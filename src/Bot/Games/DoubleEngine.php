<?php

declare(strict_types=1);

namespace App\Bot\Games;

use App\Bot\Blaze\BlazeAPI;
use App\Bot\Blaze\BlazePoller;
use App\Bot\Jonbet\JonbetAPI;
use App\Bot\Jonbet\JonbetPoller;
use App\Database;
use App\Models\ConfigRepository;
use App\Models\UserRepository;
use App\Services\BotCommandService;
use App\Services\TelegramBridge;

/**
 * Motor Double (Blaze/Jonbet) — port fiel da lógica principal de bot/games/double.ts
 */
final class DoubleEngine
{
    private const COLOR_MAP = [0 => 'BRANCO', 1 => 'VERMELHO', 2 => 'PRETO'];
    private const COLOR_ID = ['VERMELHO' => 1, 'VERDE' => 1, 'PRETO' => 2, 'BRANCO' => 0];
    private const COOLDOWN_ROUNDS = 2;

    private BlazeAPI|JonbetAPI $api;
    private BlazePoller|JonbetPoller $ws;
    private int $userId;
    private string $platform;
    private bool $isDemo;
    private bool $forceReset;
    private bool $running = false;
    private array $history = [];
    private int $liveRoundsCount = 0;
    private int $cooldownRoundsRemaining = self::COOLDOWN_ROUNDS;
    private int $currentGale = 0;
    private float $currentBetAmount = 0;
    private float $currentProtectionAmount = 0;
    private int $cycleCount = 0;
    private float $cycleBaseAmount = 0;
    private float $simulatedBalance = 1000;
    private string $lastMatchedPattern = '';
    private bool $skipNextBet = false;
    private bool $sfeObserving = false;
    private bool $sfeReady = false;
    private string $sfeColor = '';
    private string $sfePattern = '';
    private bool $sfeSimulateGales = false;
    private int $sfeVirtualGaleCount = 0;
    private int $sfeMaxGale = 0;
    private string $currentSignalColor = '';
    private string $currentSignalPattern = '';
    private float $peakProfit = 0;
    private bool $betInFlight = false;
    private bool $pendingStop = false;
    private ?array $cachedSettings = null;
    private ?array $cachedStrategies = null;
    private float $lastKeepAlive = 0;
    private float $lastHorarioCheck = 0;
    private string $lastHorarioMinute = '';

    // ── Telegram / COPIAR SALA DE SINAL ──────────────────────────
    private ?string $pendingTelegramSignal = null;
    private int $lastTgMsgId = 0;
    private bool $tgCursorSeeded = false;
    private float $lastTgPoll = 0;
    private bool $tgWaitActive = false;
    private float $tgWaitUntil = 0;
    private bool $tgAnnounced = false;
    private ?string $tgSession = null;
    private ?string $tgGroupId = null;
    private array $tgKeywords = [];
    private ?string $tgSignalKeyword = null;
    private bool $tgSignalKeywordVerified = false;
    private bool $tgConfigured = false;

    public function __construct(
        int $userId,
        BlazeAPI|JonbetAPI $api,
        bool $isDemo = false,
        string $platform = 'BLAZE',
        bool $forceReset = false
    ) {
        $this->userId = $userId;
        $this->api = $api;
        $this->isDemo = $isDemo;
        $this->platform = $platform;
        $this->forceReset = $forceReset;
        if ($platform === 'JONBET') {
            $this->ws = new JonbetPoller('double_v2', fn () => $this->api->getToken());
            $this->ws->on('waiting', fn () => $this->onWaiting());
            $this->ws->on('complete', fn (array $d) => $this->onResult($d));
        } else {
            $this->ws = new BlazePoller('double_v2');
            $this->ws->onWaiting = fn () => $this->onWaiting();
            $this->ws->onComplete = fn (array $d) => $this->onResult($d);
        }
    }

    public function start(): void
    {
        $this->running = true;
        $this->syncBalance();
        $this->initVariables();
        $this->preloadHistory();
        $this->cachedSettings = $this->getSettings();
        $this->cachedStrategies = $this->loadStrategies();
        $this->loadTelegramConfig();
        $this->ws->connect();
        $stype = (string) ($this->cachedSettings['strategyType'] ?? 'SEQUÊNCIA');
        // SYSTEM / BRANQUINHO removidos do produto — trata como SEQUÊNCIA
        if ($stype === 'SYSTEM' || $stype === 'BRANQUINHO DO AUTOWIN') {
            $stype = 'SEQUÊNCIA';
            $this->cachedSettings['strategyType'] = 'SEQUÊNCIA';
            try {
                Database::update($this->settingsTable(), ['strategyType' => 'SEQUÊNCIA'], 'ownerId = :oid', ['oid' => $this->userId]);
            } catch (\Throwable) {
            }
        }
        $this->msg('🟢 Bot Double iniciado (' . $this->platform . ') — modo ' . ($this->isDemo ? 'DEMO' : 'REAL') . ' · estratégia ' . $stype);
        if ($stype === 'COPIAR SALA DE SINAL') {
            if ($this->platform === 'JONBET') {
                $this->msg('⚠️ COPIAR SALA DE SINAL não é suportado na Jonbet.');
            } elseif ($this->tgConfigured) {
                $this->msg('📡 Telegram conectado — aguardando sinais do grupo...');
                $this->tgAnnounced = true;
            } else {
                $this->msg('⚠️ Estratégia COPIAR SALA: Telegram não configurado (conecte o grupo em Estratégias).');
            }
        } elseif ($stype === 'SEQUÊNCIA') {
            $n = count(array_filter(
                $this->cachedStrategies ?? [],
                static fn ($s) => (($s['strategyType'] ?? 'SEQUÊNCIA') === 'SEQUÊNCIA' || ($s['strategyType'] ?? '') === '')
            ));
            $this->msg($n > 0 ? "📋 {$n} sequência(s) carregada(s)." : '⚠️ Nenhuma sequência cadastrada em Estratégias.');
        }
    }

