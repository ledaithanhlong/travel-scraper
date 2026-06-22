'use strict';

/**
 * test-scraper.js
 *
 * Test nhanh logic scraper mà không cần chạy full:
 *   - Vietravel: chặn network request khi scroll listing để lấy tourCode + pid,
 *                sau đó fetch giá qua API
 *   - BTT: lấy 2 tour đầu từ listing, scrape chi tiết, kiểm tra quoc_gia/khu_vuc
 *   - DLV: stealth browser, scrape listing + chi tiết, kiểm tra lịch/giá
 *
 * Cách chạy:
 *   node test-scraper.js            -- test cả 3
 *   node test-scraper.js vietravel  -- test chỉ Vietravel
 *   node test-scraper.js benthanh   -- test chỉ BTT
 *   node test-scraper.js dulichviet -- test chỉ Du Lịch Việt
 */

const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

const TEST_LIMIT = 2;

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
    phpSaveUrl: 'http://localhost/travel-scraper/api/save_tours_v3.php',
    months: [{ month: 5, year: 2026 }],

    vietravel: {
        companyName: 'Vietravel',
        source: 'vietravel',
        domestic: { listingUrl: 'https://travel.com.vn/du-lich-viet-nam.aspx', tourType: 'domestic' },
        international: { listingUrl: 'https://travel.com.vn/du-lich-nuoc-ngoai.aspx', tourType: 'international' },
        apiBase: 'https://api2.travel.com.vn/core/tour',
        requestDelay: 500,
        pageDelay: 1500,
    },

    benthanh: {
        companyName: 'BenThanh Tourist',
        source: 'benthanhtourist',
        domestic: { listingUrl: 'https://benthanhtourist.com/diem-den/tour-trong-nuoc', tourType: 'domestic' },
        international: { listingUrl: 'https://benthanhtourist.com/diem-den/tour-nuoc-ngoai', tourType: 'international' },
        requestDelay: 300,
        pageDelay: 1500,
    },

    dulichviet: {
        companyName: 'Du Lịch Việt',
        source: 'dulichviet',
        domestic: { listingUrl: 'https://dulichviet.com.vn/du-lich-trong-nuoc', tourType: 'domestic' },
        international: { listingUrl: 'https://dulichviet.com.vn/du-lich-nuoc-ngoai', tourType: 'international' },
        pageDelay: 1500,
    },
};

// ============================================================
// CHUẨN HÓA
// ============================================================
const DEPARTURE_CITY_MAP = {
    'hồ chí minh': 'TP. Hồ Chí Minh', 'ho chi minh': 'TP. Hồ Chí Minh',
    'tp.hcm': 'TP. Hồ Chí Minh', 'hà nội': 'Hà Nội', 'ha noi': 'Hà Nội',
    'đà nẵng': 'Đà Nẵng', 'cần thơ': 'Cần Thơ',
};

const COUNTRY_KEYWORDS = [
    ['nhật bản', 'Nhật Bản'], ['japan', 'Nhật Bản'],
    ['hàn quốc', 'Hàn Quốc'], ['korea', 'Hàn Quốc'],
    ['trung quốc', 'Trung Quốc'], ['china', 'Trung Quốc'],
    ['thái lan', 'Thái Lan'], ['thailand', 'Thái Lan'], ['bangkok', 'Thái Lan'],
    ['singapore', 'Singapore'],
    ['indonesia', 'Indonesia'], ['bali', 'Indonesia'],
    ['malaysia', 'Malaysia'],
    ['campuchia', 'Campuchia'], ['cambodia', 'Campuchia'],
    ['pháp', 'Pháp'], ['france', 'Pháp'], ['paris', 'Pháp'],
    ['ý', 'Ý'], ['italy', 'Ý'],
    ['đức', 'Đức'], ['germany', 'Đức'],
    ['anh', 'Anh'], ['london', 'Anh'],
    ['thụy sĩ', 'Thụy Sĩ'], ['switzerland', 'Thụy Sĩ'],
    ['áo', 'Áo'], ['austria', 'Áo'],
    ['séc', 'Séc'], ['czech', 'Séc'],
    ['na uy', 'Na Uy'], ['norway', 'Na Uy'],
    ['đan mạch', 'Đan Mạch'], ['denmark', 'Đan Mạch'],
    ['úc', 'Úc'], ['australia', 'Úc'],
    ['mỹ', 'Mỹ'], ['usa', 'Mỹ'],
    ['việt nam', 'Việt Nam'], ['vietnam', 'Việt Nam'],
];

