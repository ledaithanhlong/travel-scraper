/**
 * scraper.js
 * ----------
 * Dùng Playwright mở Chrome thật → lấy Bearer token tự động
 * → gọi API get-tour-info-day → lưu vào MySQL qua PHP API
 *
 * Chạy: node scraper.js
 */

const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

// ─── Config ──────────────────────────────────────────────────────────────────
const CONFIG = {
    targetUrl: 'https://travel.com.vn/du-lich-tiet-kiem.aspx',
    baseApi: 'https://api2.travel.com.vn/core/tour',
    tourCodes: [
        'NDSGN538',
        'NDSGN612',
        'NNSGN222',
        'NNHA751',
        'NNSGN1338',
        'NDSGN534',
        'NDHAN200',
        'NNSGN288',
        'NNSGN4512',
        'NNSGN6183'
    ],   // Thêm tourCode khác vào đây
    monthsAhead: 3,
    saveApiUrl: 'http://localhost/travel-scraper/api/save_tours.php',
};

// ─── Helper: gọi HTTP POST ────────────────────────────────────────────────────
function postJSON(url, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const parsed = new URL(url);
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || 80,
            path: parsed.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        };
        const req = http.request(options, res => {
            let raw = '';
            res.on('data', chunk => raw += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(raw)); }
                catch { resolve({ success: false, raw }); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ─── Helper: log ─────────────────────────────────────────────────────────────
function log(msg) {
    const line = `[${new Date().toLocaleString('vi-VN')}] ${msg}`;
    console.log(line);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
    log('=== Scraper started ===');

    // 1. Mở Chrome thật (headless = ẩn, đổi false để thấy Chrome mở ra)
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // 2. Gắn listener TRƯỚC khi goto để bắt được mọi request
    let capturedToken = null;
    let capturedClientId = null;

    page.on('request', request => {
        const auth = request.headers()['authorization'];
        const clientId = request.headers()['clientid'];
        if (auth && auth.startsWith('Bearer ') && !capturedToken) {
            capturedToken = auth;
            capturedClientId = clientId || '';
            log(`Token captured: ${capturedToken.substring(0, 40)}...`);
        }
    });

    // 3. Vào trang — listener đã sẵn sàng bắt request
    log('Đang mở trang travel.com.vn...');
    await page.goto(CONFIG.targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
    log('Trang đã load xong.');

    // Scroll để trigger thêm request lazy-load nếu token chưa bắt được
    if (!capturedToken) {
        log('Chưa bắt được token, thử scroll để trigger thêm request...');
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(4000);
    }

    // Fallback: thử lấy token trực tiếp từ JS runtime của trang
    if (!capturedToken) {
        log('Thử lấy token từ JS runtime...');
        try {
            const tokenFromJS = await page.evaluate(() => {
                // Một số trang lưu token trong localStorage hoặc biến global
                return localStorage.getItem('token')
                    || localStorage.getItem('accessToken')
                    || localStorage.getItem('Authorization')
                    || window.__token
                    || window.__auth
                    || null;
            });
            if (tokenFromJS) {
                capturedToken = tokenFromJS.startsWith('Bearer ')
                    ? tokenFromJS
                    : `Bearer ${tokenFromJS}`;
                log(`Token từ localStorage: ${capturedToken.substring(0, 40)}...`);
            }
        } catch (e) {
            log(`[WARN] Không đọc được localStorage: ${e.message}`);
        }
    }

    if (!capturedToken) {
        log('[ERROR] Không lấy được token sau tất cả các phương pháp.');
        log('→ Gợi ý: đổi headless: false để xem Chrome thật và kiểm tra thủ công.');
        await browser.close();
        return;
    }

    await browser.close();
    log('Browser đóng. Bắt đầu scrape API...');

    // 4. Dùng token vừa lấy để gọi API
    const now = new Date();
    const allData = [];

    for (const tourCode of CONFIG.tourCodes) {
        for (let delta = 0; delta <= CONFIG.monthsAhead; delta++) {
            const d = new Date(now.getFullYear(), now.getMonth() + delta, 1);
            const month = d.getMonth() + 1;
            const year = d.getFullYear();

            const url = `${CONFIG.baseApi}/get-tour-info-day?tourCode=${tourCode}&month=${month}&year=${year}`;
            log(`Fetching [${tourCode}] ${month}/${year}...`);

            try {
                const res = await fetch(url, {
                    headers: {
                        'Authorization': capturedToken,
                        'ClientId': capturedClientId,
                        'Accept': 'application/json',
                        'Referer': 'https://travel.com.vn/',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    },
                });
                const data = await res.json();

                if (data.status !== 1) {
                    log(`[WARN] status != 1 [${tourCode} ${month}/${year}]: ${data.message}`);
                    continue;
                }

                const records = [];
                for (const dayItem of data.response || []) {
                    const departureDate = (dayItem.date || '').substring(0, 10);
                    if (!departureDate) continue;

                    for (const tour of dayItem.tours || []) {
                        records.push({
                            tour_code: tourCode,
                            sub_tour_code: tour.tourCode || null,
                            departure_date: departureDate,
                            sale_price: tour.salePrice || dayItem.salePrice || 0,
                            price_final: dayItem.priceFinal || 0,
                            discount_amount: dayItem.discountAmount || 0,
                            is_discount: dayItem.isDiscount ? 1 : 0,
                        });
                    }
                }

                log(`[${tourCode}] ${month}/${year} → ${records.length} records fetched.`);
                allData.push(...records);

            } catch (err) {
                log(`[ERROR] Fetch failed [${tourCode} ${month}/${year}]: ${err.message}`);
            }

            // Delay tránh rate-limit
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // 5. Gửi data về PHP API để lưu vào MySQL
    if (allData.length > 0) {
        log(`Sending ${allData.length} records to PHP save API...`);
        try {
            const result = await postJSON(CONFIG.saveApiUrl, { records: allData });
            log(`Save result: ${JSON.stringify(result)}`);
        } catch (err) {
            log(`[ERROR] Could not send to PHP API: ${err.message}`);
        }
    } else {
        log('[WARN] Không có data nào để lưu.');
    }

    log('=== Scraper finished ===');
}

main().catch(err => {
    log(`[FATAL] ${err.message}`);
    process.exit(1);
});
