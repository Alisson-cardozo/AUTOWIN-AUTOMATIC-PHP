<?php

declare(strict_types=1);

require dirname(__DIR__) . '/vendor/autoload.php';

use App\Bootstrap;
use App\Database;

Bootstrap::init();

$host = env('DB_HOST', '127.0.0.1');
$port = env('DB_PORT', '3306');
$dbName = env('DB_DATABASE', 'autowin');
$user = env('DB_USERNAME', 'root');
$pass = (string) env('DB_PASSWORD', '');

echo "Conectando em {$host}:{$port}...\n";

$pdo = new PDO("mysql:host={$host};port={$port};charset=utf8mb4", $user, $pass, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);
$pdo->exec("CREATE DATABASE IF NOT EXISTS `{$dbName}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
$pdo->exec("USE `{$dbName}`");

$sql = file_get_contents(__DIR__ . '/schema.sql');
if ($sql === false) {
    fwrite(STDERR, "Falha ao ler schema.sql\n");
    exit(1);
}

// Executa statement por statement
$parts = array_filter(array_map('trim', preg_split('/;\s*\n/', $sql) ?: []));
foreach ($parts as $part) {
    if ($part === '' || str_starts_with($part, '--')) {
        continue;
    }
    // remove comentários de linha sozinhos no início
    $clean = preg_replace('/^--.*$/m', '', $part);
    $clean = trim((string) $clean);
    if ($clean === '') {
        continue;
    }
    try {
        $pdo->exec($clean);
    } catch (Throwable $e) {
        echo "AVISO: " . $e->getMessage() . "\n";
    }
}

echo "Schema aplicado com sucesso no banco `{$dbName}`.\n";

// Migrações leves (colunas novas em tabelas já existentes)
$alters = [
    "ALTER TABLE `bot_entries` ADD COLUMN `gameType` VARCHAR(20) NULL AFTER `type`",
];
foreach ($alters as $sqlAlter) {
    try {
        $pdo->exec($sqlAlter);
        echo "OK: {$sqlAlter}\n";
    } catch (Throwable $e) {
        // coluna já existe — ignora
        if (!str_contains($e->getMessage(), 'Duplicate column')) {
            echo "AVISO alter: " . $e->getMessage() . "\n";
        }
    }
}

// Seed chaves de API do .env para system_config
try {
    \App\Models\ConfigRepository::seedFromEnv();
    echo "Configurações de API (env → system_config) sincronizadas.\n";
} catch (Throwable $e) {
    echo "AVISO seed config: " . $e->getMessage() . "\n";
}
