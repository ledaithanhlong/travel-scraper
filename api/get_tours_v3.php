<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

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
    echo json_encode([]);
    exit;
}

// ============================================================
// THAM SỐ FILTER
// ?type=all|domestic|international
// ?source=all|vietravel|benthanhtourist
// ?khu_vuc=all|Châu Á|Châu Âu|...
// ?thang=all|5|6|7|8
// ============================================================
$type    = $_GET['type']    ?? 'all';
$source  = $_GET['source']  ?? 'all';
$khuVuc  = $_GET['khu_vuc'] ?? 'all';
$thang   = $_GET['thang']   ?? 'all';

$conditions = ['tp.sale_price > 0'];

// Filter tour_type
if ($type === 'domestic') {
    $conditions[] = "t.tour_type = 'domestic'";
} elseif ($type === 'international') {
    $conditions[] = "t.tour_type = 'international'";
}

// Filter source — dùng prepared statement để tránh injection
$params = [];
if ($source !== 'all') {
    $conditions[] = "t.source = :source";
    $params[':source'] = $source;
}

// Filter khu_vuc — phục vụ câu hỏi "tour Châu Á" trong Looker Studio
if ($khuVuc !== 'all') {
    $conditions[] = "t.khu_vuc = :khu_vuc";
    $params[':khu_vuc'] = $khuVuc;
}

// Filter thang — phục vụ câu hỏi "mùa hè tháng 6-8"
if ($thang !== 'all' && is_numeric($thang)) {
    $conditions[] = "tp.thang = :thang";
    $params[':thang'] = (int) $thang;
}

$whereSQL = 'WHERE ' . implode(' AND ', $conditions);

// ============================================================
// QUERY CHÍNH
// Trả về đầy đủ các cột cần cho Looker Studio:
//   ten_cong_ty  → Dimension so sánh 2 công ty
//   quoc_gia     → Dimension điểm đến
//   khu_vuc      → Dimension châu lục (filter mùa hè Châu Á)
//   noi_khoi_hanh→ Dimension nơi khởi hành (đã chuẩn hóa)
//   thang        → Dimension tháng (xu hướng giá)
// ============================================================
$sql = "
    SELECT
        t.tour_code,
        tp.sub_tour_code,
        t.tour_name,
        CASE
            WHEN t.tour_type = 'domestic'       THEN 'Trong Nước'
            WHEN t.tour_type = 'international'  THEN 'Nước Ngoài'
            ELSE t.tour_type
        END                                          AS tour_type,
        COALESCE(t.ten_cong_ty, t.source, '')        AS ten_cong_ty,
        COALESCE(t.source, 'vietravel')              AS source,
        COALESCE(t.category, '')                     AS category,
        COALESCE(t.vehicle, '')                      AS vehicle,
        COALESCE(t.duration, '')                     AS duration,
        COALESCE(t.noi_khoi_hanh, t.departure_city, '') AS noi_khoi_hanh,
        COALESCE(t.quoc_gia, '')                     AS quoc_gia,
        COALESCE(t.khu_vuc, '')                      AS khu_vuc,
        tp.departure_date,
        tp.thang,
        tp.seats_available,
        tp.sale_price,
        tp.price_final,
        tp.discount_amount,
        CASE WHEN tp.discount_amount > 0 THEN 'Có' ELSE 'Không' END AS is_discount,
        COALESCE(tp.promotion, '')                   AS promotion,
        tp.scraped_at
    FROM tours t
    INNER JOIN tour_prices tp ON t.tour_code = tp.tour_code
    $whereSQL
    ORDER BY t.ten_cong_ty, t.tour_type, t.quoc_gia, t.tour_code, tp.departure_date
    LIMIT 10000
";

try {
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    echo json_encode($rows ?: [], JSON_UNESCAPED_UNICODE);
} catch (PDOException $e) {
    echo json_encode(['error' => $e->getMessage()]);
}