    public function stop(): void
    {
        $this->running = false;
        $this->ws->disconnect();
        $this->tgWaitActive = false;
        $this->pendingTelegramSignal = null;
    }

    public function requestStop(): bool
    {
        if ($this->betInFlight) {
            $this->pendingStop = true;
            $this->msg('⏸️ Estou no meio de uma entrada — assim que sair o resultado (WIN ou LOSS), vou parar o sistema e todas as operações.');
            return false;
        }
        $this->stop();
        return true;
    }

    public function isPendingStop(): bool
    {
        return $this->pendingStop;
    }

    public function isRunning(): bool
    {
        return $this->running;
    }

    public function refreshCache(): void
    {
        $this->cachedSettings = $this->getSettings();
        $this->cachedStrategies = $this->loadStrategies();
        $this->loadTelegramConfig();
    }

    public function tick(): void
    {
        if (!$this->running) {
            return;
        }
        if ($this->ws instanceof JonbetPoller) {
            $this->ws->tick();
        } else {
            $this->ws->tick($this->api);
        }
        $now = microtime(true);
        if (!$this->isDemo && $now - $this->lastKeepAlive > 20) {
            $this->lastKeepAlive = $now;
            try {
                $this->api->getWallet();
            } catch (\Throwable) {
            }
        }
        if ($now - $this->lastHorarioCheck > 1) {
            $this->lastHorarioCheck = $now;
            $this->checkHorario();
        }

        // Poll Telegram para COPIAR SALA DE SINAL (~a cada 1.5s)
        $stype = (string) (($this->cachedSettings ?? $this->getSettings())['strategyType'] ?? '');
        if ($stype === 'COPIAR SALA DE SINAL' && $this->platform !== 'JONBET') {
            if (!$this->tgConfigured) {
                $this->loadTelegramConfig();
            }
            if ($this->tgConfigured && $now - $this->lastTgPoll >= 1.5) {
                $this->lastTgPoll = $now;
                $this->pollTelegramSignals();
            }
            // Janela de espera aberta: se chegou sinal, re-dispara onWaiting
            if ($this->tgWaitActive) {
                if ($this->pendingTelegramSignal) {
                    $this->tgWaitActive = false;
                    $this->onWaiting();
                } elseif ($now >= $this->tgWaitUntil) {
                    $this->tgWaitActive = false;
                }
            }
        }
    }

    private function pf(string $field): string
    {
        if ($this->platform !== 'JONBET') {
            return $field;
        }
        return 'jonbet' . ucfirst($field);
    }

    private function settingsTable(): string
    {
        return $this->platform === 'JONBET' ? 'jonbet_settings' : 'settings';
    }

    private function variablesTable(): string
    {
        return $this->platform === 'JONBET' ? 'jonbet_variables' : 'variables';
    }

    private function displayColor(string $c): string
    {
        if ($this->platform === 'JONBET' && $c === 'VERMELHO') {
            return 'VERDE';
        }
        return $c;
    }

    private function msg(string $m): void
    {
        $strategyType = (string) ($this->cachedSettings['strategyType'] ?? 'SEQUÊNCIA');
        BotCommandService::pushMessage($this->userId, $m, $this->platform, $strategyType);
        log_msg("[double:{$this->userId}] $m", 'bot');
    }

    private function getSettings(): ?array
    {
        return Database::fetch('SELECT * FROM `' . $this->settingsTable() . '` WHERE ownerId = ?', [$this->userId]);
    }

    private function getVariables(): ?array
    {
        return Database::fetch('SELECT * FROM `' . $this->variablesTable() . '` WHERE ownerId = ?', [$this->userId]);
    }

    private function loadStrategies(): array
    {
        return Database::fetchAll(
            "SELECT * FROM strategies WHERE ownerId = ? AND gameType = 'DOUBLE' AND platform = ?",
            [$this->userId, $this->platform]
        );
    }

    private function preloadHistory(): void
    {
        $rows = Database::fetchAll(
            "SELECT blazeId, color, roll, createdAt FROM game_results WHERE gameType = 'DOUBLE' AND platform = ? AND roll IS NOT NULL ORDER BY id DESC LIMIT 14",
            [$this->platform]
        );
        $this->history = [];
        foreach ($rows as $r) {
            $this->history[] = [
                'id' => $r['blazeId'] ?? (string) $r['color'],
                'color' => (int) $r['color'],
                'roll' => (int) $r['roll'],
                'status' => 'complete',
            ];
        }
    }

    private function initVariables(): void
    {
        $vars = $this->getVariables();
        if (!$vars) {
            return;
        }
        $mode = $this->isDemo ? 'DEMO' : 'REAL';
        $today = date('Y-m-d');
        $lastDate = $vars['firstBalanceDate'] ? date('Y-m-d', strtotime((string) $vars['firstBalanceDate'])) : null;
        $newDay = $lastDate !== $today;
        $modeChanged = ($vars['firstBalanceMode'] ?? null) !== $mode;

        if ($this->forceReset || $newDay || $modeChanged) {
            $balance = $this->syncBalance();
            // Zera painel da sessão; mantém relatório mensal (salvo virada de mês)
            \App\Bot\BotEntryLogger::resetSessionCounters($this->variablesTable(), $this->userId, $balance);
            Database::update($this->variablesTable(), [
                'firstBalanceMode' => $mode,
            ], 'ownerId = :oid', ['oid' => $this->userId]);
            if ($this->forceReset) {
                $this->msg('💰 Sessão reiniciada — vitórias/derrotas do painel zeradas (relatório do mês mantido)');
            }
        }
    }

