<?php
declare(strict_types=1);

$host = '127.0.0.1';
$port = 3306;
$db   = 'autowin-auto';
$user = 'root';
$pass = 'root123';

echo "Testing MySQL {$host}:{$port}/{$db} ...\n";
try {
    $pdo = new PDO(
        "mysql:host={$host};port={$port};dbname={$db};charset=utf8mb4",
        $user,
        $pass,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_TIMEOUT => 3,
        ]
    );
    $v = $pdo->query('SELECT VERSION()')->fetchColumn();
    $n = $pdo->query('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()')->fetchColumn();
    echo "OK connected\n";
    echo "Version: {$v}\n";
    echo "Tables: {$n}\n";
} catch (Throwable $e) {
    echo "FAIL: " . $e->getMessage() . "\n";
    exit(1);
}
