<?php

declare(strict_types=1);

namespace App\Services;

/**
 * Garante que o processo longo bot/worker.php está rodando.
 * Sem ele, start/stop ficam em bot_commands com status=pending
 * e o painel mostra bot "ativo" sem entradas/cards.
 */
final class BotWorker
{
    public static function ensureRunning(): void
    {
        $pidFile = storage_path('bot-worker.pid');
        if (is_file($pidFile)) {
            $pid = (int) trim((string) file_get_contents($pidFile));
            if ($pid > 0 && self::isAlive($pid)) {
                return;
            }
            @unlink($pidFile);
        }

        $php = PHP_BINARY ?: 'php';
        $script = base_path('bot/worker.php');
        if (!is_file($script)) {
            log_msg('[worker] bot/worker.php não encontrado', 'bot');
            return;
        }

        $log = storage_path('logs/worker-out.log');
        @mkdir(dirname($log), 0777, true);

        if (PHP_OS_FAMILY === 'Windows') {
            if (!function_exists('popen')) {
                log_msg('[worker] popen() indisponível — configure um cron rodando bot/worker.php', 'bot');
                return;
            }
            // start /B em background sem bloquear o request
            $cmd = 'start /B "" ' . escapeshellarg($php) . ' ' . escapeshellarg($script)
                . ' >> ' . escapeshellarg($log) . ' 2>&1';
            pclose(popen($cmd, 'r'));
        } else {
            if (!function_exists('exec')) {
                // Comum em hospedagem compartilhada (exec desabilitado). O worker precisa
                // rodar via cron do painel de hospedagem: "php bot/worker.php" periodicamente.
                log_msg('[worker] exec() indisponível — configure um cron rodando bot/worker.php', 'bot');
                return;
            }
            $cmd = escapeshellarg($php) . ' ' . escapeshellarg($script)
                . ' >> ' . escapeshellarg($log) . ' 2>&1 & echo $!';
            $out = [];
            exec($cmd, $out);
            $pid = (int) ($out[0] ?? 0);
            if ($pid > 0) {
                @file_put_contents($pidFile, (string) $pid);
            }
        }

        // dá um fôlego pro worker gravar o pid
        usleep(200_000);
        log_msg('[worker] spawn solicitado', 'bot');
    }

    public static function isAlive(int $pid): bool
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
        // posix
        if (function_exists('posix_kill')) {
            return @posix_kill($pid, 0);
        }
        return is_dir('/proc/' . $pid);
    }
}
