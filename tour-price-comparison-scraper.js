'use strict';

/**
 * tour-price-comparison-scraper.js
 *
 * Thu thập và so sánh dữ liệu tour du lịch từ 3 công ty:
 *   - Vietravel        (travel.com.vn)          — API nội bộ + Bearer token
 *   - BenThanh Tourist (benthanhtourist.com)     — scrape HTML tĩnh
 *   - Du Lịch Việt     (dulichviet.com.vn)       — Playwright stealth (Cloudflare)
 *
 * Cách chạy:
 *   node tour-price-comparison-scraper.js             -- cả 3 công ty
 *   node tour-price-comparison-scraper.js vietravel   -- chỉ Vietravel
 *   node tour-price-comparison-scraper.js benthanh    -- chỉ BenThanh Tourist
 *   node tour-price-comparison-scraper.js dulichviet  -- chỉ Du Lịch Việt
 */

const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

// ============================================================
// CẤU HÌNH CHUNG
// ============================================================
const CONFIG = {
    phpSaveUrl: 'http://localhost/travel-scraper/api/save_tours_v3.php',

    months: [
        { month: 5, year: 2026 },
        { month: 6, year: 2026 },
        { month: 7, year: 2026 },
        { month: 8, year: 2026 },
    ],

    vietravel: {
        companyName: 'Vietravel',
        source: 'vietravel',
        domestic:      { listingUrl: 'https://travel.com.vn/du-lich-viet-nam.aspx',   tourType: 'domestic' },
        international: { listingUrl: 'https://travel.com.vn/du-lich-nuoc-ngoai.aspx', tourType: 'international' },
        apiBase: 'https://api2.travel.com.vn/core/tour',
        requestDelay: 800,
        pageDelay: 2000,
    },

    benthanh: {
        companyName: 'BenThanh Tourist',
        source: 'benthanhtourist',
        domestic:      { listingUrl: 'https://benthanhtourist.com/diem-den/tour-trong-nuoc',  tourType: 'domestic' },
        international: { listingUrl: 'https://benthanhtourist.com/diem-den/tour-nuoc-ngoai', tourType: 'international' },
        requestDelay: 500,
        pageDelay: 2000,
    },

    dulichviet: {
        companyName: 'Du Lịch Việt',
        source: 'dulichviet',
        domestic:      { listingUrl: 'https://dulichviet.com.vn/du-lich-trong-nuoc', tourType: 'domestic' },
        international: { listingUrl: 'https://dulichviet.com.vn/du-lich-nuoc-ngoai', tourType: 'international' },
        pageDelay: 2000,
        maxPages: 50,       // tăng từ 30 → 50 để đủ số lần click Xem thêm
        pollTimeout: 15000, // tăng từ 8000 → 15000ms — DLV AJAX render chậm
        pollInterval: 600,
    },
};

// ============================================================
// DANH SÁCH CHUẨN HÓA DÙNG CHUNG
// ============================================================
const DEPARTURE_CITY_MAP = {
    'hồ chí minh': 'TP. Hồ Chí Minh', 'ho chi minh': 'TP. Hồ Chí Minh',
    'hcm': 'TP. Hồ Chí Minh', 'tphcm': 'TP. Hồ Chí Minh',
    'tp hcm': 'TP. Hồ Chí Minh', 'tp.hcm': 'TP. Hồ Chí Minh',
    'sài gòn': 'TP. Hồ Chí Minh', 'sai gon': 'TP. Hồ Chí Minh',
    'hà nội': 'Hà Nội', 'ha noi': 'Hà Nội', 'hanoi': 'Hà Nội',
    'đà nẵng': 'Đà Nẵng', 'da nang': 'Đà Nẵng',
    'cần thơ': 'Cần Thơ', 'can tho': 'Cần Thơ',
    'hải phòng': 'Hải Phòng', 'hai phong': 'Hải Phòng',
    'nha trang': 'Nha Trang',
    'đà lạt': 'Đà Lạt', 'da lat': 'Đà Lạt',
};

