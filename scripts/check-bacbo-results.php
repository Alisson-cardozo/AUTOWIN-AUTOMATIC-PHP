<?php
declare(strict_types=1);

/**
 * Valida se os winners da fonte Bac Bo batem com a regra real do jogo:
 * score = (d1+d2) % 10; maior score vence; empate se iguais.
 */

function fetchSource(): array
{
    $ctx = stream_context_create([
        'http' => [
            'timeout' => 15,
            'header' => "Accept: application/json\r\nUser-Agent: AutoWinCheck/1.0\r\n",
        ],
    ]);
    $raw = @file_get_contents('https://bacbominer.com.br/api/bacbo', false, $ctx);
    if ($raw === false) {
        throw new RuntimeException('Falha ao baixar fonte bacbominer');
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        throw new RuntimeException('JSON inválido da fonte');
    }
    return $data;
}

function calcWinner(int $p1, int $p2, int $b1, int $b2): string
{
    $ps = ($p1 + $p2) % 10;
    $bs = ($b1 + $b2) % 10;
    if ($ps > $bs) {
        return 'PlayerWon';
    }
    if ($bs > $ps) {
        return 'BankerWon';
    }
    return 'Tie';
}

function mapOutcome(string $w): string
{
    if ($w === 'PlayerWon') {
        return 'PLAYER';
    }
    if ($w === 'BankerWon') {
        return 'BANKER';
    }
    return 'EMPATE';
}

echo "=== Fonte bacbominer.com.br ===\n";
$data = fetchSource();
echo 'Total retornado: ' . count($data) . "\n\n";

$ok = 0;
$bad = 0;
$names = [];
$mismatches = [];

foreach ($data as $i => $r) {
    $p1 = (int) ($r['diceplayer1'] ?? 0);
    $p2 = (int) ($r['diceplayer2'] ?? 0);
    $b1 = (int) ($r['dicebanker1'] ?? 0);
    $b2 = (int) ($r['dicebanker2'] ?? 0);
    $api = (string) ($r['winner'] ?? '');
    $calc = calcWinner($p1, $p2, $b1, $b2);
    $names[$api] = ($names[$api] ?? 0) + 1;

    if ($api === $calc) {
        $ok++;
    } else {
        $bad++;
        if (count($mismatches) < 15) {
            $mismatches[] = sprintf(
                '#%d id=%s P(%d+%d=%d→%d) B(%d+%d=%d→%d) api=%s calc=%s',
                $i,
                (string) ($r['_id'] ?? '?'),
                $p1,
                $p2,
                $p1 + $p2,
                ($p1 + $p2) % 10,
                $b1,
                $b2,
                $b1 + $b2,
                ($b1 + $b2) % 10,
                $api,
                $calc
            );
        }
    }
}

echo "Conferência dice→winner: OK={$ok} MISMATCH={$bad}\n";
echo 'Labels winner na API: ' . json_encode($names, JSON_UNESCAPED_UNICODE) . "\n";
if ($mismatches) {
    echo "\nPrimeiros mismatches:\n";
    foreach ($mismatches as $line) {
        echo "  $line\n";
    }
}

echo "\n=== Últimas 12 rodadas (fonte) ===\n";
foreach (array_slice($data, 0, 12) as $r) {
    $p1 = (int) $r['diceplayer1'];
    $p2 = (int) $r['diceplayer2'];
    $b1 = (int) $r['dicebanker1'];
    $b2 = (int) $r['dicebanker2'];
    $api = (string) $r['winner'];
    $calc = calcWinner($p1, $p2, $b1, $b2);
    $mark = $api === $calc ? 'OK' : '!!';
    printf(
        "[%s] %s  P %d+%d=%d (s%d) | B %d+%d=%d (s%d)  → API=%s map=%s %s\n",
        substr((string) ($r['createdAt'] ?? ''), 11, 8),
        substr((string) ($r['_id'] ?? ''), 0, 8),
        $p1,
        $p2,
        $p1 + $p2,
        ($p1 + $p2) % 10,
        $b1,
        $b2,
        $b1 + $b2,
        ($b1 + $b2) % 10,
        $api,
        mapOutcome($api),
        $mark
    );
}

