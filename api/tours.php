<?php
/**
 * api/tours.php
 * -------------
 * Endpoint để frontend đọc dữ liệu tour từ DB
 * 
 * GET /api/tours.php                     → tất cả tour sắp khởi hành
 * GET /api/tours.php?code=NDSGN538       → theo tourCode
 * GET /api/tours.php?month=5&year=2026   → theo tháng
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *'); // Cho phép React/Next.js gọi

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

function respond(bool $success, $data, string $message = ''): void
{
    echo json_encode([
        'success' => $success,
        'message' => $message,
        'data' => $data,
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

$conn = getDB();
$where = ['departure_date >= CURDATE()'];
$params = [];
$types = '';

// Filter theo tourCode
if (!empty($_GET['code'])) {
    $where[] = 'tour_code = ?';
    $params[] = $_GET['code'];
    $types .= 's';
}

// Filter theo tháng/năm
if (!empty($_GET['month']) && !empty($_GET['year'])) {
    $where[] = 'MONTH(departure_date) = ? AND YEAR(departure_date) = ?';
    $params[] = (int) $_GET['month'];
    $params[] = (int) $_GET['year'];
    $types .= 'ii';
}

$whereSQL = implode(' AND ', $where);
$sql = "
    SELECT
        tour_code,
        sub_tour_code,
        departure_date,
        sale_price,
        price_final,
        discount_amount,
        is_discount,
        updated_at
    FROM tour_prices
    WHERE {$whereSQL}
    ORDER BY departure_date ASC
    LIMIT 200
";

$stmt = $conn->prepare($sql);
if (!empty($params)) {
    $stmt->bind_param($types, ...$params);
}
$stmt->execute();
$result = $stmt->get_result();

$tours = [];
while ($row = $result->fetch_assoc()) {
    $tours[] = $row;
}

$stmt->close();
$conn->close();

respond(true, $tours, count($tours) . ' tours found');
