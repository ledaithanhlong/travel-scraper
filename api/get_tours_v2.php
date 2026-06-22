<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

$host = 'localhost';
$db = 'travel_db';
$user = 'root';
$pass = '';
$charset = 'utf8mb4';

try {
    $pdo = new PDO(
        "mysql:host=$host;dbname=$db;charset=$charset",
        $user,
        $pass,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (PDOException $e) {
    echo json_encode([]);
    exit;
}

$type = isset($_GET['type']) ? $_GET['type'] : 'all';
$source = isset($_GET['source']) ? $_GET['source'] : 'all';

// Dùng tour_type gốc (domestic/international) tránh lỗi encoding tiếng Việt
if ($type === 'domestic') {
    $whereClause = "WHERE t.tour_type = 'domestic'";
} elseif ($type === 'international') {
    $whereClause = "WHERE t.tour_type = 'international'";
} else {
    $whereClause = '';
}

// Filter theo source nếu có
if ($source !== 'all') {
    $sourceClause = "t.source = '" . addslashes($source) . "'";
    $whereClause = $whereClause === ''
        ? "WHERE $sourceClause"
        : "$whereClause AND $sourceClause";
}

$sql = "
    SELECT
        t.tour_code,
        tp.sub_tour_code,
        t.tour_name,
        CASE WHEN t.tour_type = 'domestic' THEN 'Trong Nước' ELSE 'Nước Ngoài' END AS tour_type,
        COALESCE(t.source, 'vietravel')  AS source,
        COALESCE(t.category, '')        AS category,
        COALESCE(t.vehicle, '')         AS vehicle,
        COALESCE(t.duration, '')        AS duration,
        COALESCE(t.departure_city, '')  AS departure_city,
        tp.departure_date,
        tp.seats_available,
        tp.sale_price,
        tp.price_final,
        tp.discount_amount,
        CASE WHEN tp.discount_amount > 0 THEN 'Có' ELSE 'Không' END AS is_discount,
        '' AS promotion,
        tp.scraped_at
    FROM tours t
    INNER JOIN tour_prices tp ON t.tour_code = tp.tour_code
    $whereClause
    AND tp.sale_price > 0
    ORDER BY t.tour_type, t.tour_code, tp.departure_date
    LIMIT 5000
";

// Fix: nếu không có WHERE thì AND phải thành WHERE
if ($whereClause === '') {
    $sql = str_replace('AND tp.sale_price > 0', 'WHERE tp.sale_price > 0', $sql);
}

try {
    $stmt = $pdo->query($sql);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if (!$rows)
        $rows = [];
    echo json_encode($rows, JSON_UNESCAPED_UNICODE);
} catch (PDOException $e) {
    echo json_encode(['error' => $e->getMessage()]);
}