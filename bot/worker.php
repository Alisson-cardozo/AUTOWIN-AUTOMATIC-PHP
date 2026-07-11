<?php

declare(strict_types=1);

/**
 * Worker longo de bots — rode em paralelo ao servidor web:
 *   php bot/worker.php
 *
 * Também pode ser iniciado automaticamente pelo painel (BotWorker::ensureRunning).
 */

require dirname(__DIR__) . '/vendor/autoload.php';

use App\Bootstrap;
use App\Bot\EngineManager;
use App\Services\BacBoWsFeed;

Bootstrap::init();

$pidFile = storage_path('bot-worker.pid');
@file_put_contents($pidFile, (string) getmypid());

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
