const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

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
// BƯỚC 1: LẤY DANH SÁCH LINK TOUR TỪ TRANG LISTING
// ============================================================
async function getTourLinks(page, listingUrl) {
  log(`Đang mở trang listing: ${listingUrl}`);
  await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await delay(3000);

  // Scroll để load hết lazy content
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await delay(400);
  }
  await delay(2000);

  // Lấy tất cả link đến trang chi tiết tour
  const links = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll('a[href*="chuong-trinh"]')];
    const unique = new Set();
    anchors.forEach(a => {
      if (a.href && a.href.includes('chuong-trinh')) {
        unique.add(a.href.split('?')[0]); // bỏ query string
      }
    });
    return [...unique];
  });

  log(`Tìm thấy ${links.length} link tour`);
  return links;
}

// ============================================================
// BƯỚC 2: VÀO TỪNG TRANG CHI TIẾT LẤY THÔNG TIN TOUR
// ============================================================
async function getTourDetail(page, url, tourType) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2000);

    const detail = await page.evaluate((type) => {
      // Tên tour: class tour--header__title
      const titleEl = document.querySelector('[class*="tour--header__title"]');
      const tourName = titleEl ? titleEl.textContent.trim() : '';

      // Mã tour: tìm text "Mã tour:" trong trang
      const allText = document.body.innerText;
      const codeMatch = allText.match(/Mã tour[:\s]+([A-Z]{2,4}[A-Z0-9]*[0-9]{2,6})/);
      const tourCode = codeMatch ? codeMatch[1] : '';

      // Thời gian
      const durMatch = allText.match(/Thời gian[:\s]+(\d+N\d*[ĐD])/i);
      const duration = durMatch ? durMatch[1] : '';

      // Phương tiện
      const vehicleMatch = allText.match(/Phương tiện[:\s]+([^\n]{2,20})/);
      let vehicle = vehicleMatch ? vehicleMatch[1].trim() : '';
      if (vehicle.includes('Máy bay')) vehicle = 'Máy bay';
      else if (vehicle.includes('Tàu hỏa')) vehicle = 'Tàu hỏa';
      else if (vehicle.includes('Xe')) vehicle = 'Xe';

      // Điểm khởi hành
      const depMatch = allText.match(/Khởi hành[:\s]+([^\n]{2,30})/);
      const departure = depMatch ? depMatch[1].trim() : '';

      // Dòng tour
      let category = '';
      if (allText.includes('Tiết kiệm')) category = 'Tiết kiệm';
      else if (allText.includes('Cao cấp')) category = 'Cao cấp';
      else if (allText.includes('Tiêu chuẩn')) category = 'Tiêu chuẩn';
      else if (allText.includes('Giá Tốt')) category = 'Giá Tốt';
      else if (allText.includes('ESG')) category = 'ESG & LEI';

      // Giá
      const priceEl = document.querySelector('[class*="price"] [class*="current"], [class*="newPrice"] span');
      let priceFrom = 0;
      if (priceEl) {
        priceFrom = parseInt(priceEl.textContent.replace(/[^\d]/g, '')) || 0;
      }

      return { tourCode, tourName, duration, vehicle, departure, category, priceFrom, tourType: type };
    }, tourType);

    return detail;
  } catch (err) {
    log(`[WARN] Không vào được ${url}: ${err.message}`);
    return null;
  }
}

// ============================================================
// BƯỚC 3: CAPTURE TOKEN
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
    await delay(5000);
  } catch (err) {
    log(`[WARN] Token capture: ${err.message}`);
  } finally {
    await page.close();
  }

  return { token, clientId };
}

// ============================================================
// BƯỚC 4: FETCH GIÁ TOUR
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
              records.push({
                subTourCode: t.tourCode || '',
                departureDate: t.departureDate || day.date,
                salePrice: t.salePrice || day.salePrice || 0,
                priceFinal: day.priceFinal || t.salePrice || 0,
                discountAmount: day.discountAmount || 0,
                isDiscount: day.isDiscount ? 1 : 0,
                seatsAvailable: t.seatsAvailable || t.availableSeats || null,
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
        log(`  [${tourCode}] ${month}/${year} → ${records.length} records`);
      }
    } catch (err) {
      log(`  [${tourCode}] ${month}/${year} ERROR: ${err.message}`);
    }
    await delay(CONFIG.requestDelay);
  }

  return records;
}

// ============================================================
// BƯỚC 5: LƯU VÀO DB
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
      log(`  → DB: saved ${parsed.savedPrices} prices`);
    }
  } catch (err) {
    log(`  [ERROR] Save DB: ${err.message}`);
  }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  log('=== Scraper V2 (Fixed) Started ===');
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
  });

  try {
    // Capture token
    const { token, clientId } = await captureToken(browser);
    if (!token) {
      log('[FATAL] Không lấy được token. Dừng.');
      return;
    }

    const allTours = [];
    const detailPage = await browser.newPage();

    // --- TRONG NƯỚC ---
    log('\n--- TRONG NƯỚC ---');
    const listingPage1 = await browser.newPage();
    const domesticLinks = await getTourLinks(listingPage1, CONFIG.domestic.listingUrl);
    await listingPage1.close();

    for (let i = 0; i < domesticLinks.length; i++) {
      const link = domesticLinks[i];
      log(`[TN] ${i + 1}/${domesticLinks.length} - ${link.split('/').pop()}`);
      const detail = await getTourDetail(detailPage, link, 'domestic');
      if (detail && detail.tourCode) {
        allTours.push(detail);
      }
      await delay(CONFIG.pageDelay);
    }

    // --- NƯỚC NGOÀI ---
    log('\n--- NƯỚC NGOÀI ---');
    const listingPage2 = await browser.newPage();
    const intlLinks = await getTourLinks(listingPage2, CONFIG.international.listingUrl);
    await listingPage2.close();

    for (let i = 0; i < intlLinks.length; i++) {
      const link = intlLinks[i];
      log(`[NN] ${i + 1}/${intlLinks.length} - ${link.split('/').pop()}`);
      const detail = await getTourDetail(detailPage, link, 'international');
      if (detail && detail.tourCode) {
        allTours.push(detail);
      }
      await delay(CONFIG.pageDelay);
    }

    await detailPage.close();

    log(`\nTổng: ${allTours.length} tours — bắt đầu fetch giá...\n`);

    let totalRecords = 0;
    for (const tourInfo of allTours) {
      log(`[${tourInfo.tourType === 'domestic' ? 'TN' : 'NN'}] ${tourInfo.tourCode} - ${tourInfo.tourName.substring(0, 50)}`);
      const prices = await fetchPrices(tourInfo.tourCode, token, clientId);
      await saveToDb(tourInfo, prices);
      totalRecords += prices.length;
      await delay(300);
    }

    log(`\n=== Hoàn thành! Tổng: ${totalRecords} price records ===`);

  } finally {
    await browser.close();
  }
}

main().catch(err => log(`[FATAL] ${err.message}`));