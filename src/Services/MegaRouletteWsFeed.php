<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\ConfigRepository;

/**
 * Garante o processo Node bot/megaroulette-ws-feed.cjs (resultados Blaze Mega
 * Roulette / Pragmatic Play via WebSocket direto — sem bloqueio Akamai,
 * diferente do Bac Bo/Evolution). Mesmo padrão do BacBoWsFeed.
 */
final class MegaRouletteWsFeed
{
    public static function historyPath(): string
    {
        return storage_path('megaroulette-ws/history.json');
    }

    public static function pidPath(): string
    {
        return storage_path('megaroulette-ws/feed.pid');
    }

    public static function isRunning(): bool
    {
        $pidFile = self::pidPath();
        if (!is_file($pidFile)) {
            return false;
        }
        $pid = (int) trim((string) file_get_contents($pidFile));
        if ($pid <= 0) {
            @unlink($pidFile);
            return false;
        }
        if (!self::isAlive($pid)) {
            @unlink($pidFile);
            return false;
        }
        return true;
    }

    /**
     * Token do feed: Admin/env, senão token Blaze de usuário ativo (só leitura de resultados).
     */
    public static function resolveFeedToken(): string
    {
        $token = trim((string) (ConfigRepository::get('MEGAROULETTE_FEED_TOKEN', '') ?: env('MEGAROULETTE_FEED_TOKEN', '')));
        if ($token !== '') {
            return $token;
        }
        // Fallback: conta Blaze de alguém logado no sistema (feed é só WS de resultados).
        try {
            $row = \App\Database::fetch(
                "SELECT token FROM users WHERE token IS NOT NULL AND token != '' ORDER BY isActive DESC, id ASC LIMIT 1"
            );
            if ($row && !empty($row['token'])) {
                return trim((string) $row['token']);
            }
        } catch (\Throwable) {
            /* ignore */
        }
        return '';
    }

    public static function ensureRunning(): void
    {
        // Default: mesa real via Blaze → WebSocket Pragmatic (sem GamblingCounting/browser)
        $source = trim((string) (ConfigRepository::get('MEGAROULETTE_FEED_SOURCE', '') ?: env('MEGAROULETTE_FEED_SOURCE', 'blaze')));
        if ($source === '') {
            $source = 'blaze';
        }

        // off/none desliga o spawn (manutenção)
        if (in_array($source, ['off', 'none'], true)) {
            return;
        }

        if (self::isRunning()) {
            return;
        }

        // Evita storm de spawn (worker poll a cada ~1.5s se history stale)
        $lock = storage_path('megaroulette-ws/spawn.lock');
        @mkdir(storage_path('megaroulette-ws'), 0777, true);
        if (is_file($lock) && (time() - (int) @filemtime($lock)) < 15) {
            return;
        }
        @file_put_contents($lock, (string) time());

        $token = self::resolveFeedToken();
        $gcWsUrl = trim((string) (ConfigRepository::get('MEGAROULETTE_GC_WS_URL', '') ?: env('MEGAROULETTE_GC_WS_URL', '')));

        if ($token === '' && $gcWsUrl === '') {
            log_msg(
                '[megaroulette-ws-feed] sem fonte — configure MEGAROULETTE_GC_WS_URL '
                . '(wss gamblingcounting) ou MEGAROULETTE_FEED_TOKEN (Blaze)',
                'bot'
            );
            return;
        }

        $script = base_path('bot/megaroulette-ws-feed.cjs');
        if (!is_file($script)) {
            log_msg('[megaroulette-ws-feed] script não encontrado', 'bot');
            return;
        }

        $nodeModules = base_path('node_modules/ws');
        if (!is_dir($nodeModules)) {
            log_msg('[megaroulette-ws-feed] pacote ws ausente — npm install ws', 'bot');
            return;
        }

        $node = self::findNode();
        if ($node === null) {
            log_msg('[megaroulette-ws-feed] Node.js não encontrado', 'bot');
            return;
        }

        @mkdir(storage_path('logs'), 0777, true);
        $log = storage_path('logs/megaroulette-ws-feed.log');

        // Brazilian Mega Roulette (substitui 204-204)
        $slug = trim((string) (ConfigRepository::get('MEGAROULETTE_GAME_SLUG', '') ?: env('MEGAROULETTE_GAME_SLUG', 'mega-roulette---brazilian-287-287')));
        if ($slug === '') {
            $slug = 'mega-roulette---brazilian-287-287';
        }

        $envPairs = [
            'MEGAROULETTE_FEED_SOURCE' => $source,
            'MEGAROULETTE_GAME_SLUG' => $slug,
            'MEGAROULETTE_GC_GAME_KEY' => '8-287',
        ];
        if ($token !== '') {
            $envPairs['MEGAROULETTE_FEED_TOKEN'] = $token;
        }
        if ($gcWsUrl !== '') {
            $envPairs['MEGAROULETTE_GC_WS_URL'] = $gcWsUrl;
        }

        $envPrefix = '';
        foreach ($envPairs as $k => $v) {
            $envPrefix .= $k . '=' . escapeshellarg($v) . ' ';
        }

        if (PHP_OS_FAMILY === 'Windows') {
            if (!function_exists('popen')) {
                log_msg('[megaroulette-ws-feed] popen() indisponível', 'bot');
                return;
            }
            $set = '';
            foreach ($envPairs as $k => $v) {
                $set .= 'set ' . $k . '=' . $v . ' && ';
            }
            $cmd = $set . 'start /B "" '
                . escapeshellarg($node) . ' ' . escapeshellarg($script)
                . ' >> ' . escapeshellarg($log) . ' 2>&1';
            pclose(popen($cmd, 'r'));
        } else {
            if (!function_exists('exec')) {
                log_msg('[megaroulette-ws-feed] exec() indisponível', 'bot');
                return;
            }
            $cmd = $envPrefix . escapeshellarg($node) . ' ' . escapeshellarg($script)
                . ' >> ' . escapeshellarg($log) . ' 2>&1 & echo $!';
            $out = [];
            exec($cmd, $out);
            $pid = (int) ($out[0] ?? 0);
            if ($pid > 0) {
                @file_put_contents(self::pidPath(), (string) $pid);
            }
        }

        usleep(300_000);
        log_msg(
            '[megaroulette-ws-feed] spawn solicitado source=' . $source
            . ' slug=' . $slug
            . ' token=' . ($token !== '' ? 'sim' : 'nao')
            . ' gc=' . ($gcWsUrl !== '' ? 'sim' : 'nao'),
            'bot'
        );
    }