const COUNTRY_KEYWORDS = [
    ['nhật bản','Nhật Bản'],['japan','Nhật Bản'],
    ['hàn quốc','Hàn Quốc'],['korea','Hàn Quốc'],['seoul','Hàn Quốc'],
    ['trung quốc','Trung Quốc'],['china','Trung Quốc'],
    ['đài loan','Đài Loan'],['taiwan','Đài Loan'],
    ['hong kong','Hong Kong'],['hồng kông','Hong Kong'],
    ['macao','Macao'],['macau','Macao'],
    ['mông cổ','Mông Cổ'],['mongolia','Mông Cổ'],
    ['thái lan','Thái Lan'],['thailand','Thái Lan'],['bangkok','Thái Lan'],
    ['singapore','Singapore'],
    ['indonesia','Indonesia'],['bali','Indonesia'],
    ['malaysia','Malaysia'],['kuala lumpur','Malaysia'],
    ['philippine','Philippines'],['philippines','Philippines'],
    ['myanmar','Myanmar'],['burma','Myanmar'],
    ['campuchia','Campuchia'],['cambodia','Campuchia'],['angkor','Campuchia'],
    ['lào','Lào'],['laos','Lào'],
    ['brunei','Brunei'],
    ['ấn độ','Ấn Độ'],['india','Ấn Độ'],
    ['nepal','Nepal'],['sri lanka','Sri Lanka'],['bhutan','Bhutan'],
    ['dubai','UAE'],['uae','UAE'],['abu dhabi','UAE'],
    ['israel','Israel'],['jerusalem','Israel'],
    ['thổ nhĩ kỳ','Thổ Nhĩ Kỳ'],['turkey','Thổ Nhĩ Kỳ'],['istanbul','Thổ Nhĩ Kỳ'],
    ['jordan','Jordan'],
    ['ai cập','Ai Cập'],['egypt','Ai Cập'],
    ['maroc','Maroc'],['morocco','Maroc'],
    ['pháp','Pháp'],['france','Pháp'],['paris','Pháp'],
    ['ý','Ý'],['italy','Ý'],['rome','Ý'],
    ['đức','Đức'],['germany','Đức'],
    ['anh','Anh'],['united kingdom','Anh'],['london','Anh'],
    ['tây ban nha','Tây Ban Nha'],['spain','Tây Ban Nha'],
    ['bồ đào nha','Bồ Đào Nha'],['portugal','Bồ Đào Nha'],
    ['hà lan','Hà Lan'],['netherlands','Hà Lan'],
    ['bỉ','Bỉ'],['belgium','Bỉ'],
    ['thụy sĩ','Thụy Sĩ'],['switzerland','Thụy Sĩ'],
    ['áo','Áo'],['austria','Áo'],['vienna','Áo'],
    ['séc','Séc'],['czech','Séc'],['prague','Séc'],
    ['hungary','Hungary'],['budapest','Hungary'],
    ['ba lan','Ba Lan'],['poland','Ba Lan'],
    ['hy lạp','Hy Lạp'],['greece','Hy Lạp'],
    ['croatia','Croatia'],
    ['thụy điển','Thụy Điển'],['sweden','Thụy Điển'],
    ['na uy','Na Uy'],['norway','Na Uy'],
    ['đan mạch','Đan Mạch'],['denmark','Đan Mạch'],
    ['phần lan','Phần Lan'],['finland','Phần Lan'],
    ['iceland','Iceland'],
    ['nga','Nga'],['russia','Nga'],
    ['mỹ','Mỹ'],['usa','Mỹ'],['new york','Mỹ'],['california','Mỹ'],
    ['canada','Canada'],
    ['brazil','Brazil'],['peru','Peru'],['mexico','Mexico'],['argentina','Argentina'],
    ['úc','Úc'],['australia','Úc'],['sydney','Úc'],
    ['new zealand','New Zealand'],['fiji','Fiji'],
    ['việt nam','Việt Nam'],['vietnam','Việt Nam'],
    ['nam phi','Nam Phi'],['south africa','Nam Phi'],
    ['kenya','Kenya'],['tanzania','Tanzania'],
];

const REGION_MAP = {
    'Nhật Bản':'Châu Á','Hàn Quốc':'Châu Á','Trung Quốc':'Châu Á',
    'Đài Loan':'Châu Á','Hong Kong':'Châu Á','Macao':'Châu Á','Mông Cổ':'Châu Á',
    'Thái Lan':'Châu Á','Singapore':'Châu Á','Indonesia':'Châu Á',
    'Malaysia':'Châu Á','Philippines':'Châu Á','Myanmar':'Châu Á',
    'Campuchia':'Châu Á','Lào':'Châu Á','Brunei':'Châu Á',
    'Ấn Độ':'Châu Á','Nepal':'Châu Á','Sri Lanka':'Châu Á','Bhutan':'Châu Á',
    'UAE':'Châu Á','Israel':'Châu Á','Thổ Nhĩ Kỳ':'Châu Á','Jordan':'Châu Á',
    'Pháp':'Châu Âu','Ý':'Châu Âu','Đức':'Châu Âu','Anh':'Châu Âu',
    'Tây Ban Nha':'Châu Âu','Bồ Đào Nha':'Châu Âu','Hà Lan':'Châu Âu',
    'Bỉ':'Châu Âu','Thụy Sĩ':'Châu Âu','Áo':'Châu Âu','Séc':'Châu Âu',
    'Hungary':'Châu Âu','Ba Lan':'Châu Âu','Hy Lạp':'Châu Âu','Croatia':'Châu Âu',
    'Thụy Điển':'Châu Âu','Na Uy':'Châu Âu','Đan Mạch':'Châu Âu',
    'Phần Lan':'Châu Âu','Iceland':'Châu Âu','Nga':'Châu Âu',
    'Ai Cập':'Châu Phi','Maroc':'Châu Phi',
    'Nam Phi':'Châu Phi','Kenya':'Châu Phi','Tanzania':'Châu Phi',
    'Mỹ':'Châu Mỹ','Canada':'Châu Mỹ','Brazil':'Châu Mỹ',
    'Peru':'Châu Mỹ','Mexico':'Châu Mỹ','Argentina':'Châu Mỹ',
    'Úc':'Châu Úc','New Zealand':'Châu Úc','Fiji':'Châu Úc',
    'Việt Nam':'Đông Nam Á',
};

// ============================================================
// HÀM TIỆN ÍCH DÙNG CHUNG
// ============================================================
function log(company, msg) {
    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const tag = company ? `[${company}]` : '';
    console.log(`[${now}] ${tag} ${msg}`);
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
    if (!tourName) return '';
    const lower = tourName.toLowerCase();
    for (const [keyword, country] of COUNTRY_KEYWORDS) {
        if (lower.includes(keyword)) return country;
    }
    return '';
}

function extractRegion(country) { return REGION_MAP[country] || 'Khác'; }

function normalizeDuration(raw) {
    if (!raw) return '';
    if (/^\d+N\d+[DĐ]$/i.test(raw.trim())) return raw.trim().toUpperCase();
    const nd = raw.match(/(\d+)\s*ng[aà]y\s*(\d+)\s*đêm/i);
    if (nd) return `${nd[1]}N${nd[2]}Đ`;
    const n = raw.match(/(\d+)\s*ng[aà]y/i);
    if (n) return `${n[1]}N`;
    return raw.trim();
}