    private function syncBalance(): float
    {
        if ($this->isDemo) {
            Database::update($this->variablesTable(), ['balance' => $this->simulatedBalance], 'ownerId = :oid', ['oid' => $this->userId]);
            return $this->simulatedBalance;
        }
        try {
            $wallet = $this->api->getWallet();
            $bal = $this->api->extractBalance($wallet);
            Database::update($this->variablesTable(), ['balance' => $bal], 'ownerId = :oid', ['oid' => $this->userId]);
            return $bal;
        } catch (\Throwable) {
            $v = $this->getVariables();
            return (float) ($v['balance'] ?? 0);
        }
    }

    private function onWaiting(): void
    {
        if (!$this->running) {
            return;
        }
        if ($this->liveRoundsCount < 1) {
            return;
        }
        if ($this->cooldownRoundsRemaining > 0) {
            return;
        }

        $this->currentProtectionAmount = 0;
        $user = UserRepository::findWithRelations($this->userId);
        if (!$user) {
            return;
        }
        $settings = $this->platform === 'JONBET' ? ($user['jonbetSettings'] ?? null) : ($user['settings'] ?? null);
        $vars = $this->platform === 'JONBET' ? ($user['jonbetVariables'] ?? null) : ($user['variables'] ?? null);
        if (!$settings || !$vars) {
            return;
        }

        if ($this->licenseExpired($user)) {
            $this->msg('⛔ Licença expirada — bot parado.');
            $this->stop();
            UserRepository::update($this->userId, [$this->pf('isActive') => 0]);
            return;
        }

        $inGale = !empty($vars['isGale']) && !empty($user[$this->pf('colorBefore')]);
        if ($this->skipNextBet && !$inGale) {
            $this->skipNextBet = false;
            return;
        }

        if ($inGale) {
            $signal = (string) $user[$this->pf('colorBefore')];
        } elseif ($this->sfeObserving) {
            return;
        } elseif ($this->sfeReady) {
            $signal = $this->sfeColor;
            $this->sfeReady = false;
            $this->lastMatchedPattern = $this->sfePattern;
        } else {
            $signal = $this->detectSignal($settings);
            // COPIAR SALA: sem sinal pronto → abre janela de 7s e sai
            if (!$signal && ($settings['strategyType'] ?? '') === 'COPIAR SALA DE SINAL') {
                if (!$this->tgWaitActive) {
                    $this->tgWaitActive = true;
                    $this->tgWaitUntil = microtime(true) + 7.0;
                    // poll imediato
                    $this->pollTelegramSignals();
                    if ($this->pendingTelegramSignal) {
                        $signal = $this->pendingTelegramSignal;
                        $this->pendingTelegramSignal = null;
                        $this->lastMatchedPattern = 'Telegram';
                        $this->tgWaitActive = false;
                    } else {
                        return;
                    }
                } else {
                    return;
                }
            }
            if (!$signal) {
                return;
            }
            if (!empty($settings['skipFirstEntry'])) {
                $this->sfeObserving = true;
                $this->sfeSimulateGales = false;
                $this->sfeColor = $signal;
                $this->sfePattern = $this->lastMatchedPattern;
                $this->msg("🔍 Sinal: *{$this->displayColor($signal)}* | 📋 {$this->lastMatchedPattern}\n⏳ Aguardando 1ª rodada...");
                return;
            }
            if (!empty($settings['skipEntryAfterLoss'])) {
                $usesWhiteGale = !empty($settings['whiteEntryGaleEnabled']) && $signal === 'BRANCO';
                $this->sfeObserving = true;
                $this->sfeSimulateGales = true;
                $this->sfeVirtualGaleCount = 0;
                $this->sfeMaxGale = $usesWhiteGale ? (int) $settings['whiteEntryGale'] : (int) $settings['martingale'];
                $this->sfeColor = $signal;
                $this->sfePattern = $this->lastMatchedPattern;
                $this->msg("🔍 Sinal: *{$this->displayColor($signal)}* | 📋 {$this->lastMatchedPattern}\n⏳ Simulando gale antes de confirmar...");
                return;
            }
        }

        $amount = $this->calcBetAmount($settings, $signal, $vars);
        if ($amount <= 0) {
            return;
        }
        $this->currentBetAmount = $amount;

        $baseProt = (float) ($settings['protectionValue'] ?? 0);
        $rawProt = ($settings['protectionHand'] ?? 'NÃO') === 'SIM' && $baseProt > 0 && $signal !== 'BRANCO';
        $protAmount = $rawProt
            ? round($baseProt * pow((float) ($settings['whiteMultiplier'] ?? 1), $this->currentGale), 2)
            : 0.0;
        $hasProt = $rawProt && $protAmount >= 0.1;
        $this->currentProtectionAmount = $hasProt ? $protAmount : 0;

        $galeNum = (int) $vars['countMartingale'];
        $usesWhiteGale = !empty($settings['whiteEntryGaleEnabled']) && $signal === 'BRANCO';
        $maxGale = $usesWhiteGale ? (int) $settings['whiteEntryGale'] : (int) $settings['martingale'];
        $protText = $hasProt ? ' + 🛡️ BRANCO R$ ' . number_format($protAmount, 2, '.', '') : '';

        // Marca entrada ANTES da API (stop/pendingStop e botão bloqueado no painel)
        $this->betInFlight = true;
        UserRepository::update($this->userId, [
            $this->pf('isBetting') => 1,
            $this->pf('colorBet') => $signal,
        ]);

        try {
            if (!$this->isDemo) {
                $this->api->betDouble(self::COLOR_ID[$signal] ?? 1, $amount);
                if ($hasProt) {
                    try {
                        $this->api->betDouble(0, $protAmount);
                    } catch (\Throwable $e) {
                        log_msg('[double] proteção falhou: ' . $e->getMessage(), 'bot');
                    }
                }
            }
            $this->currentSignalColor = $signal;
            $this->currentSignalPattern = $this->lastMatchedPattern;
            if ($inGale) {
                $this->msg("🔄 Gale {$galeNum}/{$maxGale}: *{$this->displayColor($signal)}* — R$ " . number_format($amount, 2, '.', '') . $protText . " | 📋 {$this->lastMatchedPattern}");
            } else {
                $this->msg("🎯 Entrando: *{$this->displayColor($signal)}* — R$ " . number_format($amount, 2, '.', '') . $protText . " | 📋 {$this->lastMatchedPattern}");
            }
        } catch (\Throwable $e) {
            $this->betInFlight = false;
            UserRepository::update($this->userId, [
                $this->pf('isBetting') => 0,
                $this->pf('colorBet') => null,
            ]);
            $this->msg('⚠️ Erro na aposta: ' . $e->getMessage());
            if (str_contains($e->getMessage(), '1005')) {
                $this->msg('⚠️ Saldo insuficiente — bot parado.');
                $this->stop();
                UserRepository::update($this->userId, [$this->pf('isActive') => 0]);
            }
        }
    }

