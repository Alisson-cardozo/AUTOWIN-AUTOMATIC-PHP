<?php
declare(strict_types=1);

$raw = file_get_contents('https://bacbominer.com.br/api/bacbo', false, stream_context_create([
    'http' => ['timeout' => 15, 'header' => "Accept: application/json\r\n"],
]));
$d = json_decode((string) $raw, true);
if (!is_array($d)) {
    fwrite(STDERR, "fail fetch\n");
    exit(1);
}

$modOk = $modBad = $sumOk = $sumBad = $swModOk = 0;
foreach ($d as $r) {
    $p1 = (int) $r['diceplayer1'];
    $p2 = (int) $r['diceplayer2'];
    $b1 = (int) $r['dicebanker1'];
    $b2 = (int) $r['dicebanker2'];
    $api = (string) $r['winner'];

    $ps = ($p1 + $p2) % 10;
    $bs = ($b1 + $b2) % 10;
    $mod = $ps > $bs ? 'PlayerWon' : ($bs > $ps ? 'BankerWon' : 'Tie');

    $pt = $p1 + $p2;
    $bt = $b1 + $b2;
    $sum = $pt > $bt ? 'PlayerWon' : ($bt > $pt ? 'BankerWon' : 'Tie');

    $swps = ($b1 + $b2) % 10;
    $swbs = ($p1 + $p2) % 10;
    $swMod = $swps > $swbs ? 'PlayerWon' : ($swbs > $swps ? 'BankerWon' : 'Tie');

    $api === $mod ? $modOk++ : $modBad++;
    $api === $sum ? $sumOk++ : $sumBad++;
    if ($api === $swMod) {
        $swModOk++;
    }
}

echo "total=" . count($d) . "\n";
echo "mod10   OK={$modOk} BAD={$modBad}\n";
echo "rawSum  OK={$sumOk} BAD={$sumBad}\n";
echo "swapMod OK={$swModOk}\n";

// Official Evolution Bac Bo = highest two-dice TOTAL (2-12), NOT baccarat mod10
// Source: evolution.com / casino scores docs
if ($sumOk === count($d)) {
    echo "CONCLUSAO: fonte usa SOMA BRUTA (regra oficial Evolution Bac Bo). CORRETO.\n";
} elseif ($modOk === count($d)) {
    echo "CONCLUSAO: fonte usa MOD 10 (estilo baccarat). \n";
} else {
    echo "CONCLUSAO: inconsistente com ambas as regras.\n";
}
