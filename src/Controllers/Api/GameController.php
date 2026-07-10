<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Auth\Auth;
use App\Bot\Games\BacBoSource;
use App\Database;
use App\Models\ConfigRepository;
use App\Services\HttpClient;

final class GameController
{
    private const BACBO_MAX_RESULTS = 100;
    private const BACBO_STALE_THRESHOLD_MS = 60000;


    private function client(): HttpClient
    {
        return new HttpClient('https://blaze.bet.br', [
            'Accept' => 'application/json',
            'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer' => 'https://blaze.bet.br/pt/games/double',
            'x-client-version' => '2ecb1ba89',
            'ipcountry' => 'BR',
        ]);
    }

    private function jonbetClient(): HttpClient
    {
        return new HttpClient('https://jonbet.bet.br', [
            'Accept' => 'application/json',
            'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Origin' => 'https://jonbet.bet.br',
            'Referer' => 'https://jonbet.bet.br/',
        ]);
    }

    public function doubleRecent(): void
    {
        $res = $this->client()->get('/api/singleplayer-originals/originals/roulette_games/recent/1?t=' . time());
        if ($res['ok'] && is_array($res['data'])) {
            $results = array_values(array_filter($res['data'], 'is_array'));
            // Persiste novos resultados pro bot/histórico
            foreach (array_reverse($results) as $r) {
                $id = (string) ($r['id'] ?? '');
                if ($id === '') {
                    continue;
                }
                $exists = Database::fetch(
                    "SELECT id FROM game_results WHERE gameType = 'DOUBLE' AND platform = 'BLAZE' AND blazeId = ? LIMIT 1",
                    [$id]
                );
                if (!$exists) {
                    try {
                        Database::insert('game_results', [
                            'gameType' => 'DOUBLE',
                            'platform' => 'BLAZE',
                            'blazeId' => $id,
                            'color' => (string) ($r['color'] ?? 0),
                            'roll' => (int) ($r['roll'] ?? 0),
                            'createdAt' => now(),
                        ]);
                    } catch (\Throwable $e) {
                        // ignore race / schema
                    }
                }
            }
            json_response([
                'results' => $results,
                'total' => count($results),
                'apiDown' => false,
            ]);
        }
        $rows = Database::fetchAll(
            "SELECT blazeId AS id, color, roll, createdAt AS created_at FROM game_results WHERE gameType = 'DOUBLE' AND platform = 'BLAZE' ORDER BY id DESC LIMIT 50"
        );
        // color/roll podem vir string do DB
        $rows = array_map(static function (array $r): array {
            $r['color'] = (int) $r['color'];
            $r['roll'] = (int) $r['roll'];
            return $r;
        }, $rows);
        json_response(['results' => $rows, 'total' => count($rows), 'apiDown' => true]);
    }

    public function doubleCurrent(): void
    {
        $res = $this->client()->get('/api/singleplayer-originals/originals/roulette_games/current/1?t=' . time());
        json_response($res['data'] ?? ['error' => 'indisponível'], $res['ok'] ? 200 : 502);
    }

    public function crashRecent(): void
    {
        $res = $this->client()->get('/api/singleplayer-originals/originals/crash_games/recent/4?t=' . time());
        if ($res['ok'] && is_array($res['data'])) {
            $results = array_values(array_filter($res['data'], 'is_array'));
            // Normaliza + descarta crash_point=0 (rodadas inválidas da API)
            $results = array_values(array_filter(array_map(static function (array $r): ?array {
                if (!isset($r['crash_point']) && isset($r['crashPoint'])) {
                    $r['crash_point'] = $r['crashPoint'];
                }
                $cp = (float) ($r['crash_point'] ?? 0);
                if ($cp <= 0) {
                    return null;
                }
                $r['crash_point'] = (string) $r['crash_point'];
                return $r;
            }, $results)));

            foreach (array_reverse($results) as $r) {
                $id = (string) ($r['id'] ?? '');
                if ($id === '') {
                    continue;
                }
                $exists = Database::fetch(
                    "SELECT id FROM game_results WHERE gameType = 'CRASH' AND platform = 'BLAZE' AND blazeId = ? LIMIT 1",
                    [$id]
                );
                if (!$exists) {
                    try {
                        Database::insert('game_results', [
                            'gameType' => 'CRASH',
                            'platform' => 'BLAZE',
                            'blazeId' => $id,
                            'crashPoint' => (string) ($r['crash_point'] ?? '0'),
                            'createdAt' => now(),
                        ]);
                    } catch (\Throwable $e) {
                    }
                }
            }
            json_response([
                'results' => $results,
                'total' => count($results),
                'apiDown' => false,
            ]);
        }
        $rows = Database::fetchAll(
            "SELECT blazeId AS id, crashPoint AS crash_point, createdAt AS created_at FROM game_results WHERE gameType = 'CRASH' AND platform = 'BLAZE' AND crashPoint IS NOT NULL AND CAST(crashPoint AS DECIMAL(12,4)) > 0 ORDER BY id DESC LIMIT 50"
        );
        json_response(['results' => $rows, 'total' => count($rows), 'apiDown' => true]);
    }