    private function onResult(array $data): void
    {
        $this->liveRoundsCount++;
        if ($this->cooldownRoundsRemaining > 0) {
            $this->cooldownRoundsRemaining--;
        }
        array_unshift($this->history, $data);
        if (count($this->history) > 14) {
            array_pop($this->history);
        }

        // grava game_results
        try {
            Database::insert('game_results', [
                'blazeId' => (string) ($data['id'] ?? ''),
                'gameType' => 'DOUBLE',
                'platform' => $this->platform,
                'color' => (string) ($data['color'] ?? ''),
                'roll' => isset($data['roll']) ? (int) $data['roll'] : null,
                'createdAt' => now(),
            ]);
        } catch (\Throwable) {
        }

        $resultColor = self::COLOR_MAP[(int) ($data['color'] ?? -1)] ?? 'PRETO';

        if ($this->sfeObserving) {
            $settings = $this->cachedSettings ?? $this->getSettings();
            $protectionActive = ($settings['protectionHand'] ?? '') === 'SIM'
                && (float) ($settings['protectionValue'] ?? 0) > 0
                && $this->sfeColor !== 'BRANCO';
            $wouldWin = $resultColor === $this->sfeColor || ($resultColor === 'BRANCO' && $protectionActive);
            if ($wouldWin) {
                $this->sfeObserving = false;
                $this->sfeSimulateGales = false;
                $this->msg("⚠️ Observação: saiu {$this->displayColor($resultColor)} ✅ — resetando");
                $this->logEntry('OBS_WIN', $this->sfeColor, $resultColor, $this->sfePattern);
                $this->sfeColor = '';
            } elseif (!$this->sfeSimulateGales) {
                $this->sfeObserving = false;
                $this->msg("✅ Observação: saiu {$this->displayColor($resultColor)} — entrando na próxima");
                $this->logEntry('OBS_LOSS', $this->sfeColor, $resultColor, $this->sfePattern);
                $this->sfeReady = true;
            } else {
                $this->sfeVirtualGaleCount++;
                if ($this->sfeVirtualGaleCount <= $this->sfeMaxGale) {
                    $this->msg("🔍 Observação: gale virtual {$this->sfeVirtualGaleCount}/{$this->sfeMaxGale}");
                } else {
                    $this->sfeObserving = false;
                    $this->sfeSimulateGales = false;
                    $this->msg('✅ Observação: sequência de gale perderia — entrando na próxima');
                    $this->logEntry('OBS_LOSS', $this->sfeColor, $resultColor, $this->sfePattern);
                    $this->sfeReady = true;
                }
            }
            return;
        }

        $user = UserRepository::find($this->userId);
        if (!$user) {
            return;
        }
        $betColor = $user[$this->pf('colorBet')] ?? null;
        $isBetting = !empty($user[$this->pf('isBetting')]);
        if (!$betColor || !$isBetting) {
            return;
        }

        $settings = $this->getSettings();
        $vars = $this->getVariables();
        if (!$settings || !$vars) {
            return;
        }

        $hasProtectionHit = $resultColor === 'BRANCO' && $this->currentProtectionAmount > 0;
        $won = $betColor === $resultColor || $hasProtectionHit;

        UserRepository::update($this->userId, [
            $this->pf('isBetting') => 0,
            $this->pf('colorBefore') => $betColor,
        ]);
        $this->betInFlight = false;

        if ($this->isDemo) {
            $pv = (($settings['protectionHand'] ?? '') === 'SIM' && $betColor !== 'BRANCO')
                ? $this->currentProtectionAmount : 0;
            if ($won) {
                if ($resultColor === 'BRANCO' && $betColor !== 'BRANCO') {
                    $this->simulatedBalance += $pv * 13 - $this->currentBetAmount;
                } elseif ($resultColor === 'BRANCO' && $betColor === 'BRANCO') {
                    $this->simulatedBalance += $this->currentBetAmount * 13;
                } else {
                    $this->simulatedBalance += $this->currentBetAmount - $pv;
                }
            } else {
                $this->simulatedBalance -= $this->currentBetAmount + $pv;
            }
        }

        if ($won) {
            $patternMissed = $betColor !== $resultColor;
            $profit = $this->handleWin($settings, $vars, $resultColor, $patternMissed);
            $this->cooldownRoundsRemaining = self::COOLDOWN_ROUNDS;
            $this->checkStop($settings, array_merge($vars, ['profit' => $profit]));
        } else {
            $res = $this->handleLoss($settings, $vars, $resultColor);
            if ($res['exhausted']) {
                $this->cooldownRoundsRemaining = self::COOLDOWN_ROUNDS;
                $this->checkStop($settings, array_merge($vars, ['profit' => $res['newProfit']]));
            }
        }

        if ($this->pendingStop) {
            $this->pendingStop = false;
            $this->stop();
            UserRepository::update($this->userId, [
                $this->pf('isActive') => 0,
                $this->pf('isBetting') => 0,
            ]);
            $this->msg('⏹️ Entrada finalizada — parando o robô.');
            return;
        }
        $this->refreshCache();
    }

