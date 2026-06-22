<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

$host    = 'localhost';
$db      = 'travel_db';
$user    = 'root';
$pass    = '';
$charset = 'utf8mb4';

try {
    $pdo = new PDO(
        "mysql:host=$host;dbname=$db;charset=$charset",
        $user, $pass,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'DB connection failed: ' . $e->getMessage()]);
    exit;
}

// ============================================================
// TẠO / CẬP NHẬT SCHEMA
// Thêm 3 cột mới: ten_cong_ty, quoc_gia, khu_vuc
// noi_khoi_hanh thay thế departure_city (giữ departure_city để
// tương thích ngược với dữ liệu cũ, noi_khoi_hanh là bản chuẩn hóa)
// ============================================================
$pdo->exec("
CREATE TABLE IF NOT EXISTS tours (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    tour_code       VARCHAR(50)  UNIQUE NOT NULL,
    pid             VARCHAR(20)  DEFAULT NULL,
    tour_name       VARCHAR(255),
    duration        VARCHAR(50),
    departure_city  VARCHAR(100),
    noi_khoi_hanh   VARCHAR(100)  COMMENT 'Tên thành phố chuẩn hóa dùng cho Looker Studio',
    vehicle         VARCHAR(50),
    category        VARCHAR(50),
    tour_type       ENUM('domestic','international') DEFAULT 'domestic',
    source          VARCHAR(50)  DEFAULT 'vietravel',
    ten_cong_ty     VARCHAR(100) COMMENT 'Tên hiển thị: Vietravel / BenThanh Tourist',
    quoc_gia        VARCHAR(100) COMMENT 'Quốc gia đích đến, extract từ tên tour',
    khu_vuc         VARCHAR(50)  COMMENT 'Châu Á / Châu Âu / Châu Mỹ / ...',
    price_from      DECIMAL(15,2) DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
");

// Thêm cột mới vào bảng tours nếu đang nâng cấp từ schema cũ
$alterTours = [
    "ALTER TABLE tours ADD COLUMN IF NOT EXISTS pid           VARCHAR(20)  DEFAULT NULL",
    "ALTER TABLE tours ADD COLUMN IF NOT EXISTS noi_khoi_hanh VARCHAR(100) COMMENT 'Tên thành phố chuẩn hóa dùng cho Looker Studio'",
    "ALTER TABLE tours ADD COLUMN IF NOT EXISTS ten_cong_ty   VARCHAR(100) COMMENT 'Tên hiển thị: Vietravel / BenThanh Tourist'",
    "ALTER TABLE tours ADD COLUMN IF NOT EXISTS quoc_gia      VARCHAR(100) COMMENT 'Quốc gia đích đến, extract từ tên tour'",
    "ALTER TABLE tours ADD COLUMN IF NOT EXISTS khu_vuc       VARCHAR(50)  COMMENT 'Châu Á / Châu Âu / Châu Mỹ / ...'",
];
foreach ($alterTours as $sql) {
    try { $pdo->exec($sql); } catch (PDOException $e) { /* cột đã tồn tại, bỏ qua */ }
}

$pdo->exec("
CREATE TABLE IF NOT EXISTS tour_prices (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    tour_code       VARCHAR(50)  NOT NULL,
    sub_tour_code   VARCHAR(150),
    departure_date  DATE,
    thang           TINYINT      COMMENT 'Số tháng 1-12, dùng để filter theo mùa trong Looker Studio',
    sale_price      DECIMAL(15,2) DEFAULT 0,
    price_final     DECIMAL(15,2) DEFAULT 0,
    discount_amount DECIMAL(15,2) DEFAULT 0,
    is_discount     TINYINT(1)   DEFAULT 0,
    seats_available INT          DEFAULT NULL,
    promotion       VARCHAR(255) DEFAULT NULL,
    scraped_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tour_date (sub_tour_code, departure_date)
)
");

// Thêm cột thang vào tour_prices nếu đang nâng cấp từ schema cũ
try {
    $pdo->exec("ALTER TABLE tour_prices ADD COLUMN IF NOT EXISTS thang TINYINT COMMENT 'Số tháng 1-12'");
} catch (PDOException $e) { /* bỏ qua */ }

// ============================================================
// NHẬN DATA POST
// ============================================================
$input = file_get_contents('php://input');
$data  = json_decode($input, true);

if (!$data) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON']);
    exit;
}

$tourInfo     = $data['tourInfo']     ?? [];
$priceRecords = $data['priceRecords'] ?? [];
$scrapedAt    = $data['scrapedAt']    ?? date('c');

if (empty($tourInfo) || empty($priceRecords)) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing tourInfo or priceRecords']);
    exit;
}

$savedTours  = 0;
$savedPrices = 0;
$errors      = [];

// ============================================================
// UPSERT BẢNG tours
// Dùng noi_khoi_hanh (chuẩn hóa) làm cột chính,
// ghi song song vào departure_city để tương thích ngược.
// ============================================================
try {
    $stmt = $pdo->prepare("
        INSERT INTO tours
            (tour_code, pid, tour_name, duration, departure_city, noi_khoi_hanh,
             vehicle, category, tour_type, source, ten_cong_ty,
             quoc_gia, khu_vuc, price_from)
        VALUES
            (:tour_code, :pid, :tour_name, :duration, :noi_khoi_hanh, :noi_khoi_hanh,
             :vehicle, :category, :tour_type, :source, :ten_cong_ty,
             :quoc_gia, :khu_vuc, :price_from)
        ON DUPLICATE KEY UPDATE
            pid             = VALUES(pid),
            tour_name       = VALUES(tour_name),
            duration        = VALUES(duration),
            departure_city  = VALUES(departure_city),
            noi_khoi_hanh   = VALUES(noi_khoi_hanh),
            vehicle         = VALUES(vehicle),
            category        = VALUES(category),
            tour_type       = VALUES(tour_type),
            source          = VALUES(source),
            ten_cong_ty     = VALUES(ten_cong_ty),
            quoc_gia        = VALUES(quoc_gia),
            khu_vuc         = VALUES(khu_vuc),
            price_from      = VALUES(price_from),
            updated_at      = NOW()
    ");

    $stmt->execute([
        ':tour_code'   => $tourInfo['tourCode']      ?? '',
        ':pid'         => $tourInfo['pid']           ?? null,
        ':tour_name'   => $tourInfo['tourName']      ?? '',
        ':duration'    => $tourInfo['duration']      ?? '',
        ':noi_khoi_hanh' => $tourInfo['noi_khoi_hanh'] ?? $tourInfo['departure'] ?? '',
        ':vehicle'     => $tourInfo['vehicle']       ?? '',
        ':category'    => $tourInfo['category']      ?? '',
        ':tour_type'   => $tourInfo['tourType']      ?? 'domestic',
        ':source'      => $tourInfo['source']        ?? 'vietravel',
        ':ten_cong_ty' => $tourInfo['ten_cong_ty']   ?? '',
        ':quoc_gia'    => $tourInfo['quoc_gia']      ?? '',
        ':khu_vuc'     => $tourInfo['khu_vuc']       ?? '',
        ':price_from'  => $tourInfo['priceFrom']     ?? 0,
    ]);
    $savedTours = 1;
} catch (PDOException $e) {
    $errors[] = 'Tour upsert: ' . $e->getMessage();
}

// ============================================================
// UPSERT BẢNG tour_prices
// Thêm cột thang để Looker Studio filter theo tháng trực tiếp.
// ============================================================
$priceStmt = $pdo->prepare("
    INSERT INTO tour_prices
        (tour_code, sub_tour_code, departure_date, thang,
         sale_price, price_final, discount_amount, is_discount,
         seats_available, scraped_at)
    VALUES
        (:tour_code, :sub_tour_code, :departure_date, :thang,
         :sale_price, :price_final, :discount_amount, :is_discount,
         :seats_available, :scraped_at)
    ON DUPLICATE KEY UPDATE
        sale_price      = VALUES(sale_price),
        price_final     = VALUES(price_final),
        discount_amount = VALUES(discount_amount),
        is_discount     = VALUES(is_discount),
        seats_available = VALUES(seats_available),
        thang           = VALUES(thang),
        scraped_at      = VALUES(scraped_at),
        updated_at      = NOW()
");

foreach ($priceRecords as $record) {
    try {
        $dateStr = $record['departureDate'] ?? '';
        $date    = null;
        if ($dateStr) {
            $d = date_create($dateStr);
            if ($d) $date = date_format($d, 'Y-m-d');
        }
        if (!$date) continue;

        $subCode = $record['subTourCode'] ?? '';
        if (empty($subCode)) $subCode = ($tourInfo['tourCode'] ?? '') . '-' . $date;

        // Lấy thang từ scraper nếu có, fallback tự parse từ date
        $thang = $record['thang'] ?? (int) date('n', strtotime($date));

        $priceStmt->execute([
            ':tour_code'      => $tourInfo['tourCode']      ?? '',
            ':sub_tour_code'  => $subCode,
            ':departure_date' => $date,
            ':thang'          => $thang,
            ':sale_price'     => $record['salePrice']       ?? 0,
            ':price_final'    => $record['priceFinal']      ?? 0,
            ':discount_amount'=> $record['discountAmount']  ?? 0,
            ':is_discount'    => $record['isDiscount']      ?? 0,
            ':seats_available'=> $record['seatsAvailable']  ?? null,
            ':scraped_at'     => $scrapedAt,
        ]);
        $savedPrices++;
    } catch (PDOException $e) {
        if ($e->getCode() != '23000') {
            $errors[] = $e->getMessage();
        }
    }
}

echo json_encode([
    'success'     => true,
    'savedTours'  => $savedTours,
    'savedPrices' => $savedPrices,
    'errors'      => $errors,
]);