    public function crashCurrent(): void
    {
        $res = $this->client()->get('/api/singleplayer-originals/originals/crash_games/current/4?t=' . time());
        json_response($res['data'] ?? ['error' => 'indisponível'], $res['ok'] ? 200 : 502);
    }

    public function fortuneRecent(): void
    {
        $res = $this->client()->get('/api/singleplayer-originals/originals/fortune_double_games/recent/1');
        if ($res['ok'] && is_array($res['data'])) {
            $results = array_values(array_filter($res['data'], 'is_array'));
            foreach (array_reverse($results) as $r) {
                $id = (string) ($r['id'] ?? '');
                if ($id === '') {
                    continue;
                }
                $exists = Database::fetch(
                    "SELECT id FROM game_results WHERE gameType = 'FORTUNE' AND platform = 'BLAZE' AND blazeId = ? LIMIT 1",
                    [$id]
                );
                if (!$exists) {
                    try {
                        Database::insert('game_results', [
                            'gameType' => 'FORTUNE',
                            'platform' => 'BLAZE',
                            'blazeId' => $id,
                            'color' => (string) ($r['color'] ?? 0),
                            'roll' => (int) ($r['roll'] ?? 0),
                            'createdAt' => now(),
                        ]);
                    } catch (\Throwable $e) {
                    }
                }
            }
            json_response([
                'results' => $results,
                'total' => count($results),
                'apiDown' => false,
            ]);
        }
        $rows = Database::fetchAll(
            "SELECT blazeId AS id, color, roll, createdAt AS created_at FROM game_results WHERE gameType = 'FORTUNE' AND platform = 'BLAZE' ORDER BY id DESC LIMIT 50"
        );
        $rows = array_map(static function (array $r): array {
            $r['color'] = (int) $r['color'];
            $r['roll'] = (int) $r['roll'];
            return $r;
        }, $rows);
        json_response(['results' => $rows, 'total' => count($rows), 'apiDown' => true]);
    }

    public function bacboRecent(): void
    {
        Auth::requireUserId();

        $apiResults = BacBoSource::fetchSource();

        if ($apiResults) {
            try {
                BacBoSource::persistNew($apiResults);
            } catch (\Throwable $e) {
                log_msg('[bacbo/recent] erro ao persistir: ' . $e->getMessage(), 'bot');
            }

            $newestAgeMs = (microtime(true) * 1000) - (strtotime((string) $apiResults[0]['created_at']) * 1000);
            $stale = $newestAgeMs > self::BACBO_STALE_THRESHOLD_MS;

            $sliced = array_slice($apiResults, 0, self::BACBO_MAX_RESULTS);
            json_response([
                'results' => array_map(static fn (array $r) => [
                    'id' => $r['id'],
                    'created_at' => $r['created_at'],
                    'diceplayer1' => $r['diceplayer1'],
                    'diceplayer2' => $r['diceplayer2'],
                    'dicebanker1' => $r['dicebanker1'],
                    'dicebanker2' => $r['dicebanker2'],
                    'winner' => $r['winner'],
                ], $sliced),
                'total' => min(count($apiResults), self::BACBO_MAX_RESULTS),
                'apiDown' => $stale,
            ]);
        }

        log_msg('[bacbo/recent] fonte indisponível, servindo último estado salvo', 'bot');
        try {
            $rows = Database::fetchAll('SELECT * FROM bacbo_results ORDER BY id DESC LIMIT ' . self::BACBO_MAX_RESULTS);
            json_response([
                'results' => array_map(static fn (array $r) => [
                    'id' => (string) $r['id'],
                    'created_at' => (string) $r['createdAt'],
                    'diceplayer1' => (int) $r['player1'],
                    'diceplayer2' => (int) $r['player2'],
                    'dicebanker1' => (int) $r['banker1'],
                    'dicebanker2' => (int) $r['banker2'],
                    'winner' => $r['winner'],
                ], $rows),
                'total' => count($rows),
                'apiDown' => true,
            ]);
        } catch (\Throwable $e) {
            log_msg('[bacbo/recent] erro ao buscar banco: ' . $e->getMessage(), 'bot');
            json_response(['results' => [], 'total' => 0, 'apiDown' => true]);
        }
    }

