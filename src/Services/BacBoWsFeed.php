<?php

declare(strict_types=1);

namespace App\Services;

/**
 * Garante o processo Node bot/bacbo-ws-feed.cjs (resultados Bac Bo via WebSocket Evolution).
 */
final class BacBoWsFeed
{
    public static function historyPath(): string
    {
        return storage_path('bacbo-ws/history.json');
    }

    public static function statusPath(): string
    {
        return storage_path('bacbo-ws/status.json');
    }

    public static function pidPath(): string
    {
        return storage_path('bacbo-ws/feed.pid');
    }

    public static function isRunning(): bool
    {
        $pidFile = self::pidPath();
        if (!is_file($pidFile)) {
            return false;
        }
        $pid = (int) trim((string) file_get_contents($pidFile));
        if ($pid <= 0) {
            return false;
        }
        return self::isAlive($pid);
    }

    public static function ensureRunning(): void
    {
        if (self::isRunning()) {
            return;
        }

        $script = base_path('bot/bacbo-ws-feed.cjs');
        if (!is_file($script)) {
            log_msg('[bacbo-ws-feed] script não encontrado', 'bot');
            return;
        }

        $nodeModules = base_path('node_modules/ws');
        if (!is_dir($nodeModules)) {
            log_msg('[bacbo-ws-feed] pacote ws ausente — npm install ws', 'bot');
            return;
        }

        $node = self::findNode();
        if ($node === null) {
            log_msg('[bacbo-ws-feed] Node.js não encontrado', 'bot');
            return;
        }

        @mkdir(storage_path('bacbo-ws'), 0777, true);
        @mkdir(storage_path('logs'), 0777, true);
        $log = storage_path('logs/bacbo-ws-feed.log');

        if (PHP_OS_FAMILY === 'Windows') {
            if (!function_exists('popen')) {
                log_msg('[bacbo-ws-feed] popen() indisponível — rode o feed via bot/server.cjs', 'bot');
                return;
            }
            $cmd = 'start /B "" ' . escapeshellarg($node) . ' ' . escapeshellarg($script)
                . ' >> ' . escapeshellarg($log) . ' 2>&1';
            pclose(popen($cmd, 'r'));
        } else {
            if (!function_exists('exec')) {
                // Hospedagem compartilhada: exec() desabilitado. O feed deve rodar dentro
                // do processo persistente bot/server.cjs (deploy separado, ex. Node App
                // do hPanel) — ele já grava no mesmo storage/bacbo-ws/history.json.
                log_msg('[bacbo-ws-feed] exec() indisponível — rode o feed via bot/server.cjs', 'bot');
                return;
            }
            $cmd = escapeshellarg($node) . ' ' . escapeshellarg($script)
                . ' >> ' . escapeshellarg($log) . ' 2>&1 & echo $!';
            $out = [];
            exec($cmd, $out);
            $pid = (int) ($out[0] ?? 0);
            if ($pid > 0) {
                @file_put_contents(self::pidPath(), (string) $pid);
            }
        }

        usleep(300_000);
        log_msg('[bacbo-ws-feed] spawn solicitado', 'bot');
    }

    /**
     * Lê histórico gerado pelo feed WS (mais recente primeiro).
     *
     * @return list<array{id:string,created_at:string,diceplayer1:int,diceplayer2:int,dicebanker1:int,dicebanker2:int,winner:string}>|null
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
                $id = (string) ($r['_id'] ?? $r['id'] ?? '');
                if ($id === '') {
                    continue;
                }
                $p1 = (int) ($r['diceplayer1'] ?? 0);
                $p2 = (int) ($r['diceplayer2'] ?? 0);
                $b1 = (int) ($r['dicebanker1'] ?? 0);
                $b2 = (int) ($r['dicebanker2'] ?? 0);
                $winner = (string) ($r['winner'] ?? '');
                if ($winner === '' || ($p1 + $p2 + $b1 + $b2) > 0) {
                    $winner = \App\Bot\Games\BacBoSource::winnerFromDice($p1, $p2, $b1, $b2);
                }
                $out[] = [
                    'id' => $id,
                    'created_at' => (string) ($r['createdAt'] ?? $r['created_at'] ?? ''),
                    'diceplayer1' => $p1,
                    'diceplayer2' => $p2,
                    'dicebanker1' => $b1,
                    'dicebanker2' => $b2,
                    'winner' => $winner,
                ];
            }
            return $out ?: null;
        } catch (\Throwable) {
            return null;
        }
    }

    public static function isStale(int $maxAgeSeconds = 120): bool
    {
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
