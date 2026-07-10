<?php

declare(strict_types=1);

namespace App\Bot\Games;

use App\Bot\Blaze\BlazeAPI;
use App\Bot\Blaze\BlazePoller;
use App\Bot\Jonbet\JonbetAPI;
use App\Bot\Jonbet\JonbetPoller;
use App\Database;
use App\Models\UserRepository;
use App\Services\BotCommandService;

/**
 * Motor Crash — port do fluxo principal de bot/games/crash.ts
 * (mensagens no formato esperado pelo LogParser + gale + saldo REAL/DEMO).
 */
final class CrashEngine
{
    private const COOLDOWN_ROUNDS = 2;

    private BlazeAPI|JonbetAPI $api;
    private BlazePoller|JonbetPoller $ws;
    private int $userId;
    private string $platform;
    private bool $isDemo;
    private bool $forceReset;
    private bool $running = false;
    /** @var list<float> */
    private array $history = [];
    private int $liveRounds = 0;
    private int $cooldownRoundsRemaining = self::COOLDOWN_ROUNDS;
    private bool $betInFlight = false;
    private bool $pendingStop = false;
    private bool $skipNextBet = false;
    private float $currentBet = 0;
    private float $currentTarget = 2.0;
    private float $simulatedBalance = 1000;
    private string $lastPattern = '';
    private int $currentGale = 0;
    private string $strategyType = 'SEQUÊNCIA';
    private float $peakProfit = 0;
    private string $lastAttemptedRoundId = '';
    /** ID da rodada em que entramos (waiting) — só processamos o complete dessa. */
    private ?string $enteredRoundId = null;