    public function roletasRecent(): void
    {
        Auth::requireUserId();

        try {
            $rows = Database::fetchAll('SELECT * FROM roulette_results ORDER BY id DESC LIMIT 100');
            json_response([
                'results' => array_map(static fn (array $r) => [
                    'id' => $r['evoId'],
                    'created_at' => $r['createdAt'],
                    'result' => (int) $r['result'],
                    'color' => $r['color'],
                    'lightningMultiplier' => $r['lightningMultiplier'] !== null ? (int) $r['lightningMultiplier'] : null,
                ], $rows),
                'total' => count($rows),
                'apiDown' => false,
                'isMock' => false,
            ]);
        } catch (\Throwable $e) {
            json_response(['error' => $e->getMessage(), 'results' => [], 'total' => 0, 'apiDown' => true], 500);
        }
    }

    /** Port de generateMockResults() em app/api/game/futebol/recent/route.ts. */
    private function generateFutebolMockResults(int $count): array
    {
        $now = (int) (microtime(true) * 1000);
        $results = [];
        for ($i = 0; $i < $count; $i++) {
            $timeMs = $now - $i * 30000;
            $time = gmdate('Y-m-d\TH:i:s', intdiv($timeMs, 1000)) . '.' . str_pad((string) ($timeMs % 1000), 3, '0', STR_PAD_LEFT) . 'Z';

            $scoreHome = random_int(1, 13);
            $scoreAway = random_int(1, 13);
            $winner = $scoreHome > $scoreAway ? 'Home' : ($scoreAway > $scoreHome ? 'Away' : 'Tie');

            $results[] = [
                'id' => 'mock-' . ($now - $i),
                'created_at' => $time,
                'scoreHome' => $scoreHome,
                'scoreAway' => $scoreAway,
                'winner' => $winner,
            ];
        }
        return $results;
    }

    public function futebolRecent(): void
    {
        Auth::requireUserId();

        $cached = ConfigRepository::get('FUTEBOL_MOCK_CACHE');
        $results = $cached ? json_decode($cached, true) : null;
        if (!is_array($results) || !$results) {
            $results = $this->generateFutebolMockResults(100);
            ConfigRepository::set('FUTEBOL_MOCK_CACHE', json_encode($results, JSON_UNESCAPED_UNICODE));
        }

        json_response([
            'results' => $results,
            'total' => count($results),
            'apiDown' => false,
            'isMock' => true,
        ]);
    }

