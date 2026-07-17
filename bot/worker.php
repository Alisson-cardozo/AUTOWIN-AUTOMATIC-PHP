<?php

declare(strict_types=1);

/**
 * Worker longo de bots — rode em paralelo ao servidor web:
 *   php bot/worker.php
 *
 * Também pode ser iniciado automaticamente pelo painel (BotWorker::ensureRunning),
 * quando exec()/popen() estão disponíveis (não é o caso em hospedagem compartilhada).
 *
 * Hospedagem compartilhada (sem exec/proc_open): configure um cron do painel
 * rodando este script periodicamente. Defina WORKER_MAX_SECONDS (ex.: 280) pra
 * ele encerrar sozinho antes do próximo disparo do cron — evita instância presa
 * além do limite de execução do host. Sem essa env, roda para sempre (padrão
 * atual, pensado pra VPS/systemd/PM2 ou dev local).
 */

require dirname(__DIR__) . '/vendor/autoload.php';

use App\Bootstrap;
use App\Bot\EngineManager;
use App\Services\BacBoWsFeed;
use App\Services\BotWorker;

Bootstrap::init();

$pidFile = storage_path('bot-worker.pid');

// Cron pode disparar este script antes do anterior terminar — se já tem uma
// instância viva, esta encerra sem fazer nada (evita workers duplicados).
if (is_file($pidFile)) {
    $existingPid = (int) trim((string) @file_get_contents($pidFile));
    if ($existingPid > 0 && $existingPid !== getmypid() && BotWorker::isAlive($existingPid)) {
        echo '[' . date('H:i:s') . "] worker já ativo (pid=$existingPid) — encerrando\n";
        exit(0);
    }
}

@file_put_contents($pidFile, (string) getmypid());

$maxSeconds = (int) (getenv('WORKER_MAX_SECONDS') ?: 0);
$startedAt = microtime(true);

// limpa pid ao sair
register_shutdown_function(static function () use ($pidFile): void {
    if (is_file($pidFile)) {
        $cur = (int) trim((string) @file_get_contents($pidFile));
        if ($cur === getmypid()) {
            @unlink($pidFile);
        }
    }
});

echo '[' . date('H:i:s') . "] AutoWin bot worker iniciado (pid=" . getmypid() . ")\n";
log_msg('worker started pid=' . getmypid(), 'bot');

// Feed WS Bac Bo (resultados da mesa Evolution — substitui bacbominer)
try {
    BacBoWsFeed::ensureRunning();
    echo '[' . date('H:i:s') . "] Bac Bo WS feed solicitado\n";
} catch (Throwable $e) {
    echo 'Aviso bacbo-ws-feed: ' . $e->getMessage() . "\n";
}

// evita que um fatal mate tudo sem log
set_exception_handler(function (Throwable $e) {
    log_msg('UNCAUGHT: ' . $e->getMessage() . "\n" . $e->getTraceAsString(), 'bot');
    fwrite(STDERR, $e->getMessage() . "\n");
});

try {
    EngineManager::resumeActive();
    echo '[' . date('H:i:s') . "] Bots ativos retomados\n";
} catch (Throwable $e) {
    echo 'Aviso resume: ' . $e->getMessage() . "\n";
}

$lastCmd = 0;
$lastFeedCheck = 0;
while (true) {
    if ($maxSeconds > 0 && (microtime(true) - $startedAt) >= $maxSeconds) {
        echo '[' . date('H:i:s') . "] worker encerrando (WORKER_MAX_SECONDS=$maxSeconds) — cron reinicia em seguida\n";
        break;
    }

    // renova pid (caso outro processo sobrescreva)
    @file_put_contents($pidFile, (string) getmypid());

    $now = microtime(true);
    if ($now - $lastCmd >= 0.5) {
        $lastCmd = $now;
        try {
            EngineManager::processCommands();
        } catch (Throwable $e) {
            log_msg('commands: ' . $e->getMessage(), 'bot');
        }
    }
    // re-sobe o feed WS se morrer (a cada ~15s)
    if ($now - $lastFeedCheck >= 15) {
        $lastFeedCheck = $now;
        try {
            BacBoWsFeed::ensureRunning();
        } catch (Throwable) {
        }
    }
    try {
        EngineManager::tickAll();
    } catch (Throwable $e) {
        log_msg('tick: ' . $e->getMessage(), 'bot');
    }
    usleep(250_000); // 250ms — paridade com poll Node
}
