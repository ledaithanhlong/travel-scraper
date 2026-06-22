<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

$host = 'localhost';
$db   = 'travel_db';
$user = 'root';
$pass = '';
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

// Tạo bảng nếu chưa có
$pdo->exec("
CREATE TABLE IF NOT EXISTS tours (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tour_code VARCHAR(50) UNIQUE NOT NULL,
    tour_name VARCHAR(255),
    duration VARCHAR(50),
    departure_city VARCHAR(100),
    vehicle VARCHAR(50),
    category VARCHAR(50),
    tour_type ENUM('domestic','international') DEFAULT 'domestic',
    price_from DECIMAL(15,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
");

$pdo->exec("
CREATE TABLE IF NOT EXISTS tour_prices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tour_code VARCHAR(50) NOT NULL,
    sub_tour_code VARCHAR(150),
    departure_date DATE,
    sale_price DECIMAL(15,2) DEFAULT 0,
    price_final DECIMAL(15,2) DEFAULT 0,
    discount_amount DECIMAL(15,2) DEFAULT 0,
    is_discount TINYINT(1) DEFAULT 0,
    seats_available INT DEFAULT NULL,
    promotion VARCHAR(255) DEFAULT NULL,
    scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tour_date (sub_tour_code, departure_date)
)
");

// Nhận data POST
$input = file_get_contents('php://input');
$data = json_decode($input, true);

if (!$data) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON']);
    exit;
}

$tourInfo    = $data['tourInfo'] ?? [];
$priceRecords = $data['priceRecords'] ?? [];
$scrapedAt   = $data['scrapedAt'] ?? date('c');

if (empty($tourInfo) || empty($priceRecords)) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing tourInfo or priceRecords']);
    exit;
}

$savedTours = 0;
$savedPrices = 0;
$errors = [];

// Upsert tour info
try {
    $stmt = $pdo->prepare("
        INSERT INTO tours 
            (tour_code, tour_name, duration, departure_city, vehicle, category, tour_type, source, price_from)
        VALUES 
            (:tour_code, :tour_name, :duration, :departure_city, :vehicle, :category, :tour_type, :source, :price_from)
        ON DUPLICATE KEY UPDATE
            tour_name = VALUES(tour_name),
            duration = VALUES(duration),
            departure_city = VALUES(departure_city),
            vehicle = VALUES(vehicle),
            category = VALUES(category),
            tour_type = VALUES(tour_type),
            source = VALUES(source),
            price_from = VALUES(price_from),
            updated_at = NOW()
    ");

    $stmt->execute([
        ':tour_code'     => $tourInfo['tourCode'] ?? '',
        ':tour_name'     => $tourInfo['tourName'] ?? '',
        ':duration'      => $tourInfo['duration'] ?? '',
        ':departure_city'=> $tourInfo['departure'] ?? '',
        ':vehicle'       => $tourInfo['vehicle'] ?? '',
        ':category'      => $tourInfo['category'] ?? '',
        ':tour_type'     => $tourInfo['tourType'] ?? 'domestic',
        ':source'        => $tourInfo['source'] ?? 'vietravel',
        ':price_from'    => $tourInfo['priceFrom'] ?? 0,
    ]);
    $savedTours = 1;
} catch (PDOException $e) {
    $errors[] = 'Tour upsert: ' . $e->getMessage();
}

// Upsert price records
$priceStmt = $pdo->prepare("
    INSERT INTO tour_prices 
        (tour_code, sub_tour_code, departure_date, sale_price, price_final, 
         discount_amount, is_discount, seats_available, scraped_at)
    VALUES 
        (:tour_code, :sub_tour_code, :departure_date, :sale_price, :price_final,
         :discount_amount, :is_discount, :seats_available, :scraped_at)
    ON DUPLICATE KEY UPDATE
        sale_price = VALUES(sale_price),
        price_final = VALUES(price_final),
        discount_amount = VALUES(discount_amount),
        is_discount = VALUES(is_discount),
        seats_available = VALUES(seats_available),
        updated_at = NOW()
");

foreach ($priceRecords as $record) {
    try {
        // Parse date
        $dateStr = $record['departureDate'] ?? '';
        $date = null;
        if ($dateStr) {
            $d = date_create($dateStr);
            if ($d) $date = date_format($d, 'Y-m-d');
        }

        if (!$date) continue;

        $subCode = $record['subTourCode'] ?? $tourInfo['tourCode'] . '-' . $date;
        if (empty($subCode)) $subCode = $tourInfo['tourCode'] . '-' . $date;

        $priceStmt->execute([
            ':tour_code'      => $tourInfo['tourCode'] ?? '',
            ':sub_tour_code'  => $subCode,
            ':departure_date' => $date,
            ':sale_price'     => $record['salePrice'] ?? 0,
            ':price_final'    => $record['priceFinal'] ?? 0,
            ':discount_amount'=> $record['discountAmount'] ?? 0,
            ':is_discount'    => $record['isDiscount'] ?? 0,
            ':seats_available'=> $record['seatsAvailable'] ?? null,
            ':scraped_at'     => $scrapedAt,
        ]);
        $savedPrices++;
    } catch (PDOException $e) {
        // Duplicate key = OK, skip
        if ($e->getCode() != '23000') {
            $errors[] = $e->getMessage();
        }
    }
}

echo json_encode([
    'success' => true,
    'savedTours' => $savedTours,
    'savedPrices' => $savedPrices,
    'errors' => $errors
]);