    public function jonbetDoubleRecent(): void
    {
        $res = $this->jonbetClient()->get('/api/singleplayer-originals/originals/roulette_games/recent/1?t=' . time());
        if ($res['ok'] && is_array($res['data'])) {
            $results = array_values(array_filter($res['data'], 'is_array'));
            foreach (array_reverse($results) as $r) {
                $id = (string) ($r['id'] ?? '');
                if ($id === '') {
                    continue;
                }
                $exists = Database::fetch(
                    "SELECT id FROM game_results WHERE gameType = 'DOUBLE' AND platform = 'JONBET' AND blazeId = ? LIMIT 1",
                    [$id]
                );
                if (!$exists) {
                    try {
                        Database::insert('game_results', [
                            'gameType' => 'DOUBLE',
                            'platform' => 'JONBET',
                            'blazeId' => $id,
                            'color' => (string) ($r['color'] ?? 0),
                            'roll' => (int) ($r['roll'] ?? 0),
                            'createdAt' => now(),
                        ]);
                    } catch (\Throwable $e) {
                    }
                }
            }
            json_response(['results' => $results, 'total' => count($results), 'apiDown' => false]);
        }
        $rows = Database::fetchAll(
            "SELECT blazeId AS id, color, roll, createdAt AS created_at FROM game_results WHERE gameType = 'DOUBLE' AND platform = 'JONBET' ORDER BY id DESC LIMIT 50"
        );
        $rows = array_map(static function (array $r): array {
            $r['color'] = (int) $r['color'];
            $r['roll'] = (int) $r['roll'];
            return $r;
        }, $rows);
        json_response(['results' => $rows, 'total' => count($rows), 'apiDown' => true]);
    }

    public function jonbetCrashRecent(): void
    {
        $res = $this->jonbetClient()->get('/api/singleplayer-originals/originals/crash_games/recent/4?t=' . time());
        if ($res['ok'] && is_array($res['data'])) {
            $results = array_map(static function (array $r): array {
                if (!isset($r['crash_point']) && isset($r['crashPoint'])) {
                    $r['crash_point'] = $r['crashPoint'];
                }
                return $r;
            }, array_values(array_filter($res['data'], 'is_array')));
            foreach (array_reverse($results) as $r) {
                $id = (string) ($r['id'] ?? '');
                if ($id === '') {
                    continue;
                }
                $exists = Database::fetch(
                    "SELECT id FROM game_results WHERE gameType = 'CRASH' AND platform = 'JONBET' AND blazeId = ? LIMIT 1",
                    [$id]
                );
                if (!$exists) {
                    try {
                        Database::insert('game_results', [
                            'gameType' => 'CRASH',
                            'platform' => 'JONBET',
                            'blazeId' => $id,
                            'crashPoint' => (string) ($r['crash_point'] ?? '0'),
                            'createdAt' => now(),
                        ]);
                    } catch (\Throwable $e) {
                    }
                }
            }
            json_response(['results' => $results, 'total' => count($results), 'apiDown' => false]);
        }
        $rows = Database::fetchAll(
            "SELECT blazeId AS id, crashPoint AS crash_point, createdAt AS created_at FROM game_results WHERE gameType = 'CRASH' AND platform = 'JONBET' ORDER BY id DESC LIMIT 50"
        );
        json_response(['results' => $rows, 'total' => count($rows), 'apiDown' => true]);
    }

    public function jonbetFortuneRecent(): void
    {
        $res = $this->jonbetClient()->get('/api/singleplayer-originals/originals/fortune_double_games/recent/1');
        if ($res['ok'] && is_array($res['data'])) {
            $results = array_values(array_filter($res['data'], 'is_array'));
            foreach (array_reverse($results) as $r) {
                $id = (string) ($r['id'] ?? '');
                if ($id === '') {
                    continue;
                }
                $exists = Database::fetch(
                    "SELECT id FROM game_results WHERE gameType = 'FORTUNE' AND platform = 'JONBET' AND blazeId = ? LIMIT 1",
                    [$id]
                );
                if (!$exists) {
                    try {
                        Database::insert('game_results', [
                            'gameType' => 'FORTUNE',
                            'platform' => 'JONBET',
                            'blazeId' => $id,
                            'color' => (string) ($r['color'] ?? 0),
                            'roll' => (int) ($r['roll'] ?? 0),
                            'createdAt' => now(),
                        ]);
                    } catch (\Throwable $e) {
                    }
                }
            }
            json_response(['results' => $results, 'total' => count($results), 'apiDown' => false]);
        }
        $rows = Database::fetchAll(
            "SELECT blazeId AS id, color, roll, createdAt AS created_at FROM game_results WHERE gameType = 'FORTUNE' AND platform = 'JONBET' ORDER BY id DESC LIMIT 50"
        );
        $rows = array_map(static function (array $r): array {
            $r['color'] = (int) $r['color'];
            $r['roll'] = (int) $r['roll'];
            return $r;
        }, $rows);
        json_response(['results' => $rows, 'total' => count($rows), 'apiDown' => true]);
    }

