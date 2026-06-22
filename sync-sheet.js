/**
 * sync-sheet.js
 * -------------
 * Đọc data từ MySQL qua PHP API → đẩy lên Google Sheet
 * Chạy: node sync-sheet.js
 */

const { google } = require('googleapis');
const http = require('http');
const path = require('path');

// ─── Config ──────────────────────────────────────────────────────────────────
const SPREADSHEET_ID = '1CFN1CgyLolgFunD--6fZx5j-RqOJoMDfpDvMaw_TQkM';
const SHEET_NAME = 'Trang tính1';
const CREDENTIALS = path.join(__dirname, 'credentials.json');
const PHP_API_URL = 'http://localhost/travel-scraper/api/tours.php';

// ─── Log ─────────────────────────────────────────────────────────────────────
function log(msg) {
    console.log(`[${new Date().toLocaleString('vi-VN')}] ${msg}`);
}

// ─── Lấy data từ PHP API ─────────────────────────────────────────────────────
function fetchTours() {
    return new Promise((resolve, reject) => {
        http.get(PHP_API_URL, res => {
            let raw = '';
            res.on('data', chunk => raw += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(raw);
                    resolve(json.data || []);
                } catch {
                    reject(new Error('Parse JSON thất bại'));
                }
            });
        }).on('error', reject);
    });
}

// ─── Format tiền VND ─────────────────────────────────────────────────────────
function formatVND(amount) {
    return new Intl.NumberFormat('vi-VN').format(amount) + ' ₫';
}

// ─── Sync lên Google Sheet ───────────────────────────────────────────────────
async function syncToSheet(tours) {
    // Auth bằng service account
    const auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Header row
    const headers = [
        'Tour Code', 'Sub Tour Code', 'Ngày Khởi Hành',
        'Giá Gốc', 'Giá Cuối', 'Giảm Giá', 'Có Khuyến Mãi', 'Cập Nhật Lúc'
    ];

    // Data rows
    const rows = tours.map(t => [
        t.tour_code,
        t.sub_tour_code || '',
        t.departure_date,
        formatVND(t.sale_price),
        formatVND(t.price_final),
        t.discount_amount > 0 ? formatVND(t.discount_amount) : '—',
        t.is_discount === '1' ? '✓' : '',
        t.updated_at,
    ]);

    const values = [headers, ...rows];

    // Xóa sheet cũ rồi ghi lại toàn bộ
    await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1:Z10000`,
    });

    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values },
    });

    // Format header: bold + background
    const sheetId = await getSheetId(sheets, SPREADSHEET_ID, SHEET_NAME);
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            requests: [
                // Bold header
                {
                    repeatCell: {
                        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                        cell: {
                            userEnteredFormat: {
                                textFormat: { bold: true, fontSize: 11 },
                                backgroundColor: { red: 0.18, green: 0.49, blue: 0.40 },
                                horizontalAlignment: 'CENTER',
                            },
                        },
                        fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)',
                    },
                },
                // Freeze header row
                {
                    updateSheetProperties: {
                        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                        fields: 'gridProperties.frozenRowCount',
                    },
                },
                // Auto resize columns
                {
                    autoResizeDimensions: {
                        dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 8 },
                    },
                },
            ],
        },
    });
}

// ─── Lấy sheetId theo tên ────────────────────────────────────────────────────
async function getSheetId(sheets, spreadsheetId, sheetName) {
    const res = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = res.data.sheets.find(s => s.properties.title === sheetName);
    return sheet ? sheet.properties.sheetId : 0;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
    log('=== Sync to Google Sheet started ===');

    log('Đang lấy data từ PHP API...');
    const tours = await fetchTours();
    log(`Lấy được ${tours.length} tours.`);

    if (tours.length === 0) {
        log('[WARN] Không có data để sync. Chạy scraper trước.');
        return;
    }

    log('Đang đẩy lên Google Sheet...');
    await syncToSheet(tours);
    log(`✓ Sync thành công ${tours.length} tours lên Google Sheet.`);
    log(`→ Xem tại: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`);

    log('=== Sync finished ===');
}

main().catch(err => {
    log(`[FATAL] ${err.message}`);
    process.exit(1);
});
