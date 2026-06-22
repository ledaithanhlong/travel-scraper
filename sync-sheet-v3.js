'use strict';

/**
 * sync-sheet-v3.js
 *
 * Đồng bộ dữ liệu tour từ PHP API lên Google Sheets.
 * Hỗ trợ 3 công ty: Vietravel, BenThanh Tourist, Du Lịch Việt
 *
 * Cách chạy:
 *   node sync-sheet-v3.js              -- sync tất cả
 *   node sync-sheet-v3.js vietravel    -- chỉ Vietravel
 *   node sync-sheet-v3.js benthanh     -- chỉ BenThanh Tourist
 *   node sync-sheet-v3.js dulichviet   -- chỉ Du Lịch Việt
 */

const { google } = require('googleapis');
const http = require('http');

// ============================================================
// CẤU HÌNH
// ============================================================
const SPREADSHEET_ID   = '1CFN1CgyLolgFunD--6fZx5j-RqOJoMDfpDvMaw_TQkM';
const CREDENTIALS_PATH = './credentials.json';
const PHP_API_URL      = 'http://localhost/travel-scraper/api/get_tours_v3.php';

function log(msg) {
    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    console.log(`[${now}] ${msg}`);
}

// ============================================================
// LẤY DATA TỪ PHP API
// ============================================================
function fetchFromPhp(params = {}) {
    return new Promise((resolve, reject) => {
        const qs  = new URLSearchParams(params).toString();
        const url = `${PHP_API_URL}${qs ? '?' + qs : ''}`;
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(Array.isArray(JSON.parse(data)) ? JSON.parse(data) : []); }
                catch { resolve([]); }
            });
        }).on('error', (err) => { log(`[ERROR] fetchFromPhp: ${err.message}`); resolve([]); });
    });
}

// ============================================================
// HÀM TIỆN ÍCH
// ============================================================
function formatPrice(price) {
    if (!price || price === 0) return '';
    return Number(price);
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const raw = dateStr.toString().substring(0, 10);
    const [y, m, d] = raw.split('-');
    if (!y || !m || !d) return dateStr;
    return `${parseInt(d)}/${parseInt(m)}/${y}`;
}

function getPhanLoai(tourType) {
    if (tourType === 'domestic'      || tourType === 'Trong Nước') return 'Trong Nước';
    if (tourType === 'international' || tourType === 'Nước Ngoài') return 'Nước Ngoài';
    return tourType || '';
}

// ============================================================
// HEADER VÀ ROW BUILDER
// ============================================================
const SHEET_HEADERS = [
    'Tour Code',        // A
    'Sub Tour Code',    // B
    'Tên Tour',         // C
    'Công Ty',          // D
    'Phân Loại',        // E
    'Quốc Gia',         // F
    'Khu Vực',          // G
    'Thể Loại Tour',    // H
    'Phương Tiện',      // I
    'Thời Gian',        // J
    'Nơi Khởi Hành',   // K
    'Tháng',            // L
    'Ngày Khởi Hành',  // M
    'Số Chỗ',           // N
    'Giá Gốc',          // O
    'Giá Cuối',         // P
    'Giảm Giá',         // Q
    'Có KM',            // R
    'Khuyến Mãi',       // S
    'Source',           // T
    'Giờ Cập Nhật',    // U
    'Giờ Sync',        // V
];