    // Pular 1ª entrada / Entrada Após Loss (igual Double/original)
    private bool $sfeObserving = false;
    private bool $sfeReady = false;
    private bool $sfeSimulateGales = false;
    private int $sfeVirtualGaleCount = 0;
    private int $sfeMaxGale = 0;
    private float $sfeTarget = 0;
    private string $sfePattern = '';

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
            $this->ws = new JonbetPoller('crash_v2', fn () => $this->api->getToken());
            $this->ws->on('waiting', fn ($id = null) => $this->onWaiting(is_string($id) ? $id : null));
            $this->ws->on('complete', fn (array $d) => $this->onResult($d));
        } else {
            $this->ws = new BlazePoller('crash_v2');
            // BlazePoller passa $data no waiting — usamos o id da rodada
            $this->ws->onWaiting = function ($data = null) {
                $id = is_array($data) ? (string) ($data['id'] ?? '') : '';
                $this->onWaiting($id !== '' ? $id : null);
            };
            $this->ws->onComplete = fn (array $d) => $this->onResult($d);
        }
    }

    public function start(): void
    {
        $this->running = true;
        $this->syncBalance();
        $this->initVariables();
        $this->preloadHistory();
        $this->ws->connect();

        $settings = Database::fetch('SELECT * FROM `' . $this->settingsTable() . '` WHERE ownerId = ?', [$this->userId]);
        $stype = (string) ($settings['strategyType'] ?? 'SEQUÊNCIA');
        if ($stype === 'SYSTEM' || $stype === 'BRANQUINHO DO AUTOWIN') {
            $stype = 'SEQUÊNCIA';
            try {
                Database::update($this->settingsTable(), ['strategyType' => 'SEQUÊNCIA'], 'ownerId = :oid', ['oid' => $this->userId]);
            } catch (\Throwable) {
            }
        }
        $this->strategyType = $stype;
        $this->msg('🟢 Bot Crash iniciado (' . $this->platform . ') — modo ' . ($this->isDemo ? 'DEMO' : 'REAL') . ' · estratégia ' . $stype);
        $n = count($this->loadCrashStrategies($stype === '' ? 'SEQUÊNCIA' : $stype));
        $this->msg($n > 0 ? "📋 {$n} estratégia(s) Crash carregada(s)." : '⚠️ Nenhuma estratégia Crash cadastrada em Estratégias.');
    }

    public function stop(): void
    {
        $this->running = false;
        $this->ws->disconnect();
    }

    public function requestStop(): bool
    {
        if ($this->betInFlight) {
            $this->pendingStop = true;
            $this->msg('⏸️ Estou no meio de uma entrada — assim que sair o resultado (WIN ou LOSS), vou parar o sistema e todas as operações.');
            return false;
        }
        // também se está em observação, pode parar na hora
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
    }

    private function msg(string $m): void
    {
        BotCommandService::pushMessage($this->userId, $m, $this->platform, $this->strategyType);
        log_msg("[crash:{$this->userId}] $m", 'bot');
    }

    private function settingsTable(): string
    {
        return $this->platform === 'JONBET' ? 'jonbet_settings' : 'settings';
    }

    private function variablesTable(): string
    {
        return $this->platform === 'JONBET' ? 'jonbet_variables' : 'variables';
    }

    private function pf(string $field): string
    {
        if ($this->platform !== 'JONBET') {
            return $field;
        }
        return 'jonbet' . ucfirst($field);
    }

    private function syncBalance(): float
    {
        if ($this->isDemo) {
            // Demo: continua de onde parou se já tem saldo DEMO; senão 1000
            $vars = Database::fetch('SELECT balance, firstBalanceMode FROM `' . $this->variablesTable() . '` WHERE ownerId = ?', [$this->userId]);
            if ($vars && ($vars['firstBalanceMode'] ?? '') === 'DEMO' && (float) ($vars['balance'] ?? 0) > 0) {
                $this->simulatedBalance = (float) $vars['balance'];
            }
            Database::update($this->variablesTable(), ['balance' => $this->simulatedBalance], 'ownerId = :oid', ['oid' => $this->userId]);
            return $this->simulatedBalance;
        }
        try {
            $wallet = $this->api->getWallet();
            $bal = $this->api->extractBalance($wallet);
            Database::update($this->variablesTable(), ['balance' => $bal], 'ownerId = :oid', ['oid' => $this->userId]);
            return $bal;
        } catch (\Throwable) {
            $v = Database::fetch('SELECT balance FROM `' . $this->variablesTable() . '` WHERE ownerId = ?', [$this->userId]);
            return (float) ($v['balance'] ?? 0);
        }
    }

    private function initVariables(): void
    {
        $vars = Database::fetch('SELECT * FROM `' . $this->variablesTable() . '` WHERE ownerId = ?', [$this->userId]);
        if (!$vars) {
            return;
        }
        $mode = $this->isDemo ? 'DEMO' : 'REAL';
        $today = date('Y-m-d');
        $lastDate = !empty($vars['firstBalanceDate'])
            ? date('Y-m-d', strtotime((string) $vars['firstBalanceDate']))
            : null;
        $newDay = $lastDate !== $today;
        $modeChanged = ($vars['firstBalanceMode'] ?? null) !== $mode;

        if ($this->forceReset || $newDay || $modeChanged) {
            $balance = $this->syncBalance();
            \App\Bot\BotEntryLogger::resetSessionCounters($this->variablesTable(), $this->userId, $balance);
            Database::update($this->variablesTable(), [
                'firstBalanceMode' => $mode,
            ], 'ownerId = :oid', ['oid' => $this->userId]);
            $this->peakProfit = 0;
            $this->msg($this->forceReset
                ? '💰 Sessão reiniciada — vitórias/derrotas do painel zeradas (relatório do mês mantido)'
                : ($modeChanged
                    ? "💰 Sessão {$mode} iniciada — banca R$ " . number_format($balance, 2, '.', '')
                    : '💰 Nova sessão do dia — contadores zerados'));
        } else {
            $this->peakProfit = (float) ($vars['profit'] ?? 0);
            if ($this->isDemo) {
                $this->simulatedBalance = (float) ($vars['balance'] ?? 1000);
            }
        }
    }

    private function onWaiting(?string $roundId = null): void
    {
        if (!$this->running) {
            return;
        }
        if ($this->liveRounds < 1) {
            return;
        }
        if ($this->cooldownRoundsRemaining > 0) {
            return;
        }
        if ($this->betInFlight) {
            return;
        }
        if ($roundId !== null && $roundId !== '' && $roundId === $this->lastAttemptedRoundId) {
            return;
        }

        $settings = Database::fetch('SELECT * FROM `' . $this->settingsTable() . '` WHERE ownerId = ?', [$this->userId]);
        $vars = Database::fetch('SELECT * FROM `' . $this->variablesTable() . '` WHERE ownerId = ?', [$this->userId]);
        if (!$settings || !$vars) {
            return;
        }
        $this->strategyType = (string) ($settings['strategyType'] ?? 'SEQUÊNCIA');

        $user = UserRepository::find($this->userId);
        $pointBet = $user ? (string) ($user[$this->pf('pointBet')] ?? '') : '';
        $inGale = !empty($vars['isGale']) && (
            $this->currentTarget > 0 || $pointBet !== ''
        );

        // Pula uma rodada após WIN/LOSS final (não pula durante gale)
        if ($this->skipNextBet && !$inGale) {
            $this->skipNextBet = false;
            return;
        }

        // Observando 1ª entrada / sequência de gale virtual — não aposta
        if ($this->sfeObserving && !$inGale) {
            return;
        }

        if ($inGale) {
            $targetPoint = $this->currentTarget > 0
                ? $this->currentTarget
                : max(1.01, (float) str_replace(',', '.', $pointBet) ?: 2.0);
            $this->currentTarget = $targetPoint;
            if ($this->lastPattern === '' && !empty($vars['lastPattern'] ?? null)) {
                $this->lastPattern = (string) $vars['lastPattern'];
            }
        } elseif ($this->sfeReady) {
            $targetPoint = $this->sfeTarget > 0 ? $this->sfeTarget : $this->currentTarget;
            $this->lastPattern = $this->sfePattern !== '' ? $this->sfePattern : $this->lastPattern;
            $this->sfeReady = false;
            $this->sfeTarget = 0;
            $this->sfePattern = '';
            $this->currentTarget = $targetPoint;
        } else {
            $signal = $this->detect($settings);
            if ($signal === null) {
                return;
            }
            $targetPoint = $signal;

            // Pular 1ª entrada — observa 1 rodada (igual Double)
            if (!empty($settings['skipFirstEntry'])) {
                $this->sfeObserving = true;
                $this->sfeSimulateGales = false;
                $this->sfeTarget = $targetPoint;
                $this->sfePattern = $this->lastPattern;
                $this->currentTarget = $targetPoint;
                $this->msg("🔍 Padrão encontrado: *{$targetPoint}x* | 📋 {$this->lastPattern}\n⏳ Aguardando 1ª rodada para confirmar...");
                return;
            }

            // Entrada Após Loss — simula sequência de gale inteira antes de entrar
            if (!empty($settings['skipEntryAfterLoss'])) {
                $this->sfeObserving = true;
                $this->sfeSimulateGales = true;
                $this->sfeVirtualGaleCount = 0;
                $this->sfeMaxGale = (int) ($settings['martingale'] ?? 0);
                $this->sfeTarget = $targetPoint;
                $this->sfePattern = $this->lastPattern;
                $this->currentTarget = $targetPoint;
                $this->msg("🔍 Padrão encontrado: *{$targetPoint}x* | 📋 {$this->lastPattern}\n⏳ Simulando sequência de gale antes de confirmar...");
                return;
            }
            $this->currentTarget = $targetPoint;
        }

        $galeLevel = (int) ($vars['countMartingale'] ?? 0);
        $base = ($settings['enterType'] ?? '') === 'PORCENTAGEM'
            ? ((float) $vars['balance'] * (float) $settings['enterPercent'] / 100)
            : (float) $settings['enterValue'];
        $mult = (float) ($settings['martingaleMultiplier'] ?? 2);
        $amount = round($base * pow($mult, $galeLevel), 2);
        if ($amount <= 0) {
            return;
        }

        $this->currentBet = $amount;
        $this->currentTarget = $targetPoint;
        $this->currentGale = $galeLevel;

        // Marca entrada ANTES da API (stop/pendingStop e botão bloqueado no painel)
        $this->betInFlight = true;
        UserRepository::update($this->userId, [
            $this->pf('isBetting') => 1,
            $this->pf('pointBet') => (string) $targetPoint,
        ]);

        try {
            if (!$this->isDemo) {
                $this->api->enterCrash($amount, $targetPoint);
            }
            // Igual original: ids "next_round_*" não batem com o complete real —
            // deixa null e aceita o próximo complete válido com crash_point > 0.
            if ($roundId !== null && $roundId !== '' && !str_starts_with($roundId, 'next_round_')) {
                $this->enteredRoundId = $roundId;
                $this->lastAttemptedRoundId = $roundId;
            } else {
                $this->enteredRoundId = null;
            }

            // Formato LogParser: cor entre * * e 📋 padrão
            // Gale level no UI: após 1º loss countMartingale vira 1 → mensagem G1/N
            $maxGale = (int) ($settings['martingale'] ?? 0);
            if ($inGale || $galeLevel > 0) {
                $gShow = max(1, $galeLevel);
                $this->msg(
                    "🔄 Gale {$gShow}/{$maxGale}: *{$targetPoint}x* — R$ "
                    . number_format($amount, 2, '.', '')
                    . " | 📋 {$this->lastPattern}"
                );
            } else {
                $this->msg(
                    "🎯 Entrando: *{$targetPoint}x* — R$ "
                    . number_format($amount, 2, '.', '')
                    . " | 📋 {$this->lastPattern}"
                );
            }
        } catch (\Throwable $e) {
            $this->betInFlight = false;
            $this->enteredRoundId = null;
            $msg = $e->getMessage();
            if (str_contains($msg, '1005') || str_contains(mb_strtolower($msg), 'saldo') || str_contains(mb_strtolower($msg), 'balance')) {
                $this->msg('⚠️ Saldo insuficiente — bot parado automaticamente.');
                $this->stop();
                UserRepository::update($this->userId, [
                    $this->pf('isActive') => 0,
                    $this->pf('isBetting') => 0,
                ]);
            } else {
                UserRepository::update($this->userId, [$this->pf('isBetting') => 0]);
                $this->msg('Erro crash: ' . $msg);
            }
        }
    }

    private function onResult(array $data): void
    {
        $roundId = (string) ($data['id'] ?? '');
        $crashPoint = (float) ($data['crash_point'] ?? $data['crashPoint'] ?? 0);

        // crash_point=0 = dado inválido da API — NUNCA cancela aposta real.
        // Espera o próximo complete com multiplicador > 0 (WIN ou LOSS de verdade).
        if ($crashPoint <= 0) {
            log_msg("[crash:{$this->userId}] ignorando complete sem crash_point (id={$roundId})", 'bot');
            return;
        }

        // Só conta rodadas válidas no histórico
        array_unshift($this->history, $crashPoint);
        if (count($this->history) > 30) {
            array_pop($this->history);
        }
        $this->liveRounds++;
        if ($this->cooldownRoundsRemaining > 0) {
            $this->cooldownRoundsRemaining--;
        }
        try {
            Database::insert('game_results', [
                'blazeId' => $roundId,
                'gameType' => 'CRASH',
                'platform' => $this->platform,
                'crashPoint' => $crashPoint,
                'createdAt' => now(),
            ]);
        } catch (\Throwable) {
        }

        if (!$this->betInFlight) {
            // Observação (Pular 1ª / Entrada Após Loss)
            if ($this->sfeObserving) {
                $tgt = $this->sfeTarget > 0 ? $this->sfeTarget : $this->currentTarget;
                $wouldWin = $crashPoint >= $tgt;
                if ($wouldWin) {
                    $this->sfeObserving = false;
                    $this->sfeSimulateGales = false;
                    $this->sfeVirtualGaleCount = 0;
                    $this->sfeReady = false;
                    $this->sfeTarget = 0;
                    $this->msg("⚠️ *Observação*: saiu " . number_format($crashPoint, 2, '.', '') . "x ✅ — sinal teria ganhado, resetando\n🔍 Aguardando novo padrão...");
                } elseif (!$this->sfeSimulateGales) {
                    // skipFirstEntry: 1 rodada de observação perdeu → entra na próxima
                    $this->sfeObserving = false;
                    $this->sfeReady = true;
                    $this->msg("✅ *Observação*: saiu " . number_format($crashPoint, 2, '.', '') . "x — não atingiu {$tgt}x\n⏭️ Entrando na próxima rodada!");
                } else {
                    // skipEntryAfterLoss: simula gale virtual
                    $this->sfeVirtualGaleCount++;
                    if ($this->sfeVirtualGaleCount <= $this->sfeMaxGale) {
                        $this->msg("🔍 *Observação*: gale virtual {$this->sfeVirtualGaleCount}/{$this->sfeMaxGale} de *{$tgt}x* também perderia — continuando a simular...");
                    } else {
                        $this->sfeObserving = false;
                        $this->sfeSimulateGales = false;
                        $this->sfeReady = true;
                        $this->msg("✅ *Observação*: sequência de gale inteira de *{$tgt}x* perderia ({$this->sfeMaxGale} gales) — entrando na próxima rodada!");
                    }
                }
            }
            return;
        }

        // Se sabemos o id da rodada da aposta e veio outra, ignora (resultado secundário)
        if ($this->enteredRoundId !== null && $roundId !== '' && $roundId !== $this->enteredRoundId) {
            log_msg("[crash:{$this->userId}] ignorando complete {$roundId} (aguardando {$this->enteredRoundId})", 'bot');
            return;
        }

        // Aposta real: SEMPRE resolve em WIN ou LOSS (nunca CANCELADO)
        $this->betInFlight = false;
        $this->enteredRoundId = null;
        $vars = Database::fetch('SELECT * FROM `' . $this->variablesTable() . '` WHERE ownerId = ?', [$this->userId]);
        $settings = Database::fetch('SELECT * FROM `' . $this->settingsTable() . '` WHERE ownerId = ?', [$this->userId]);
        if (!$vars || !$settings) {
            return;
        }

        $targetPoint = $this->currentTarget > 0
            ? $this->currentTarget
            : max(1.01, (float) str_replace(',', '.', (string) ($vars['pointBet'] ?? $this->currentTarget)) ?: 2.0);

        $won = $crashPoint >= $targetPoint;

        // Atualiza saldo
        if ($this->isDemo) {
            if ($won) {
                $this->simulatedBalance += $this->currentBet * ($targetPoint - 1);
            } else {
                $this->simulatedBalance -= $this->currentBet;
            }
            $balance = round($this->simulatedBalance, 2);
        } else {
            // estima local + corrige com wallet se possível
            $prev = (float) ($vars['balance'] ?? 0);
            $net = $won ? $this->currentBet * ($targetPoint - 1) : -$this->currentBet;
            $balance = round($prev + $net, 2);
            try {
                $balance = $this->api->extractBalance($this->api->getWallet());
            } catch (\Throwable) {
            }
        }

        $firstBalance = (float) ($vars['firstBalance'] ?? $balance);
        // se firstBalanceMode estiver errado (DEMO em conta REAL), corrige na hora
        $mode = $this->isDemo ? 'DEMO' : 'REAL';
        if (($vars['firstBalanceMode'] ?? '') !== $mode) {
            $firstBalance = $balance;
            Database::update($this->variablesTable(), [
                'firstBalance' => $firstBalance,
                'firstBalanceMode' => $mode,
                'firstBalanceDate' => now(),
                'profit' => 0,
            ], 'ownerId = :oid', ['oid' => $this->userId]);
        }
        $profit = round($balance - $firstBalance, 2);

        UserRepository::update($this->userId, [
            $this->pf('isBetting') => 0,
            $this->pf('pointBefore') => (string) $crashPoint,
        ]);

        $cpFmt = number_format($crashPoint, 2, '.', '');
        $profitFmt = number_format($profit, 2, '.', '');
        $balFmt = number_format($balance, 2, '.', '');

        // P/L desta rodada (para relatório mensal na tela inicial)
        $roundProfit = $won
            ? round($this->currentBet * ($targetPoint - 1), 2)
            : round(-$this->currentBet, 2);

        if ($won) {
            Database::update($this->variablesTable(), [
                'countWin' => (int) $vars['countWin'] + 1,
                'monthCountWin' => (int) ($vars['monthCountWin'] ?? 0) + 1,
                'countMartingale' => 0,
                'isGale' => 0,
                'profit' => $profit,
                'balance' => $balance,
            ], 'ownerId = :oid', ['oid' => $this->userId]);
            $this->currentGale = 0;
            $this->skipNextBet = true;
            $this->cooldownRoundsRemaining = self::COOLDOWN_ROUNDS;
            $this->peakProfit = max($this->peakProfit, $profit);
            // Formato LogParser: "— 1.60x" e "Lucro: R$ ..."
            $this->msg("✅ *WIN* — {$cpFmt}x\nLucro: R$ {$profitFmt}\nBanca atual: R$ {$balFmt}");
            \App\Bot\BotEntryLogger::log(
                $this->userId,
                'WIN',
                'CRASH',
                $this->platform,
                (string) $targetPoint . 'x',
                $cpFmt . 'x',
                $this->lastPattern !== '' ? $this->lastPattern : null,
                $this->currentBet,
                $roundProfit,
                (int) ($vars['countMartingale'] ?? 0)
            );
            $this->checkStop($settings, $profit, (int) $vars['countWin'] + 1, (int) $vars['countLoss']);
        } else {
            $newMartingale = (int) $vars['countMartingale'] + 1;
            $maxGale = (int) ($settings['martingale'] ?? 0);
            $exhausted = $newMartingale > $maxGale;

            if (!$exhausted) {
                Database::update($this->variablesTable(), [
                    'countMartingale' => $newMartingale,
                    'isGale' => 1,
                    'profit' => $profit,
                    'balance' => $balance,
                ], 'ownerId = :oid', ['oid' => $this->userId]);
                $this->currentGale = $newMartingale;
                // mantém currentTarget para o gale
                $this->msg("❌ *LOSS* — {$cpFmt}x | Gale {$newMartingale}/{$maxGale}\nLucro: R$ {$profitFmt}");
                \App\Bot\BotEntryLogger::log(
                    $this->userId,
                    'GALE',
                    'CRASH',
                    $this->platform,
                    (string) $targetPoint . 'x',
                    $cpFmt . 'x',
                    $this->lastPattern !== '' ? $this->lastPattern : null,
                    $this->currentBet,
                    $roundProfit,
                    $newMartingale
                );
            } else {
                Database::update($this->variablesTable(), [
                    'countLoss' => (int) $vars['countLoss'] + 1,
                    'monthCountLoss' => (int) ($vars['monthCountLoss'] ?? 0) + 1,
                    'countMartingale' => 0,
                    'isGale' => 0,
                    'profit' => $profit,
                    'balance' => $balance,
                ], 'ownerId = :oid', ['oid' => $this->userId]);
                $this->currentGale = 0;
                $this->currentTarget = 0;
                $this->skipNextBet = true;
                $this->cooldownRoundsRemaining = self::COOLDOWN_ROUNDS;
                $this->msg("❌ *LOSS* — {$cpFmt}x | Gales esgotados\nLucro: R$ {$profitFmt}\nBanca atual: R$ {$balFmt}");
                \App\Bot\BotEntryLogger::log(
                    $this->userId,
                    'LOSS',
                    'CRASH',
                    $this->platform,
                    (string) $targetPoint . 'x',
                    $cpFmt . 'x',
                    $this->lastPattern !== '' ? $this->lastPattern : null,
                    $this->currentBet,
                    $roundProfit,
                    $newMartingale
                );
                $this->checkStop($settings, $profit, (int) $vars['countWin'], (int) $vars['countLoss'] + 1);
            }
        }

        if ($this->pendingStop) {
            $this->pendingStop = false;
            $this->stop();
            UserRepository::update($this->userId, [
                $this->pf('isActive') => 0,
                $this->pf('isBetting') => 0,
            ]);
            $this->msg('⏹️ Entrada finalizada — parando o robô e todas as operações, como solicitado.');
        }
    }

    private function checkStop(array $settings, float $profit, int $countWin, int $countLoss): void
    {
        $stopGain = (float) ($settings['stopGain'] ?? 0);
        $stopLoss = (float) ($settings['stopLoss'] ?? 0);
        $stopType = (string) ($settings['stopType'] ?? 'QUANTIDADE');
        $stopped = false;

        if ($stopType === 'VALOR') {
            if ($stopGain > 0 && $profit >= $stopGain) {
                $this->msg('🏆 *STOP WIN* atingido! Lucro: R$ ' . number_format($profit, 2, '.', ''));
                $stopped = true;
            } elseif ($stopLoss > 0) {
                $threshold = $this->peakProfit - $stopLoss;
                if ($profit <= $threshold) {
                    $this->msg('🛑 *STOP LOSS* atingido! Lucro: R$ ' . number_format($profit, 2, '.', ''));
                    $stopped = true;
                }
            }
        } else {
            // QUANTIDADE
            if ($stopGain > 0 && $countWin >= $stopGain) {
                $this->msg("🏆 *STOP WIN* atingido! {$countWin} vitórias");
                $stopped = true;
            } elseif ($stopLoss > 0 && $countLoss >= $stopLoss) {
                $this->msg("🛑 *STOP LOSS* atingido! {$countLoss} derrotas");
                $stopped = true;
            }
        }

        if ($stopped) {
            $this->stop();
            UserRepository::update($this->userId, [
                $this->pf('isActive') => 0,
                $this->pf('isBetting') => 0,
            ]);
        }
    }

    private function preloadHistory(): void
    {
        try {
            $rows = Database::fetchAll(
                "SELECT crashPoint FROM game_results WHERE gameType = 'CRASH' AND platform = ? AND crashPoint IS NOT NULL AND crashPoint > 0 ORDER BY id DESC LIMIT 30",
                [$this->platform]
            );
            $this->history = [];
            foreach ($rows as $r) {
                $cp = (float) ($r['crashPoint'] ?? 0);
                if ($cp > 0) {
                    $this->history[] = $cp;
                }
            }
        } catch (\Throwable) {
        }
    }

    private function detect(array $settings): ?float
    {
        if (count($this->history) < 1) {
            return null;
        }
        $type = (string) ($settings['strategyType'] ?? 'SEQUÊNCIA');
        if ($type === 'SYSTEM' || $type === 'BRANQUINHO DO AUTOWIN') {
            $type = 'SEQUÊNCIA';
        }

        if ($type === 'SEQUÊNCIA' || $type === 'NÚMEROS' || $type === '') {
            $rows = $this->loadCrashStrategies($type === '' ? 'SEQUÊNCIA' : $type);
            foreach ($rows as $s) {
                $items = array_map(fn ($x) => strtoupper(trim($x)), explode(',', (string) $s['sequence']));
                if ($this->matchCrashPattern($items, $this->history)) {
                    $this->lastPattern = (string) $s['sequence'];
                    $target = (float) str_replace(',', '.', (string) $s['color']);
                    return $target > 1 ? $target : 2.0;
                }
            }
            return null;
        }

        $all = $this->loadCrashStrategies(null);
        foreach ($all as $s) {
            $items = array_map(fn ($x) => strtoupper(trim($x)), explode(',', (string) $s['sequence']));
            if ($this->matchCrashPattern($items, $this->history)) {
                $this->lastPattern = (string) $s['sequence'];
                $target = (float) str_replace(',', '.', (string) $s['color']);
                return $target > 1 ? $target : 2.0;
            }
        }
        return null;
    }

    /** @return list<array<string,mixed>> */
    private function loadCrashStrategies(?string $strategyType): array
    {
        if ($strategyType === null) {
            return Database::fetchAll(
                "SELECT * FROM strategies WHERE ownerId = ? AND gameType = 'CRASH' AND platform = ?",
                [$this->userId, $this->platform]
            );
        }
        return Database::fetchAll(
            "SELECT * FROM strategies WHERE ownerId = ? AND gameType = 'CRASH' AND platform = ? AND (strategyType = ? OR strategyType = '' OR strategyType IS NULL)",
            [$this->userId, $this->platform, $strategyType]
        );
    }

    /**
     * @param  list<string>  $items
     * @param  list<float>   $history  [0]=mais recente
     */
    private function matchCrashPattern(array $items, array $history): bool
    {
        $valid = array_values(array_filter($history, static fn ($h) => (float) $h > 0));
        if (count($items) > count($valid)) {
            return false;
        }
        foreach ($items as $idx => $item) {
            $point = (float) ($valid[count($items) - 1 - $idx] ?? 0);
            $item = strtoupper(trim((string) $item));
            if ($item === 'X') {
                continue;
            }
            if ($item === 'V') {
                if ($point < 2.0) {
                    return false;
                }
                continue;
            }
            if ($item === 'R') {
                if ($point >= 2.0) {
                    return false;
                }
                continue;
            }
            if (is_numeric($item)) {
                $val = (float) $item;
                if ($val >= 0) {
                    if ($point < $val) {
                        return false;
                    }
                } elseif ($point > abs($val)) {
                    return false;
                }
                continue;
            }
            if (str_contains($item, '-')) {
                [$a, $b] = array_map('floatval', explode('-', $item, 2));
                if ($point < $a || $point > $b) {
                    return false;
                }
                continue;
            }
            return false;
        }
        return true;
    }
}