    private function handleWin(array $settings, array $vars, string $resultColor, bool $patternMissed): float
    {
        $this->currentGale = 0;
        $this->cycleCount = 0;
        $this->cycleBaseAmount = 0;
        $this->sfeReady = false;
        $this->sfeObserving = false;
        $this->skipNextBet = true;
        usleep(500_000);
        $newBalance = $this->syncBalance();
        $profit = $newBalance - (float) $vars['firstBalance'];
        Database::update($this->variablesTable(), [
            'countWin' => (int) $vars['countWin'] + 1,
            'monthCountWin' => (int) $vars['monthCountWin'] + 1,
            'countMartingale' => 0,
            'isGale' => 0,
            'lastCycleWasLoss' => $patternMissed ? 1 : 0,
            'profit' => $profit,
            'balance' => $newBalance,
        ], 'ownerId = :oid', ['oid' => $this->userId]);
        $this->peakProfit = max($this->peakProfit, $profit);
        $this->msg("✅ *WIN* — {$this->displayColor($resultColor)}\nLucro: R$ " . number_format($profit, 2, '.', '') . "\nBanca: R$ " . number_format($newBalance, 2, '.', ''));
        // Lucro da rodada (não o acumulado da sessão) — relatório mensal
        $roundProfit = round($newBalance - (float) ($vars['balance'] ?? $newBalance), 2);
        if (abs($roundProfit) < 0.001) {
            $roundProfit = $this->currentBetAmount; // fallback 1:1
        }
        $this->logEntry('WIN', $this->currentSignalColor, $resultColor, $this->currentSignalPattern, $this->currentBetAmount, $roundProfit, (int) $vars['countMartingale']);
        return $profit;
    }

    private function handleLoss(array $settings, array $vars, string $resultColor): array
    {
        $usesWhiteGale = !empty($settings['whiteEntryGaleEnabled']) && $this->currentSignalColor === 'BRANCO';
        $maxGale = $usesWhiteGale ? (int) ($settings['whiteEntryGale'] ?? $settings['martingale']) : (int) $settings['martingale'];
        $newMartingale = (int) $vars['countMartingale'] + 1;
        $newBalance = $this->syncBalance();
        $profit = $newBalance - (float) $vars['firstBalance'];

        if ($newMartingale <= $maxGale) {
            $this->currentGale = $newMartingale;
            Database::update($this->variablesTable(), [
                'countMartingale' => $newMartingale,
                'isGale' => 1,
                'profit' => $profit,
                'balance' => $newBalance,
            ], 'ownerId = :oid', ['oid' => $this->userId]);
            $roundProfit = round($newBalance - (float) ($vars['balance'] ?? $newBalance), 2);
            if (abs($roundProfit) < 0.001) {
                $roundProfit = -$this->currentBetAmount;
            }
            $this->msg("❌ *LOSS* — {$this->displayColor($resultColor)} | Gale {$newMartingale}/{$maxGale}\nLucro: R$ " . number_format($profit, 2, '.', ''));
            $this->logEntry('GALE', $this->currentSignalColor, $resultColor, $this->currentSignalPattern, $this->currentBetAmount, $roundProfit, $newMartingale);
            return ['exhausted' => false, 'newProfit' => $profit];
        }

        $this->cycleCount++;
        $this->currentGale = 0;
        $this->skipNextBet = true;
        Database::update($this->variablesTable(), [
            'countLoss' => (int) $vars['countLoss'] + 1,
            'monthCountLoss' => (int) $vars['monthCountLoss'] + 1,
            'countMartingale' => 0,
            'isGale' => 0,
            'lastCycleWasLoss' => 1,
            'profit' => $profit,
            'balance' => $newBalance,
        ], 'ownerId = :oid', ['oid' => $this->userId]);

        $roundProfit = round($newBalance - (float) ($vars['balance'] ?? $newBalance), 2);
        if (abs($roundProfit) < 0.001) {
            $roundProfit = -$this->currentBetAmount;
        }

        $qty = (int) ($settings['quantityCycles'] ?? 1);
        if ($this->cycleCount < $qty) {
            $this->cycleBaseAmount = $this->currentBetAmount;
            $this->msg("❌ *LOSS* — gales esgotados · ciclo " . ($this->cycleCount + 1) . "/{$qty}");
            $this->logEntry('LOSS', $this->currentSignalColor, $resultColor, $this->currentSignalPattern, $this->currentBetAmount, $roundProfit, $newMartingale);
            return ['exhausted' => false, 'newProfit' => $profit];
        }
        $this->cycleCount = 0;
        $this->cycleBaseAmount = 0;
        $this->msg("❌ *LOSS* — {$this->displayColor($resultColor)} | Gales esgotados\nLucro: R$ " . number_format($profit, 2, '.', ''));
        $this->logEntry('LOSS', $this->currentSignalColor, $resultColor, $this->currentSignalPattern, $this->currentBetAmount, $roundProfit, $newMartingale);
        return ['exhausted' => true, 'newProfit' => $profit];
    }

