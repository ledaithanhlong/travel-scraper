'use strict';

/**
 * scraper-v4.js — Vietravel Tour Price Scraper
 *
 * Flow mới (xác nhận từ DOM thực tế 12/5/2026):
 *   Bước 1: scrapeVietravelListing
 *           Scroll listing đến khi article[data-track="tour-card"] ổn định.
 *           Mỗi card extract: pid (từ srcset), tourName (từ aria-label),
 *           departure/duration/price (từ contentBody lines), category (từ badge).
 *           Đồng thời bắt Bearer token từ network request.
 *
 *   Bước 2: getTourCodeFromDetail
 *           Vào /chuong-trinh/pid-[pid], parse "Mã chương trình" từ DOM.
 *
 *   Bước 3: fetchPrices
 *           Gọi API get-tour-info-day?tourCode=[tourCode] cho từng tháng.
 *           Kèm fetchSeats qua get-tour-detail-day nếu cần.
 *
 *   Bước 4: saveToDb
 *           POST tourInfo + priceRecords về PHP endpoint.
 *
 * Cách chạy:
 *   node scraper-v4.js
 */

const { chromium } = require('playwright');
const https = require('https');
const http  = require('http');

// ============================================================
// CONFIG
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
    phpSaveUrl:   'http://localhost/travel-scraper/api/save_tours_v2.php',
    apiBase:      'https://api2.travel.com.vn/core/tour',
    requestDelay: 800,   // delay giữa các API call giá
    pageDelay:    2000,  // delay giữa các lần vào trang chi tiết
    detailDelay:  1500,  // delay chờ trang chi tiết render
};

// ============================================================
// CHUẨN HÓA
// ============================================================
const DEPARTURE_CITY_MAP = {
    'hồ chí minh': 'TP. Hồ Chí Minh', 'ho chi minh': 'TP. Hồ Chí Minh',
    'tp.hcm': 'TP. Hồ Chí Minh', 'tp hcm': 'TP. Hồ Chí Minh',
    'hà nội': 'Hà Nội',   'ha noi': 'Hà Nội',
    'đà nẵng': 'Đà Nẵng', 'da nang': 'Đà Nẵng',
    'cần thơ': 'Cần Thơ', 'can tho': 'Cần Thơ',
    'hải phòng': 'Hải Phòng',
};

const COUNTRY_KEYWORDS = [
    ['nhật bản', 'Nhật Bản'], ['japan', 'Nhật Bản'],
    ['hàn quốc', 'Hàn Quốc'], ['korea', 'Hàn Quốc'],
    ['trung quốc', 'Trung Quốc'], ['china', 'Trung Quốc'],
    ['côn minh', 'Trung Quốc'], ['lệ giang', 'Trung Quốc'], ['thượng hải', 'Trung Quốc'],
    ['thái lan', 'Thái Lan'], ['thailand', 'Thái Lan'], ['bangkok', 'Thái Lan'],
    ['singapore', 'Singapore'],
    ['indonesia', 'Indonesia'], ['bali', 'Indonesia'],
    ['malaysia', 'Malaysia'], ['kuala lumpur', 'Malaysia'],
    ['campuchia', 'Campuchia'], ['cambodia', 'Campuchia'], ['angkor', 'Campuchia'],
    ['pháp', 'Pháp'], ['france', 'Pháp'], ['paris', 'Pháp'],
    ['ý', 'Ý'], ['italy', 'Ý'], ['rome', 'Ý'],
    ['đức', 'Đức'], ['germany', 'Đức'],
    ['anh', 'Anh'], ['london', 'Anh'],
    ['thụy sĩ', 'Thụy Sĩ'], ['switzerland', 'Thụy Sĩ'],
    ['áo', 'Áo'], ['austria', 'Áo'], ['vienna', 'Áo'],
    ['séc', 'Séc'], ['czech', 'Séc'], ['prague', 'Séc'],
    ['na uy', 'Na Uy'], ['norway', 'Na Uy'],
    ['đan mạch', 'Đan Mạch'], ['denmark', 'Đan Mạch'],
    ['úc', 'Úc'], ['australia', 'Úc'], ['sydney', 'Úc'],
    ['mỹ', 'Mỹ'], ['usa', 'Mỹ'], ['new york', 'Mỹ'],
    ['việt nam', 'Việt Nam'], ['vietnam', 'Việt Nam'],
];