    /**
     * Port de app/api/premium/history/route.ts, app/api/premium/crash-history/route.ts,
     * app/api/premium/fortune-history/route.ts e seus equivalentes /api/jonbet/premium/*.
     *
     * A Next.js original NÃO lê de banco — ela é um proxy ao vivo pro endpoint de
     * histórico paginado da Blaze/Jonbet, com cache em memória. O front-end nunca manda
     * ?platform= nem ?game= — a plataforma e o jogo são inferidos só pela URL da rota
     * (path prefix /api/jonbet/premium/... vs /api/premium/..., e o sufixo
     * crash-history/fortune-history/history).
     */
    public function premiumHistory(): void
    {
        $uri = $_SERVER['REQUEST_URI'] ?? '';
        $platform = $this->premiumPlatform($uri);
        $game = str_contains($uri, 'crash-history') ? 'CRASH' : (str_contains($uri, 'fortune-history') ? 'FORTUNE' : 'DOUBLE');

        // Igual ao original: history (double) e crash-history exigem sessão; fortune-history não.
        if ($game !== 'FORTUNE') {
            Auth::requireUserId();
        }

        $start = (string) ($_GET['start'] ?? '');
        $end = (string) ($_GET['end'] ?? '');
        $page = (string) ($_GET['page'] ?? '1');
        if ($start === '' || $end === '') {
            json_response(['error' => 'start e end obrigatórios'], 400);
        }

        $host = $this->premiumHost($platform);
        $label = $platform === 'JONBET' ? 'Jonbet' : 'Blaze';

        if ($game === 'DOUBLE') {
            $headers = $this->premiumHeaders($platform, '/pt/games/double');
            $url = $host . '/api/singleplayer-originals/originals/roulette_games/recent/history/1'
                . '?startDate=' . rawurlencode($start) . '&endDate=' . rawurlencode($end) . '&page=' . rawurlencode($page);
            $this->premiumProxySimple($url, $headers, $label);
            return;
        }

        if ($game === 'CRASH') {
            $headers = $this->premiumHeaders($platform, '/pt/games/crash');
            $url = $host . '/api/singleplayer-originals/originals/crash_games/recent/history/4'
                . '?startDate=' . rawurlencode($start) . '&endDate=' . rawurlencode($end) . '&page=' . rawurlencode($page);
            $this->premiumProxySimple($url, $headers, $label);
            return;
        }

        // FORTUNE: página 1 mescla analytics (paginado) + recent/history (tempo real);
        // páginas 2+ usam só analytics.
        $headers = $this->premiumHeaders($platform, '/pt/games/fortune-double/1');
        $isPage1 = $page === '1';
        $analyticsUrl = $host . '/api/singleplayer-originals/originals/fortune_double_games/history/analytics/1'
            . '?startDate=' . rawurlencode($start) . '&endDate=' . rawurlencode($end) . '&page=' . rawurlencode($page);

        if ($isPage1) {
            $recentUrl = $host . '/api/singleplayer-originals/originals/fortune_double_games/recent/history/1'
                . '?startDate=' . rawurlencode($start) . '&endDate=' . rawurlencode($end) . '&page=1';

            $analyticsRes = $this->premiumFetchWithRetry($analyticsUrl, $headers);
            if (($analyticsRes['status'] ?? 0) === 429) {
                json_response(['error' => "$label 429 — aguarde 1 minuto"], 429);
            }
            if (!$analyticsRes['ok']) {
                json_response(['error' => "$label {$analyticsRes['status']}"], $analyticsRes['status'] ?: 502);
            }

            $analyticsRaw = $analyticsRes['data'];
            $analyticsRecords = $this->premiumExtractFortuneRecords($analyticsRaw);
            $lastPage = $this->premiumExtractLastPage($analyticsRaw);

            $recentRecords = [];
            $recentRes = $this->premiumFetchWithRetry($recentUrl, $headers);
            if ($recentRes['ok']) {
                $recentRecords = $this->premiumExtractFortuneRecords($recentRes['data']);
            }

            $analyticsIds = array_map(static fn ($r) => $r['id'] ?? null, $analyticsRecords);
            $newRecords = array_values(array_filter(
                $recentRecords,
                static fn ($r) => !in_array($r['id'] ?? null, $analyticsIds, true)
            ));

            $allRecords = array_merge($newRecords, $analyticsRecords);
            usort($allRecords, static function ($a, $b) {
                $ta = strtotime((string) ($a['created_at'] ?? '')) ?: 0;
                $tb = strtotime((string) ($b['created_at'] ?? '')) ?: 0;
                return $tb <=> $ta;
            });

            $normalized = is_array($analyticsRaw) ? $analyticsRaw : [];
            $normalized['records'] = $allRecords;
            $normalized['last_page'] = $lastPage;
            json_response($normalized);
            return;
        }

        $res = $this->premiumFetchWithRetry($analyticsUrl, $headers);
        if (($res['status'] ?? 0) === 429) {
            json_response(['error' => "$label 429 — aguarde 1 minuto"], 429);
        }
        if (!$res['ok']) {
            json_response(['error' => "$label {$res['status']}"], $res['status'] ?: 502);
        }
        $raw = $res['data'];
        $normalized = is_array($raw) ? $raw : [];
        $normalized['records'] = $this->premiumExtractFortuneRecords($raw);
        $normalized['last_page'] = $this->premiumExtractLastPage($raw);
        json_response($normalized);
    }

