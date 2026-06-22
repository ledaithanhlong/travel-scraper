const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

// ============================================================
// CAU HINH
// ============================================================
const CONFIG = {
    domestic: {
        listingUrl: 'https://travel.com.vn/du-lich-viet-nam.aspx',
        tourType: 'domestic',
    },
    international: {
        listingUrl: 'https://travel.com.vn/du-lich-nuoc-ngoai.aspx',
        tourType: 'international',
    },
    months: [
        { month: 5, year: 2026 },
        { month: 6, year: 2026 },
        { month: 7, year: 2026 },
        { month: 8, year: 2026 },
    ],
    phpSaveUrl: 'http://localhost/travel-scraper/api/save_tours_v2.php',
    apiBase: 'https://api2.travel.com.vn/core/tour',
    requestDelay: 800,
    pageDelay: 2000,
};

function log(msg) {
    const now = new Date().toLocaleString('vi-VN');
    console.log(`[${now}] ${msg}`);
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { headers }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(null); }
            });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
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
// BUOC 1: LAY DANH SACH TOUR TU TRANG LISTING (V2 approach)
// Dung innerText + regex - on dinh hon DOM selector
// ============================================================
async function getTourListFromPage(browser, listingUrl, tourType) {
    log(`Dang mo: ${listingUrl}`);
    const page = await browser.newPage();
    const tours = [];

    try {
        await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await delay(3000);

        // Scroll de load het lazy content
        for (let i = 0; i < 20; i++) {
            await page.evaluate(() => window.scrollBy(0, 600));
            await delay(500);
        }
        await delay(2000);

        // Lay toan bo text va extract tourCode bang regex
        const pageText = await page.evaluate(() => document.body.innerText);

        const tourMap = {};
        const codeRegex = /\b([A-Z]{2,4}[A-Z0-9]{0,4}[0-9]{2,6})\b/g;
        let m;
        while ((m = codeRegex.exec(pageText)) !== null) {
            const code = m[1];
            if (code.length >= 6 && code.length <= 12) tourMap[code] = true;
        }

        log(`Tim thay ${Object.keys(tourMap).length} tour codes`);

        // Lay thong tin co ban tu context xung quanh tourCode
        for (const code of Object.keys(tourMap)) {
            const idx = pageText.indexOf(code);
            if (idx === -1) continue;

            const context = pageText.substring(Math.max(0, idx - 100), idx + 400);
            const lines = context.split('\n').map(l => l.trim()).filter(l => l.length > 15);

            // Lay thong tin co ban - ten tour se duoc lay chinh xac tu trang chi tiet
            const durMatch = context.match(/(\d+N\d*[DĐ])/i);
            const depMatch = context.match(/Kh[oở]i h[aà]nh[:\s]+([^\n]{2,30})/);

            let vehicle = '';
            if (context.includes('Máy bay')) vehicle = 'Máy bay';
            else if (context.includes('Tàu hỏa')) vehicle = 'Tàu hỏa';
            else if (context.includes('Xe')) vehicle = 'Xe';

            let category = '';
            if (context.includes('Tiết kiệm')) category = 'Tiết kiệm';
            else if (context.includes('Cao cấp')) category = 'Cao cấp';
            else if (context.includes('Tiêu chuẩn')) category = 'Tiêu chuẩn';
            else if (context.includes('Giá Tốt')) category = 'Giá Tốt';
            else if (context.includes('ESG')) category = 'ESG & LEI';

            const priceMatch = context.match(/([\d,.]+)\s*[₫đ]/);

            tours.push({
                tourCode: code,
                tourName: '', // Se duoc cap nhat tu trang chi tiet
                duration: durMatch ? durMatch[1] : '',
                departure: depMatch ? depMatch[1].trim().substring(0, 50) : '',
                vehicle,
                category,
                priceFrom: priceMatch ? parseInt(priceMatch[1].replace(/[,.]/g, '')) || 0 : 0,
                tourType,
            });
        }

    } catch (err) {
        log(`[ERROR] ${err.message}`);
    } finally {
        await page.close();
    }

    return tours;
}