function toISODate(ddmmyyyy) {
    if (!ddmmyyyy) return '';
    const parts = ddmmyyyy.split('/');
    if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
    return ddmmyyyy;
}

function getMonth(isoDate) {
    if (!isoDate || isoDate.length < 7) return null;
    return parseInt(isoDate.substring(5, 7), 10);
}

// ============================================================
// HÀM MẠNG DÙNG CHUNG
// ============================================================
function httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { headers }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

function postToPhp(url, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const parsed = new URL(url);
        const req = http.request({
            hostname: parsed.hostname, path: parsed.pathname,
            port: parsed.port || 80, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, (res) => {
            let result = '';
            res.on('data', c => result += c);
            res.on('end', () => resolve(result));
        });
        req.on('error', reject);
        req.write(body); req.end();
    });
}

async function saveToDb(tourInfo, priceRecords) {
    if (!priceRecords || priceRecords.length === 0) {
        log(tourInfo.ten_cong_ty, `  [SKIP] Không có lịch: ${tourInfo.tourCode}`);
        return 0;
    }
    try {
        const res = await postToPhp(CONFIG.phpSaveUrl, {
            tourInfo, priceRecords, scrapedAt: new Date().toISOString(),
        });
        const parsed = JSON.parse(res);
        if (parsed.savedPrices) {
            log(tourInfo.ten_cong_ty, `  -> DB: saved ${parsed.savedPrices} records`);
            return parsed.savedPrices;
        }
        if (parsed.errors?.length > 0) log(tourInfo.ten_cong_ty, `  -> DB errors: ${parsed.errors.join(', ')}`);
    } catch (err) { log(tourInfo.ten_cong_ty, `  [ERROR] Save DB: ${err.message}`); }
    return 0;
}

// ============================================================
// PHẦN VIETRAVEL — V4
// Flow: Listing DOM (article[data-track="tour-card"])
//       → pid từ srcset, tourName từ aria-label
//       → getTourCode từ /chuong-trinh/pid-[pid]
//       → API get-tour-info-day (giá/lịch theo tháng)
//       → API get-tour-detail-day (số chỗ)
// ============================================================

/**
 * Scrape listing Vietravel bằng DOM selector.
 * Scroll đến khi article[data-track="tour-card"] ổn định.
 * Đồng thời bắt Bearer token từ network request.
 */
