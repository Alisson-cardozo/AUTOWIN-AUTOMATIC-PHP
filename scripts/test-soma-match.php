<?php
require dirname(__DIR__) . '/vendor/autoload.php';
App\Bootstrap::init();

$cases = [
    ['PLAYER_4', ['winner' => 'PlayerWon', 'score' => 4], true],
    ['BANKER_8', ['winner' => 'BankerWon', 'score' => 8], true],
    ['PLAYER_4', ['winner' => 'BankerWon', 'score' => 4], false],
    ['EMPATE_X', ['winner' => 'Tie', 'score' => 6], true],
    ['EMPATE', ['winner' => 'Tie', 'score' => 9], true],
    ['BANKER_X', ['winner' => 'BankerWon', 'score' => 11], true],
    ['P4', ['winner' => 'PlayerWon', 'score' => 4], true],
];
foreach ($cases as [$tok, $r, $want]) {
    $got = App\Bot\Games\BacBoSource::matchesSomaToken($tok, $r);
    $ok = $got === $want ? 'OK' : 'FAIL';
    echo "{$ok} token={$tok} expect=" . ($want ? '1' : '0') . " got=" . ($got ? '1' : '0') . PHP_EOL;
}
echo 'token=' . App\Bot\Games\BacBoSource::scoreSomaToken('BANKER', 8) . PHP_EOL;
