'use strict';

/**
 * scraper-dlv.js — Du Lịch Việt (dulichviet.com.vn)
 *
 * Cấu trúc trang chi tiết tour:
 *   Mã tour:     19070
 *   Thời gian:   5 ngày 4 đêm
 *   Khởi hành:   08,15/04; 06,13,20,27/05; ...  ← lịch ngày khởi hành
 *   Vận Chuyển:  Xe du lịch, Máy bay
 *   Xuất phát:   Từ Hồ Chí Minh                 ← nơi khởi hành
 *
 * node scraper-dlv.js           -- domestic + international
 * node scraper-dlv.js domestic  -- chỉ trong nước
 * node scraper-dlv.js intl      -- chỉ nước ngoài
 */

const { chromium } = require('playwright');
const http = require('http');

// ============================================================
// CẤU HÌNH
// ============================================================
const CONFIG = {
    domestic:      { tourType: 'domestic',      ct: 70, listingUrl: 'https://dulichviet.com.vn/du-lich-trong-nuoc' },
    international: { tourType: 'international', ct: 67, listingUrl: 'https://dulichviet.com.vn/du-lich-nuoc-ngoai' },
    phpSaveUrl: 'http://localhost/travel-scraper/api/save_tours_v3.php',
    source: 'dulichviet',
    tenCongTy: 'Du Lịch Việt',
    pageDelay: 2000,
    maxPages: 30,
    pollTimeout: 8000,
    pollInterval: 500,
};