const REGION_MAP = {
    'Việt Nam':   'Đông Nam Á',
    'Thái Lan':   'Đông Nam Á', 'Singapore': 'Đông Nam Á',
    'Indonesia':  'Đông Nam Á', 'Malaysia':  'Đông Nam Á', 'Campuchia': 'Đông Nam Á',
    'Nhật Bản':   'Đông Bắc Á', 'Hàn Quốc': 'Đông Bắc Á', 'Trung Quốc': 'Đông Bắc Á',
    'Pháp':       'Châu Âu', 'Ý':       'Châu Âu', 'Đức':    'Châu Âu',
    'Anh':        'Châu Âu', 'Thụy Sĩ': 'Châu Âu', 'Áo':     'Châu Âu',
    'Séc':        'Châu Âu', 'Na Uy':   'Châu Âu', 'Đan Mạch': 'Châu Âu',
    'Úc':         'Châu Úc',
    'Mỹ':         'Châu Mỹ',
};

// ============================================================
// UTILS
// ============================================================
function log(msg) {
    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    console.log(`[${now}] ${msg}`);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeDeparture(raw) {
    if (!raw) return '';
    const lower = raw.toLowerCase().trim();
    for (const [key, val] of Object.entries(DEPARTURE_CITY_MAP)) {
        if (lower.includes(key)) return val;
    }
    return raw.trim().substring(0, 50);
}

function extractCountry(tourName, tourType) {
    if (tourType === 'domestic') return 'Việt Nam';
    if (!tourName) return 'Chưa xác định';
    const lower = tourName.toLowerCase();
    for (const [keyword, country] of COUNTRY_KEYWORDS) {
        if (lower.includes(keyword)) return country;
    }
    return 'Chưa xác định';
}

function extractRegion(country) {
    return REGION_MAP[country] || 'Khác';
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
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

function postToPhp(url, data) {
    return new Promise((resolve, reject) => {
        const body   = JSON.stringify(data);
        const parsed = new URL(url);
        const options = {
            hostname: parsed.hostname,
            path:     parsed.pathname,
            port:     parsed.port || 80,
            method:   'POST',
            headers:  {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
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
// BƯỚC 1: SCRAPE LISTING
// Scroll đến khi article[data-track="tour-card"] ổn định.
// Bắt token từ network request đồng thời.
// ============================================================
async function scrapeVietravelListing(browser, listingUrl, tourType) {
    const page = await browser.newPage();
    let token    = null;
    let clientId = null;

    page.on('request', req => {
        const auth = req.headers()['authorization'];
        const cid  = req.headers()['clientid'];
        if (auth && auth.startsWith('Bearer ') && !token) {
            token    = auth.replace('Bearer ', '');
            clientId = cid || '';
            log(`  Token OK | ClientId: ${clientId ? clientId.substring(0, 8) + '...' : 'none'}`);
        }
    });

    let tours = [];

    try {
        log(`Mở listing (${tourType}): ${listingUrl}`);
        await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await delay(3000);

        // Scroll đến khi số card ổn định qua 2 vòng kiểm tra liên tiếp
        let prevCount    = 0;
        let stableRounds = 0;
        for (let i = 0; i < 60; i++) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
            await delay(600);

            if (i % 5 === 4) {
                const currentCount = await page.evaluate(() =>
                    document.querySelectorAll('article[data-track="tour-card"]').length
                );
                log(`  Scroll ${i + 1}: ${currentCount} cards`);

                if (currentCount === prevCount) {
                    stableRounds++;
                    if (stableRounds >= 2) { log('  Dừng scroll — không load thêm'); break; }
                } else {
                    stableRounds = 0;
                    prevCount    = currentCount;
                }
            }
        }
        await delay(1500);

        // Debug: log thử 1 card để xác nhận selector trước khi parse full
        const debugInfo = await page.evaluate(() => {
            const card = document.querySelector('article[data-track="tour-card"]');
            if (!card) return 'NO CARD';
            const img = card.querySelector('img[srcset], img[src]');
            const btn = card.querySelector('button[aria-label^="Đặt tour"]');
            return JSON.stringify({
                srcset: (img?.getAttribute('srcset') || '').substring(0, 60),
                src:    (img?.getAttribute('src')    || '').substring(0, 60),
                pid:    (img?.getAttribute('srcset') || img?.getAttribute('src') || '').match(/tf__\d+_(\d+)_/)?.[1] || 'NOT FOUND',
                btn:    (btn?.getAttribute('aria-label') || '').substring(0, 50),
            });
        });
        log(`  [DEBUG] Card mẫu: ${debugInfo}`);

        // Parse tất cả card trong DOM
        tours = await page.evaluate((type) => {
            const SKIP = new Set(['Xem chi tiết', 'Giá từ:', 'Đặt ngay']);

            return [...document.querySelectorAll('article[data-track="tour-card"]')].map(card => {
                // pid từ srcset hoặc src: pattern tf__\d+_[pid]_
                const img = card.querySelector('img[srcset], img[src]');
                const srcFull = img?.getAttribute('srcset') || img?.getAttribute('src') || '';
                const pidMatch = srcFull.match(/tf__\d+_(\d+)_/);
                // Fallback: tìm pid trong bất kỳ attribute nào của card chứa pattern
                let pid = pidMatch ? pidMatch[1] : '';
                if (!pid) {
                    const html = card.innerHTML;
                    const m2 = html.match(/tf__\d+_(\d+)_/);
                    if (m2) pid = m2[1];
                }

                // tourName từ aria-label của button CTA
                const btn      = card.querySelector('button[aria-label^="Đặt tour"]');
                const ariaLabel = btn?.getAttribute('aria-label') || '';
                const tourName  = ariaLabel
                    .replace(/^Đặt tour\s+/i, '')
                    .replace(/\s+ngay$/i, '')
                    .trim();

                // category từ badge (Tiêu chuẩn / Tiết kiệm / Cao cấp / Giá tốt)
                const badge    = card.querySelector('[class*="badge"], [class*="label"], [class*="tag"]');
                const category = badge?.innerText?.trim() || '';

                // lines từ contentBody
                // rawLines[0] = tên tour (bỏ qua), [1] = departure, [2] = duration, có ₫ = price
                const body     = card.querySelector('[class*="contentBody"]');
                const rawLines = (body?.innerText || '')
                    .split('\n').map(l => l.trim()).filter(Boolean);
                const dataLines = rawLines.slice(1).filter(l => !SKIP.has(l));

                const departure = dataLines[0] || '';
                const duration  = dataLines[1] || '';
                const priceRaw  = dataLines.find(l => l.includes('₫')) || '';
                const priceFrom = parseInt(priceRaw.replace(/[^\d]/g, ''), 10) || 0;

                return { pid, tourName, departure, duration, priceFrom, category, tourType: type };
            });
        }, tourType);

    } catch (err) {
        log(`[ERROR] scrapeVietravelListing: ${err.message}`);
    } finally {
        await page.close();
    }

    // Normalize departure sau khi ra khỏi browser context
    tours = tours
        .filter(t => t.pid)   // bỏ card không lấy được pid
        .map(t => ({ ...t, departure: normalizeDeparture(t.departure) }));

    log(`Listing ${tourType}: ${tours.length} tours | token: ${token ? 'OK' : 'FAIL'}`);
    return { token, clientId, tours };
}

// ============================================================
// BƯỚC 2: LẤY TOURCODE TỪ TRANG CHI TIẾT
// URL: https://travel.com.vn/chuong-trinh/pid-[pid]
// ============================================================
async function getTourCodeFromDetail(browser, pid) {
    const page = await browser.newPage();
    try {
        const url = `https://travel.com.vn/chuong-trinh/pid-${pid}`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await delay(CONFIG.detailDelay);

        const tourCode = await page.evaluate(() => {
            // Ưu tiên: tìm element leaf node khớp pattern tourCode
            // có element cha chứa "Mã chương trình"
            for (const el of document.querySelectorAll('*')) {
                if (el.children.length > 0) continue;
                const text = el.innerText?.trim() || '';
                if (!/^[A-Z]{2,5}[A-Z0-9]{0,5}[0-9]{2,6}$/.test(text)) continue;
                const parentText = el.parentElement?.innerText || '';
                if (parentText.includes('Mã chương trình') || parentText.includes('chương trình')) {
                    return text;
                }
            }
            // Fallback: regex trên toàn bộ innerText
            const m = document.body.innerText
                .match(/Mã chương trình[^\n]*?([A-Z]{2,5}[A-Z0-9]{0,5}[0-9]{2,6})/);
            return m ? m[1] : '';
        });

        return tourCode;
    } catch {
        return '';
    } finally {
        await page.close();
    }
}

// ============================================================
// BƯỚC 3A: FETCH SỐ CHỖ QUA get-tour-detail-day
// ============================================================
async function fetchSeats(subTourCode, token, clientId) {
    const headers = {
        'Authorization': `Bearer ${token}`,
        'ClientId':      clientId || '',
        'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
    };
    const url = `${CONFIG.apiBase}/get-tour-detail-day/tourCode=${subTourCode}`;
    try {
        const data = await httpGet(url, headers);
        if (data && data.status === 1 && data.response) {
            return data.response.remainPax ?? null;
        }
    } catch { /* ignore */ }
    return null;
}

// ============================================================
// BƯỚC 3: FETCH GIÁ TOUR QUA API (tất cả các tháng trong CONFIG)
// ============================================================
async function fetchPrices(tourCode, token, clientId) {
    const headers = {
        'Authorization': `Bearer ${token}`,
        'ClientId':      clientId || '',
        'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
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
                            let seats = t.seatsAvailable || t.availableSeats || null;
                            if (!seats && subCode) {
                                seats = await fetchSeats(subCode, token, clientId);
                                await delay(200);
                            }
                            records.push({
                                subTourCode:   subCode,
                                departureDate: t.departureDate || day.date,
                                salePrice:     t.salePrice || day.salePrice || 0,
                                priceFinal:    day.priceFinal || t.salePrice || 0,
                                discountAmount: day.discountAmount || 0,
                                isDiscount:    day.isDiscount ? 1 : 0,
                                seatsAvailable: seats,
                            });
                        }
                    } else if (day.salePrice > 0) {
                        records.push({
                            subTourCode:   '',
                            departureDate: day.date,
                            salePrice:     day.salePrice,
                            priceFinal:    day.priceFinal || 0,
                            discountAmount: day.discountAmount || 0,
                            isDiscount:    day.isDiscount ? 1 : 0,
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
// BƯỚC 4: LƯU VÀO DB QUA PHP
// POST: { tourInfo, priceRecords, scrapedAt }
// GET:  save_tours_v2.php nhận và ghi vào DB
// ============================================================
async function saveToDb(tourInfo, priceRecords) {
    if (priceRecords.length === 0) return 0;
    try {
        const res    = await postToPhp(CONFIG.phpSaveUrl, {
            tourInfo,
            priceRecords,
            scrapedAt: new Date().toISOString(),
        });
        const parsed = JSON.parse(res);
        if (parsed.savedPrices) {
            log(`  -> DB: saved ${parsed.savedPrices} prices`);
            return parsed.savedPrices;
        }
        if (parsed.error) {
            log(`  -> DB ERROR: ${parsed.error}`);
        }
    } catch (err) {
        log(`  [ERROR] saveToDb: ${err.message}`);
    }
    return 0;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
    log('=== Vietravel Tour Scraper V4 ===');
    log('Flow: Listing (DOM card) -> Detail (pid -> tourCode) -> API gia -> DB');

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
    });

    let totalTours   = 0;
    let totalRecords = 0;

    try {
        for (const [typeName, typeCfg] of [
            ['TRONG NUOC',  CONFIG.domestic],
            ['NUOC NGOAI',  CONFIG.international],
        ]) {
            log(`\n--- ${typeName} ---`);

            // Bước 1: Scrape listing
            const { token, clientId, tours } = await scrapeVietravelListing(
                browser, typeCfg.listingUrl, typeCfg.tourType
            );

            if (!token) {
                log(`[FATAL] Không lấy được token cho ${typeName} — bỏ qua`);
                continue;
            }
            if (tours.length === 0) {
                log(`[WARN] Không parse được tour nào — kiểm tra selector`);
                continue;
            }

            log(`Tổng ${tours.length} tours — bắt đầu lấy tourCode + giá...\n`);

            for (let i = 0; i < tours.length; i++) {
                const tour = tours[i];
                const prefix = `[${typeCfg.tourType === 'domestic' ? 'TN' : 'NN'}] ${i + 1}/${tours.length}`;
                log(`${prefix} pid:${tour.pid} | ${tour.tourName.substring(0, 50)}`);

                // Bước 2: Lấy tourCode từ trang chi tiết
                const tourCode = await getTourCodeFromDetail(browser, tour.pid);
                if (!tourCode) {
                    log(`  [SKIP] Không lấy được tourCode`);
                    await delay(CONFIG.pageDelay);
                    continue;
                }
                log(`  tourCode: ${tourCode}`);

                // Build tourInfo đầy đủ để lưu DB
                const country  = extractCountry(tour.tourName, typeCfg.tourType);
                const region   = extractRegion(country);
                const tourInfo = {
                    tourCode,
                    pid:        tour.pid,
                    tourName:   tour.tourName,
                    departure:  tour.departure,
                    duration:   tour.duration,
                    priceFrom:  tour.priceFrom,
                    category:   tour.category,
                    tourType:   tour.tourType,
                    country,
                    region,
                    source:     'vietravel',
                };

                // Bước 3: Fetch giá
                const prices = await fetchPrices(tourCode, token, clientId);

                // Bước 4: Lưu DB
                const saved  = await saveToDb(tourInfo, prices);
                totalRecords += saved;
                totalTours++;

                await delay(CONFIG.pageDelay);
            }
        }

    } finally {
        await browser.close();
    }

    log('\n=== Scraper V4 Hoàn thành! ===');
    log(`Tours xử lý: ${totalTours}`);
    log(`Price records đã lưu: ${totalRecords}`);
}

main().catch(err => log(`[FATAL] ${err.message}`));