// Banco local (se .env + PDO ok)
echo "\n=== Banco local (se disponível) ===\n";
$root = dirname(__DIR__);
if (is_file($root . '/vendor/autoload.php') && is_file($root . '/.env')) {
    require $root . '/vendor/autoload.php';
    App\Bootstrap::init();
    try {
        $rows = App\Database::fetchAll('SELECT * FROM bacbo_results ORDER BY id DESC LIMIT 15');
        echo 'Últimas ' . count($rows) . " no bacbo_results:\n";
        $dbBad = 0;
        foreach ($rows as $row) {
            $p1 = (int) $row['player1'];
            $p2 = (int) $row['player2'];
            $b1 = (int) $row['banker1'];
            $b2 = (int) $row['banker2'];
            $api = (string) $row['winner'];
            $calc = calcWinner($p1, $p2, $b1, $b2);
            $mark = $api === $calc ? 'OK' : '!!';
            if ($api !== $calc) {
                $dbBad++;
            }
            printf(
                "id=%s ext=%s winner=%s map=%s P%d+%d B%d+%d %s\n",
                $row['id'],
                substr((string) $row['externalId'], 0, 10),
                $api,
                mapOutcome($api),
                $p1,
                $p2,
                $b1,
                $b2,
                $mark
            );
        }
        echo "DB mismatches nos 15: {$dbBad}\n";

        // Cruzar ids recentes fonte x banco
        $sourceIds = [];
        foreach (array_slice($data, 0, 20) as $r) {
            $sourceIds[(string) $r['_id']] = $r;
        }
        $matched = 0;
        $missing = 0;
        $winnerDiff = 0;
        foreach ($sourceIds as $id => $r) {
            $db = App\Database::fetch('SELECT * FROM bacbo_results WHERE externalId = ?', [$id]);
            if (!$db) {
                $missing++;
                continue;
            }
            $matched++;
            if ((string) $db['winner'] !== (string) $r['winner']) {
                $winnerDiff++;
                echo "DIFF winner id={$id} fonte={$r['winner']} db={$db['winner']}\n";
            }
            if (
                (int) $db['player1'] !== (int) $r['diceplayer1']
                || (int) $db['player2'] !== (int) $r['diceplayer2']
                || (int) $db['banker1'] !== (int) $r['dicebanker1']
                || (int) $db['banker2'] !== (int) $r['dicebanker2']
            ) {
                echo "DIFF dice id={$id}\n";
            }
        }
        echo "Cruzamento top20 fonte: matched={$matched} missing_in_db={$missing} winner_diff={$winnerDiff}\n";

        // Entradas do bot
        $entries = App\Database::fetchAll(
            'SELECT type, signalColor, resultColor, pattern, betAmount, profit, galeLevel, createdAt
             FROM bacbo_bot_entries ORDER BY id DESC LIMIT 12'
        );
        echo "\n=== Últimas entradas bot (bacbo_bot_entries) ===\n";
        foreach ($entries as $e) {
            printf(
                "%s | %s sinal=%s result=%s pattern=%s gale=%s bet=%s profit=%s\n",
                $e['createdAt'] ?? '',
                $e['type'] ?? '',
                $e['signalColor'] ?? '',
                $e['resultColor'] ?? '',
                $e['pattern'] ?? '',
                $e['galeLevel'] ?? '',
                $e['betAmount'] ?? '',
                $e['profit'] ?? ''
            );
        }
    } catch (Throwable $e) {
        echo 'DB erro: ' . $e->getMessage() . "\n";
    }
} else {
    echo "Sem vendor/.env — skip DB\n";
}

echo "\n=== Resumo ===\n";
if ($bad === 0) {
    echo "Fonte: winners 100% consistentes com regra Bac Bo (soma%10).\n";
} else {
    echo "ATENÇÃO: {$bad} resultados da fonte NÃO batem com a regra de placar.\n";
}
echo "Mapeamento engine: PlayerWon→PLAYER, BankerWon→BANKER, Tie/outro→EMPATE\n";
