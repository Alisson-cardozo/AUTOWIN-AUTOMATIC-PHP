<?php

declare(strict_types=1);

namespace App\Bot;

use App\Bot\Games\BacBoSource;
use App\Database;

/**
 * Port of bot/pattern-accuracy.ts
 */
final class PatternAccuracy
{
    private const CACHE_TTL_MS = 5 * 60 * 1000;
    private const MAX_PAGES = 30;

    /** @var array<string, array{points:list<array>,expiresAt:float}> */
    private static array $cache = [];

    private const ENDPOINTS = [
        'BLAZE' => [
            'CRASH' => [
                'url' => 'https://blaze.bet.br/api/singleplayer-originals/originals/crash_games/recent/history/4',
                'referer' => 'https://blaze.bet.br/pt/games/crash',
            ],
            'DOUBLE' => [
                'url' => 'https://blaze.bet.br/api/singleplayer-originals/originals/roulette_games/recent/history/1',
                'referer' => 'https://blaze.bet.br/pt/games/double',
            ],
            'FORTUNE' => [
                'url' => 'https://blaze.bet.br/api/singleplayer-originals/originals/fortune_double_games/history/analytics/1',
                'referer' => 'https://blaze.bet.br/pt/games/fortune-double/1',
            ],
        ],
        'JONBET' => [
            'CRASH' => [
                'url' => 'https://jonbet.bet.br/api/singleplayer-originals/originals/crash_games/recent/history/4',
                'referer' => 'https://jonbet.bet.br/pt/games/crash',
            ],
            'DOUBLE' => [
                'url' => 'https://jonbet.bet.br/api/singleplayer-originals/originals/roulette_games/recent/history/1',
                'referer' => 'https://jonbet.bet.br/pt/games/double',
            ],
            'FORTUNE' => [
                'url' => 'https://jonbet.bet.br/api/singleplayer-originals/originals/fortune_double_games/history/analytics/1',
                'referer' => 'https://jonbet.bet.br/pt/games/fortune-double/1',
            ],
        ],
    ];