const REGION_MAP = {
    'Việt Nam': 'Đông Nam Á',
    'Thái Lan': 'Đông Nam Á', 'Singapore': 'Đông Nam Á',
    'Indonesia': 'Đông Nam Á', 'Malaysia': 'Đông Nam Á', 'Campuchia': 'Đông Nam Á',
    'Nhật Bản': 'Đông Bắc Á', 'Hàn Quốc': 'Đông Bắc Á', 'Trung Quốc': 'Đông Bắc Á',
    'Pháp': 'Châu Âu', 'Ý': 'Châu Âu', 'Đức': 'Châu Âu', 'Anh': 'Châu Âu',
    'Thụy Sĩ': 'Châu Âu', 'Áo': 'Châu Âu', 'Séc': 'Châu Âu',
    'Na Uy': 'Châu Âu', 'Đan Mạch': 'Châu Âu',
    'Úc': 'Châu Úc', 'Mỹ': 'Châu Mỹ',
};

function log(tag, msg) {
    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    console.log(`[${now}] [${tag}] ${msg}`);
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

// ============================================================
// VIETRAVEL — FLOW MỚI (xác nhận từ DOM thực tế):
//
// Listing: article[data-track="tour-card"]
//   - pid:      srcset pattern tf__\d+_(\d+)_
//   - tourName: aria-label của button, bỏ prefix/suffix
//   - lines sau filter: [departure, duration, price]
//   - category: class badge trên ảnh (Tiêu chuẩn / Tiết kiệm / ...)
//
// Detail (https://travel.com.vn/chuong-trinh/[slug]-pid-[pid]):
//   - tourCode: text sau "Mã chương trình:"
//
// API giá: get-tour-info-day?tourCode=[tourCode]&month=M&year=Y
// ============================================================

/**
 * Scrape toàn bộ card tour từ trang listing.
 * Scroll đến khi số card ổn định (infinite scroll đã hết).
 * Đồng thời bắt Bearer token từ network request.
 */
async function scrapeVietravelListing(browser, listingUrl, tourType) {
    const page = await browser.newPage();
    let token = null;
    let clientId = null;

    page.on('request', req => {
        const auth = req.headers()['authorization'];
        const cid  = req.headers()['clientid'];
        if (auth && auth.startsWith('Bearer ') && !token) {
            token    = auth.replace('Bearer ', '');
            clientId = cid || '';
            log('VT', `Token OK | ClientId: ${clientId ? clientId.substring(0, 8) + '...' : 'none'}`);
        }
    });

    let tours = [];

    try {
        log('VT', `Mở listing: ${listingUrl}`);
        await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await delay(3000);

        // Scroll đến khi số article[data-track="tour-card"] không tăng thêm
        let prevCount = 0;
        let stableRounds = 0;
        for (let i = 0; i < 60; i++) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
            await delay(600);

            if (i % 5 === 4) {
                const currentCount = await page.evaluate(() =>
                    document.querySelectorAll('article[data-track="tour-card"]').length
                );
                log('VT', `  Scroll ${i + 1}: ${currentCount} cards trong DOM`);

                if (currentCount === prevCount) {
                    stableRounds++;
                    if (stableRounds >= 2) {
                        log('VT', '  Không load thêm — dừng scroll');
                        break;
                    }
                } else {
                    stableRounds = 0;
                    prevCount = currentCount;
                }
            }
        }
        await delay(1500);

        // Parse tất cả card
        tours = await page.evaluate((type) => {
            const SKIP_LINES = new Set(['Xem chi tiết', 'Giá từ:', 'Đặt ngay']);

            return [...document.querySelectorAll('article[data-track="tour-card"]')].map(card => {
                // --- pid từ srcset ---
                const img     = card.querySelector('img[srcset]');
                const pidMatch = img?.getAttribute('srcset')?.match(/tf__\d+_(\d+)_/);
                const pid     = pidMatch ? pidMatch[1] : '';

                // --- tourName từ aria-label của button ---
                const btn      = card.querySelector('button[aria-label^="Đặt tour"]');
                const ariaLabel = btn?.getAttribute('aria-label') || '';
                const tourName  = ariaLabel
                    .replace(/^Đặt tour\s+/i, '')
                    .replace(/\s+ngay$/i, '')
                    .trim();

                // --- category từ badge text ---
                const badge    = card.querySelector('[class*="badge"], [class*="label"], [class*="tag"]');
                const category = badge?.innerText?.trim() || '';

                // --- lines từ contentBody ---
                // rawLines: [tourName, departure, duration, "Giá từ:", price, "Xem chi tiết"]
                // Dùng index cố định thay vì filter string để tránh lỗi encoding mismatch
                const body     = card.querySelector('[class*="contentBody"]');
                const rawLines = (body?.innerText || '')
                    .split('\n')
                    .map(l => l.trim())
                    .filter(Boolean);

                // rawLines[0] luôn là tên tour — bỏ qua, lấy từ index 1 trở đi
                const dataLines = rawLines.slice(1).filter(l => !SKIP_LINES.has(l));

                const departure = dataLines[0] || '';
                const duration  = dataLines[1] || '';
                const priceRaw  = dataLines.find(l => l.includes('₫')) || '';
                const priceFrom = parseInt(priceRaw.replace(/[^\d]/g, ''), 10) || 0;

                return { pid, tourName, departure, duration, priceFrom, category, tourType: type };
            });
        }, tourType);

    } catch (err) {
        log('VT', `[ERROR] ${err.message}`);
    } finally {
        await page.close();
    }

    // Normalize departure
    tours = tours.map(t => ({ ...t, departure: normalizeDeparture(t.departure) }));
    log('VT', `Listing ${tourType}: ${tours.length} tours | token: ${token ? 'OK' : 'FAIL'}`);
    return { token, clientId, tours };
}

