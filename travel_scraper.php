<?php
/**
 * travel_scraper.php
 * ------------------
 * Cào giá tour từ api2.travel.com.vn và lưu vào MySQL (XAMPP)
 * Chạy thủ công: php travel_scraper.php
 * Chạy tự động:  Windows Task Scheduler gọi file này mỗi ngày
 */

// ─── Config ──────────────────────────────────────────────────────────────────
define('DB_HOST', 'localhost');
define('DB_USER', 'root');
define('DB_PASS', '');          // XAMPP mặc định không có password
define('DB_NAME', 'travel_db');

define('BASE_API', 'https://api2.travel.com.vn/core/tour');
define('MONTHS_AHEAD', 3);      // Scrape tháng hiện tại + 3 tháng tới

// ─── Database ─────────────────────────────────────────────────────────────────
function getDB(): mysqli
{
    $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    if ($conn->connect_error) {
        die("[ERROR] Kết nối DB thất bại: " . $conn->connect_error . "\n");
    }
    $conn->set_charset('utf8mb4');
    return $conn;
}

function initDB(): void
{
    $conn = getDB();

    $conn->query("
        CREATE TABLE IF NOT EXISTS tour_prices (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            tour_code       VARCHAR(100) NOT NULL,
            sub_tour_code   VARCHAR(150),
            departure_date  DATE NOT NULL,
            sale_price      DECIMAL(15,2),
            price_final     DECIMAL(15,2),
            discount_amount DECIMAL(15,2) DEFAULT 0,
            is_discount     TINYINT(1)    DEFAULT 0,
            scraped_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_tour_date (sub_tour_code, departure_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $conn->query("
        CREATE TABLE IF NOT EXISTS scrape_logs (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            run_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            tour_code     VARCHAR(100),
            month         INT,
            year          INT,
            records_saved INT     DEFAULT 0,
            status        ENUM('success','error') DEFAULT 'success',
            error_msg     TEXT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $conn->close();
    log_msg("Database initialized.");
}

// ─── Logging ──────────────────────────────────────────────────────────────────
function log_msg(string $msg): void
{
    $line = "[" . date('Y-m-d H:i:s') . "] " . $msg . "\n";
    echo $line;
    file_put_contents(__DIR__ . '/scraper.log', $line, FILE_APPEND);
}

function log_to_db(string $tourCode, int $month, int $year, int $saved, string $status, string $errMsg = ''): void
{
    $conn = getDB();
    $stmt = $conn->prepare("
        INSERT INTO scrape_logs (tour_code, month, year, records_saved, status, error_msg)
        VALUES (?, ?, ?, ?, ?, ?)
    ");
    $stmt->bind_param('siiiss', $tourCode, $month, $year, $saved, $status, $errMsg);
    $stmt->execute();
    $stmt->close();
    $conn->close();
}

// ─── API call ─────────────────────────────────────────────────────────────────
function fetchTourInfoDay(string $tourCode, int $month, int $year): array
{
    $url = BASE_API . "/get-tour-info-day?" . http_build_query([
        'tourCode' => $tourCode,
        'month' => $month,
        'year' => $year,
    ]);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => [
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer: https://travel.com.vn/',
            'Accept: application/json',
        ],
    ]);

    $raw = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);

    if ($err) {
        log_msg("[ERROR] cURL [{$tourCode} {$month}/{$year}]: {$err}");
        return [];
    }

    $data = json_decode($raw, true);
    if (!$data || ($data['status'] ?? 0) != 1) {
        log_msg("[WARN] API status != 1 [{$tourCode} {$month}/{$year}]");
        return [];
    }

    // Parse response thành records sẵn sàng insert
    $records = [];
    foreach ($data['response'] ?? [] as $dayItem) {
        // "2026-04-30T00:00:00" → "2026-04-30"
        $departureDate = substr($dayItem['date'] ?? '', 0, 10);
        if (!$departureDate)
            continue;

        foreach ($dayItem['tours'] ?? [] as $tour) {
            $records[] = [
                'tour_code' => $tourCode,
                'sub_tour_code' => $tour['tourCode'] ?? null,
                'departure_date' => $departureDate,
                'sale_price' => $tour['salePrice'] ?? $dayItem['salePrice'] ?? null,
                'price_final' => $dayItem['priceFinal'] ?? null,
                'discount_amount' => $dayItem['discountAmount'] ?? 0,
                'is_discount' => ($dayItem['isDiscount'] ?? false) ? 1 : 0,
            ];
        }
    }

    return $records;
}

// ─── Save to DB ───────────────────────────────────────────────────────────────
function saveTourPrices(array $records): int
{
    if (empty($records))
        return 0;

    $conn = getDB();
    $sql = "
        INSERT INTO tour_prices
            (tour_code, sub_tour_code, departure_date, sale_price, price_final, discount_amount, is_discount)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            sale_price      = VALUES(sale_price),
            price_final     = VALUES(price_final),
            discount_amount = VALUES(discount_amount),
            is_discount     = VALUES(is_discount),
            updated_at      = CURRENT_TIMESTAMP
    ";

    $stmt = $conn->prepare($sql);
    $saved = 0;

    foreach ($records as $r) {
        $stmt->bind_param(
            'sssdddi',
            $r['tour_code'],
            $r['sub_tour_code'],
            $r['departure_date'],
            $r['sale_price'],
            $r['price_final'],
            $r['discount_amount'],
            $r['is_discount']
        );
        if ($stmt->execute())
            $saved++;
    }

    $stmt->close();
    $conn->close();
    return $saved;
}

// ─── Lấy danh sách tour codes ─────────────────────────────────────────────────
function getAllTourCodes(): array
{
    // Bước 1: thử lấy từ API get-tourlines
    $url = 'https://travel.com.vn/api/get-tourlines?Tourtype=2';
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => ['User-Agent: Mozilla/5.0', 'Accept: application/json'],
    ]);
    $raw = curl_exec($ch);
    curl_close($ch);

    $data = json_decode($raw, true);
    $codes = [];

    // Điều chỉnh key theo cấu trúc JSON thực tế của get-tourlines
    foreach ($data['response'] ?? [] as $item) {
        if (!empty($item['tourCode'])) {
            $codes[] = $item['tourCode'];
        }
    }

    // Fallback: danh sách cứng nếu API trên không trả về gì
    if (empty($codes)) {
        log_msg("[WARN] Không lấy được tour list từ API, dùng fallback list.");
        $codes = ['NDSGN538'];  // Thêm tourCode thủ công vào đây
    }

    return $codes;
}

// ─── Main job ─────────────────────────────────────────────────────────────────
function runScrapeJob(): void
{
    log_msg("=== Scrape job started ===");

    $tourCodes = getAllTourCodes();
    log_msg("Found " . count($tourCodes) . " tour(s) to scrape.");

    $now = new DateTime();

    foreach ($tourCodes as $tourCode) {
        for ($delta = 0; $delta <= MONTHS_AHEAD; $delta++) {
            $dt = (clone $now)->modify("+{$delta} month");
            $month = (int) $dt->format('n');
            $year = (int) $dt->format('Y');

            $records = fetchTourInfoDay($tourCode, $month, $year);
            $saved = saveTourPrices($records);

            log_msg("[{$tourCode}] {$month}/{$year} → " . count($records) . " fetched, {$saved} saved.");
            log_to_db($tourCode, $month, $year, $saved, 'success');

            sleep(1); // tránh bị rate-limit
        }
    }

    log_msg("=== Scrape job finished ===\n");
}

// ─── Entry point ──────────────────────────────────────────────────────────────
initDB();
runScrapeJob();