    /**
     * @return list<array{id:string,created_at:string,roll:int,color:string}>|null
     */
    public static function readResults(): ?array
    {
        $path = self::historyPath();
        if (!is_file($path)) {
            return null;
        }
        try {
            $raw = file_get_contents($path);
            if ($raw === false || $raw === '') {
                return null;
            }
            $data = json_decode($raw, true);
            if (!is_array($data) || !isset($data['results']) || !is_array($data['results'])) {
                return null;
            }
            $out = [];
            foreach ($data['results'] as $r) {
                if (!is_array($r)) {
                    continue;
                }
                $id = (string) ($r['id'] ?? '');
                if ($id === '') {
                    continue;
                }
                $out[] = [
                    'id' => $id,
                    'created_at' => (string) ($r['created_at'] ?? ''),
                    'roll' => (int) ($r['roll'] ?? -1),
                    'color' => (string) ($r['color'] ?? ''),
                ];
            }
            return $out ?: null;
        } catch (\Throwable) {
            return null;
        }
    }

    public static function isStale(int $maxAgeSeconds = 180): bool
    {
        // Preferência: último RESULTADO real (não só heartbeat/conexão)
        $statusPath = storage_path('megaroulette-ws/status.json');
        if (is_file($statusPath)) {
            try {
                $s = json_decode((string) file_get_contents($statusPath), true);
                if (is_array($s) && !empty($s['lastResultAt'])) {
                    $t = strtotime((string) $s['lastResultAt']);
                    if ($t !== false) {
                        return (time() - $t) > $maxAgeSeconds;
                    }
                }
            } catch (\Throwable) {
                /* */
            }
        }
        $path = self::historyPath();
        if (!is_file($path)) {
            return true;
        }
        $mtime = @filemtime($path) ?: 0;
        return (time() - $mtime) > $maxAgeSeconds;
    }

    private static function isAlive(int $pid): bool
    {
        if ($pid <= 0) {
            return false;
        }
        if (PHP_OS_FAMILY === 'Windows') {
            $out = [];
            exec('tasklist /FI "PID eq ' . $pid . '" /NH 2>NUL', $out);
            $line = implode(' ', $out);
            return str_contains($line, (string) $pid);
        }
        if (function_exists('posix_kill')) {
            return @posix_kill($pid, 0);
        }
        return is_dir('/proc/' . $pid);
    }

    private static function findNode(): ?string
    {
        $candidates = [
            'C:\\Program Files\\nodejs\\node.exe',
            'C:\\Program Files (x86)\\nodejs\\node.exe',
            'node',
        ];
        foreach ($candidates as $c) {
            if ($c !== 'node' && is_file($c)) {
                return $c;
            }
            if ($c === 'node') {
                $which = PHP_OS_FAMILY === 'Windows' ? 'where' : 'which';
                $out = [];
                @exec($which . ' node 2>nul', $out);
                if (!empty($out[0]) && (is_file(trim($out[0])) || PHP_OS_FAMILY !== 'Windows')) {
                    return trim($out[0]);
                }
                return 'node';
            }
        }
        return null;
    }
}