    /**
     * Port de app/api/premium/{crash,double,fortune}-aggregate/route.ts e equivalentes
     * /api/jonbet/premium/*-aggregate. Busca TODAS as páginas do histórico server-side
     * (com pacing entre requests) e devolve {records, total} — usado pelo Gerador de
     * Lista, Buscar Padrão e Corrigir Lista pra ter uma janela grande de rounds de uma
     * vez só. Também sem cache entre requests (cada request HTTP do PHP é um processo
     * novo) — a Next.js original cacheava em memória do processo Node, aqui cada
     * chamada busca ao vivo.
     */
    public function premiumAggregate(): void
    {
        $uri = $_SERVER['REQUEST_URI'] ?? '';
        $platform = $this->premiumPlatform($uri);
        $game = str_contains($uri, 'crash-aggregate') ? 'CRASH' : (str_contains($uri, 'fortune-aggregate') ? 'FORTUNE' : 'DOUBLE');

        $host = $this->premiumHost($platform);
        @set_time_limit(180);
        $now = new \DateTime('now', new \DateTimeZone('UTC'));

        if ($game === 'FORTUNE') {
            $daysBack = min((int) ($_GET['days'] ?? 1), 14);
            $maxPages = min((int) ($_GET['maxPages'] ?? 30), 200);
            $end = $this->premiumRoundToHour($now);
            $start = $this->premiumRoundToHour((clone $now)->modify('-' . $daysBack . ' days'));

            $headers = $this->premiumHeaders($platform, '/pt/games/fortune-double/1');
            $base = $host . '/api/singleplayer-originals/originals/fortune_double_games/history/analytics/1';
            $records = $this->premiumFetchAllPages($base, $this->premiumToISO($start), $this->premiumToISO($end), $maxPages, $headers, 300);
            $records = array_map(function (array $r) {
                $r['color'] = $this->premiumNormalizeColor($r['color'] ?? null);
                return $r;
            }, $records);
            json_response(['records' => array_values($records), 'total' => count($records)]);
            return;
        }

        $dateParam = isset($_GET['date']) && $_GET['date'] !== '' ? (string) $_GET['date'] : null;

        if ($dateParam !== null) {
            [$boundsStart, $boundsEnd] = $this->premiumBrDayBoundsUTC($dateParam);
            $start = $boundsStart;
            $isTodayOnly = $boundsEnd > $now;
            $end = $isTodayOnly ? clone $now : $boundsEnd;
            $maxPages = min((int) ($_GET['maxPages'] ?? 50), 80);
        } else {
            $defaultDays = $game === 'CRASH' ? 7 : 1;
            $daysBack = min((int) ($_GET['days'] ?? $defaultDays), 14);
            $maxPages = min((int) ($_GET['maxPages'] ?? 30), 60);
            $isTodayOnly = $daysBack === 1;
            $end = $isTodayOnly ? $this->premiumRoundTo10Seconds($now) : $this->premiumRoundToHour($now);
            $start = $isTodayOnly
                ? (clone $now)->modify('-1 day')
                : $this->premiumRoundToHour((clone $now)->modify('-' . $daysBack . ' days'));
        }

        if ($game === 'CRASH') {
            $headers = $this->premiumHeaders($platform, '/pt/games/crash');
            $base = $host . '/api/singleplayer-originals/originals/crash_games/recent/history/4';
        } else {
            $headers = $this->premiumHeaders($platform, '/pt/games/double');
            $base = $host . '/api/singleplayer-originals/originals/roulette_games/recent/history/1';
        }

        $records = $this->premiumFetchAllPages($base, $this->premiumToISO($start), $this->premiumToISO($end), $maxPages, $headers, 600);
        json_response(['records' => array_values($records), 'total' => count($records)]);
    }