    private function checkStop(array $settings, array $variables): void
    {
        $stopGain = (float) $settings['stopGain'];
        $stopLoss = (float) $settings['stopLoss'];
        $stopped = false;
        if (($settings['stopType'] ?? 'VALOR') === 'VALOR') {
            if ($variables['profit'] >= $stopGain && $stopGain > 0) {
                $this->msg('🏆 *STOP WIN* atingido!');
                $stopped = true;
            } else {
                $threshold = $this->peakProfit - $stopLoss;
                if ($stopLoss > 0 && $variables['profit'] <= $threshold) {
                    $this->msg('🛑 *STOP LOSS* atingido!');
                    $stopped = true;
                }
            }
        } else {
            if ($variables['countWin'] >= $stopGain) {
                $this->msg('🏆 *STOP WIN* (quantidade)!');
                $stopped = true;
            } elseif ($variables['countLoss'] >= $stopLoss) {
                $this->msg('🛑 *STOP LOSS* (quantidade)!');
                $stopped = true;
            }
        }
        if ($stopped) {
            $this->stop();
            UserRepository::update($this->userId, [$this->pf('isActive') => 0]);
        }
    }

    private function calcBetAmount(array $settings, string $signal, array $vars): float
    {
        $mult = (float) ($settings['martingaleMultiplier'] ?? 2);
        if (!empty($settings['whiteEntryGaleEnabled']) && $signal === 'BRANCO') {
            $mult = (float) ($settings['whiteEntryGaleMultiplier'] ?? $mult);
        }
        $base = 0.0;
        if ($this->cycleBaseAmount > 0) {
            $base = $this->cycleBaseAmount;
        } elseif (($settings['enterType'] ?? 'VALOR') === 'PORCENTAGEM') {
            $base = ((float) $vars['balance'] * (float) $settings['enterPercent']) / 100;
        } else {
            $base = (float) $settings['enterValue'];
            if ($signal === 'BRANCO' && (float) ($settings['whiteEntryValue'] ?? 0) > 0) {
                $base = (float) $settings['whiteEntryValue'];
            }
        }
        $gale = (int) ($vars['countMartingale'] ?? 0);
        return round($base * pow($mult, $gale), 2);
    }

    private function detectSignal(array $settings): ?string
    {
        if (count($this->history) < 1) {
            return null;
        }
        $type = $settings['strategyType'] ?? 'SEQUÊNCIA';
        if ($type === 'SYSTEM' || $type === 'BRANQUINHO DO AUTOWIN') {
            $type = 'SEQUÊNCIA';
        }
        $lastColors = array_map(fn ($h) => self::COLOR_MAP[(int) ($h['color'] ?? -1)] ?? 'PRETO', array_slice($this->history, 0, 14));

        if ($type === 'SEQUÊNCIA') {
            $hit = $this->matchSequenceStrategies(
                array_filter($this->cachedStrategies ?? $this->loadStrategies(), function ($s) {
                    $t = $s['strategyType'] ?? 'SEQUÊNCIA';
                    return $t === 'SEQUÊNCIA' || $t === '';
                }),
                $lastColors
            );
            if ($hit) {
                return $hit;
            }
        }

        if ($type === 'CORES' || $type === 'INVERTIDO') {
            // fallback simples: repete/inverte última cor
            $last = $lastColors[0] ?? null;
            if (!$last || $last === 'BRANCO') {
                return null;
            }
            $this->lastMatchedPattern = $type . ':' . $last;
            if ($type === 'INVERTIDO') {
                return $last === 'VERMELHO' ? 'PRETO' : 'VERMELHO';
            }
            return $last;
        }

        // NÚMEROS
        if ($type === 'NÚMEROS') {
            $strategies = array_filter(
                $this->cachedStrategies ?? $this->loadStrategies(),
                fn ($s) => ($s['strategyType'] ?? '') === 'NÚMEROS'
            );
            foreach ($strategies as $strategy) {
                $items = array_map('trim', explode(',', (string) $strategy['sequence']));
                if (count($items) > count($this->history)) {
                    continue;
                }
                $match = true;
                foreach ($items as $idx => $item) {
                    $result = $this->history[count($items) - 1 - $idx] ?? null;
                    if (!$result) {
                        $match = false;
                        break;
                    }
                    if ($item === 'X') {
                        continue;
                    }
                    if (preg_match('/^\d+$/', $item)) {
                        if ((int) ($result['roll'] ?? -1) !== (int) $item) {
                            $match = false;
                            break;
                        }
                    } elseif (($lastColors[count($items) - 1 - $idx] ?? null) !== strtoupper($item)) {
                        $match = false;
                        break;
                    }
                }
                if ($match) {
                    $this->lastMatchedPattern = $strategy['sequence'];
                    return strtoupper((string) $strategy['color']);
                }
            }
            return null;
        }

        // COPIAR SALA DE SINAL — consome sinal pendente do poll Telegram
        if ($type === 'COPIAR SALA DE SINAL') {
            if ($this->pendingTelegramSignal) {
                $color = $this->pendingTelegramSignal;
                $this->pendingTelegramSignal = null;
                $this->lastMatchedPattern = 'Telegram';
                return $color;
            }
            return null;
        }

        // HORÁRIO é armado em checkHorario
        return null;
    }

    /**
     * @param  list<array<string,mixed>>  $strategies
     * @param  list<string>  $lastColors  [0]=mais recente
     */
    private function matchSequenceStrategies(array $strategies, array $lastColors): ?string
    {
        foreach ($strategies as $strategy) {
            $seq = array_map(fn ($s) => strtoupper(trim($s)), explode(',', (string) $strategy['sequence']));
            if (count($seq) > count($lastColors)) {
                continue;
            }
            $match = true;
            foreach ($seq as $idx => $color) {
                if ($color === 'X') {
                    continue;
                }
                // lastColors[0]=mais recente; seq[0]=mais antigo
                if (($lastColors[count($seq) - 1 - $idx] ?? null) !== $color) {
                    $match = false;
                    break;
                }
            }
            if ($match) {
                $this->lastMatchedPattern = (string) $strategy['sequence'];
                return strtoupper((string) $strategy['color']);
            }
        }
        return null;
    }

