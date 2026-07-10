<?php
require dirname(__DIR__) . '/vendor/autoload.php';
App\Bootstrap::init();
$rows = [
    ['id' => 1, 'message' => '🎯 Entrando: *1.50x* — R$ 0.10 | 📋 V,V', 'strategyType' => 'SEQUÊNCIA', 'createdAt' => '2026-07-10 13:00:00'],
    ['id' => 2, 'message' => "✅ *WIN* — 1.79x\nLucro: R$ 0.05\nBanca atual: R$ 1.70", 'strategyType' => 'SEQUÊNCIA', 'createdAt' => '2026-07-10 13:00:30'],
    ['id' => 3, 'message' => '🎯 Entrando: *2.00x* — R$ 0.10 | 📋 R,R', 'strategyType' => 'SEQUÊNCIA', 'createdAt' => '2026-07-10 13:01:00'],
    ['id' => 4, 'message' => "❌ *LOSS* — 1.20x | Gale 1/1\nLucro: R$ -0.05", 'strategyType' => 'SEQUÊNCIA', 'createdAt' => '2026-07-10 13:01:30'],
];
echo json_encode(App\Bot\LogParser::build($rows), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), PHP_EOL;
