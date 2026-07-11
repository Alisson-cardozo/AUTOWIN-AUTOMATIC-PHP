<?php
require dirname(__DIR__) . '/vendor/autoload.php';
App\Bootstrap::init();
$r = App\Bot\Games\BacBoSource::fetchSource();
echo 'source=' . (App\Bot\Games\BacBoSource::$lastSource ?? 'null') . PHP_EOL;
echo 'count=' . (is_array($r) ? count($r) : 0) . PHP_EOL;
if ($r) {
    foreach (array_slice($r, 0, 6) as $i => $row) {
        echo sprintf(
            "#%d %s %s score=%s at=%s\n",
            $i,
            substr($row['id'], 0, 8),
            $row['winner'],
            (string) ($row['score'] ?? 0),
            $row['created_at']
        );
    }
}