const STEALTH_HEADERS = {
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

// ============================================================
// CHUẨN HÓA
// ============================================================
const COUNTRY_KEYWORDS = [
    ['nhật bản','Nhật Bản'],['japan','Nhật Bản'],
    ['hàn quốc','Hàn Quốc'],['korea','Hàn Quốc'],
    ['trung quốc','Trung Quốc'],['china','Trung Quốc'],
    ['thái lan','Thái Lan'],['thailand','Thái Lan'],['bangkok','Thái Lan'],
    ['singapore','Singapore'],
    ['indonesia','Indonesia'],['bali','Indonesia'],
    ['malaysia','Malaysia'],
    ['campuchia','Campuchia'],['cambodia','Campuchia'],
    ['đài loan','Đài Loan'],['taiwan','Đài Loan'],
    ['hong kong','Hồng Kông'],
    ['pháp','Pháp'],['france','Pháp'],['paris','Pháp'],
    ['ý','Ý'],['italy','Ý'],
    ['đức','Đức'],['germany','Đức'],
    ['anh','Anh'],['london','Anh'],['anh quốc','Anh'],
    ['thụy sĩ','Thụy Sĩ'],['switzerland','Thụy Sĩ'],
    ['áo','Áo'],['austria','Áo'],
    ['séc','Séc'],['czech','Séc'],
    ['na uy','Na Uy'],['norway','Na Uy'],
    ['phần lan','Phần Lan'],['finland','Phần Lan'],
    ['thụy điển','Thụy Điển'],['sweden','Thụy Điển'],
    ['bồ đào nha','Bồ Đào Nha'],['portugal','Bồ Đào Nha'],
    ['tây ban nha','Tây Ban Nha'],['spain','Tây Ban Nha'],
    ['hy lạp','Hy Lạp'],['greece','Hy Lạp'],
    ['úc','Úc'],['australia','Úc'],
    ['new zealand','New Zealand'],
    ['mỹ','Mỹ'],['usa','Mỹ'],['america','Mỹ'],
    ['canada','Canada'],
    ['dubai','UAE'],['uae','UAE'],
    ['ấn độ','Ấn Độ'],['india','Ấn Độ'],
    ['nepal','Nepal'],['bhutan','Bhutan'],
    ['nga','Nga'],['russia','Nga'],
    ['thổ nhĩ kỳ','Thổ Nhĩ Kỳ'],['turkey','Thổ Nhĩ Kỳ'],['istanbul','Thổ Nhĩ Kỳ'],
    ['ai cập','Ai Cập'],['egypt','Ai Cập'],
    ['việt nam','Việt Nam'],['vietnam','Việt Nam'],
];

const REGION_MAP = {
    'Việt Nam':'Đông Nam Á','Thái Lan':'Đông Nam Á','Singapore':'Đông Nam Á',
    'Indonesia':'Đông Nam Á','Malaysia':'Đông Nam Á','Campuchia':'Đông Nam Á',
    'Đài Loan':'Đông Nam Á','Hồng Kông':'Đông Nam Á',
    'Nhật Bản':'Đông Bắc Á','Hàn Quốc':'Đông Bắc Á','Trung Quốc':'Đông Bắc Á',
    'Ấn Độ':'Nam Á','Nepal':'Nam Á','Bhutan':'Nam Á',
    'UAE':'Trung Đông','Thổ Nhĩ Kỳ':'Trung Đông','Ai Cập':'Trung Đông',
    'Pháp':'Châu Âu','Ý':'Châu Âu','Đức':'Châu Âu','Anh':'Châu Âu',
    'Thụy Sĩ':'Châu Âu','Áo':'Châu Âu','Séc':'Châu Âu','Na Uy':'Châu Âu',
    'Phần Lan':'Châu Âu','Thụy Điển':'Châu Âu','Bồ Đào Nha':'Châu Âu',
    'Tây Ban Nha':'Châu Âu','Hy Lạp':'Châu Âu','Nga':'Châu Âu',
    'Úc':'Châu Úc','New Zealand':'Châu Úc',
    'Mỹ':'Châu Mỹ','Canada':'Châu Mỹ',
};

const DEPARTURE_MAP = {
    'hồ chí minh':'TP. Hồ Chí Minh','ho chi minh':'TP. Hồ Chí Minh',
    'hcm':'TP. Hồ Chí Minh','tp.hcm':'TP. Hồ Chí Minh','tphcm':'TP. Hồ Chí Minh',
    'sài gòn':'TP. Hồ Chí Minh','sai gon':'TP. Hồ Chí Minh',
    'hà nội':'Hà Nội','ha noi':'Hà Nội','hanoi':'Hà Nội',
    'đà nẵng':'Đà Nẵng','da nang':'Đà Nẵng',
    'cần thơ':'Cần Thơ','can tho':'Cần Thơ',
    'hải phòng':'Hải Phòng',
};

function extractCountry(name, type) {
    if (type === 'domestic') return 'Việt Nam';
    if (!name) return '';
    const lower = name.toLowerCase();
    for (const [kw, c] of COUNTRY_KEYWORDS) if (lower.includes(kw)) return c;
    return '';
}
function extractRegion(c) { return REGION_MAP[c] || 'Khác'; }

// "Từ Hồ Chí Minh" → "TP. Hồ Chí Minh"
function normalizeDeparture(raw) {
    if (!raw) return '';
    // Bỏ prefix "Từ ", "từ ", "From "
    const cleaned = raw.replace(/^(từ|from)\s+/i, '').trim();
    const lower = cleaned.toLowerCase();
    for (const [k, v] of Object.entries(DEPARTURE_MAP)) {
        if (lower.includes(k)) return v;
    }
    // Trả về nếu ngắn và trông giống tên thành phố
    if (cleaned.length > 0 && cleaned.length <= 40 && !/\d{4,}/.test(cleaned)) {
        return cleaned;
    }
    return '';
}

// "Xe du lịch, Máy bay" → "Xe, Máy bay"
function normalizeVehicle(raw) {
    if (!raw) return '';
    const l = raw.toLowerCase();
    const hasBay = l.includes('máy bay') || l.includes('may bay') ||
                   l.includes('hàng không') || l.includes('airline') ||
                   l.includes('airways') || l.includes('air ');
    const hasXe  = l.includes('xe');
    const hasTau = l.includes('tàu hỏa') || l.includes('tau hoa') || l.includes('tàu thủy');
    const parts = [];
    if (hasXe)  parts.push('Xe');
    if (hasTau) parts.push('Tàu hỏa');
    if (hasBay) parts.push('Máy bay');
    return parts.join(', ');
}

// "5 ngày 4 đêm" → "5N4Đ"
function parseDuration(raw) {
    if (!raw) return '';
    // Bỏ nếu có dấu / hoặc , — bị lẫn lịch
    if (/[\/,;]/.test(raw)) return '';
    const nd = raw.match(/(\d+)\s*ng[aà]y\s*(\d+)\s*đêm/i);
    if (nd) return `${nd[1]}N${nd[2]}Đ`;
    if (/^\d+N\d+[DĐ]$/i.test(raw.trim())) return raw.trim().toUpperCase();
    return '';
}

// ============================================================
// UTILS
// ============================================================
function log(msg) {
    console.log(`[${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}] ${msg}`);
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function postToPhp(url, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const p = new URL(url);
        const req = http.request({
            hostname: p.hostname, path: p.pathname, port: p.port || 80, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, res => { let r = ''; res.on('data', c => r += c); res.on('end', () => resolve(r)); });
        req.on('error', reject);
        req.write(body); req.end();
    });
}

// ============================================================
// STEALTH
// ============================================================
async function launchStealthBrowser() {
    return chromium.launch({
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox',
               '--disable-blink-features=AutomationControlled',
               '--disable-dev-shm-usage','--no-first-run',
               '--disable-gpu','--window-size=1366,768'],
    });
}

