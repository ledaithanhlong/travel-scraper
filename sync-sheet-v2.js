const { google } = require('googleapis');
const http = require('http');

// ============================================================
// CẤU HÌNH
// ============================================================
const SPREADSHEET_ID = '1CFN1CgyLolgFunD--6fZx5j-RqOJoMDfpDvMaw_TQkM';
const CREDENTIALS_PATH = './credentials.json';
const PHP_API_URL = 'http://localhost/travel-scraper/api/get_tours_v2.php';

function log(msg) {
  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  console.log(`[${now}] ${msg}`);
}

// ============================================================
// LẤY DATA TỪ PHP API
// ============================================================
function fetchFromPhp(tourType) {
  return new Promise((resolve, reject) => {
    const url = `${PHP_API_URL}?type=${tourType}`;
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch {
          resolve([]);
        }
      });
    }).on('error', (err) => {
      log(`[ERROR] fetchFromPhp: ${err.message}`);
      resolve([]);
    });
  });
}

// ============================================================
// FORMAT TIỀN - trả về số nguyên để Google Sheet xử lý đúng
// ============================================================
function formatPrice(price) {
  if (!price || price === 0) return '';
  return Number(price);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  // Cắt chỉ lấy phần YYYY-MM-DD tránh lệch timezone
  const raw = dateStr.toString().substring(0, 10);
  const [y, m, d] = raw.split('-');
  if (!y || !m || !d) return dateStr;
  return `${parseInt(d)}/${parseInt(m)}/${y}`;
}

// ============================================================
// FIX: Xác định phân loại đúng dù PHP trả về domestic/international hay tiếng Việt
// ============================================================
function getPhanLoai(tour_type) {
  if (tour_type === 'domestic' || tour_type === 'Trong Nước') return 'Trong Nước';
  if (tour_type === 'international' || tour_type === 'Nước Ngoài') return 'Nước Ngoài';
  return tour_type || '';
}

// ============================================================
// CẬP NHẬT SHEET
// ============================================================
async function updateSheet(sheets, sheetName, data) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID
  });

  const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

  if (!existingSheets.includes(sheetName)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [{
          addSheet: {
            properties: { title: sheetName }
          }
        }]
      }
    });
    log(`Tạo sheet mới: ${sheetName}`);
  }

  // Header
  const headers = [
    'Tour Code',
    'Sub Tour Code',
    'Tên Tour',
    'Phân Loại',
    'Thể Loại Tour',
    'Phương Tiện',
    'Thời Gian',
    'Điểm Khởi Hành',
    'Ngày Khởi Hành',
    'Số Chỗ',
    'Giá Gốc',
    'Giá Cuối',
    'Giảm Giá',
    'Có KM',
    'KM_Count',
    'Khuyến Mãi',
    'Source',
    'Giờ Cập Nhật'
  ];

  // Rows
  const rows = data.map(r => [
    r.tour_code || '',
    r.sub_tour_code || '',
    r.tour_name || '',
    getPhanLoai(r.tour_type),                         // FIX: dùng hàm getPhanLoai
    r.category || '',
    r.vehicle || '',
    r.duration || '',
    r.departure_city || '',
    formatDate(r.departure_date),
    r.seats_available !== null ? r.seats_available : '',
    formatPrice(r.sale_price),
    formatPrice(r.price_final),
    r.discount_amount > 0 ? formatPrice(r.discount_amount) : '',
    r.discount_amount > 0 ? 'Có' : 'Không',
    r.discount_amount > 0 ? 1 : 0,
    r.promotion || '',
    r.source || 'vietravel',
    r.scraped_at
      ? new Date(r.scraped_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
      : ''                                            // FIX: timezone đúng
  ]);

  const values = [headers, ...rows];

  // Clear và ghi lại
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1:Z99999`
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    resource: { values }
  });

  // Format header
  const sheetId = spreadsheet.data.sheets.find(
    s => s.properties.title === sheetName
  )?.properties?.sheetId;

  if (sheetId !== undefined) {
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
                  horizontalAlignment: 'CENTER'
                }
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)'
            }
          },
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                gridProperties: { frozenRowCount: 1 }
              },
              fields: 'gridProperties.frozenRowCount'
            }
          },
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId,
                dimension: 'COLUMNS',
                startIndex: 0,
                endIndex: 18
              }
            }
          }
        ]
      }
    });
  }

  log(`Sheet "${sheetName}": ${rows.length} rows`);
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  log('=== Sync to Google Sheet V2 Started ===');

  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  log('Đang lấy data Trong Nước từ PHP API...');
  const domesticData = await fetchFromPhp('domestic');
  log(`Trong Nước: ${domesticData.length} records`);

  log('Đang lấy data Nước Ngoài từ PHP API...');
  const intlData = await fetchFromPhp('international');
  log(`Nước Ngoài: ${intlData.length} records`);

  if (domesticData.length > 0) {
    await updateSheet(sheets, 'Trong Nước', domesticData);
  } else {
    log('[WARN] Không có data Trong Nước');
  }

  if (intlData.length > 0) {
    await updateSheet(sheets, 'Nước Ngoài', intlData);
  } else {
    log('[WARN] Không có data Nước Ngoài');
  }

  const total = domesticData.length + intlData.length;
  log(`\n=== Sync hoàn thành! Tổng: ${total} records ===`);
  log(`Sheet URL: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`);
}

main().catch(err => log(`[FATAL] ${err.message}`));