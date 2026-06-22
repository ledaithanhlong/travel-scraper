<?php
/**
 * api/save_tours.php
 * ------------------
 * Nhận POST JSON từ Node.js scraper → lưu vào MySQL
 */

header('Content-Type: application/json; charset=utf-8');

define('DB_HOST', 'localhost');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_NAME', 'travel_db');

function getDB(): mysqli
{
    $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    $conn->set_charset('utf8mb4');
    return $conn;
}

// Nhận JSON body
$raw = file_get_contents('php://input');
$body = json_decode($raw, true);

if (empty($body['records'])) {
    echo json_encode(['success' => false, 'message' => 'No records received']);
    exit;
}

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

foreach ($body['records'] as $r) {
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

echo json_encode([
    'success' => true,
    'message' => "{$saved} records saved",
    'saved' => $saved,
]);
