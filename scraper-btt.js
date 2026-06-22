const { chromium } = require('playwright');
const http = require('http');

// ============================================================
// CAU HINH
// ============================================================
const CONFIG = {
    domestic: {
        listingUrl: 'https://benthanhtourist.com/diem-den/tour-trong-nuoc',
        tourType: 'domestic',
    },
    international: {
        listingUrl: 'https://benthanhtourist.com/diem-den/tour-nuoc-ngoai',
        tourType: 'international',
    },
    phpSaveUrl: 'http://localhost/travel-scraper/api/save_tours_v2.php',
    source: 'benthanhtourist',
    pageDelay: 2000,
    requestDelay: 500,
};

function log(msg) {
    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    console.log(`[${now}] ${msg}`);
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function postToPhp(url, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const parsed = new URL(url);
        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname,
            port: parsed.port || 80,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        const req = http.request(options, (res) => {
            let result = '';
            res.on('data', c => result += c);
            res.on('end', () => resolve(result));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ============================================================
// BUOC 1: LAY TAT CA LINK TOUR TU TRANG LISTING
// ============================================================
async function getTourLinksFromListing(browser, listingUrl) {
    log(`Dang mo listing: ${listingUrl}`);
    const page = await browser.newPage();
    const tourLinks = [];

    try {
        await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await delay(2000);

        // Scroll de load het content
        for (let i = 0; i < 10; i++) {
            await page.evaluate(() => window.scrollBy(0, 800));
            await delay(500);
        }
        await delay(1000);

        // Lay tat ca link /tour/ (trang chi tiet)
        const links = await page.evaluate(() => {
            const anchors = [...document.querySelectorAll('a[href*="/tour/"]')];
            const seen = new Set();
            const result = [];
            anchors.forEach(a => {
                const href = a.href.split('?')[0]; // Bo ?item=... lay URL goc
                if (href.includes('/tour/') && !seen.has(href)) {
                    seen.add(href);
                    result.push(href);
                }
            });
            return result;
        });

        tourLinks.push(...links);
        log(`Trang 1: ${links.length} tour links`);

        // Lay so trang tu pagination
        const totalPages = await page.evaluate(() => {
            const pageLinks = [...document.querySelectorAll('.pagination a, .page-item a, nav[aria-label="pagination"] a')];
            const pageNums = pageLinks
                .map(a => parseInt(a.innerText.trim()))
                .filter(n => !isNaN(n));
            return pageNums.length > 0 ? Math.max(...pageNums) : 1;
        });

        log(`Tong ${totalPages} trang`);

        // Loop qua tung trang
        for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
            const pageUrl = `${listingUrl}?page=${pageNum}`;
            await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await delay(2000);

            const pageLinks = await page.evaluate(() => {
                const anchors = [...document.querySelectorAll('a[href*="/tour/"]')];
                const seen = new Set();
                const result = [];
                anchors.forEach(a => {
                    const href = a.href.split('?')[0];
                    if (href.includes('/tour/') && !seen.has(href)) {
                        seen.add(href);
                        result.push(href);
                    }
                });
                return result;
            });

            tourLinks.push(...pageLinks);
            log(`Trang ${pageNum}: ${pageLinks.length} tour links`);
            await delay(CONFIG.requestDelay);
        }

    } catch (err) {
        log(`[ERROR] getTourLinksFromListing: ${err.message}`);
    } finally {
        await page.close();
    }

    // De-duplicate
    const unique = [...new Set(tourLinks)];
    log(`Tong: ${unique.length} tour links duy nhat`);
    return unique;
}

// ============================================================
// BUOC 2: SCRAPE THONG TIN VA LICH KHAI HANH TU TRANG CHI TIET
// ============================================================
async function scrapeTourDetail(browser, tourUrl, tourType) {
    const page = await browser.newPage();
    try {
        await page.goto(tourUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await delay(2000);

        const data = await page.evaluate(() => {
            // Ten tour
            const h1 = document.querySelector('h1, .tour-title, .title');
            const tourName = h1 ? h1.innerText.trim() : document.title
                .replace(/\s*\|\s*.*$/, '').trim();

            // Thong tin co ban tu trang hien tai
            const bodyText = document.body.innerText;

            // Ma tour chinh (tu trang hien tai)
            const maMatch = bodyText.match(/Mã tour\s*[:\s]+([A-Z0-9]{6,20})/);
            const mainTourCode = maMatch ? maMatch[1] : '';

            // Thoi gian - convert "X ngay Y dem" -> "XNYD"
            const tgMatch = bodyText.match(/Thời gian\s*[:\s]+([^\n]{3,30})/);
            let duration = '';
            if (tgMatch) {
                const raw = tgMatch[1].trim();
                const nd = raw.match(/(\d+)\s*ng[aà]y\s*(\d+)\s*đêm/i);
                if (nd) duration = nd[1] + 'N' + nd[2] + 'Đ';
                else duration = raw;
            }

            // Diem khoi hanh - chuan hoa ten thanh pho
            const depMatch = bodyText.match(/Khởi hành\s*[:\s]+([^\n]{2,50})/);
            let departure = depMatch ? depMatch[1].trim() : '';
            const cityMap = {
                'Hồ Chí Minh': 'TP. Hồ Chí Minh',
                'HCM': 'TP. Hồ Chí Minh',
                'TPHCM': 'TP. Hồ Chí Minh',
                'TP HCM': 'TP. Hồ Chí Minh',
                'Hà Nội': 'Hà Nội',
                'Đà Nẵng': 'Đà Nẵng',
                'Cần Thơ': 'Cần Thơ',
            };
            for (const [key, val] of Object.entries(cityMap)) {
                if (departure.includes(key)) { departure = val; break; }
            }

            // Phuong tien - tim trong text
            // Phuong tien
            let vehicle = '';
            if (bodyText.includes('Máy bay')) vehicle = 'Máy bay';
            else if (bodyText.includes('Tàu hỏa')) vehicle = 'Tàu hỏa';
            else if (bodyText.includes('Ô tô') || bodyText.includes('Xe')) vehicle = 'Xe';

            // The loai tour - detect tu ten tour
            let category = 'Tiêu chuẩn';
            if (/cao c[aấ]p/i.test(tourName)) category = 'Cao cấp';
            else if (/ti[ết] ki[ệm]/i.test(tourName)) category = 'Tiết kiệm';

            // Gia hien tai
            const giaMatch = bodyText.match(/([\d,]+)\s*VNĐ/);
            const priceFrom = giaMatch
                ? parseInt(giaMatch[1].replace(/,/g, '')) || 0
                : 0;

            // Ngay khoi hanh hien tai
            const ngayMatch = bodyText.match(/Ngày khởi hành\s*[:\s]+([\d\/]+)/);
            const currentDate = ngayMatch ? ngayMatch[1].trim() : '';

            // So cho con hien tai
            const choMatch = bodyText.match(/Số chỗ còn\s*[:\s]+(\d+)/);
            const currentSeats = choMatch ? parseInt(choMatch[1]) : null;

            // Lay tat ca lich khoi hanh tu #card-table-tour-days > ul.list-options-tour
            const schedules = [];
            const tourCards = document.querySelectorAll(
                '#card-table-tour-days ul.list-options-tour, .card-table-tour-days ul.list-options-tour'
            );

            tourCards.forEach(card => {
                const text = card.innerText || '';
                const codeMatch = text.match(/([A-Z]{2}[A-Z0-9]{1,10}\d{6,10})/);
                const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
                const priceMatch = text.match(/([\d,]+)\s*VNĐ/);
                const seatsMatch = text.match(/(\d+)/g);

                if (codeMatch && dateMatch) {
                    schedules.push({
                        subTourCode: codeMatch[1],
                        date: dateMatch[1],
                        price: priceMatch
                            ? parseInt(priceMatch[1].replace(/,/g, '')) || 0
                            : 0,
                        seats: seatsMatch ? parseInt(seatsMatch[seatsMatch.length - 1]) : null,
                    });
                }
            });

            // Neu khong co schedule tu table, dung ngay hien tai
            if (schedules.length === 0 && mainTourCode && currentDate) {
                schedules.push({
                    subTourCode: mainTourCode,
                    date: currentDate,
                    price: priceFrom,
                    seats: currentSeats,
                });
            }

            return {
                tourName,
                mainTourCode,
                duration,
                departure,
                vehicle,
                category,
                priceFrom,
                schedules,
            };
        });

        return data;

    } catch (err) {
        log(`[ERROR] scrapeTourDetail ${tourUrl}: ${err.message}`);
        return null;
    } finally {
        await page.close();
    }
}

// ============================================================
// BUOC 3: LUU VAO DB QUA PHP
// ============================================================
async function saveToDb(tourInfo, priceRecords) {
    if (priceRecords.length === 0) {
        log(`  [SKIP] Khong co lich khai hanh: ${tourInfo.tourCode}`);
        return;
    }
    try {
        const res = await postToPhp(CONFIG.phpSaveUrl, {
            tourInfo,
            priceRecords,
            scrapedAt: new Date().toISOString()
        });
        const parsed = JSON.parse(res);
        if (parsed.savedPrices) {
            log(`  -> DB: saved ${parsed.savedPrices} prices`);
        } else if (parsed.errors && parsed.errors.length > 0) {
            log(`  -> DB errors: ${parsed.errors.join(', ')}`);
        }
    } catch (err) {
        log(`  [ERROR] Save DB: ${err.message}`);
    }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
    log('=== BenThanh Tourist Scraper Started ===');
    log('Flow: Listing -> Chi tiet (HTML tinh) -> Lich khai hanh -> DB');

    const browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        let totalSaved = 0;
        let totalSkipped = 0;

        for (const [type, config] of Object.entries(CONFIG).filter(([k]) =>
            k === 'domestic' || k === 'international'
        )) {
            log(`\n--- SCRAPING ${type.toUpperCase()} ---`);

            const tourLinks = await getTourLinksFromListing(browser, config.listingUrl);

            for (let i = 0; i < tourLinks.length; i++) {
                const tourUrl = tourLinks[i];
                log(`[${type === 'domestic' ? 'TN' : 'NN'}] ${i + 1}/${tourLinks.length} - ${tourUrl.split('/tour/')[1]?.substring(0, 50)}`);

                const detail = await scrapeTourDetail(browser, tourUrl, config.tourType);

                if (!detail || !detail.mainTourCode) {
                    log(`  [SKIP] Khong lay duoc thong tin`);
                    totalSkipped++;
                    continue;
                }

                // Build tourCode tu mainTourCode
                // BTT dung format: TD1NFHN26022026XXXX -> lay phan dau lam tourCode
                const tourCodeBase = detail.mainTourCode.substring(0, detail.mainTourCode.length - 4) || detail.mainTourCode;

                const tourInfo = {
                    tourCode: tourCodeBase,
                    tourName: detail.tourName,
                    tourType: config.tourType,
                    source: CONFIG.source,
                    duration: detail.duration,
                    departure: detail.departure,
                    vehicle: detail.vehicle,
                    category: detail.category || 'Tiêu chuẩn',
                    priceFrom: detail.priceFrom,
                };

                // Convert schedules -> priceRecords
                const priceRecords = detail.schedules.map(s => {
                    // Convert DD/MM/YYYY -> YYYY-MM-DD
                    let departureDate = '';
                    if (s.date) {
                        const parts = s.date.split('/');
                        if (parts.length === 3) {
                            departureDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                        }
                    }
                    return {
                        subTourCode: s.subTourCode || tourCodeBase,
                        departureDate,
                        salePrice: s.price,
                        priceFinal: s.price,
                        discountAmount: 0,
                        isDiscount: 0,
                        seatsAvailable: s.seats,
                    };
                }).filter(r => r.departureDate);

                log(`  ${detail.tourName.substring(0, 50)} | ${priceRecords.length} lich`);
                await saveToDb(tourInfo, priceRecords);

                if (priceRecords.length > 0) totalSaved++;
                else totalSkipped++;

                await delay(CONFIG.pageDelay);
            }
        }

        log(`\n=== BTT Scraper Hoan thanh! ===`);
        log(`Saved: ${totalSaved} tours, Skipped: ${totalSkipped} tours`);

    } finally {
        await browser.close();
    }
}

main().catch(err => log(`[FATAL] ${err.message}`));