/**
 * Vào trang chi tiết để lấy tourCode (Mã chương trình).
 * URL pattern: https://travel.com.vn/chuong-trinh/pid-[pid]
 * Không cần slug, URL dạng này được trang hỗ trợ trực tiếp.
 */
async function getTourCodeFromDetail(browser, pid, token) {
    const page = await browser.newPage();
    try {
        // travel.com.vn hỗ trợ URL dạng /chuong-trinh/pid-[pid] trực tiếp — không cần slug
        const url = `https://travel.com.vn/chuong-trinh/pid-${pid}`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await delay(1500);

        const tourCode = await page.evaluate(() => {
            // Thử lấy từ element trực tiếp trước (chính xác hơn regex trên innerText)
            const allEls = [...document.querySelectorAll('*')];
            for (const el of allEls) {
                if (el.children.length === 0 && /^[A-Z]{2,5}[A-Z0-9]{0,5}[0-9]{2,6}$/.test(el.innerText?.trim())) {
                    const parent = el.parentElement?.innerText || '';
                    if (parent.includes('Mã chương trình') || parent.includes('chương trình')) {
                        return el.innerText.trim();
                    }
                }
            }
            // Fallback: regex trên toàn bộ innerText
            const text = document.body.innerText;
            const m = text.match(/Mã chương trình[^\n]*?([A-Z]{2,5}[A-Z0-9]{0,5}[0-9]{2,6})/);
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
// TEST VIETRAVEL
// ============================================================
async function testVietravel(browser) {
    log('TEST', '===== VIETRAVEL =====');
    const cfg = CONFIG.vietravel;

    for (const [typeName, typeCfg] of [
        ['domestic',      cfg.domestic],
        ['international', cfg.international],
    ]) {
        log('VT', `--- ${typeName.toUpperCase()} ---`);

        const { token, clientId, tours } = await scrapeVietravelListing(
            browser, typeCfg.listingUrl, typeCfg.tourType
        );

        if (!token) {
            log('VT', '[FAIL] Không lấy được token');
            continue;
        }
        if (tours.length === 0) {
            log('VT', '[WARN] Không parse được tour nào — kiểm tra selector article[data-track="tour-card"]');
            continue;
        }

        log('VT', `Có ${tours.length} tours — test ${TEST_LIMIT} tour đầu:`);

        const headers = {
            'Authorization': `Bearer ${token}`,
            'ClientId':      clientId || '',
            'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        };

        for (const tour of tours.slice(0, TEST_LIMIT)) {
            const { pid, tourName, duration, priceFrom, departure, category } = tour;

            log('VT', `  pid: ${pid} | ${tourName.substring(0, 50)}`);

            // Bước 1: vào trang chi tiết lấy tourCode
            const tourCode = await getTourCodeFromDetail(browser, pid, token);
            if (!tourCode) {
                log('VT', `  [WARN] Không lấy được tourCode từ detail — bỏ qua`);
                continue;
            }
            log('VT', `  tourCode: ${tourCode}`);

            // Bước 2: fetch giá từ API
            const apiUrl = `${cfg.apiBase}/get-tour-info-day?tourCode=${tourCode}&month=5&year=2026`;
            const data   = await httpGet(apiUrl, headers);

            const country = extractCountry(tourName, typeCfg.tourType);
            const region  = extractRegion(country);

            if (data && data.status === 1 && Array.isArray(data.response) && data.response.length > 0) {
                const firstDay = data.response[0];
                const apiPrice = firstDay.salePrice || firstDay.tours?.[0]?.salePrice || 0;
                log('VT', `  ✓ OK`);
                log('VT', `    duration: ${duration} | category: ${category} | khoi_hanh: ${departure}`);
                log('VT', `    quoc_gia: ${country} | khu_vuc: ${region}`);
                log('VT', `    gia_listing: ${priceFrom.toLocaleString()} | gia_api: ${apiPrice.toLocaleString()} | schedules: ${data.response.length}`);
            } else {
                log('VT', `  ✗ Không có lịch tháng 5 | quoc_gia: ${country} | API status: ${data?.status}`);
            }

            await delay(cfg.requestDelay);
        }
    }
}

// ============================================================
// TEST BENTHANH (giữ nguyên)
// ============================================================
async function testBenThanh(browser) {
    log('TEST', '===== BENTHANH TOURIST =====');
    const cfg = CONFIG.benthanh;

    for (const [typeName, typeCfg] of [['domestic', cfg.domestic], ['international', cfg.international]]) {
        log('BTT', `--- ${typeName.toUpperCase()} ---`);

        const listPage = await browser.newPage();
        await listPage.goto(typeCfg.listingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await delay(2000);

        const links = await listPage.evaluate(() => {
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
            return result.slice(0, 3);
        });

        await listPage.close();
        log('BTT', `Lấy được ${links.length} links mẫu`);

        for (const tourUrl of links.slice(0, TEST_LIMIT)) {
            const detailPage = await browser.newPage();
            try {
                await detailPage.goto(tourUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await delay(1500);

                const detail = await detailPage.evaluate(() => {
                    const body = document.body.innerText;
                    const h1 = document.querySelector('h1');
                    const tourName = h1 ? h1.innerText.trim() : '';
                    const codeMatch = body.match(/Mã tour\s*[:\s]+([A-Z0-9]{6,20})/);
                    const depMatch = body.match(/Khởi hành\s*[:\s]+([^\n]{2,50})/);
                    const durMatch = body.match(/Thời gian\s*[:\s]+([^\n]{3,30})/);
                    const priceMatch = body.match(/([\d,]+)\s*VNĐ/);
                    const scheduleCount = document.querySelectorAll('#card-table-tour-days ul.list-options-tour').length;

                    let duration = '';
                    if (durMatch) {
                        const nd = durMatch[1].match(/(\d+)\s*ng[aà]y\s*(\d+)\s*đêm/i);
                        if (nd) duration = nd[1] + 'N' + nd[2] + 'Đ';
                        else duration = durMatch[1].trim();
                    }

                    return {
                        tourName,
                        tourCode: codeMatch ? codeMatch[1] : '',
                        departure: depMatch ? depMatch[1].trim() : '',
                        duration,
                        price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : 0,
                        scheduleCount,
                    };
                });

                const country = extractCountry(detail.tourName, typeCfg.tourType);
                const region = extractRegion(country);
                const dep = normalizeDeparture(detail.departure);

                log('BTT', `✓ ${detail.tourCode} | ${detail.tourName.substring(0, 40)}`);
                log('BTT', `  quoc_gia: ${country} | khu_vuc: ${region} | khoi_hanh: ${dep} | duration: ${detail.duration} | schedules: ${detail.scheduleCount}`);

            } catch (err) {
                log('BTT', `✗ ${tourUrl.split('/tour/')[1]?.substring(0, 40)} | ${err.message}`);
            } finally {
                await detailPage.close();
            }
            await delay(cfg.requestDelay);
        }
    }
}

// ============================================================
// TEST DU LỊCH VIỆT
// Logic: stealth browser, click "Xem thêm" để load hết listing,
//        scrape trang chi tiết lấy mã tour / lịch / giá
// ============================================================

const STEALTH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none', 'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
};

async function dlv_applyStealthToPage(page) {
    await page.setExtraHTTPHeaders(STEALTH_HEADERS);
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        ]});
        Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN','vi','en-US','en'] });
        window.chrome = { runtime: {} };
    });
}

async function dlv_waitForLoadingDone(page, ms = 10000) {
    try {
        await page.waitForFunction(() =>
            [...document.querySelectorAll('.mda-loading, .mda-box-loading')].every(el => {
                const s = window.getComputedStyle(el);
                return s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0' || !el.offsetParent;
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

async function dlv_getLinks(browser, listingUrl, limit = 3) {
    const page = await browser.newPage();
    await dlv_applyStealthToPage(page);
    const seen = new Set(), links = [];
    try {
        log('DLV', `Listing: ${listingUrl}`);
        await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        try { await page.waitForSelector('span.mda-btn-tour-more', { timeout: 10000 }); }
        catch (_) { await delay(4000); }

        for (const l of await dlv_extractLinks(page))
            if (!seen.has(l)) { seen.add(l); links.push(l); }
        log('DLV', `  Load 1: ${links.length} links — chỉ test ${limit} đầu`);
    } catch (err) {
        log('DLV', `[ERROR] getLinks: ${err.message}`);
    } finally {
        await page.close();
    }
    return links.slice(0, limit);
}

function dlv_normalizeVehicle(raw) {
    if (!raw) return '';
    const l = raw.toLowerCase();
    const parts = [];
    if (l.includes('xe'))   parts.push('Xe');
    if (l.includes('tàu hỏa') || l.includes('tàu thủy')) parts.push('Tàu hỏa');
    if (l.includes('máy bay') || l.includes('hàng không') || l.includes('airline')) parts.push('Máy bay');
    return parts.join(', ');
}

function dlv_parseDuration(raw) {
    if (!raw || /[\/,;]/.test(raw)) return '';
    const nd = raw.match(/(\d+)\s*ng[aà]y\s*(\d+)\s*đêm/i);
    if (nd) return `${nd[1]}N${nd[2]}Đ`;
    if (/^\d+N\d+[DĐ]$/i.test(raw.trim())) return raw.trim().toUpperCase();
    return '';
}

function dlv_parseSchedules(raw, price) {
    if (!raw) return [];
    const seen = new Set(), schedules = [];
    const year = new Date().getFullYear();
    const re = /(\d{1,2}(?:,\s*\d{1,2})*)\s*\/\s*(\d{2})\s*(?:\/\s*(\d{4}))?/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
        const month = parseInt(m[2]);
        if (month < 1 || month > 12) continue;
        const y = m[3] ? parseInt(m[3]) : year;
        if (y < 2024 || y > 2030) continue;
        for (const d of m[1].split(',').map(d => parseInt(d.trim()))) {
            if (d < 1 || d > 31) continue;
            const dateStr = `${y}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            if (seen.has(dateStr)) continue;
            seen.add(dateStr);
            schedules.push({ departureDate: dateStr, salePrice: price, priceFinal: price,
                             discountAmount: 0, isDiscount: 0, seatsAvailable: null });
        }
    }
    return schedules;
}

async function dlv_scrapeDetail(browser, tourUrl, tourType) {
    const page = await browser.newPage();
    await dlv_applyStealthToPage(page);
    try {
        await page.goto(tourUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await delay(1500);

        const detail = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const h1 = document.querySelector('h1, .tour-title, .mda-title, h2.title');
            const tourName = h1 ? h1.innerText.trim()
                                : document.title.replace(/\s*[-|]\s*.*$/, '').trim();
            const codeMatch = bodyText.match(/Mã tour\s*[:\s]*(\d+)/i);
            const tourCode  = codeMatch ? `DLV${codeMatch[1]}` : '';

            function getLabelValue(label) {
                for (const row of document.querySelectorAll('tr')) {
                    const cells = [...row.querySelectorAll('td, th')];
                    for (let i = 0; i < cells.length - 1; i++) {
                        if (cells[i].innerText.trim().toLowerCase().startsWith(label.toLowerCase())) {
                            return cells[i + 1].innerText.trim();
                        }
                    }
                }
                const m = bodyText.match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\s*[:\\s]+([^\\n]{1,50})','i'));
                return m ? m[1].trim() : '';
            }

            const durRaw      = getLabelValue('Thời gian');
            const vehRaw      = getLabelValue('Vận Chuyển') || getLabelValue('Vận chuyển') || getLabelValue('Phương tiện');
            const depRaw      = getLabelValue('Xuất phát') || getLabelValue('Nơi xuất phát');
            const scheduleRaw = getLabelValue('Khởi hành');
            const priceMatch  = bodyText.match(/Giá từ[:\s]*([\d.,]+)\s*[đĐ₫]/i)
                             || bodyText.match(/giá\s*[:\s]*([\d.,]+)\s*[đĐ₫]/i);
            const priceFrom   = priceMatch ? parseInt(priceMatch[1].replace(/[.,]/g,'')) || 0 : 0;

            return { tourName, tourCode, durRaw, vehRaw, depRaw, scheduleRaw, priceFrom };
        });

        if (!detail.tourCode) {
            log('DLV', `  [SKIP] Không lấy được mã tour`);
            return null;
        }

        const country   = extractCountry(detail.tourName, tourType);
        const region    = extractRegion(country);
        const duration  = dlv_parseDuration(detail.durRaw);
        const vehicle   = dlv_normalizeVehicle(detail.vehRaw);
        const departure = normalizeDeparture((detail.depRaw || '').replace(/^(từ|from)\s+/i,'').trim());
        const schedules = dlv_parseSchedules(detail.scheduleRaw || '', detail.priceFrom);

        log('DLV', `  ✓ ${detail.tourCode} | ${detail.tourName.substring(0,45)}`);
        log('DLV', `    duration: ${duration} | vehicle: ${vehicle} | departure: ${departure}`);
        log('DLV', `    quoc_gia: ${country} | khu_vuc: ${region} | schedules: ${schedules.length}`);

        return { tourCode: detail.tourCode, tourName: detail.tourName, country, region, duration, vehicle, departure, schedules };
    } catch (err) {
        log('DLV', `  [ERROR] ${err.message}`);
        return null;
    } finally {
        await page.close();
    }
}

async function testDuLichViet(browser) {
    log('TEST', '===== DU LỊCH VIỆT =====');

    for (const [typeName, listingUrl, tourType] of [
        ['domestic',      'https://dulichviet.com.vn/du-lich-trong-nuoc', 'domestic'],
        ['international', 'https://dulichviet.com.vn/du-lich-nuoc-ngoai', 'international'],
    ]) {
        log('DLV', `--- ${typeName.toUpperCase()} ---`);
        const links = await dlv_getLinks(browser, listingUrl, TEST_LIMIT);

        if (links.length === 0) {
            log('DLV', '[WARN] Không lấy được link tour nào');
            continue;
        }

        for (const tourUrl of links) {
            log('DLV', `  ${tourUrl.split('/').pop()?.substring(0, 60)}`);
            await dlv_scrapeDetail(browser, tourUrl, tourType);
            await delay(1500);
        }
    }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
    const mode = process.argv[2] || 'all';
    log('TEST', `=== Test Scraper === mode: ${mode}`);

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        if (mode === 'vietravel'  || mode === 'all') await testVietravel(browser);
        if (mode === 'benthanh'   || mode === 'all') await testBenThanh(browser);
        if (mode === 'dulichviet' || mode === 'all') await testDuLichViet(browser);
    } finally {
        await browser.close();
    }

    log('TEST', '=== Xong! Kiểm tra kết quả bên trên ===');
}

main().catch(err => console.error('[FATAL]', err.message));