async function applyStealthToPage(page) {
    await page.setExtraHTTPHeaders(STEALTH_HEADERS);
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

// ============================================================
// LISTING PAGE
// ============================================================
async function extractLinks(page) {
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

async function waitForLoadingDone(page, ms = 15000) {
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

async function clickXemThem(page, countBefore) {
    await waitForLoadingDone(page);
    const btn = await page.$('span.mda-btn-tour-more');
    if (!btn || !(await btn.isVisible().catch(() => false))) return false;
    await btn.scrollIntoViewIfNeeded();
    await delay(400);
    await page.evaluate(el => el.click(), btn);
    await delay(300);
    await waitForLoadingDone(page, 10000);
    for (let w = 0; w < CONFIG.pollTimeout; w += CONFIG.pollInterval) {
        await delay(CONFIG.pollInterval);
        const n = await page.evaluate(() => {
            const ps = ['/du-lich-nuoc-ngoai/', '/du-lich-trong-nuoc/'];
            return [...new Set([...document.querySelectorAll('a[href]')]
                .map(a => (a.href||'').split('?')[0])
                .filter(h => ps.some(p => h.includes(p)) &&
                             h.split('/').filter(Boolean).pop()?.length > 5)
            )].length;
        });
        if (n > countBefore) { log(`  [BTN] Links: ${countBefore} → ${n}`); return true; }
    }
    return false;
}

async function getTourLinks(browser, listingUrl) {
    const seen = new Set(), links = [];
    const page = await browser.newPage();
    await applyStealthToPage(page);
    try {
        log(`  Loading: ${listingUrl}`);
        await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        try {
            await page.waitForSelector('span.mda-btn-tour-more', { timeout: 15000 });
            await delay(800);
        } catch (_) { await delay(5000); }

        for (const l of await extractLinks(page))
            if (!seen.has(l)) { seen.add(l); links.push(l); }
        log(`  Load 1: ${links.length} links`);

        for (let p = 2; p <= CONFIG.maxPages + 1; p++) {
            const before = seen.size;
            if (!(await clickXemThem(page, before))) { log('  Hết tour'); break; }
            let added = 0;
            for (const l of await extractLinks(page))
                if (!seen.has(l)) { seen.add(l); links.push(l); added++; }
            log(`  Load ${p}: ${links.length} links (mới: ${added})`);
            if (added === 0) { log('  Không có link mới, dừng'); break; }
        }
    } catch (err) { log(`  [ERROR] getTourLinks: ${err.message}`); }
    finally { await page.close(); }
    log(`Tổng: ${links.length} tour links`);
    return links;
}

// ============================================================
// BUOC 2: CHI TIẾT TOUR
//
// Mapping label thật trên trang DLV:
//   "Mã tour"      → tourCode
//   "Thời gian"    → duration    (vd: "5 ngày 4 đêm")
//   "Khởi hành"    → lịch ngày  (vd: "08,15/04; 06,13/05; ...")
//   "Vận Chuyển"   → vehicle     (vd: "Xe du lịch, Máy bay")
//   "Xuất phát"    → departure   (vd: "Từ Hồ Chí Minh")  ← FIX CHÍNH
// ============================================================
async function scrapeTourDetail(browser, tourUrl, tourType) {
    const page = await browser.newPage();
    await applyStealthToPage(page);
    try {
        await page.goto(tourUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await delay(1500);

        const detail = await page.evaluate(() => {
            const bodyText = document.body.innerText;

            // Tên tour
            const h1 = document.querySelector('h1, .tour-title, .mda-title, h2.title');
            const tourName = h1
                ? h1.innerText.trim()
                : document.title.replace(/\s*[-|]\s*.*$/, '').trim();

            // Mã tour
            const codeMatch = bodyText.match(/Mã tour\s*[:\s]*(\d+)/i);
            const tourCode  = codeMatch ? `DLV${codeMatch[1]}` : '';

            // Hàm lấy value theo label — tìm trong td cạnh nhau (cấu trúc table DLV)
            function getLabelValue(labelText) {
                const rows = [...document.querySelectorAll('tr')];
                for (const row of rows) {
                    const cells = [...row.querySelectorAll('td, th')];
                    for (let i = 0; i < cells.length - 1; i++) {
                        const cellLabel = cells[i].innerText.trim().toLowerCase()
                            .replace(/\s+/g, ' ');
                        if (cellLabel === labelText.toLowerCase() ||
                            cellLabel.startsWith(labelText.toLowerCase())) {
                            return cells[i + 1].innerText.trim();
                        }
                    }
                }
                // Fallback: regex giới hạn 1 dòng ngắn
                const re = new RegExp(
                    labelText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                    '\\s*[:\\s]+([^\\n]{1,50})',
                    'i'
                );
                const m = bodyText.match(re);
                return m ? m[1].trim() : '';
            }

            const durRaw = getLabelValue('Thời gian');
            const vehRaw = getLabelValue('Vận Chuyển') || getLabelValue('Vận chuyển') ||
                           getLabelValue('Phương tiện');
            // "Xuất phát" là nơi khởi hành — KHÔNG dùng "Khởi hành" (đó là lịch ngày)
            const depRaw = getLabelValue('Xuất phát') || getLabelValue('Nơi xuất phát');

            // Lịch khởi hành nằm ở label "Khởi hành"
            const scheduleRaw = getLabelValue('Khởi hành');

            // Giá
            const priceMatch = bodyText.match(/Giá từ[:\s]*([\d.,]+)\s*[đĐ₫]/i)
                            || bodyText.match(/giá\s*[:\s]*([\d.,]+)\s*[đĐ₫]/i);
            const priceFrom = priceMatch
                ? parseInt(priceMatch[1].replace(/[.,]/g, '')) || 0
                : 0;

            return {
                tourName, tourCode, priceFrom,
                durRaw, vehRaw, depRaw, scheduleRaw,
                bodyText,
            };
        });

        if (!detail.tourCode) {
            log(`  [SKIP] Không lấy được mã tour: ${tourUrl}`);
            return null;
        }

        const duration  = parseDuration(detail.durRaw);
        const vehicle   = normalizeVehicle(detail.vehRaw);
        const departure = normalizeDeparture(detail.depRaw);

        // Parse lịch: ưu tiên dùng scheduleRaw từ label "Khởi hành"
        // Nếu rỗng thì fallback quét toàn bodyText
        const scheduleSource = detail.scheduleRaw || detail.bodyText;
        const schedules = parseSchedules(scheduleSource, detail.priceFrom);

        return {
            tourName:  detail.tourName,
            tourCode:  detail.tourCode,
            duration, vehicle, departure,
            priceFrom: detail.priceFrom,
            schedules,
        };
    } catch (err) {
        log(`  [ERROR] ${tourUrl}: ${err.message}`);
        return null;
    } finally {
        await page.close();
    }
}

// ============================================================
// PARSE LỊCH KHỞI HÀNH
// Input: "08,15/04; 06,13,20,27/05; 03,10,17,24/06; ..."
// ============================================================
function parseSchedules(raw, price) {
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
                discountAmount: 0, isDiscount: 0,
                seatsAvailable: null, thang: month,
            });
        }
    }
    return schedules;
}