    /** @return array{hits:int,total:int,pct:float}|null */
    public static function compute(
        string $game,
        string $platform,
        array $sequence,
        float|string|int $target,
        int $gales = 0,
        int $days = 7
    ): ?array {
        try {
            $points = self::fetchWindow($game, $platform, $days);
            $n = count($sequence);
            if (count($points) < $n + 1) {
                return null;
            }

            $wonAt = function (int $idx) use ($points, $game, $platform, $target): bool {
                if ($game === 'CRASH') {
                    return (float) ($points[$idx]['crashPoint'] ?? 0) >= (float) $target;
                }
                return self::colorLabel((int) ($points[$idx]['color'] ?? 0), $game, $platform) === (string) $target;
            };

            $hits = 0;
            $total = 0;
            $len = count($points);
            for ($i = $n; $i < $len - $gales; $i++) {
                $window = array_slice($points, $i - $n, $n);
                $matched = true;
                foreach ($sequence as $idx => $item) {
                    $p = $window[$idx];
                    if ($game === 'CRASH') {
                        if (!self::matchesCrashItem($item, (float) ($p['crashPoint'] ?? 0))) {
                            $matched = false;
                            break;
                        }
                    } else {
                        if ($item === 'X') {
                            continue;
                        }
                        if (self::colorLabel((int) ($p['color'] ?? 0), $game, $platform) !== $item) {
                            $matched = false;
                            break;
                        }
                    }
                }
                if (!$matched) {
                    continue;
                }
                $total++;

                if ($wonAt($i)) {
                    $hits++;
                    continue;
                }

                if ($game === 'FORTUNE') {
                    $g = 0;
                    $idx = $i;
                    $wonInGale = false;
                    while ($g < $gales) {
                        $idx++;
                        if ($idx >= $len) {
                            break;
                        }
                        if ($wonAt($idx)) {
                            $wonInGale = true;
                            break;
                        }
                        if (self::colorLabel((int) ($points[$idx]['color'] ?? 0), $game, $platform) !== 'AMARELO') {
                            $g++;
                        }
                    }
                    if ($wonInGale) {
                        $hits++;
                    }
                } else {
                    for ($g = 1; $g <= $gales; $g++) {
                        if ($i + $g < $len && $wonAt($i + $g)) {
                            $hits++;
                            break;
                        }
                    }
                }
            }

            if ($total === 0) {
                return null;
            }
            return [
                'hits' => $hits,
                'total' => $total,
                'pct' => (float) number_format(($hits / $total) * 100, 1, '.', ''),
            ];
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Timeout wrapper — PHP can't race easily; we just call compute.
     * @return array{hits:int,total:int,pct:float}|null
     */
    public static function computeWithTimeout(
        string $game,
        string $platform,
        array $sequence,
        float|string|int $target,
        int $gales = 0,
        int $timeoutMs = 3000,
        int $days = 7
    ): ?array {
        // Cache hit is instant; cold fetch can be slow — still run fully.
        unset($timeoutMs);
        return self::compute($game, $platform, $sequence, $target, $gales, $days);
    }

    /** @return array{hits:int,total:int,pct:float}|null */
    public static function computeBacBo(array $sequence, string $target, int $gales = 0, int $days = 7): ?array
    {
        try {
            $since = date('Y-m-d H:i:s', time() - $days * 86400);
            $rows = Database::fetchAll(
                'SELECT winner FROM bacbo_results WHERE createdAt >= ? ORDER BY id ASC',
                [$since]
            );
            $outcomes = array_map(
                fn ($r) => BacBoSource::OUTCOME_NAME[BacBoSource::winnerCode((string) $r['winner'])],
                $rows
            );
            $n = count($sequence);
            if (count($outcomes) < $n + 1) {
                return null;
            }

            $hits = 0;
            $total = 0;
            $len = count($outcomes);
            for ($i = $n; $i < $len - $gales; $i++) {
                $window = array_slice($outcomes, $i - $n, $n);
                $matched = true;
                foreach ($sequence as $idx => $item) {
                    if ($item !== 'X' && $window[$idx] !== $item) {
                        $matched = false;
                        break;
                    }
                }
                if (!$matched) {
                    continue;
                }
                $total++;
                if ($outcomes[$i] === $target) {
                    $hits++;
                    continue;
                }
                for ($g = 1; $g <= $gales; $g++) {
                    if ($i + $g < $len && $outcomes[$i + $g] === $target) {
                        $hits++;
                        break;
                    }
                }
            }
            if ($total === 0) {
                return null;
            }
            return [
                'hits' => $hits,
                'total' => $total,
                'pct' => (float) number_format(($hits / $total) * 100, 1, '.', ''),
            ];
        } catch (\Throwable) {
            return null;
        }
    }

    public static function computeBacBoWithTimeout(
        array $sequence,
        string $target,
        int $gales = 0,
        int $timeoutMs = 3000,
        int $days = 7
    ): ?array {
        unset($timeoutMs);
        return self::computeBacBo($sequence, $target, $gales, $days);
    }

    /** @return list<array{crashPoint?:float,color?:int,createdAt:string}> */
    private static function fetchWindow(string $game, string $platform, int $days = 7): array
    {
        $key = "$platform:$game:$days";
        $nowMs = microtime(true) * 1000;
        if (isset(self::$cache[$key]) && self::$cache[$key]['expiresAt'] > $nowMs) {
            return self::$cache[$key]['points'];
        }

        $ep = self::ENDPOINTS[$platform][$game] ?? null;
        if (!$ep) {
            return [];
        }

        $headers = [
            'Accept' => 'application/json',
            'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer' => $ep['referer'],
            'Origin' => $platform === 'JONBET' ? 'https://jonbet.bet.br' : 'https://blaze.bet.br',
            'Accept-Language' => 'pt-BR,pt;q=0.9,en;q=0.8',
            'Cache-Control' => 'no-cache',
            'Pragma' => 'no-cache',
            'x-client-version' => '2ecb1ba89',
            'ipcountry' => 'BR',
        ];

        $end = gmdate('Y-m-d\TH:i:00.000\Z');
        $start = gmdate('Y-m-d\TH:i:s.000\Z', time() - $days * 86400);

        $http = new HttpClient('', $headers, 15);

        $all = [];
        $page = 1;
        $lastPage = 1;
        while ($page <= self::MAX_PAGES) {
            $url = $ep['url'] . '?startDate=' . rawurlencode($start)
                . '&endDate=' . rawurlencode($end)
                . '&page=' . $page;
            $data = self::fetchPage($http, $url);
            if ($data === null) {
                break;
            }
            $records = self::extractRecords($data);
            foreach ($records as $r) {
                $all[] = $r;
            }
            if ($page === 1) {
                $lastPage = self::extractLastPage($data);
            }
            if ($page >= $lastPage || $page >= self::MAX_PAGES) {
                break;
            }
            $page++;
            usleep(500_000);
        }

        $points = [];
        foreach ($all as $r) {
            if ($game === 'CRASH') {
                $points[] = [
                    'crashPoint' => (float) ($r['crash_point'] ?? $r['point'] ?? 0),
                    'createdAt' => (string) ($r['created_at'] ?? $r['createdAt'] ?? ''),
                ];
            } else {
                $points[] = [
                    'color' => self::normalizeColor($r['color'] ?? 0),
                    'createdAt' => (string) ($r['created_at'] ?? $r['createdAt'] ?? ''),
                ];
            }
        }
        usort($points, fn ($a, $b) => strcmp($a['createdAt'] ?? '', $b['createdAt'] ?? ''));

        if ($points) {
            self::$cache[$key] = ['points' => $points, 'expiresAt' => $nowMs + self::CACHE_TTL_MS];
        }
        return $points;
    }

    private static function fetchPage(HttpClient $http, string $url, int $retries = 2): ?array
    {
        for ($i = 0; $i <= $retries; $i++) {
            try {
                $data = $http->get($url);
                if (is_array($data)) {
                    return $data;
                }
                if ($http->lastStatus() === 429 && $i < $retries) {
                    usleep(3_000_000 * ($i + 1));
                    continue;
                }
                return null;
            } catch (\Throwable) {
                if ($i < $retries) {
                    usleep(1_500_000);
                }
            }
        }
        return null;
    }

    private static function extractRecords(mixed $data): array
    {
        if (is_array($data) && array_is_list($data)) {
            return $data;
        }
        if (!is_array($data)) {
            return [];
        }
        return $data['records'] ?? $data['data'] ?? $data['results'] ?? [];
    }

    private static function extractLastPage(mixed $data): int
    {
        if (!is_array($data)) {
            return 1;
        }
        return (int) ($data['last_page'] ?? $data['totalPages'] ?? $data['total_pages'] ?? $data['pages'] ?? 1);
    }

    private static function normalizeColor(mixed $c): int
    {
        if (is_int($c) || is_float($c)) {
            return (int) round((float) $c);
        }
        if (is_string($c)) {
            if (is_numeric($c)) {
                return (int) $c;
            }
            $l = strtolower($c);
            if ($l === 'yellow' || str_contains($l, 'amarelo')) {
                return 0;
            }
            if ($l === 'red' || str_contains($l, 'vermelho') || $l === 'green' || str_contains($l, 'verde')) {
                return 1;
            }
            if ($l === 'black' || $l === 'blue' || str_contains($l, 'azul') || str_contains($l, 'preto')) {
                return 2;
            }
        }
        if (is_array($c)) {
            return self::normalizeColor($c['id'] ?? $c['color_id'] ?? $c['value'] ?? $c['color'] ?? 0);
        }
        return 0;
    }

    private static function matchesCrashItem(string $item, float $point): bool
    {
        if ($item === 'X') {
            return true;
        }
        if ($item === 'V') {
            return $point >= 2.0;
        }
        if ($item === 'R') {
            return $point < 2.0;
        }
        if (is_numeric($item)) {
            $val = (float) $item;
            return $val >= 0 ? $point >= $val : $point <= abs($val);
        }
        return false;
    }

    private static function colorLabel(int $colorNum, string $game, string $platform): string
    {
        if ($game === 'FORTUNE') {
            return $colorNum === 0 ? 'AMARELO' : ($colorNum === 1 ? 'VERMELHO' : 'AZUL');
        }
        if ($colorNum === 0) {
            return 'BRANCO';
        }
        if ($colorNum === 1) {
            return $platform === 'JONBET' ? 'VERDE' : 'VERMELHO';
        }
        return 'PRETO';
    }
}