    // ── Telegram helpers ──────────────────────────────────────────

    private function loadTelegramConfig(): void
    {
        $this->tgConfigured = false;
        $this->tgSession = null;
        $this->tgGroupId = null;
        $this->tgKeywords = [];
        $this->tgSignalKeyword = null;
        $this->tgSignalKeywordVerified = false;

        if ($this->platform === 'JONBET') {
            return;
        }

        $row = Database::fetch(
            'SELECT session, groupId, keywords, signalKeyword, signalKeywordVerified, isConnected FROM telegram_userbots WHERE ownerId = ?',
            [$this->userId]
        );
        if (!$row || empty($row['isConnected']) || empty($row['session']) || empty($row['groupId'])) {
            return;
        }

        $this->tgSession = (string) $row['session'];
        $this->tgGroupId = (string) $row['groupId'];
        $this->tgSignalKeyword = !empty($row['signalKeyword']) ? (string) $row['signalKeyword'] : null;
        $this->tgSignalKeywordVerified = !empty($row['signalKeywordVerified']);
        if (!empty($row['keywords'])) {
            $decoded = json_decode((string) $row['keywords'], true);
            $this->tgKeywords = is_array($decoded) ? $decoded : [];
        }
        $this->tgConfigured = true;
    }

    private function pollTelegramSignals(): void
    {
        if (!$this->tgConfigured || !$this->tgSession || !$this->tgGroupId) {
            return;
        }

        $apiId = (int) (ConfigRepository::get('TELEGRAM_API_ID', '0') ?: '0');
        $apiHash = (string) (ConfigRepository::get('TELEGRAM_API_HASH', '') ?? '');
        if ($apiId <= 0 || $apiHash === '') {
            return;
        }

        $result = TelegramBridge::call([
            'action' => 'poll-messages',
            'session' => $this->tgSession,
            'apiId' => $apiId,
            'apiHash' => $apiHash,
            'groupId' => $this->tgGroupId,
            'minId' => $this->lastTgMsgId,
            'limit' => 10,
        ]);

        if (empty($result['ok'])) {
            log_msg("[double:{$this->userId}] tg poll error: " . ($result['error'] ?? '?'), 'bot');
            return;
        }

        if (isset($result['authorized']) && $result['authorized'] === false) {
            log_msg("[double:{$this->userId}] sessão Telegram inválida — desconectando", 'bot');
            Database::update('telegram_userbots', ['isConnected' => 0], 'ownerId = :oid', ['oid' => $this->userId]);
            $this->tgConfigured = false;
            $this->msg('⚠️ Sessão do Telegram expirada. Reconecte em Estratégias.');
            return;
        }

        $messages = $result['messages'] ?? [];
        if (!is_array($messages)) {
            return;
        }

        // Primeira leitura: só marca o cursor no último id (ignora histórico)
        if (!$this->tgCursorSeeded) {
            $maxId = $this->lastTgMsgId;
            // poll com minId 0 filtra id>0 e devolve as últimas N → pega o max
            foreach ($messages as $m) {
                $id = (int) ($m['id'] ?? 0);
                if ($id > $maxId) {
                    $maxId = $id;
                }
            }
            // Se não veio nada (grupo vazio) ou filtro estranho, busca as últimas 8
            if ($maxId === 0) {
                $all = TelegramBridge::call([
                    'action' => 'fetch-messages',
                    'session' => $this->tgSession,
                    'apiId' => $apiId,
                    'apiHash' => $apiHash,
                    'groupId' => $this->tgGroupId,
                ]);
                if (!empty($all['ok']) && !empty($all['messages']) && is_array($all['messages'])) {
                    foreach ($all['messages'] as $m) {
                        $id = (int) ($m['id'] ?? 0);
                        if ($id > $maxId) {
                            $maxId = $id;
                        }
                    }
                }
            }
            $this->lastTgMsgId = $maxId;
            $this->tgCursorSeeded = true;
            log_msg("[double:{$this->userId}] tg cursor seed id={$this->lastTgMsgId}", 'bot');
            return;
        }

        foreach ($messages as $m) {
            $id = (int) ($m['id'] ?? 0);
            $text = (string) ($m['text'] ?? '');
            if ($id > $this->lastTgMsgId) {
                $this->lastTgMsgId = $id;
            }
            if ($text === '') {
                continue;
            }
            $this->processTelegramMessage($text);
        }
    }

    private function processTelegramMessage(string $msg): void
    {
        // Filtro: signalKeyword tem prioridade; fallback keywords
        if ($this->tgSignalKeyword) {
            $tpl = preg_replace('/VERMELHO|PRETO|BRANCO|VERDE|🔴|⚫|⬛|⚪|🟢/iu', '', $this->tgSignalKeyword) ?? '';
            $tpl = preg_replace('/\s+/', ' ', trim($tpl)) ?? '';
            if ($tpl !== '' && mb_stripos($msg, $tpl) === false) {
                return;
            }
        } elseif ($this->tgKeywords) {
            $hit = false;
            $low = mb_strtolower($msg);
            foreach ($this->tgKeywords as $kw) {
                if ($kw !== '' && str_contains($low, mb_strtolower((string) $kw))) {
                    $hit = true;
                    break;
                }
            }
            if (!$hit) {
                return;
            }
        }

        $color = null;
        if ($this->tgSignalKeyword) {
            $color = $this->extractColorFromSignalKeyword($this->tgSignalKeyword, $msg)
                ?? $this->extractColorFromMessage($msg);
        } else {
            $color = $this->extractColorFromMessage($msg);
        }

        if (!$color) {
            return;
        }

        // Calibração da mensagem-chave (primeira detecção não aposta)
        if ($this->tgSignalKeyword && !$this->tgSignalKeywordVerified) {
            $this->tgSignalKeywordVerified = true;
            try {
                Database::update(
                    'telegram_userbots',
                    ['signalKeywordVerified' => 1],
                    'ownerId = :oid',
                    ['oid' => $this->userId]
                );
            } catch (\Throwable) {
            }
            $this->msg("⚙️ *Calibração da Mensagem-Chave*\n✅ Cor detectada: *{$color}*\n\nMensagem-chave validada! A próxima entrada será realizada normalmente.");
            log_msg("[double:{$this->userId}] tg calibração OK cor={$color}", 'bot');
            return;
        }

        $this->pendingTelegramSignal = $color;
        log_msg("[double:{$this->userId}] tg SINAL PENDENTE: {$color} | " . mb_substr($msg, 0, 80), 'bot');
        if (!$this->tgAnnounced) {
            $this->msg("📡 Sinal Telegram capturado: *{$this->displayColor($color)}*");
        }
    }