    private function premiumPlatform(string $uri): string
    {
        return str_contains($uri, '/jonbet/premium/') ? 'JONBET' : 'BLAZE';
    }

    private function premiumHost(string $platform): string
    {
        return $platform === 'JONBET' ? 'https://jonbet.bet.br' : 'https://blaze.bet.br';
    }

    private function premiumHeaders(string $platform, string $refererPath): array
    {
        $host = $this->premiumHost($platform);
        return [
            'Accept' => 'application/json',
            'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer' => $host . $refererPath,
            'Origin' => $host,
            'Accept-Language' => 'pt-BR,pt;q=0.9,en;q=0.8',
            'Cache-Control' => 'no-cache',
            'Pragma' => 'no-cache',
            'x-client-version' => $platform === 'JONBET' ? 'e672a0517' : '2ecb1ba89',
            'ipcountry' => 'BR',
        ];
    }

    private function premiumCurlGet(string $url, array $headers): array
    {
        $ch = curl_init($url);
        $lines = [];
        foreach ($headers as $k => $v) {
            $lines[] = "$k: $v";
        }
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $lines,
            CURLOPT_CONNECTTIMEOUT => 6,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($raw === false) {
            return ['ok' => false, 'status' => 0, 'data' => null];
        }
        $data = json_decode($raw, true);
        return ['ok' => $status >= 200 && $status < 300, 'status' => $status, 'data' => $data];
    }

    /** Port de blazeFetch()/jonbetFetch(): retenta em 429 com backoff 3s*(i+1). */
    private function premiumFetchWithRetry(string $url, array $headers, int $retries = 2): array
    {
        $res = ['ok' => false, 'status' => 0, 'data' => null];
        for ($i = 0; $i <= $retries; $i++) {
            $res = $this->premiumCurlGet($url, $headers);
            if (($res['status'] ?? 0) !== 429) {
                return $res;
            }
            if ($i < $retries) {
                usleep(3000 * ($i + 1) * 1000);
            }
        }
        return $this->premiumCurlGet($url, $headers);
    }

    private function premiumProxySimple(string $url, array $headers, string $label): void
    {
        $res = $this->premiumFetchWithRetry($url, $headers);
        if (($res['status'] ?? 0) === 429) {
            json_response(['error' => "$label 429 — aguarde 1 minuto e tente novamente"], 429);
        }
        if (!$res['ok']) {
            json_response(['error' => "$label {$res['status']}"], $res['status'] ?: 502);
        }
        json_response($res['data']);
    }