// ============================================================
// BUOC 2: LAY TEN TOUR CHINH XAC TU DOCUMENT.TITLE
// Format: "Dat tour [Ten tour] cung Vietravel"
// ============================================================
async function getTourName(browser, tourCode) {
    const page = await browser.newPage();
    try {
        // Lay link trang chi tiet tu trang listing
        const searchUrl = `https://travel.com.vn/tim-kiem.aspx?keyword=${tourCode}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await delay(2000);

        // Tim link chuong trinh chua tourCode
        const link = await page.evaluate((code) => {
            const anchors = [...document.querySelectorAll('a[href*="chuong-trinh"]')];
            const found = anchors.find(a => a.href.includes(code.toLowerCase()) ||
                document.body.innerText.includes(code));
            return found ? found.href.split('?')[0] : '';
        }, tourCode);

        if (!link) {
            // Fallback: thu tim qua trang listing chinh
            await page.close();
            return '';
        }

        // Vao trang chi tiet lay title
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await delay(2000);

        const title = await page.evaluate(() => {
            // Lay tu document.title va cat bo prefix/suffix
            let t = document.title || '';
            t = t.replace(/^Đặt tour\s*/i, '').replace(/\s*cùng Vietravel\s*$/i, '').trim();
            return t;
        });

        return title;

    } catch (err) {
        return '';
    } finally {
        await page.close();
    }
}

// ============================================================
// BUOC 3: LAY TEN TOUR BANG CACH VAO TRUC TIEP TRANG CHI TIET
// Tu link duoc lay tu trang listing
// ============================================================
async function getTourNameFromLink(browser, link) {
    const page = await browser.newPage();
    try {
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await delay(2000);

        const title = await page.evaluate(() => {
            let t = document.title || '';
            // Cat "Dat tour " o dau va " cung Vietravel" o cuoi
            t = t.replace(/^Đặt tour\s*/i, '').replace(/\s*cùng Vietravel\s*$/i, '').trim();
            return t;
        });

        return title;
    } catch (err) {
        return '';
    } finally {
        await page.close();
    }
}

// ============================================================
// BUOC 4: LAY LINK VA TOURCODE CUNG LUC TU TRANG LISTING
// ============================================================
async function getTourLinksAndCodes(browser, listingUrl, tourType) {
    log(`Dang mo listing de lay links: ${listingUrl}`);
    const page = await browser.newPage();
    const results = [];

    try {
        await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await delay(3000);

        for (let i = 0; i < 20; i++) {
            await page.evaluate(() => window.scrollBy(0, 600));
            await delay(500);
        }
        await delay(2000);

        // Lay ca text lan links
        const data = await page.evaluate((type) => {
            const pageText = document.body.innerText;

            // Lay links theo thu tu tu tren xuong duoi, moi tour 1 link
            const anchors = [...document.querySelectorAll('a[href*="chuong-trinh"]')];
            const seen = new Set();
            const links = [];
            anchors.forEach(a => {
                const url = a.href.split('?')[0];
                if (!seen.has(url)) {
                    seen.add(url);
                    links.push(url);
                }
            });

            // Extract tourCode tu text
            const tourMap = {};
            const codeRegex = /\b([A-Z]{2,4}[A-Z0-9]{0,4}[0-9]{2,6})\b/g;
            let m;
            while ((m = codeRegex.exec(pageText)) !== null) {
                const code = m[1];
                if (code.length >= 6 && code.length <= 12) {
                    const idx = pageText.indexOf(code);
                    const context = pageText.substring(Math.max(0, idx - 100), idx + 400);

                    const durMatch = context.match(/(\d+N\d*[DĐ])/i);
                    const depMatch = context.match(/Kh[oở]i h[aà]nh[:\s]+([^\n]{2,30})/);

                    let vehicle = '';
                    if (context.includes('Máy bay')) vehicle = 'Máy bay';
                    else if (context.includes('Tàu hỏa')) vehicle = 'Tàu hỏa';
                    else if (context.includes('Xe')) vehicle = 'Xe';

                    let category = '';
                    if (context.includes('Tiết kiệm')) category = 'Tiết kiệm';
                    else if (context.includes('Cao cấp')) category = 'Cao cấp';
                    else if (context.includes('Tiêu chuẩn')) category = 'Tiêu chuẩn';
                    else if (context.includes('Giá Tốt')) category = 'Giá Tốt';
                    else if (context.includes('ESG')) category = 'ESG & LEI';

                    const priceMatch = context.match(/([\d,.]+)\s*[₫đ]/);

                    tourMap[code] = {
                        tourCode: code,
                        duration: durMatch ? durMatch[1] : '',
                        departure: depMatch ? depMatch[1].trim().substring(0, 50) : '',
                        vehicle,
                        category,
                        priceFrom: priceMatch ? parseInt(priceMatch[1].replace(/[,.]/g, '')) || 0 : 0,
                        tourType: type,
                    };
                }
            }

            return { links, tourMap };
        }, tourType);

        log(`Tim thay ${data.links.length} links, ${Object.keys(data.tourMap).length} tourCodes`);

        // Map link voi tourCode theo thu tu xuat hien tren trang
        // Ca link va tourCode deu lay theo thu tu tu tren xuong duoi
        const codes = Object.keys(data.tourMap);
        const links = data.links;

        // Moi link tuong ung voi 1 tourCode theo thu tu
        for (let i = 0; i < Math.min(codes.length, links.length); i++) {
            results.push({
                ...data.tourMap[codes[i]],
                link: links[i] || '',
            });
        }

        // Them cac tour khong co link
        for (let i = links.length; i < codes.length; i++) {
            results.push({
                ...data.tourMap[codes[i]],
                link: '',
            });
        }

        log(`Tong: ${results.length} tours (co link: ${results.filter(r => r.link).length})`);

    } catch (err) {
        log(`[ERROR] ${err.message}`);
    } finally {
        await page.close();
    }

    return results;
}

// ============================================================
// BUOC 5: CAPTURE TOKEN
// ============================================================
async function captureToken(browser) {
    log('Capturing token...');
    const page = await browser.newPage();
    let token = null;
    let clientId = null;

    page.on('request', req => {
        const url = req.url();
        if (url.includes('api2.travel.com.vn')) {
            const auth = req.headers()['authorization'];
            const cid = req.headers()['clientid'];
            if (auth && auth.startsWith('Bearer ') && !token) {
                token = auth.replace('Bearer ', '');
                clientId = cid || '';
                log(`Token OK! ClientId: ${clientId ? 'yes' : 'no'}`);
            }
        }
    });

    try {
        await page.goto('https://travel.com.vn/du-lich-nuoc-ngoai.aspx', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await delay(3000);
        // Scroll de kich hoat API call
        await page.evaluate(() => window.scrollBy(0, 500));
        await delay(3000);
        await page.evaluate(() => window.scrollBy(0, 500));
        await delay(2000);
    } catch (err) {
        log(`[WARN] Token capture: ${err.message}`);
    } finally {
        await page.close();
    }

    return { token, clientId };
}

// ============================================================
// BUOC 6A: FETCH SEATS QUA get-tour-detail-day
// ============================================================
async function fetchSeats(subTourCode, token, clientId) {
    const headers = {
        'Authorization': `Bearer ${token}`,
        'ClientId': clientId || '',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
    };
    const url = `${CONFIG.apiBase}/get-tour-detail-day/tourCode=${subTourCode}`;
    try {
        const data = await httpGet(url, headers);
        if (data && data.status === 1 && data.response) {
            return data.response.remainPax ?? null;
        }
    } catch {
        // ignore
    }
    return null;
}

// ============================================================
// BUOC 6: FETCH GIA TOUR QUA API
// ============================================================
async function fetchPrices(tourCode, token, clientId) {
    const headers = {
        'Authorization': `Bearer ${token}`,
        'ClientId': clientId || '',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
    };

    const records = [];

    for (const { month, year } of CONFIG.months) {
        const url = `${CONFIG.apiBase}/get-tour-info-day?tourCode=${tourCode}&month=${month}&year=${year}`;
        try {
            const data = await httpGet(url, headers);
            if (data && data.status === 1 && Array.isArray(data.response)) {
                for (const day of data.response) {
                    const tourList = day.tours || [];
                    if (tourList.length > 0) {
                        for (const t of tourList) {
                            const subCode = t.tourCode || '';
                            // Lay seats tu get-tour-detail-day neu co subTourCode
                            let seats = t.seatsAvailable || t.availableSeats || null;
                            if (!seats && subCode) {
                                seats = await fetchSeats(subCode, token, clientId);
                                await delay(200);
                            }
                            records.push({
                                subTourCode: subCode,
                                departureDate: t.departureDate || day.date,
                                salePrice: t.salePrice || day.salePrice || 0,
                                priceFinal: day.priceFinal || t.salePrice || 0,
                                discountAmount: day.discountAmount || 0,
                                isDiscount: day.isDiscount ? 1 : 0,
                                seatsAvailable: seats,
                            });
                        }
                    } else if (day.salePrice > 0) {
                        records.push({
                            subTourCode: '',
                            departureDate: day.date,
                            salePrice: day.salePrice,
                            priceFinal: day.priceFinal || 0,
                            discountAmount: day.discountAmount || 0,
                            isDiscount: day.isDiscount ? 1 : 0,
                            seatsAvailable: null,
                        });
                    }
                }
                log(`  [${tourCode}] ${month}/${year} -> ${records.length} records`);
            }
        } catch (err) {
            log(`  [${tourCode}] ${month}/${year} ERROR: ${err.message}`);
        }
        await delay(CONFIG.requestDelay);
    }

    return records;
}

// ============================================================
// BUOC 7: LUU VAO DB QUA PHP
// ============================================================
async function saveToDb(tourInfo, priceRecords) {
    if (priceRecords.length === 0) return;
    try {
        const res = await postToPhp(CONFIG.phpSaveUrl, {
            tourInfo,
            priceRecords,
            scrapedAt: new Date().toISOString()
        });
        const parsed = JSON.parse(res);
        if (parsed.savedPrices) {
            log(`  -> DB: saved ${parsed.savedPrices} prices`);
        }
    } catch (err) {
        log(`  [ERROR] Save DB: ${err.message}`);
    }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
    log('=== Tour Price Scraper V3 Started ===');
    log('Flow: Listing (regex tourCode) -> Chi tiet (document.title) -> API gia');

    const browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
    });

    try {
        const { token, clientId } = await captureToken(browser);
        if (!token) {
            log('[FATAL] Khong lay duoc token. Dung.');
            return;
        }

        const allTours = [];

        // --- TRONG NUOC ---
        log('\n--- SCRAPING TRONG NUOC ---');
        const domesticList = await getTourLinksAndCodes(browser, CONFIG.domestic.listingUrl, 'domestic');

        for (let i = 0; i < domesticList.length; i++) {
            const item = domesticList[i];
            log(`[TN] ${i + 1}/${domesticList.length} - ${item.tourCode}`);

            // Lay ten tour chinh xac tu document.title
            let tourName = '';
            if (item.link) {
                tourName = await getTourNameFromLink(browser, item.link);
            }

            allTours.push({
                ...item,
                tourName: tourName || item.tourCode,
                source: 'vietravel',
            });

            if (tourName) {
                log(`  OK: ${item.tourCode} - ${tourName.substring(0, 60)}`);
            } else {
                log(`  SKIP ten: Khong lay duoc title, dung tourCode`);
            }

            await delay(CONFIG.pageDelay);
        }

        // --- NUOC NGOAI ---
        log('\n--- SCRAPING NUOC NGOAI ---');
        const intlList = await getTourLinksAndCodes(browser, CONFIG.international.listingUrl, 'international');

        for (let i = 0; i < intlList.length; i++) {
            const item = intlList[i];
            log(`[NN] ${i + 1}/${intlList.length} - ${item.tourCode}`);

            let tourName = '';
            if (item.link) {
                tourName = await getTourNameFromLink(browser, item.link);
            }

            allTours.push({
                ...item,
                tourName: tourName || item.tourCode,
                source: 'vietravel',
            });

            if (tourName) {
                log(`  OK: ${item.tourCode} - ${tourName.substring(0, 60)}`);
            } else {
                log(`  SKIP ten: Khong lay duoc title, dung tourCode`);
            }

            await delay(CONFIG.pageDelay);
        }

        const domesticCount = allTours.filter(t => t.tourType === 'domestic').length;
        const intlCount = allTours.filter(t => t.tourType === 'international').length;
        log(`\nTong: ${allTours.length} tours (${domesticCount} TN, ${intlCount} NN)`);
        log('Bat dau fetch gia tu API...\n');

        let totalRecords = 0;
        for (const tourInfo of allTours) {
            log(`[${tourInfo.tourType === 'domestic' ? 'TN' : 'NN'}] ${tourInfo.tourCode} - ${tourInfo.tourName.substring(0, 50)}`);
            const prices = await fetchPrices(tourInfo.tourCode, token, clientId);
            await saveToDb(tourInfo, prices);
            totalRecords += prices.length;
            await delay(300);
        }

        log(`\n=== Scraper V3 Hoan thanh! ===`);
        log(`Tong: ${totalRecords} price records`);
        log(`Tours: ${allTours.length} (${domesticCount} TN + ${intlCount} NN)`);

    } finally {
        await browser.close();
    }
}

main().catch(err => log(`[FATAL] ${err.message}`));