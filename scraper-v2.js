const { chromium } = require('playwright');
const https = require('https');
const http = require('http');

// ============================================================
// CẤU HÌNH
// ============================================================
const CONFIG = {
  domestic: {
    listingUrl: 'https://travel.com.vn/du-lich-viet-nam.aspx',
    tourType: 'domestic',
    label: 'Trong Nước'
  },
  international: {
    listingUrl: 'https://travel.com.vn/du-lich-nuoc-ngoai.aspx',
    tourType: 'international',
    label: 'Nước Ngoài'
  },
  // Lấy data cho 3 tháng tới
  months: [
    { month: 4, year: 2026 },
    { month: 5, year: 2026 },
    { month: 6, year: 2026 },
    { month: 7, year: 2026 },
  ],
  phpSaveUrl: 'http://localhost/travel-scraper/api/save_tours_v2.php',
  apiBase: 'https://api2.travel.com.vn/core/tour',
  delayBetweenRequests: 800, // ms
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function log(msg) {
  const now = new Date().toLocaleString('vi-VN');
  console.log(`[${now}] ${msg}`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

function postToPhp(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const parsed = new URL(url);
    options.hostname = parsed.hostname;
    options.path = parsed.pathname;
    options.port = parsed.port || 80;

    const req = http.request(options, (res) => {
      let result = '';
      res.on('data', chunk => result += chunk);
      res.on('end', () => resolve(result));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ============================================================
// BƯỚC 1: LẤY DANH SÁCH TOUR TỪ TRANG LISTING
// ============================================================
async function getTourListFromPage(browser, listingUrl, tourType) {
  log(`Đang mở trang listing: ${listingUrl}`);
  const page = await browser.newPage();
  
  const tours = [];

  try {
    await page.goto(listingUrl, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Scroll xuống để load hết tour (lazy loading)
    let prevHeight = 0;
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollBy(0, 1000));
      await delay(1000);
      const currentHeight = await page.evaluate(() => document.body.scrollHeight);
      if (currentHeight === prevHeight) break;
      prevHeight = currentHeight;
    }

    // Lấy tất cả tour card
    // Mã tour hiển thị dạng "Mã tour: NDHAN715"
    const tourData = await page.evaluate((type) => {
      const results = [];
      
      // Tìm tất cả element chứa "Mã tour:"
      const allText = document.querySelectorAll('*');
      const tourCards = document.querySelectorAll('[class*="tour-item"], [class*="tour-card"], [class*="item-tour"], article, .card');
      
      // Strategy 1: Tìm theo pattern "Mã tour: XXXXX"
      const bodyHTML = document.body.innerHTML;
      const tourCodeMatches = bodyHTML.matchAll(/Mã tour[:\s]+([A-Z0-9]+)/g);
      const foundCodes = new Set();
      
      for (const match of tourCodeMatches) {
        foundCodes.add(match[1]);
      }

      // Strategy 2: Tìm từ các link /tour/CODE hoặc trang chi tiết
      const links = document.querySelectorAll('a[href*="tour"], a[href*=".aspx"]');
      for (const link of links) {
        const href = link.href || '';
        // Pattern: NDHAN715, NDSGN538, v.v
        const codeMatch = href.match(/([A-Z]{2,6}[0-9]{2,6})/);
        if (codeMatch) foundCodes.add(codeMatch[1]);
      }

      // Lấy tên tour tương ứng
      const tourItems = document.querySelectorAll('[class*="tour"], [class*="product"], article');
      
      for (const code of foundCodes) {
        // Tìm element chứa code này để lấy thêm thông tin
        let tourName = '';
        let duration = '';
        let departure = '';
        let vehicle = '';
        let category = '';
        let priceFrom = 0;

        // Tìm card chứa mã tour này
        for (const item of tourItems) {
          if (item.textContent.includes(code)) {
            // Lấy tên (thường là h2, h3 hoặc class title)
            const titleEl = item.querySelector('h1, h2, h3, h4, [class*="title"], [class*="name"]');
            if (titleEl) tourName = titleEl.textContent.trim();

            // Lấy thời gian
            const durationMatch = item.textContent.match(/(\d+N\d+Đ|\d+\s*ngày)/i);
            if (durationMatch) duration = durationMatch[1];

            // Lấy phương tiện
            if (item.textContent.includes('Máy bay')) vehicle = 'Máy bay';
            else if (item.textContent.includes('Xe')) vehicle = 'Xe';

            // Lấy dòng tour (Tiết kiệm, Cao cấp, Tiêu chuẩn, Giá Tốt)
            if (item.textContent.includes('Tiết kiệm')) category = 'Tiết kiệm';
            else if (item.textContent.includes('Cao cấp')) category = 'Cao cấp';
            else if (item.textContent.includes('Tiêu chuẩn')) category = 'Tiêu chuẩn';
            else if (item.textContent.includes('Giá Tốt')) category = 'Giá Tốt';
            else if (item.textContent.includes('ESG')) category = 'ESG & LEI';

            // Lấy giá
            const priceMatch = item.textContent.match(/([\d,.]+)\s*[đ₫]/);
            if (priceMatch) priceFrom = parseInt(priceMatch[1].replace(/[,.]/g, ''));

            // Lấy điểm khởi hành
            const departureMatch = item.textContent.match(/Khởi hành[:\s]+([^\n\r]+)/);
            if (departureMatch) departure = departureMatch[1].trim().substring(0, 50);

            break;
          }
        }

        results.push({
          tourCode: code,
          tourName: tourName || code,
          duration,
          departure,
          vehicle,
          category,
          priceFrom,
          tourType: type
        });
      }

      return results;
    }, tourType);

    log(`Tìm thấy ${tourData.length} tour từ trang listing`);
    tours.push(...tourData);

  } catch (err) {
    log(`[ERROR] Lỗi khi scrape listing: ${err.message}`);
  } finally {
    await page.close();
  }

  return tours;
}

// ============================================================
// BƯỚC 2: LẤY TOKEN TỪ TRANG CHI TIẾT TOUR
// ============================================================
async function captureApiToken(browser) {
  log('Đang capture Bearer token...');
  const page = await browser.newPage();
  let token = null;
  let clientId = null;

  page.on('request', request => {
    const url = request.url();
    if (url.includes('api2.travel.com.vn')) {
      const auth = request.headers()['authorization'];
      const cid = request.headers()['clientid'];
      if (auth && auth.startsWith('Bearer ') && !token) {
        token = auth.replace('Bearer ', '');
        clientId = cid || '';
        log(`Token captured! ClientId: ${clientId ? 'OK' : 'N/A'}`);
      }
    }
  });

  try {
    await page.goto('https://travel.com.vn/du-lich-viet-nam.aspx', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    await delay(3000);

    // Nếu chưa có token, thử click vào 1 tour
    if (!token) {
      const firstLink = await page.$('a[href*="tour"], a[href*=".aspx"][href*="ND"]');
      if (firstLink) {
        await firstLink.click();
        await delay(3000);
      }
    }
  } catch (err) {
    log(`[WARN] ${err.message}`);
  } finally {
    await page.close();
  }

  return { token, clientId };
}

// ============================================================
// BƯỚC 3: GỌI API LẤY GIÁ TỪNG TOUR THEO TỪNG THÁNG
// ============================================================
async function fetchTourPrices(tourCode, token, clientId) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'ClientId': clientId || '',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
  };

  const allRecords = [];

  for (const { month, year } of CONFIG.months) {
    const url = `${CONFIG.apiBase}/get-tour-info-day?tourCode=${tourCode}&month=${month}&year=${year}`;
    
    try {
      const data = await httpGet(url, headers);
      
      if (data && data.status === 1 && Array.isArray(data.response)) {
        for (const dayData of data.response) {
          if (dayData.tours && dayData.tours.length > 0) {
            for (const t of dayData.tours) {
              allRecords.push({
                tourCode,
                subTourCode: t.tourCode || '',
                departureDate: t.departureDate || dayData.date,
                salePrice: t.salePrice || dayData.salePrice || 0,
                priceFinal: dayData.priceFinal || t.salePrice || 0,
                discountAmount: dayData.discountAmount || 0,
                isDiscount: dayData.isDiscount ? 1 : 0,
                seatsAvailable: t.seatsAvailable || t.availableSeats || null,
              });
            }
          } else if (dayData.salePrice > 0) {
            allRecords.push({
              tourCode,
              subTourCode: '',
              departureDate: dayData.date,
              salePrice: dayData.salePrice || 0,
              priceFinal: dayData.priceFinal || 0,
              discountAmount: dayData.discountAmount || 0,
              isDiscount: dayData.isDiscount ? 1 : 0,
              seatsAvailable: null,
            });
          }
        }
        log(`  [${tourCode}] ${month}/${year} → ${allRecords.length} records`);
      }
    } catch (err) {
      log(`  [${tourCode}] ${month}/${year} → ERROR: ${err.message}`);
    }

    await delay(CONFIG.delayBetweenRequests);
  }

  return allRecords;
}

// ============================================================
// BƯỚC 4: GỬI DATA VỀ PHP
// ============================================================
async function saveToDatabase(tourInfo, priceRecords) {
  const payload = {
    tourInfo,
    priceRecords,
    scrapedAt: new Date().toISOString()
  };

  try {
    const result = await postToPhp(CONFIG.phpSaveUrl, payload);
    log(`  → Saved ${priceRecords.length} records to DB`);
    return true;
  } catch (err) {
    log(`  [ERROR] Save failed: ${err.message}`);
    return false;
  }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  log('=== Tour Price Scraper V2 Started ===');
  
  const browser = await chromium.launch({ headless: true });
  
  try {
    // Capture token
    const { token, clientId } = await captureApiToken(browser);
    
    if (!token) {
      log('[FATAL] Không lấy được token. Dừng lại.');
      return;
    }

    const allTours = [];

    // Lấy danh sách tour trong nước
    log('\n--- Scraping TRONG NƯỚC ---');
    const domesticTours = await getTourListFromPage(
      browser,
      CONFIG.domestic.listingUrl,
      'domestic'
    );
    allTours.push(...domesticTours);

    // Lấy danh sách tour nước ngoài
    log('\n--- Scraping NƯỚC NGOÀI ---');
    const intlTours = await getTourListFromPage(
      browser,
      CONFIG.international.listingUrl,
      'international'
    );
    allTours.push(...intlTours);

    log(`\nTổng cộng: ${allTours.length} tours`);
    log('Bắt đầu fetch giá từng tour...\n');

    let totalRecords = 0;

    for (const tourInfo of allTours) {
      log(`Fetching [${tourInfo.tourCode}] - ${tourInfo.tourName}`);
      
      const priceRecords = await fetchTourPrices(tourInfo.tourCode, token, clientId);
      
      if (priceRecords.length > 0) {
        await saveToDatabase(tourInfo, priceRecords);
        totalRecords += priceRecords.length;
      }

      await delay(500);
    }

    log(`\n=== Hoàn thành! Tổng: ${totalRecords} price records ===`);

  } catch (err) {
    log(`[FATAL] ${err.message}`);
  } finally {
    await browser.close();
  }
}

main();