async function vt_scrapeListing(browser, listingUrl, tourType) {
    const page = await browser.newPage();
    let token = null, clientId = null;

    page.on('request', req => {
        const auth = req.headers()['authorization'];
        const cid  = req.headers()['clientid'];
        if (auth && auth.startsWith('Bearer ') && !token) {
            token    = auth.replace('Bearer ', '');
            clientId = cid || '';
            log('Vietravel', `  Token OK | ClientId: ${clientId ? clientId.substring(0,8)+'...' : 'none'}`);
        }
    });

    let tours = [];
    try {
        log('Vietravel', `Listing: ${listingUrl}`);
        await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await delay(3000);

        let prevCount = 0, stableRounds = 0;
        for (let i = 0; i < 60; i++) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
            await delay(600);
            if (i % 5 === 4) {
                const cur = await page.evaluate(() =>
                    document.querySelectorAll('article[data-track="tour-card"]').length
                );
                log('Vietravel', `  Scroll ${i+1}: ${cur} cards`);
                if (cur === prevCount) {
                    if (++stableRounds >= 2) { log('Vietravel', '  Dừng scroll'); break; }
                } else { stableRounds = 0; prevCount = cur; }
            }
        }
        await delay(1500);

        tours = await page.evaluate((type) => {
            const SKIP = new Set(['Xem chi tiết', 'Giá từ:', 'Đặt ngay']);
            return [...document.querySelectorAll('article[data-track="tour-card"]')].map(card => {
                // pid từ srcset/src/innerHTML: pattern tf__\d+_[pid]_
                const img     = card.querySelector('img[srcset], img[src]');
                const srcFull = img?.getAttribute('srcset') || img?.getAttribute('src') || '';
                const pidMatch = srcFull.match(/tf__\d+_(\d+)_/);
                let pid = pidMatch ? pidMatch[1] : '';
                if (!pid) {
                    const m2 = card.innerHTML.match(/tf__\d+_(\d+)_/);
                    if (m2) pid = m2[1];
                }

                // tourName từ aria-label button CTA
                const btn      = card.querySelector('button[aria-label^="Đặt tour"]');
                const ariaLabel = btn?.getAttribute('aria-label') || '';
                const tourName  = ariaLabel
                    .replace(/^Đặt tour\s+/i, '').replace(/\s+ngay$/i, '').trim();

                // category từ badge
                const badge    = card.querySelector('[class*="badge"], [class*="label"], [class*="tag"]');
                const category = badge?.innerText?.trim() || '';

                // lines từ contentBody — rawLines[0] là tên tour, slice từ [1]
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
        log('Vietravel', `[ERROR] scrapeListing: ${err.message}`);
    } finally {
        await page.close();
    }

    tours = tours
        .filter(t => t.pid)
        .map(t => ({ ...t, departure: normalizeDeparture(t.departure) }));

    log('Vietravel', `  ${tours.length} tours | token: ${token ? 'OK' : 'FAIL'}`);
    return { token, clientId, tours };
}

/**
 * Vào /chuong-trinh/pid-[pid] để lấy tourCode (Mã chương trình).
 */
async function vt_getTourCodeFromDetail(browser, pid) {
    const page = await browser.newPage();
    try {
        await page.goto(`https://travel.com.vn/chuong-trinh/pid-${pid}`, {
            waitUntil: 'networkidle', timeout: 30000,
        });
        await delay(1500);

        return await page.evaluate(() => {
            // Ưu tiên: element leaf node khớp pattern, cha chứa "Mã chương trình"
            for (const el of document.querySelectorAll('*')) {
                if (el.children.length > 0) continue;
                const text = el.innerText?.trim() || '';
                if (!/^[A-Z]{2,5}[A-Z0-9]{0,5}[0-9]{2,6}$/.test(text)) continue;
                const parentText = el.parentElement?.innerText || '';
                if (parentText.includes('Mã chương trình') || parentText.includes('chương trình')) {
                    return text;
                }
            }
            // Fallback: regex trên innerText
            const m = document.body.innerText
                .match(/Mã chương trình[^\n]*?([A-Z]{2,5}[A-Z0-9]{0,5}[0-9]{2,6})/);
            return m ? m[1] : '';
        });
    } catch { return ''; }
    finally { await page.close(); }
}

// Lấy số chỗ còn qua API get-tour-detail-day
async function vt_fetchSeats(subTourCode, token, clientId) {
    const headers = {
        'Authorization': `Bearer ${token}`,
        'ClientId': clientId || '',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
    };
    try {
        const data = await httpGet(
            `${CONFIG.vietravel.apiBase}/get-tour-detail-day/tourCode=${subTourCode}`,
            headers
        );
        if (data?.status === 1 && data?.response) return data.response.remainPax ?? null;
    } catch {}
    return null;
}

// Lấy giá/lịch theo từng tháng qua API get-tour-info-day
async function vt_fetchPrices(tourCode, token, clientId) {
    const headers = {
        'Authorization': `Bearer ${token}`,
        'ClientId': clientId || '',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
    };
    const records = [];

    for (const { month, year } of CONFIG.months) {
        const url = `${CONFIG.vietravel.apiBase}/get-tour-info-day?tourCode=${tourCode}&month=${month}&year=${year}`;
        try {
            const data = await httpGet(url, headers);
            if (data?.status === 1 && Array.isArray(data.response)) {
                for (const day of data.response) {
                    const tourList = day.tours || [];
                    if (tourList.length > 0) {
                        for (const t of tourList) {
                            const subCode = t.tourCode || '';
                            let seats = t.seatsAvailable || t.availableSeats || null;
                            if (!seats && subCode) {
                                seats = await vt_fetchSeats(subCode, token, clientId);
                                await delay(200);
                            }
                            records.push({
                                subTourCode:    subCode,
                                departureDate:  t.departureDate || day.date,
                                thang:          month,
                                salePrice:      t.salePrice || day.salePrice || 0,
                                priceFinal:     day.priceFinal || t.salePrice || 0,
                                discountAmount: day.discountAmount || 0,
                                isDiscount:     day.isDiscount ? 1 : 0,
                                seatsAvailable: seats,
                            });
                        }
                    } else if (day.salePrice > 0) {
                        records.push({
                            subTourCode:    '',
                            departureDate:  day.date,
                            thang:          month,
                            salePrice:      day.salePrice,
                            priceFinal:     day.priceFinal || 0,
                            discountAmount: day.discountAmount || 0,
                            isDiscount:     day.isDiscount ? 1 : 0,
                            seatsAvailable: null,
                        });
                    }
                }
            }
        } catch (err) {
            log('Vietravel', `  [${tourCode}] ${month}/${year} ERROR: ${err.message}`);
        }
        await delay(CONFIG.vietravel.requestDelay);
    }
    return records;
}

async function runVietravel(browser) {
    log('Vietravel', '====== BẮT ĐẦU VIETRAVEL (V4) ======');
    const cfg = CONFIG.vietravel;
    let total = 0, skipped = 0;
    let sharedToken = null, sharedClientId = null;

    for (const [typeKey, typeCfg] of Object.entries({
        domestic: cfg.domestic, international: cfg.international,
    })) {
        log('Vietravel', `\n--- ${typeKey === 'domestic' ? 'TRONG NƯỚC' : 'NƯỚC NGOÀI'} ---`);

        const { token, clientId, tours } = await vt_scrapeListing(
            browser, typeCfg.listingUrl, typeCfg.tourType
        );

        // Dùng lại token giữa 2 lần listing
        if (token) { sharedToken = token; sharedClientId = clientId; }
        const useToken    = sharedToken;
        const useClientId = sharedClientId;

        if (!useToken) {
            log('Vietravel', '[FATAL] Không lấy được token — bỏ qua loại này');
            continue;
        }
        if (tours.length === 0) {
            log('Vietravel', '[WARN] Không parse được tour nào');
            continue;
        }

        log('Vietravel', `${tours.length} tours — bắt đầu lấy tourCode + giá...`);

        for (let i = 0; i < tours.length; i++) {
            const tour   = tours[i];
            const prefix = `[${typeKey === 'domestic' ? 'TN' : 'NN'}] ${i+1}/${tours.length}`;
            log('Vietravel', `${prefix} pid:${tour.pid} | ${tour.tourName.substring(0,50)}`);

            // Bước 1: lấy tourCode từ trang chi tiết
            const tourCode = await vt_getTourCodeFromDetail(browser, tour.pid);
            if (!tourCode) {
                log('Vietravel', '  [SKIP] Không lấy được tourCode');
                skipped++;
                await delay(cfg.pageDelay);
                continue;
            }
            log('Vietravel', `  tourCode: ${tourCode}`);

            const country = extractCountry(tour.tourName, typeCfg.tourType);
            const region  = extractRegion(country);

            const tourInfo = {
                tourCode,
                pid:          tour.pid,
                tourName:     tour.tourName,
                tourType:     typeCfg.tourType,
                ten_cong_ty:  cfg.companyName,
                source:       cfg.source,
                duration:     normalizeDuration(tour.duration),
                noi_khoi_hanh: tour.departure,
                departure:    tour.departure,
                vehicle:      '',   // không có trong card listing
                category:     tour.category,
                priceFrom:    tour.priceFrom,
                quoc_gia:     country,
                khu_vuc:      region,
            };

            // Bước 2: fetch giá
            const priceRecords = await vt_fetchPrices(tourCode, useToken, useClientId);
            log('Vietravel', `  ${country} | ${priceRecords.length} lịch`);

            // Bước 3: lưu DB
            const saved = await saveToDb(tourInfo, priceRecords);
            if (saved > 0) total += saved; else skipped++;

            await delay(cfg.pageDelay);
        }
    }

    log('Vietravel', `====== VIETRAVEL XONG: ${total} records, ${skipped} skipped ======`);
    return total;
}

// ============================================================
// PHẦN BENTHANH TOURIST (giữ nguyên từ bản gốc)
// ============================================================
async function btt_getTourLinks(browser, listingUrl) {
    log('BenThanh', `Listing: ${listingUrl}`);
    const page = await browser.newPage();
    const links = [];
    try {
        let pageNum = 1;
        while (true) {
            const url = pageNum === 1 ? listingUrl : `${listingUrl}?page=${pageNum}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await delay(1500);
            const newLinks = await page.evaluate(() =>
                [...document.querySelectorAll('a[href*="/tour/"]')]
                    .map(a => a.href)
                    .filter(h => h.includes('/tour/'))
            );
            if (newLinks.length === 0) break;
            links.push(...newLinks);
            log('BenThanh', `  Page ${pageNum}: +${newLinks.length} links (tổng ${links.length})`);
            pageNum++;
        }
    } catch (err) { log('BenThanh', `[ERROR] getListing: ${err.message}`); }
    finally { await page.close(); }
    return [...new Set(links)];
}

async function btt_scrapeTourDetail(browser, tourUrl, tourType) {
    const page = await browser.newPage();
    try {
        await page.goto(tourUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await delay(1500);
        const data = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const h1 = document.querySelector('h1, .tour-name');
            const tourName = h1 ? h1.innerText.trim() : document.title.replace(/\s*[-|].*$/, '').trim();
            const codeMatch = bodyText.match(/Mã tour\s*[:\s]*([A-Z0-9\-]+)/i)
                           || bodyText.match(/\b([A-Z]{2,4}\d{5,10})\b/);
            const mainTourCode = codeMatch ? codeMatch[1].trim() : '';
            const durMatch = bodyText.match(/(\d+)\s*ng[aà]y\s*(\d+)\s*đêm/i);
            const durationRaw = durMatch ? durMatch[0] : '';
            const depMatch = bodyText.match(/Khởi hành\s*[:\s]+([^\n]{2,60})/);
            const departureRaw = depMatch ? depMatch[1].trim() : '';
            let vehicle = '';
            if (bodyText.includes('Máy bay')) vehicle = 'Máy bay';
            else if (bodyText.includes('Tàu hỏa')) vehicle = 'Tàu hỏa';
            else if (bodyText.includes('Ô tô') || bodyText.includes('Xe')) vehicle = 'Xe';
            let category = 'Tiêu chuẩn';
            if (/cao c[aấ]p/i.test(tourName)) category = 'Cao cấp';
            else if (/ti[ếe]t ki[ệe]m/i.test(tourName)) category = 'Tiết kiệm';
            const giaMatch = bodyText.match(/([\d,]+)\s*VNĐ/);
            const priceFrom = giaMatch ? parseInt(giaMatch[1].replace(/,/g, '')) || 0 : 0;
            const ngayMatch = bodyText.match(/Ngày khởi hành\s*[:\s]+([\d\/]+)/);
            const currentDate = ngayMatch ? ngayMatch[1].trim() : '';
            const choMatch = bodyText.match(/Số chỗ còn\s*[:\s]+(\d+)/);
            const currentSeats = choMatch ? parseInt(choMatch[1]) : null;
            const schedules = [];
            const tourCards = document.querySelectorAll(
                '#card-table-tour-days ul.list-options-tour, .card-table-tour-days ul.list-options-tour'
            );
            tourCards.forEach(card => {
                const text = card.innerText || '';
                const cM = text.match(/([A-Z]{2}[A-Z0-9]{1,10}\d{6,10})/);
                const dM = text.match(/(\d{2}\/\d{2}\/\d{4})/);
                const pM = text.match(/([\d,]+)\s*VNĐ/);
                const sN = text.match(/\d+/g);
                if (cM && dM) schedules.push({
                    subTourCode: cM[1], date: dM[1],
                    price: pM ? parseInt(pM[1].replace(/,/g,'')) || 0 : 0,
                    seats: sN ? parseInt(sN[sN.length-1]) : null,
                });
            });
            if (schedules.length === 0 && mainTourCode && currentDate) {
                schedules.push({ subTourCode: mainTourCode, date: currentDate, price: priceFrom, seats: currentSeats });
            }
            return { tourName, mainTourCode, durationRaw, departureRaw, vehicle, category, priceFrom, schedules };
        });
        return data;
    } catch (err) { log('BenThanh', `[ERROR] detail ${tourUrl}: ${err.message}`); return null; }
    finally { await page.close(); }
}

async function runBenThanh(browser) {
    log('BenThanh', '====== BẮT ĐẦU BENTHANH TOURIST ======');
    const cfg = CONFIG.benthanh;
    let total = 0, skipped = 0;

    for (const [typeKey, typeCfg] of Object.entries({ domestic: cfg.domestic, international: cfg.international })) {
        log('BenThanh', `\n--- ${typeKey === 'domestic' ? 'TRONG NƯỚC' : 'NƯỚC NGOÀI'} ---`);
        const links = await btt_getTourLinks(browser, typeCfg.listingUrl);
        for (let i = 0; i < links.length; i++) {
            const tourUrl = links[i];
            log('BenThanh', `[${typeKey === 'domestic' ? 'TN' : 'NN'}] ${i+1}/${links.length} - ${tourUrl.split('/tour/')[1]?.substring(0,60)}`);
            const detail = await btt_scrapeTourDetail(browser, tourUrl, typeCfg.tourType);
            if (!detail || !detail.mainTourCode) { skipped++; continue; }

            const country = extractCountry(detail.tourName, typeCfg.tourType);
            const region  = extractRegion(country);
            const tourCodeBase = detail.mainTourCode.length > 10
                ? detail.mainTourCode.substring(0, detail.mainTourCode.length - 4)
                : detail.mainTourCode;

            const tourInfo = {
                tourCode: tourCodeBase, tourName: detail.tourName,
                tourType: typeCfg.tourType, ten_cong_ty: cfg.companyName, source: cfg.source,
                duration: normalizeDuration(detail.durationRaw),
                noi_khoi_hanh: normalizeDeparture(detail.departureRaw),
                vehicle: detail.vehicle, category: detail.category,
                priceFrom: detail.priceFrom, quoc_gia: country, khu_vuc: region,
            };
            const priceRecords = detail.schedules.map(s => {
                const isoDate = toISODate(s.date);
                return {
                    subTourCode: s.subTourCode || tourCodeBase, departureDate: isoDate,
                    thang: getMonth(isoDate), salePrice: s.price, priceFinal: s.price,
                    discountAmount: 0, isDiscount: 0, seatsAvailable: s.seats,
                };
            }).filter(r => r.departureDate && r.thang !== null);

            log('BenThanh', `  ${detail.tourName.substring(0,50)} | ${country} | ${priceRecords.length} lịch`);
            const saved = await saveToDb(tourInfo, priceRecords);
            if (saved > 0) total += saved; else skipped++;
            await delay(cfg.pageDelay);
        }
    }
    log('BenThanh', `====== BENTHANH XONG: ${total} records, ${skipped} skipped ======`);
    return total;
}

// ============================================================
// PHẦN DU LỊCH VIỆT — stealth bypass Cloudflare
//
// Label mapping trang dulichviet.com.vn:
//   "Thời gian"  → duration   ("5 ngày 4 đêm")
//   "Khởi hành"  → lịch ngày  ("08,15/04; 06,13/05; ...")
//   "Vận Chuyển" → vehicle    ("Xe du lịch, Máy bay")
//   "Xuất phát"  → departure  ("Từ Hồ Chí Minh")
// ============================================================
const DLV_STEALTH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none', 'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
};

async function dlv_applyStealthToPage(page) {
    await page.setExtraHTTPHeaders(DLV_STEALTH_HEADERS);
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
            { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ]});
        Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN','vi','en-US','en'] });
        window.chrome = { runtime: {} };
    });
}

async function dlv_waitForLoadingDone(page, ms = 15000) {
    try {
        await page.waitForFunction(() =>
            [...document.querySelectorAll('.mda-loading, .mda-box-loading')].every(el => {
                const s = window.getComputedStyle(el);
                return s.display === 'none' || s.visibility === 'hidden' ||
                       s.opacity === '0' || !el.offsetParent;
            }), { timeout: ms }
        );
    } catch (_) {}
}

async function dlv_extractLinks(page) {
    return page.evaluate(() => {
        const patterns = ['/du-lich-nuoc-ngoai/', '/du-lich-trong-nuoc/', '/loai-hinh-du-lich/'];
        const result = [];
        for (const a of document.querySelectorAll('a[href]')) {
            const href = (a.href || '').split('?')[0].trim();
            if (!href || !patterns.some(p => href.includes(p))) continue;
            const slug = href.split('/').filter(Boolean).pop() || '';
            if (slug.length > 5 && /[a-zA-Z]/.test(slug)) result.push(href);
        }
        return [...new Set(result)];
    });
}

async function dlv_clickXemThem(page, countBefore) {
    await dlv_waitForLoadingDone(page);
    const btn = await page.$('span.mda-btn-tour-more');
    if (!btn || !(await btn.isVisible().catch(() => false))) return false;

    await btn.scrollIntoViewIfNeeded();
    await delay(500);

    // Thử JS click — nếu Playwright click bị intercept thì fallback dispatchEvent
    try {
        await page.evaluate(el => el.click(), btn);
    } catch (_) {
        await page.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })), btn);
    }
    await delay(400);

    // Scroll xuống cuối để trigger render AJAX
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(300);

    await dlv_waitForLoadingDone(page, 12000);

    const cfg = CONFIG.dulichviet;
    for (let w = 0; w < cfg.pollTimeout; w += cfg.pollInterval) {
        await delay(cfg.pollInterval);
        const n = await page.evaluate(() => {
            const ps = ['/du-lich-nuoc-ngoai/', '/du-lich-trong-nuoc/'];
            return [...new Set([...document.querySelectorAll('a[href]')]
                .map(a => (a.href||'').split('?')[0])
                .filter(h => ps.some(p => h.includes(p)) &&
                             h.split('/').filter(Boolean).pop()?.length > 5)
            )].length;
        });
        if (n > countBefore) {
            log('DuLichViet', `  [BTN] Links: ${countBefore} → ${n}`);
            // Scroll lại xuống cuối để btn tiếp theo visible
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await delay(300);
            return true;
        }
    }

    // Poll hết timeout mà không tăng — kiểm tra btn còn hiển thị không
    const stillVisible = await page.$('span.mda-btn-tour-more')
        .then(b => b ? b.isVisible().catch(() => false) : false);
    if (!stillVisible) {
        log('DuLichViet', '  [BTN] Nút đã ẩn — hết tour');
    } else {
        log('DuLichViet', `  [BTN] Poll timeout (${cfg.pollTimeout}ms) — không thấy link mới, có thể tất cả đã load`);
    }
    return false;
}

async function dlv_getTourLinks(browser, listingUrl) {
    const seen = new Set(), links = [];
    const page = await browser.newPage();
    await dlv_applyStealthToPage(page);
    try {
        log('DuLichViet', `Loading: ${listingUrl}`);
        await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        try {
            await page.waitForSelector('span.mda-btn-tour-more', { timeout: 15000 });
            await delay(800);
        } catch (_) { await delay(5000); }

        for (const l of await dlv_extractLinks(page))
            if (!seen.has(l)) { seen.add(l); links.push(l); }
        log('DuLichViet', `  Load 1: ${links.length} links`);

        const cfg = CONFIG.dulichviet;
        for (let p = 2; p <= cfg.maxPages + 1; p++) {
            const before = seen.size;
            if (!(await dlv_clickXemThem(page, before))) { log('DuLichViet', '  Hết tour'); break; }
            let added = 0;
            for (const l of await dlv_extractLinks(page))
                if (!seen.has(l)) { seen.add(l); links.push(l); added++; }
            log('DuLichViet', `  Load ${p}: ${links.length} links (mới: ${added})`);
            if (added === 0) { log('DuLichViet', '  Không có link mới, dừng'); break; }
        }
    } catch (err) { log('DuLichViet', `[ERROR] getListing: ${err.message}`); }
    finally { await page.close(); }
    log('DuLichViet', `Tổng: ${links.length} links`);
    return links;
}

// FIX: dùng getLabelValue() theo cấu trúc table <tr><td>Label</td><td>Value</td></tr>
// Không dùng regex toàn bodyText để tránh bắt nhầm nội dung không liên quan
async function dlv_scrapeTourDetail(browser, tourUrl, tourType) {
    const page = await browser.newPage();
    await dlv_applyStealthToPage(page);
    try {
        await page.goto(tourUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await delay(1500);

        const detail = await page.evaluate(() => {
            const bodyText = document.body.innerText;

            const h1 = document.querySelector('h1, .tour-title, .mda-title, h2.title');
            const tourName = h1
                ? h1.innerText.trim()
                : document.title.replace(/\s*[-|]\s*.*$/, '').trim();

            const codeMatch = bodyText.match(/Mã tour\s*[:\s]*(\d+)/i);
            const tourCode  = codeMatch ? `DLV${codeMatch[1]}` : '';

            // Tìm value theo label trong cấu trúc table của DLV
            function getLabelValue(labelText) {
                const rows = [...document.querySelectorAll('tr')];
                for (const row of rows) {
                    const cells = [...row.querySelectorAll('td, th')];
                    for (let i = 0; i < cells.length - 1; i++) {
                        const cellLabel = cells[i].innerText.trim().toLowerCase().replace(/\s+/g, ' ');
                        if (cellLabel === labelText.toLowerCase() ||
                            cellLabel.startsWith(labelText.toLowerCase())) {
                            return cells[i + 1].innerText.trim();
                        }
                    }
                }
                // Fallback regex — chỉ lấy tối đa 50 ký tự đầu dòng
                const re = new RegExp(
                    labelText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:\\s]+([^\\n]{1,50})',
                    'i'
                );
                const m = bodyText.match(re);
                return m ? m[1].trim() : '';
            }

            const durRaw      = getLabelValue('Thời gian');
            const vehRaw      = getLabelValue('Vận Chuyển') || getLabelValue('Vận chuyển') || getLabelValue('Phương tiện');
            const depRaw      = getLabelValue('Xuất phát') || getLabelValue('Nơi xuất phát');
            const scheduleRaw = getLabelValue('Khởi hành'); // lịch ngày, không phải nơi KH

            const priceMatch = bodyText.match(/Giá từ[:\s]*([\d.,]+)\s*[đĐ₫]/i)
                            || bodyText.match(/giá\s*[:\s]*([\d.,]+)\s*[đĐ₫]/i);
            const priceFrom  = priceMatch ? parseInt(priceMatch[1].replace(/[.,]/g, '')) || 0 : 0;

            return { tourName, tourCode, priceFrom, durRaw, vehRaw, depRaw, scheduleRaw };
        });

        if (!detail.tourCode) return null;

        // Parse duration: "5 ngày 4 đêm" → "5N4Đ", bỏ nếu có / hoặc ;
        const duration = (() => {
            const r = detail.durRaw;
            if (!r || /[\/,;]/.test(r)) return '';
            const nd = r.match(/(\d+)\s*ng[aà]y\s*(\d+)\s*đêm/i);
            if (nd) return `${nd[1]}N${nd[2]}Đ`;
            if (/^\d+N\d+[DĐ]$/i.test(r.trim())) return r.trim().toUpperCase();
            return '';
        })();

        // Parse vehicle: "Xe du lịch, Máy bay" → "Xe, Máy bay"
        const vehicle = (() => {
            const l = (detail.vehRaw || '').toLowerCase();
            const parts = [];
            if (l.includes('xe')) parts.push('Xe');
            if (l.includes('tàu hỏa') || l.includes('tàu thủy')) parts.push('Tàu hỏa');
            if (l.includes('máy bay') || l.includes('hàng không') ||
                l.includes('airline') || l.includes('airways')) parts.push('Máy bay');
            return parts.join(', ');
        })();

        // Parse departure: "Từ Hồ Chí Minh" → "TP. Hồ Chí Minh"
        const departure = normalizeDeparture(
            (detail.depRaw || '').replace(/^(từ|from)\s+/i, '').trim()
        );

        // Parse lịch từ scheduleRaw ("08,15/04; 06,13/05; ...")
        const schedules = dlv_parseSchedules(detail.scheduleRaw, detail.priceFrom);

        return { tourName: detail.tourName, tourCode: detail.tourCode, duration, vehicle, departure, priceFrom: detail.priceFrom, schedules };
    } catch (err) { log('DuLichViet', `[ERROR] detail ${tourUrl}: ${err.message}`); return null; }
    finally { await page.close(); }
}

// Parse "08,15/04; 06,13,20,27/05; 03,10,17,24/06; ..."
function dlv_parseSchedules(raw, price) {
    if (!raw) return [];
    const seen = new Set(), schedules = [];
    const currentYear = new Date().getFullYear();

    const re = /(\d{1,2}(?:,\s*\d{1,2})*)\s*\/\s*(\d{2})\s*(?:\/\s*(\d{4}))?/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
        const month = parseInt(m[2]);
        if (month < 1 || month > 12) continue;
        const year = m[3] ? parseInt(m[3]) : currentYear;
        if (year < 2024 || year > 2030) continue;
        for (const day of m[1].split(',').map(d => parseInt(d.trim()))) {
            if (day < 1 || day > 31) continue;
            const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            if (seen.has(dateStr)) continue;
            seen.add(dateStr);
            schedules.push({
                subTourCode: '', departureDate: dateStr,
                salePrice: price, priceFinal: price,
                discountAmount: 0, isDiscount: 0, seatsAvailable: null, thang: month,
            });
        }
    }
    return schedules;
}

async function runDuLichViet(browser) {
    log('DuLichViet', '====== BẮT ĐẦU DU LỊCH VIỆT ======');
    const cfg = CONFIG.dulichviet;
    let total = 0, skipped = 0;

    for (const [typeKey, typeCfg] of Object.entries({ domestic: cfg.domestic, international: cfg.international })) {
        log('DuLichViet', `\n--- ${typeKey === 'domestic' ? 'TRONG NƯỚC' : 'NƯỚC NGOÀI'} ---`);
        const links = await dlv_getTourLinks(browser, typeCfg.listingUrl);

        for (let i = 0; i < links.length; i++) {
            const tourUrl = links[i];
            log('DuLichViet', `[${typeKey === 'domestic' ? 'TN' : 'NN'}] ${i+1}/${links.length} - ${tourUrl.split('/').pop()?.substring(0,50)}`);
            const detail = await dlv_scrapeTourDetail(browser, tourUrl, typeCfg.tourType);
            if (!detail) { skipped++; continue; }

            const country = extractCountry(detail.tourName, typeCfg.tourType);
            const region  = extractRegion(country);
            const priceRecords = detail.schedules.map(s => ({
                ...s,
                subTourCode: `${detail.tourCode}-${s.departureDate.replace(/-/g,'')}`,
            }));

            const tourInfo = {
                tourCode:      detail.tourCode,
                tourName:      detail.tourName,
                tourType:      typeCfg.tourType,
                ten_cong_ty:   cfg.companyName,
                source:        cfg.source,
                duration:      detail.duration,
                noi_khoi_hanh: detail.departure,
                vehicle:       detail.vehicle,
                category:      '',
                priceFrom:     detail.priceFrom,
                quoc_gia:      country,
                khu_vuc:       region,
            };

            log('DuLichViet', `  ${detail.tourName.substring(0,45)} | ${detail.duration||'?'} | ${detail.vehicle||'?'} | ${detail.departure||'?'} | ${priceRecords.length} lịch`);
            const saved = await saveToDb(tourInfo, priceRecords);
            if (saved > 0) total += saved; else skipped++;
            await delay(cfg.pageDelay);
        }
    }
    log('DuLichViet', `====== DU LỊCH VIỆT XONG: ${total} records, ${skipped} skipped ======`);
    return total;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
    const arg    = (process.argv[2] || '').toLowerCase();
    const runVT  = !arg || arg === 'vietravel';
    const runBTT = !arg || arg === 'benthanh';
    const runDLV = !arg || arg === 'dulichviet';

    log(null, '=== Tour Price Comparison Scraper (VT + BTT + DLV) ===');
    log(null, `Chế độ: ${!arg ? 'Cả 3 công ty' : arg}`);

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox',
               '--disable-blink-features=AutomationControlled',
               '--disable-dev-shm-usage','--no-first-run','--disable-gpu'],
    });

    let vtRecords = 0, bttRecords = 0, dlvRecords = 0;
    try {
        if (runVT)  vtRecords  = await runVietravel(browser);
        if (runBTT) bttRecords = await runBenThanh(browser);
        if (runDLV) dlvRecords = await runDuLichViet(browser);
    } finally {
        await browser.close();
    }

    log(null, '==========================================');
    log(null, '=== KẾT QUẢ TỔNG HỢP ===');
    if (runVT)  log(null, `Vietravel:        ${vtRecords} records`);
    if (runBTT) log(null, `BenThanh Tourist: ${bttRecords} records`);
    if (runDLV) log(null, `Du Lịch Việt:     ${dlvRecords} records`);
    log(null, `Tổng cộng:        ${vtRecords + bttRecords + dlvRecords} records`);
    log(null, '==========================================');
}

main().catch(err => { log(null, `[FATAL] ${err.message}`); process.exit(1); });