    /** Port de fetchPage(): retenta em 429 (backoff 4s*(i+1)) e em falha de rede (2s), até 3 vezes. */
    private function premiumFetchPageWithRetry(string $url, array $headers, int $retries = 3): mixed
    {
        for ($i = 0; $i <= $retries; $i++) {
            $res = $this->premiumCurlGet($url, $headers);
            if ($res['ok']) {
                return $res['data'];
            }
            if (($res['status'] ?? 0) === 429) {
                if ($i < $retries) {
                    usleep(4000 * ($i + 1) * 1000);
                    continue;
                }
                return null;
            }
            if (($res['status'] ?? 0) === 0) {
                if ($i < $retries) {
                    usleep(2000 * 1000);
                    continue;
                }
                return null;
            }
            return null;
        }
        return null;
    }

    private function premiumExtractRecords(mixed $data): array
    {
        if (is_array($data) && array_is_list($data)) {
            return $data;
        }
        if (is_array($data)) {
            return $data['records'] ?? $data['data'] ?? $data['results'] ?? $data['items'] ?? [];
        }
        return [];
    }

    private function premiumExtractLastPage(mixed $data): int
    {
        if (!is_array($data)) {
            return 1;
        }
        return (int) ($data['last_page'] ?? $data['totalPages'] ?? $data['total_pages'] ?? $data['pages'] ?? 1);
    }

    private function premiumNormalizeColor(mixed $c): int
    {
        if (is_int($c) || is_float($c)) {
            return (int) round($c);
        }
        if (is_string($c)) {
            if (is_numeric($c)) {
                return (int) $c;
            }
            $l = strtolower($c);
            if ($l === 'yellow' || str_contains($l, 'amarelo')) {
                return 0;
            }
            if ($l === 'red' || str_contains($l, 'vermelho')) {
                return 1;
            }
            if ($l === 'black' || $l === 'blue' || str_contains($l, 'azul')) {
                return 2;
            }
            return 0;
        }
        if (is_array($c)) {
            return $this->premiumNormalizeColor($c['id'] ?? $c['color_id'] ?? $c['value'] ?? $c['color'] ?? null);
        }
        return 0;
    }

    private function premiumExtractFortuneRecords(mixed $data): array
    {
        $raw = $this->premiumExtractRecords($data);
        return array_map(function ($r) {
            if (is_array($r)) {
                $r['color'] = $this->premiumNormalizeColor($r['color'] ?? null);
            }
            return $r;
        }, $raw);
    }

    private function premiumFetchAllPages(string $base, string $startISO, string $endISO, int $maxPages, array $headers, int $pageDelayMs): array
    {
        $all = [];
        $page = 1;
        $lastPage = 1;
        while ($page <= $maxPages) {
            $url = $base . '?startDate=' . rawurlencode($startISO) . '&endDate=' . rawurlencode($endISO) . '&page=' . $page;
            $data = $this->premiumFetchPageWithRetry($url, $headers);
            if ($data === null) {
                break;
            }
            foreach ($this->premiumExtractRecords($data) as $r) {
                $all[] = $r;
            }
            if ($page === 1) {
                $lastPage = $this->premiumExtractLastPage($data);
            }
            if ($page >= $lastPage || $page >= $maxPages) {
                break;
            }
            $page++;
            usleep($pageDelayMs * 1000);
        }
        return $all;
    }

    private function premiumRoundToHour(\DateTime $d): \DateTime
    {
        $c = clone $d;
        $c->setTime((int) $c->format('H'), 0, 0);
        return $c;
    }

    private function premiumRoundTo10Seconds(\DateTime $d): \DateTime
    {
        $c = clone $d;
        $sec = intdiv((int) $c->format('s'), 10) * 10;
        $c->setTime((int) $c->format('H'), (int) $c->format('i'), $sec);
        return $c;
    }

    /** BR (America/Sao_Paulo) não tem horário de verão desde 2019 — offset fixo -03:00. */
    private function premiumBrDayBoundsUTC(string $dateStr): array
    {
        $start = new \DateTime($dateStr . 'T00:00:00.000-03:00');
        $start->setTimezone(new \DateTimeZone('UTC'));
        $end = (clone $start)->modify('+1 day');
        return [$start, $end];
    }

    private function premiumToISO(\DateTime $d): string
    {
        $c = clone $d;
        $c->setTimezone(new \DateTimeZone('UTC'));
        return $c->format('Y-m-d\TH:i:s.v\Z');
    }
}