    private function extractColorFromSignalKeyword(string $keyword, string $msg): ?string
    {
        $template = preg_replace('/VERMELHO|PRETO|BRANCO|VERDE|🔴|⚫|⬛|⚪|🟢/iu', '', $keyword) ?? '';
        $template = preg_replace('/\s+/', ' ', trim($template)) ?? '';
        if (mb_strlen($template) < 2) {
            return null;
        }
        $tplLow = mb_strtolower($template);
        foreach (preg_split('/\r\n|\n|\r/', $msg) ?: [] as $line) {
            if (!str_contains(mb_strtolower($line), $tplLow)) {
                continue;
            }
            $t = mb_strtoupper($line);
            if (str_contains($t, 'VERMELHO') || str_contains($line, '🔴')) {
                return 'VERMELHO';
            }
            if (str_contains($t, 'PRETO') || str_contains($line, '⚫') || str_contains($line, '⬛')) {
                return 'PRETO';
            }
            if (str_contains($t, 'BRANCO') || str_contains($line, '⚪')) {
                return 'BRANCO';
            }
            if (str_contains($t, 'VERDE') || str_contains($line, '🟢')) {
                return 'VERDE';
            }
        }
        return null;
    }

    private function extractColorFromMessage(string $msg): ?string
    {
        $text = mb_strtoupper($msg);
        $entryRe = '/ENTRADA|ENTRAR|APOSTAR|APOSTE|APOSTA|SINAL|SIGNAL|BET|JOGAR|JOGUE|COMPRA|COMPRE|CONFIRMA|CONFIRMADO|PREVISÃO|PREVISAO/u';

        if (!preg_match($entryRe, $text)) {
            return null;
        }

        $pickColor = static function (string $s): ?string {
            if (str_contains($s, 'VERMELHO') || str_contains($s, '🔴')) {
                return 'VERMELHO';
            }
            if (str_contains($s, 'PRETO') || str_contains($s, '⚫') || str_contains($s, '⬛')) {
                return 'PRETO';
            }
            if (str_contains($s, 'BRANCO') || str_contains($s, '⚪')) {
                return 'BRANCO';
            }
            return null;
        };

        foreach (preg_split('/\r\n|\n|\r/', $text) ?: [] as $line) {
            if (!preg_match($entryRe, $line)) {
                continue;
            }
            $c = $pickColor($line);
            if ($c) {
                return $c;
            }
        }

        if (preg_match('/(?:ENTRADA|ENTRAR|APOSTAR|APOSTE|SINAL|BET|CONFIRMA|CONFIRMADO).{0,40}?(VERMELHO|PRETO|BRANCO|🔴|⚫|⬛|⚪)/u', $text, $m)) {
            return $pickColor($m[1]);
        }

        return null;
    }

    private function checkHorario(): void
    {
        if (!$this->running) {
            return;
        }
        $settings = $this->cachedSettings ?? $this->getSettings();
        if (($settings['strategyType'] ?? '') !== 'HORÁRIO' && ($settings['strategyType'] ?? '') !== 'HORÁRIOS') {
            return;
        }
        $minute = date('H:i');
        if ($minute === $this->lastHorarioMinute) {
            return;
        }
        $this->lastHorarioMinute = $minute;
        $strategies = $this->cachedStrategies ?? $this->loadStrategies();
        foreach ($strategies as $s) {
            $t = $s['strategyType'] ?? '';
            if ($t !== 'HORÁRIO' && $t !== 'HORÁRIOS' && !preg_match('/^\d{1,2}:\d{2}$/', trim((string) $s['sequence']))) {
                continue;
            }
            if (trim((string) $s['sequence']) === $minute) {
                $this->lastMatchedPattern = 'HORÁRIO ' . $minute;
                // força cor como colorBefore gale-like na próxima waiting via sfeReady
                $this->sfeReady = true;
                $this->sfeColor = strtoupper((string) $s['color']);
                $this->sfePattern = $this->lastMatchedPattern;
                $this->msg("⏰ Horário {$minute} — sinal *{$this->displayColor($this->sfeColor)}*");
                break;
            }
        }
    }

    private function licenseExpired(array $u): bool
    {
        if (!empty($u['isAdminAccount'])) {
            return false;
        }
        $expireOk = !empty($u['expireIn']) && strtotime((string) $u['expireIn']) > time();
        return !($expireOk && (($u['paymentStatus'] ?? '') === 'PAID' || !empty($u['isTesting'])));
    }

    private function logEntry(
        string $type,
        ?string $signal,
        ?string $result,
        ?string $pattern,
        ?float $bet = null,
        ?float $profit = null,
        ?int $gale = null
    ): void {
        \App\Bot\BotEntryLogger::log(
            $this->userId,
            $type,
            'DOUBLE',
            $this->platform,
            $signal,
            $result,
            $pattern,
            $bet,
            $profit,
            $gale
        );
    }
}