function buildRow(r) {
    return [
        r.tour_code        || '',
        r.sub_tour_code    || '',
        r.tour_name        || '',
        r.ten_cong_ty      || r.source || '',
        getPhanLoai(r.tour_type),
        r.quoc_gia         || '',
        r.khu_vuc          || '',
        r.category         || '',
        r.vehicle          || '',
        r.duration         || '',
        r.noi_khoi_hanh    || '',
        r.thang !== null   ? Number(r.thang) : '',
        formatDate(r.departure_date),
        r.seats_available  !== null ? r.seats_available : '',
        formatPrice(r.sale_price),
        formatPrice(r.price_final),
        r.discount_amount > 0 ? formatPrice(r.discount_amount) : '',
        r.discount_amount > 0 ? 'Có' : 'Không',
        r.promotion        || '',
        r.source           || '',
        r.scraped_at
            ? new Date(r.scraped_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
            : '',
        new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    ];
}

// ============================================================
// CẬP NHẬT MỘT SHEET
// ============================================================
async function updateSheet(sheets, sheetName, data) {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

    if (!existingSheets.includes(sheetName)) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
        });
        log(`Tạo sheet mới: "${sheetName}"`);
    }

    const values = [SHEET_HEADERS, ...data.map(buildRow)];

    await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A1:Z99999`,
    });
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values },
    });

    // Format header
    const sheetMeta = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
    const sheetId   = sheetMeta?.properties?.sheetId ?? null;

    if (sheetId !== null) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                requests: [
                    {
                        repeatCell: {
                            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                            cell: {
                                userEnteredFormat: {
                                    textFormat: { bold: true },
                                    backgroundColor: { red: 0.2, green: 0.6, blue: 0.9 },
                                    horizontalAlignment: 'CENTER',
                                },
                            },
                            fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)',
                        },
                    },
                    {
                        updateSheetProperties: {
                            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                            fields: 'gridProperties.frozenRowCount',
                        },
                    },
                    {
                        autoResizeDimensions: {
                            dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: SHEET_HEADERS.length },
                        },
                    },
                ],
            },
        });
    }

    log(`Sheet "${sheetName}": ${data.length} rows — OK`);
}

// ============================================================
// MAIN
// Tạo 6 sheet:
//   "Vietravel"         — data Vietravel
//   "BenThanh Tourist"  — data BenThanh Tourist
//   "Du Lịch Việt"      — data Du Lịch Việt  ← MỚI
//   "Trong Nước"        — cả 3 công ty, tour trong nước
//   "Nước Ngoài"        — cả 3 công ty, tour nước ngoài
//   "Tổng hợp"          — toàn bộ data cả 3 công ty
// ============================================================
async function main() {
    const arg    = (process.argv[2] || '').toLowerCase();
    const doVT   = !arg || arg === 'vietravel';
    const doBTT  = !arg || arg === 'benthanh';
    const doDLV  = !arg || arg === 'dulichviet';
    const doAll  = doVT && doBTT && doDLV;

    log('=== Sync to Google Sheet V3 (VT + BTT + DLV) ===');
    log(`Chế độ: ${!arg ? 'Tất cả' : arg}`);

    const auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS_PATH,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    // --- Sheet riêng từng công ty ---
    if (doVT) {
        log('Lấy data Vietravel...');
        const data = await fetchFromPhp({ source: 'vietravel' });
        log(`Vietravel: ${data.length} records`);
        if (data.length > 0) await updateSheet(sheets, 'Vietravel', data);
        else log('[WARN] Không có data Vietravel');
    }

    if (doBTT) {
        log('Lấy data BenThanh Tourist...');
        const data = await fetchFromPhp({ source: 'benthanhtourist' });
        log(`BenThanh Tourist: ${data.length} records`);
        if (data.length > 0) await updateSheet(sheets, 'BenThanh Tourist', data);
        else log('[WARN] Không có data BenThanh Tourist');
    }

    if (doDLV) {
        log('Lấy data Du Lịch Việt...');
        const data = await fetchFromPhp({ source: 'dulichviet' });
        log(`Du Lịch Việt: ${data.length} records`);
        if (data.length > 0) await updateSheet(sheets, 'Du Lịch Việt', data);
        else log('[WARN] Không có data Du Lịch Việt');
    }

    // --- Sheet gộp (chỉ tạo khi sync all) ---
    if (doAll) {
        log('Lấy data Trong Nước (cả 3 công ty)...');
        const domestic = await fetchFromPhp({ type: 'domestic' });
        log(`Trong Nước: ${domestic.length} records`);
        if (domestic.length > 0) await updateSheet(sheets, 'Trong Nước', domestic);

        log('Lấy data Nước Ngoài (cả 3 công ty)...');
        const intl = await fetchFromPhp({ type: 'international' });
        log(`Nước Ngoài: ${intl.length} records`);
        if (intl.length > 0) await updateSheet(sheets, 'Nước Ngoài', intl);

        log('Tạo sheet Tổng hợp...');
        const all = await fetchFromPhp({});
        all.sort((a, b) => {
            if (a.source < b.source) return -1;
            if (a.source > b.source) return 1;
            if (a.tour_type < b.tour_type) return -1;
            if (a.tour_type > b.tour_type) return 1;
            return (a.departure_date || '').localeCompare(b.departure_date || '');
        });
        log(`Tổng hợp: ${all.length} records`);
        if (all.length > 0) await updateSheet(sheets, 'Tổng hợp', all);
    }

    log('\n=== Sync hoàn thành! ===');
    log(`Sheet URL: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`);
}

main().catch(err => log(`[FATAL] ${err.message}`));