// ============================================================
// BUOC 3: LƯU DB
// ============================================================
async function saveToDb(tourInfo, priceRecords) {
    if (!priceRecords.length) return;
    try {
        const res = await postToPhp(CONFIG.phpSaveUrl, {
            tourInfo, priceRecords, scrapedAt: new Date().toISOString(),
        });
        const parsed = JSON.parse(res);
        if (parsed.savedPrices)
            log(`  -> DB: saved ${parsed.savedPrices} prices`);
        else if (parsed.errors?.length)
            log(`  -> DB errors: ${parsed.errors.slice(0,2).join(', ')}`);
    } catch (err) { log(`  [ERROR] Save DB: ${err.message}`); }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
    const mode = (process.argv[2] || 'all').toLowerCase();
    log('=== Du Lịch Việt Scraper ===');
    log(`Mode: ${mode}`);

    const browser = await launchStealthBrowser();
    try {
        let totalSaved = 0, totalSkipped = 0;
        const types = [];
        if (mode === 'all' || mode === 'domestic')
            types.push(['domestic', CONFIG.domestic]);
        if (mode === 'all' || mode === 'intl')
            types.push(['international', CONFIG.international]);

        for (const [typeName, typeCfg] of types) {
            log(`\n--- ${typeName.toUpperCase()} (ct=${typeCfg.ct}) ---`);
            const tourLinks = await getTourLinks(browser, typeCfg.listingUrl);
            log(`Tổng: ${tourLinks.length} tour links`);

            for (let i = 0; i < tourLinks.length; i++) {
                const tourUrl = tourLinks[i];
                log(`[${typeName === 'domestic' ? 'TN' : 'NN'}] ${i+1}/${tourLinks.length} - ${tourUrl.split('/').pop()?.substring(0,50)}`);

                const detail = await scrapeTourDetail(browser, tourUrl, typeCfg.tourType);
                if (!detail) { totalSkipped++; continue; }

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
                    source:        CONFIG.source,
                    tenCongTy:     CONFIG.tenCongTy,
                    duration:      detail.duration,
                    departure:     detail.departure,
                    noi_khoi_hanh: detail.departure,
                    vehicle:       detail.vehicle,
                    category:      '',
                    quoc_gia:      country,
                    khu_vuc:       region,
                    priceFrom:     detail.priceFrom,
                };

                log(`  ${detail.tourName.substring(0,45)} | ${detail.duration || '?'} | ${detail.vehicle || '?'} | ${detail.departure || '?'} | ${priceRecords.length} lịch`);
                await saveToDb(tourInfo, priceRecords);
                if (priceRecords.length > 0) totalSaved++;
                else totalSkipped++;
                await delay(CONFIG.pageDelay);
            }
        }

        log(`\n=== Hoàn thành! Saved: ${totalSaved}, Skipped: ${totalSkipped} ===`);
    } finally {
        await browser.close();
    }
}

main().catch(err => log(`[FATAL] ${err.message}`));