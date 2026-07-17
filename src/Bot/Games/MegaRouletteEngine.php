<?php

declare(strict_types=1);

namespace App\Bot\Games;

use App\Bot\Blaze\BlazeAPI;
use App\Database;
use App\Models\UserRepository;
use App\Services\BotCommandService;
use App\Services\MegaRouletteBet;
use App\Services\Notify;

/**
 * Motor Blaze Mega Roulette Brazilian (Pragmatic Play) — mesa:
 *   https://blaze.bet.br/pt/games/mega-roulette---brazilian-287-287
 * Fonte de resultados: bot/megaroulette-ws-feed.cjs
 *   - GamblingCounting WS (key 8-287) se MEGAROULETTE_GC_WS_URL setado
 *   - ou Blaze /play + Pragmatic WS com MEGAROULETTE_FEED_TOKEN
 *
 * Roleta europeia: 37 números (0–36). 0 = BRANCO, resto VERMELHO/PRETO.
 * REAL: MegaRouletteBet → megaroulette-bet-bridge.cjs (lpbet Pragmatic).
 */
final class MegaRouletteEngine
{
    public const GAME_TYPE = 'ROLETA';
    private const COOLDOWN_ROUNDS = 1;
    /** Ficha mínima da mesa Mega Roulette Brazilian (Pragmatic). */
    private const MIN_BET = 0.50;

    private int $userId;
    private bool $forceReset;
    private bool $isDemo;
    private ?BlazeAPI $api;
    private bool $running = false;

    /** @var list<array{roll:int,color:string}> */
    private array $history = [];
    private ?string $lastSeenId = null;
    private int $liveRoundsCount = 0;
    private int $cooldownRoundsRemaining = 0;
    private float $lastPollAt = 0;

    private int $currentGale = 0;
    private float $currentBetAmount = 0;
    /** Proteção no 0 (R$), se ativa e entrada não cobre zero. */
    private float $currentProtectionAmount = 0;
    private int $cycleCount = 0;
    private float $cycleBaseAmount = 0;
    private float $simulatedBalance = 1000;

    private string $lastMatchedPattern = '';
    private ?float $lastMatchedPatternAccuracy = null;

    // Pular 1ª entrada / Entrada após loss (mesmo mecanismo BacBo/Double)
    private bool $sfeObserving = false;
    private bool $sfeReady = false;
    private string $sfeColor = '';
    private string $sfePattern = '';
    private ?float $sfeAccuracy = null;
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

    public function __construct(
        int $userId,
        bool $forceReset = false,
        ?BlazeAPI $api = null,
        bool $isDemo = true
    ) {
        $this->userId = $userId;
        $this->forceReset = $forceReset;
        $this->api = $api;
        $this->isDemo = $isDemo || $api === null || $api->getToken() === null || $api->getToken() === '';
    }

    public function start(): void
    {
        $this->running = true;
        $this->syncBalance();
        $this->initVariables();
        $this->preloadHistory();
        $this->cachedSettings = $this->getSettings();
        $this->cachedStrategies = $this->loadStrategies();
        $this->pollSource();
        $this->lastPollAt = microtime(true);

        $stype = (string) ($this->cachedSettings['strategyType'] ?? 'SEQUÊNCIA');
        if ($this->isDemo) {
            $this->msg('🟢 Bot Mega Roulette - Brazilian iniciado (DEMO) — entradas simuladas · ' . $stype);
        } else {
            $this->msg('🟢 Bot Mega Roulette - Brazilian iniciado (REAL) — aposta via Pragmatic lpbet · ' . $stype);
        }
    }

    public function stop(): void
    {
        $this->running = false;
    }

    public function requestStop(): bool
    {
        if ($this->betInFlight) {
            $this->pendingStop = true;
            $this->msg('⏸️ Estou no meio de uma entrada — assim que sair o resultado, vou parar o robô.');
            return false;
        }
        $this->stop();
        return true;
    }

    public function isRunning(): bool
    {
        return $this->running;
    }

    public function refreshCache(): void
    {
        $this->cachedSettings = $this->getSettings();
        $this->cachedStrategies = $this->loadStrategies();
    }

    public function tick(): void
    {
        if (!$this->running) {
            return;
        }
        $now = microtime(true);
        // Poll mais frequente — roleta ~30–45s/rodada; 0.8s reduz chance de “pular” rodada
        if ($now - $this->lastPollAt >= 0.8) {
            $this->lastPollAt = $now;
            try {
                $this->pollSource();
            } catch (\Throwable $e) {
                log_msg('[megaroulette] erro no poll: ' . $e->getMessage(), 'bot');
            }
        }
    }

    private function msg(string $m): void
    {
        $strategyType = (string) ($this->cachedSettings['strategyType'] ?? 'SEQUÊNCIA');
        BotCommandService::pushMessage($this->userId, $m, 'BLAZE', $strategyType);
        log_msg("[megaroulette:{$this->userId}] $m", 'bot');
    }

    private function accuracySuffix(): string
    {
        if ($this->lastMatchedPatternAccuracy === null) {
            return '';
        }
        return ' | 📊 ' . $this->lastMatchedPatternAccuracy . '%';
    }

    private function getSettings(): ?array
    {
        return Database::fetch('SELECT * FROM settings WHERE ownerId = ?', [$this->userId]);
    }

    private function loadStrategies(): array
    {
        return Database::fetchAll(
            "SELECT * FROM strategies WHERE ownerId = ? AND gameType = ? AND platform = 'BLAZE'",
            [$this->userId, self::GAME_TYPE]
        );
    }

    private function preloadHistory(): void
    {
        $rows = Database::fetchAll(
            "SELECT * FROM game_results WHERE gameType = ? AND platform = 'BLAZE' ORDER BY id DESC LIMIT 20",
            [self::GAME_TYPE]
        );
        if (!$rows) {
            return;
        }
        $this->history = array_map(static fn (array $r): array => [
            'roll' => (int) $r['roll'],
            'color' => (string) $r['color'],
        ], $rows);
        $this->lastSeenId = (string) $rows[0]['blazeId'];
    }

    private function pushHistory(int $roll, string $color): void
    {
        array_unshift($this->history, ['roll' => $roll, 'color' => $color]);
        if (count($this->history) > 20) {
            array_pop($this->history);
        }
    }

    private function pollSource(): void
    {
        if (!$this->running) {
            return;
        }
        // 1) Tenta feed WS → grava no banco
        $results = MegaRouletteSource::fetchSource();
        if ($results) {
            try {
                MegaRouletteSource::persistNew($results);
            } catch (\Throwable $e) {
                log_msg('[megaroulette] erro ao persistir: ' . $e->getMessage(), 'bot');
            }
        }

        // 2) Fonte da verdade pro bot = game_results (sobrevive a gap do WS se já persistiu)
        $rows = Database::fetchAll(
            "SELECT blazeId AS id, roll, color, createdAt AS created_at
             FROM game_results
             WHERE gameType = ? AND platform = ?
             ORDER BY id DESC
             LIMIT 40",
            [self::GAME_TYPE, MegaRouletteSource::PLATFORM]
        );
        if (!$rows) {
            return;
        }

        $results = [];
        foreach ($rows as $row) {
            $id = (string) ($row['id'] ?? '');
            if ($id === '') {
                continue;
            }
            $roll = (int) ($row['roll'] ?? -1);
            $color = strtoupper((string) ($row['color'] ?? ''));
            if (!in_array($color, ['VERMELHO', 'PRETO', 'BRANCO'], true)) {
                $color = MegaRouletteSource::colorOf($roll);
            }
            $results[] = [
                'id' => $id,
                'roll' => $roll,
                'color' => $color,
                'created_at' => (string) ($row['created_at'] ?? ''),
            ];
        }
        if ($results === []) {
            return;
        }

        if ($this->lastSeenId === null) {
            $this->lastSeenId = $results[0]['id'];
            return;
        }

        $knownIdx = null;
        foreach ($results as $i => $r) {
            if ($r['id'] === $this->lastSeenId) {
                $knownIdx = $i;
                break;
            }
        }

        // BUG antigo: se lastSeenId sumia da lista, só pegava 1 resultado e
        // "deixava passar" os do meio. Agora recupera vários (catch-up).
        if ($knownIdx === null) {
            $fresh = array_slice($results, 0, 12);
            log_msg(
                "[megaroulette:{$this->userId}] catch-up lastSeen={$this->lastSeenId} não achado — processando "
                . count($fresh) . ' mais recentes',
                'bot'
            );
        } else {
            $fresh = array_slice($results, 0, $knownIdx);
        }
        if (!$fresh) {
            return;
        }
        $this->lastSeenId = $results[0]['id'];

        foreach (array_reverse($fresh) as $r) {
            if (!$this->running) {
                break;
            }
            $this->onNewResult(
                (int) $r['roll'],
                (string) ($r['color'] !== '' ? $r['color'] : MegaRouletteSource::colorOf((int) $r['roll']))
            );
        }
    }

    private function onNewResult(int $roll, string $color): void
    {
        $this->liveRoundsCount++;
        if ($this->cooldownRoundsRemaining > 0) {
            $this->cooldownRoundsRemaining--;
        }

        // Observação (pular 1ª / após loss): avalia resultado virtual antes de apostar
        if ($this->sfeObserving) {
            $this->handleObservationResult($color, $roll);
            $this->pushHistory($roll, $color);
            if ($this->sfeReady && $this->running) {
                $this->cooldownRoundsRemaining = 0;
                $this->decideEntry();
            }
            return;
        }

        if ($this->betInFlight) {
            $this->resolveBet($color, $roll);
            $this->pushHistory($roll, $color);
            if ($this->betInFlight || !$this->running) {
                return;
            }
        } else {
            $this->pushHistory($roll, $color);
        }

        if ($this->betInFlight || !$this->running) {
            return;
        }
        if ($this->liveRoundsCount < 1) {
            return;
        }
        // sfeReady ignora cooldown (entra logo após confirmação da observação)
        if ($this->cooldownRoundsRemaining > 0 && !$this->sfeReady) {
            return;
        }

        $this->decideEntry();
    }

    private function decideEntry(): void
    {
        $settings = $this->cachedSettings;
        if (!$settings) {
            return;
        }
        $vars = Database::fetch('SELECT * FROM variables WHERE ownerId = ?', [$this->userId]);
        if (!$vars) {
            return;
        }
        $user = UserRepository::find($this->userId);
        if (!$user) {
            return;
        }
        if ($this->licenseExpired($user)) {
            $this->msg('⛔ Licença expirada — bot parado.');
            $this->stop();
            UserRepository::update($this->userId, ['isActive' => 0]);
            return;
        }

        $inGale = !empty($vars['isGale']) && !empty($user['colorBefore']);
        $fromSfe = false;

        if ($inGale) {
            $signal = (string) $user['colorBefore'];
            if ($this->currentSignalColor === '') {
                $this->currentSignalColor = $signal;
            }
            if ($this->currentSignalPattern === '' && $this->lastMatchedPattern !== '') {
                $this->currentSignalPattern = $this->lastMatchedPattern;
            }
        } elseif ($this->sfeReady) {
            // Mantém sfeReady até placeBet ok — se REAL falhar, re-tenta sem reobservar
            $signal = $this->sfeColor;
            $fromSfe = true;
            $this->lastMatchedPattern = $this->sfePattern;
            $this->lastMatchedPatternAccuracy = $this->sfeAccuracy;
        } else {
            $signal = $this->detectSignal($settings);
            if (!$signal) {
                return;
            }

            $entryLabel = self::formatEntryLabel($signal);

            if (!empty($settings['skipFirstEntry'])) {
                $this->sfeObserving = true;
                $this->sfeSimulateGales = false;
                $this->sfeColor = $signal;
                $this->sfePattern = $this->lastMatchedPattern;
                $this->sfeAccuracy = $this->lastMatchedPatternAccuracy;
                $this->msg(
                    "🔍 Sinal: {$entryLabel} | 📋 {$this->lastMatchedPattern}{$this->accuracySuffix()}\n"
                    . '⏳ Aguardando 1ª rodada para confirmar (sem apostar)...'
                );
                return;
            }
            if (!empty($settings['skipEntryAfterLoss'])) {
                $this->sfeObserving = true;
                $this->sfeSimulateGales = true;
                $this->sfeVirtualGaleCount = 0;
                $this->sfeMaxGale = (int) ($settings['martingale'] ?? 1);
                $this->sfeColor = $signal;
                $this->sfePattern = $this->lastMatchedPattern;
                $this->sfeAccuracy = $this->lastMatchedPatternAccuracy;
                $this->msg(
                    "🔍 Sinal: {$entryLabel} | 📋 {$this->lastMatchedPattern}{$this->accuracySuffix()}\n"
                    . "⏳ Simulando sequência de gale ({$this->sfeMaxGale}) antes de confirmar..."
                );
                return;
            }
        }

        $ok = $this->placeBet($signal, $settings, $vars);
        if ($ok && $fromSfe) {
            $this->sfeReady = false;
            $this->sfeColor = '';
            $this->sfePattern = '';
            $this->sfeAccuracy = null;
        }
    }

    /**
     * Resultado durante observação (skipFirst / skipAfterLoss).
     * Usa entryWins + proteção 0, igual à resolução real da aposta.
     */
    private function handleObservationResult(string $resultColor, int $roll): void
    {
        $settings = $this->cachedSettings ?? [];
        $protOn = ($settings['protectionHand'] ?? '') === 'SIM'
            && (float) ($settings['protectionValue'] ?? 0) > 0
            && $this->sfeColor !== ''
            && !self::entryIncludesZero($this->sfeColor);

        $mainWouldWin = $this->sfeColor !== ''
            && self::entryWins($this->sfeColor, $resultColor, $roll);
        $protWouldWin = $protOn && $roll === 0;
        $wouldWin = $mainWouldWin || $protWouldWin;

        $entryLabel = self::formatEntryLabel($this->sfeColor);
        $rollTxt = $roll >= 0 ? (string) $roll : $resultColor;

        if ($wouldWin) {
            $this->sfeObserving = false;
            $this->sfeSimulateGales = false;
            $this->sfeVirtualGaleCount = 0;
            $this->msg(
                "⚠️ *Observação*: saiu {$rollTxt} ✅ — {$entryLabel} teria ganho, resetando\n"
                . '🔍 Aguardando novo sinal...'
            );
            $this->logEntry('OBS_WIN', $this->sfeColor, $resultColor, $this->sfePattern);
            $this->sfeColor = '';
            $this->sfePattern = '';
            $this->sfeAccuracy = null;
            $this->sfeReady = false;
        } elseif (!$this->sfeSimulateGales) {
            // skipFirstEntry: 1 rodada de observação basta se perdeu
            $this->sfeObserving = false;
            $this->msg(
                "✅ *Observação*: saiu {$rollTxt} — não acertou {$entryLabel}\n"
                . "⏭️ Entrando em {$entryLabel} na próxima rodada"
            );
            $this->logEntry('OBS_LOSS', $this->sfeColor, $resultColor, $this->sfePattern);
            $this->sfeReady = true;
        } else {
            // skipEntryAfterLoss: simula gale completo
            $this->sfeVirtualGaleCount++;
            if ($this->sfeVirtualGaleCount <= $this->sfeMaxGale) {
                $this->msg(
                    "🔍 *Observação*: gale virtual {$this->sfeVirtualGaleCount}/{$this->sfeMaxGale}"
                    . " de {$entryLabel} também perderia (saiu {$rollTxt}) — continuando..."
                );
            } else {
                $this->sfeObserving = false;
                $this->sfeSimulateGales = false;
                $this->msg(
                    "✅ *Observação*: sequência de gale inteira de {$entryLabel} perderia"
                    . " ({$this->sfeMaxGale} gales) — entrando na próxima rodada"
                );
                $this->logEntry('OBS_LOSS', $this->sfeColor, $resultColor, $this->sfePattern);
                $this->sfeReady = true;
            }
        }
    }

    /** @return bool true se a entrada foi aberta */
    private function placeBet(string $signal, array $settings, array $vars): bool
    {
        $amount = $this->calcBetAmount($settings);
        if ($amount <= 0) {
            return false;
        }
        $this->currentBetAmount = $amount;

        $galeNum = (int) ($vars['countMartingale'] ?? 0);
        if (!empty($vars['isGale']) && $galeNum > 0) {
            $this->currentGale = $galeNum;
        }
        $maxGale = (int) ($settings['martingale'] ?? 1);
        if ($this->currentGale > 0) {
            $amount = $this->calcBetAmount($settings);
            $this->currentBetAmount = $amount;
        }

        $modeTag = $this->isDemo ? 'DEMO' : 'REAL';

        $entryLabel = self::formatEntryLabel($signal);
        $targets = self::expandEntryTargets($signal);
        $numCount = count($targets['numbers'] ?? []);
        $units = ($targets['mode'] ?? '') === 'color' ? 1 : max(1, $numCount);

        // Proteção no 0: só se ativo, valor > 0 e a entrada NÃO cobre o zero
        // Mesa exige ficha mínima R$ 0,50 — mesmo da entrada principal
        $baseProt = (float) ($settings['protectionValue'] ?? 0);
        $protOn = ($settings['protectionHand'] ?? '') === 'SIM' && $baseProt > 0;
        $includesZero = self::entryIncludesZero($signal);
        $protAmount = 0.0;
        if ($protOn && !$includesZero) {
            $protAmount = round(
                $baseProt * pow((float) ($settings['whiteMultiplier'] ?? 1), $this->currentGale),
                2
            );
            if ($protAmount > 0 && $protAmount < self::MIN_BET) {
                $protAmount = self::MIN_BET;
            }
        }
        $this->currentProtectionAmount = $protAmount;
        $protText = $protAmount > 0
            ? ' + 🛡️ 0 R$ ' . number_format($protAmount, 2, '.', '')
            : '';

        // REAL: aposta via Pragmatic lpbet (bc 48/49/0 ou números 0–36)
        if (!$this->isDemo) {
            $token = $this->api?->getToken();
            if (!$token) {
                $this->msg('⚠️ Sem token Blaze — aposta REAL abortada (reconecte a conta).');
                return false;
            }
            $this->msg(
                "⏳ {$entryLabel} · R$ " . number_format($amount, 2, '.', '') . '/casa'
                . ($units > 1 ? " ×{$units}" : '')
                . $protText
                . ' — abrindo mesa…'
            );
            try {
                $res = MegaRouletteBet::placeBet(
                    $this->userId,
                    $token,
                    $signal,
                    $amount,
                    90000,
                    $protAmount
                );
            } catch (\Throwable $e) {
                $this->msg('❌ Bridge REAL falhou: ' . $e->getMessage());
                log_msg('[megaroulette] placeBet exception: ' . $e->getMessage(), 'megaroulette-bet');
                return false;
            }
            if (empty($res['ok'])) {
                $err = (string) ($res['error'] ?? 'erro desconhecido');
                $code = (string) ($res['code'] ?? '');
                $this->msg(
                    "❌ Aposta REAL *não* enviada: {$err}"
                    . ($code !== '' ? " (code={$code})" : '')
                    . "\n🔁 Mantendo sinal — tenta de novo no próximo."
                );
                return false;
            }
            $tableHint = (string) ($res['tableId'] ?? 'mrbras…');
            $conf = !empty($res['confirmed']) ? 'confirmada' : 'enviada';
            $this->msg(
                "✅ Aposta REAL {$conf}: {$entryLabel}{$protText}"
                . " · mesa `{$tableHint}` · bc=" . (is_array($res['bc'] ?? null) ? implode(',', $res['bc']) : ($res['bc'] ?? '?'))
            );
        }

        UserRepository::update($this->userId, ['isBetting' => 1, 'colorBet' => $signal]);
        $this->betInFlight = true;
        $this->currentSignalColor = $signal;
        if ($this->lastMatchedPattern !== '') {
            $this->currentSignalPattern = $this->lastMatchedPattern;
        }

        if ($this->currentGale > 0) {
            $this->msg("🔄 Gale {$galeNum}/{$maxGale}: {$entryLabel}{$protText} — R$ " . number_format($amount, 2, '.', '') . " | 📋 {$this->currentSignalPattern}{$this->accuracySuffix()} [{$modeTag}]");
            $this->logEntry('GALE', $signal, null, $this->currentSignalPattern, $amount, null, $galeNum);
        } else {
            $this->msg("🎯 Entrando: {$entryLabel}{$protText} — R$ " . number_format($amount, 2, '.', '') . " | 📋 {$this->currentSignalPattern}{$this->accuracySuffix()} [{$modeTag}]");
            Notify::notifyUser($this->userId, 'entrada', "Entrando: {$entryLabel}{$protText} — R$ " . number_format($amount, 2, '.', ''), 'Mega Roulette - Brazilian', 'BLAZE');
            $this->logEntry('ENTRADA', $signal, null, $this->currentSignalPattern, $amount, null, 0);
        }
        return true;
    }

    private function resolveBet(string $resultColor, int $roll = -1): void
    {
        $user = UserRepository::find($this->userId);
        $betColor = $user['colorBet'] ?? null;
        if (!$betColor || empty($user['isBetting'])) {
            $this->betInFlight = false;
            return;
        }

        $mainWon = self::entryWins((string) $betColor, $resultColor, $roll);
        $prot = $this->currentProtectionAmount;
        $zeroHit = $roll === 0;
        $protWon = $prot > 0 && $zeroHit;
        $won = $mainWon || $protWon;

        // Lucro multi-número: stake total ≈ amount * qtd números (amount é por casa)
        $targets = self::expandEntryTargets((string) $betColor);
        $units = max(1, count($targets['numbers'] ?? []) ?: 1);
        if (($targets['mode'] ?? '') === 'color') {
            $units = 1;
        }
        $stakeMain = $this->currentBetAmount * $units;
        $stakeProt = $prot > 0 ? $prot : 0.0;

        UserRepository::update($this->userId, ['isBetting' => 0, 'colorBefore' => $betColor]);
        $this->betInFlight = false;
        $this->currentProtectionAmount = 0;

        // DEMO/contábil (REAL o saldo real vem da Blaze)
        if ($mainWon) {
            if (($targets['mode'] ?? '') === 'color') {
                $this->simulatedBalance += $this->currentBetAmount;
            } else {
                $this->simulatedBalance += $this->currentBetAmount * (36 - $units);
            }
            if ($stakeProt > 0 && !$zeroHit) {
                $this->simulatedBalance -= $stakeProt; // proteção no 0 perdeu
            }
        } elseif ($protWon) {
            // 0 saiu: proteção 35:1; entrada principal perde
            $this->simulatedBalance -= $stakeMain;
            $this->simulatedBalance += $prot * 35;
        } else {
            $this->simulatedBalance -= ($stakeMain + $stakeProt);
        }

        $galeContinues = false;

        if ($won) {
            $profit = $this->handleWin($resultColor);
            $this->cooldownRoundsRemaining = self::COOLDOWN_ROUNDS;
            $vars = Database::fetch('SELECT * FROM variables WHERE ownerId = ?', [$this->userId]);
            if ($vars) {
                $this->checkStop(array_merge($vars, ['profit' => $profit]));
            }
        } else {
            $res = $this->handleLoss($resultColor);
            if ($res['exhausted']) {
                $this->cooldownRoundsRemaining = self::COOLDOWN_ROUNDS;
                $vars = Database::fetch('SELECT * FROM variables WHERE ownerId = ?', [$this->userId]);
                if ($vars) {
                    $this->checkStop(array_merge($vars, ['profit' => $res['newProfit']]));
                }
            } else {
                $galeContinues = true;
            }
        }

        if ($this->pendingStop && !$galeContinues) {
            $this->pendingStop = false;
            $this->stop();
            UserRepository::update($this->userId, ['isActive' => 0, 'isBetting' => 0]);
            $this->msg('⏹️ Entrada finalizada — parando o robô, como solicitado.');
            return;
        }

        if ($galeContinues && $this->running) {
            $this->cooldownRoundsRemaining = 0;
            $this->refreshCache();
            $settings = $this->cachedSettings ?? $this->getSettings();
            $vars = Database::fetch('SELECT * FROM variables WHERE ownerId = ?', [$this->userId]);
            if ($settings && $vars && $this->currentSignalColor !== '') {
                $this->placeBet($this->currentSignalColor, $settings, $vars);
            }
            return;
        }

        $this->refreshCache();
    }

    private function handleWin(string $resultColor): float
    {
        $this->currentGale = 0;
        $this->cycleCount = 0;
        $this->cycleBaseAmount = 0;
        $this->sfeReady = false;
        $this->sfeObserving = false;
        $this->sfeSimulateGales = false;
        $this->sfeVirtualGaleCount = 0;
        $this->sfeColor = '';
        $this->sfePattern = '';
        $this->sfeAccuracy = null;

        $newBalance = $this->simulatedBalance;
        $vars = Database::fetch('SELECT * FROM variables WHERE ownerId = ?', [$this->userId]);
        $profit = $newBalance - (float) ($vars['firstBalance'] ?? $newBalance);
        $roundProfit = round($newBalance - (float) ($vars['balance'] ?? $newBalance), 2);
        if (abs($roundProfit) < 0.001) {
            $roundProfit = $this->currentBetAmount;
        }

        Database::update('variables', [
            'countWin' => (int) ($vars['countWin'] ?? 0) + 1,
            'monthCountWin' => (int) ($vars['monthCountWin'] ?? 0) + 1,
            'countMartingale' => 0,
            'isGale' => 0,
            'profit' => $profit,
            'balance' => $newBalance,
        ], 'ownerId = :oid', ['oid' => $this->userId]);

        $this->peakProfit = max($this->peakProfit, $profit);
        $this->msg("✅ *WIN* — {$resultColor}\nLucro: R$ " . number_format($profit, 2, '.', '') . "\nBanca atual: R$ " . number_format($newBalance, 2, '.', ''));
        Notify::notifyUser($this->userId, 'win', "WIN — {$resultColor} | Lucro: R$ " . number_format($profit, 2, '.', ''), 'Mega Roulette - Brazilian', 'BLAZE');
        $this->logEntry('WIN', $this->currentSignalColor, $resultColor, $this->currentSignalPattern, $this->currentBetAmount, $roundProfit, (int) ($vars['countMartingale'] ?? 0));
        return $profit;
    }

    /** @return array{exhausted:bool,newProfit:float} */
    private function handleLoss(string $resultColor): array
    {
        $settings = $this->cachedSettings ?? [];
        $maxGale = (int) ($settings['martingale'] ?? 1);
        $vars = Database::fetch('SELECT * FROM variables WHERE ownerId = ?', [$this->userId]);
        $newMartingale = (int) ($vars['countMartingale'] ?? 0) + 1;
        $newBalance = $this->simulatedBalance;
        $profit = $newBalance - (float) ($vars['firstBalance'] ?? $newBalance);
        $roundProfit = round($newBalance - (float) ($vars['balance'] ?? $newBalance), 2);
        if (abs($roundProfit) < 0.001) {
            $roundProfit = -$this->currentBetAmount;
        }

        if ($newMartingale <= $maxGale) {
            $this->currentGale = $newMartingale;
            Database::update('variables', [
                'countMartingale' => $newMartingale,
                'isGale' => 1,
                'profit' => $profit,
                'balance' => $newBalance,
            ], 'ownerId = :oid', ['oid' => $this->userId]);
            $this->msg("❌ *LOSS* — {$resultColor} | próximo Gale {$newMartingale}/{$maxGale}\nLucro: R$ " . number_format($profit, 2, '.', ''));
            $this->logEntry('GALE', $this->currentSignalColor, $resultColor, $this->currentSignalPattern, $this->currentBetAmount, $roundProfit, $newMartingale - 1);
            return ['exhausted' => false, 'newProfit' => $profit];
        }

        $this->cycleCount++;
        $this->currentGale = 0;
        Database::update('variables', [
            'countLoss' => (int) ($vars['countLoss'] ?? 0) + 1,
            'monthCountLoss' => (int) ($vars['monthCountLoss'] ?? 0) + 1,
            'countMartingale' => 0,
            'isGale' => 0,
            'profit' => $profit,
            'balance' => $newBalance,
        ], 'ownerId = :oid', ['oid' => $this->userId]);

        $qty = (int) ($settings['quantityCycles'] ?? 1);
        if ($this->cycleCount < $qty) {
            $this->cycleBaseAmount = $this->currentBetAmount;
            $this->msg("❌ *LOSS* — {$resultColor} | Gales esgotados\n🔁 Ciclo " . ($this->cycleCount + 1) . "/{$qty} — nova base: R$ " . number_format($this->cycleBaseAmount, 2, '.', '') . "\nLucro: R$ " . number_format($profit, 2, '.', ''));
            $this->logEntry('LOSS', $this->currentSignalColor, $resultColor, $this->currentSignalPattern, $this->currentBetAmount, $roundProfit, $newMartingale);
            Notify::notifyUser($this->userId, 'loss', "LOSS — {$resultColor} | Lucro: R$ " . number_format($profit, 2, '.', ''), 'Mega Roulette - Brazilian', 'BLAZE');
            return ['exhausted' => false, 'newProfit' => $profit];
        }

        $this->cycleCount = 0;
        $this->cycleBaseAmount = 0;
        $this->msg("❌ *LOSS* — {$resultColor} | Gales esgotados\nLucro: R$ " . number_format($profit, 2, '.', ''));
        Notify::notifyUser($this->userId, 'loss', "LOSS — {$resultColor} | Lucro: R$ " . number_format($profit, 2, '.', ''), 'Mega Roulette - Brazilian', 'BLAZE');
        $this->logEntry('LOSS', $this->currentSignalColor, $resultColor, $this->currentSignalPattern, $this->currentBetAmount, $roundProfit, $newMartingale);
        return ['exhausted' => true, 'newProfit' => $profit];
    }

    private function checkStop(array $variables): void
    {
        $settings = $this->cachedSettings ?? [];
        $stopGain = (float) ($settings['stopGain'] ?? 0);
        $stopLoss = (float) ($settings['stopLoss'] ?? 0);
        $stopped = false;

        if (($settings['stopType'] ?? 'VALOR') === 'VALOR') {
            if ($variables['profit'] >= $stopGain && $stopGain > 0) {
                $this->msg('🏆 *STOP WIN* atingido! Lucro: R$ ' . number_format((float) $variables['profit'], 2, '.', ''));
                Notify::notifyUser($this->userId, 'stopWin', 'Stop Win atingido — Lucro: R$ ' . number_format((float) $variables['profit'], 2, '.', ''), 'Mega Roulette - Brazilian', 'BLAZE');
                $stopped = true;
            } else {
                $threshold = $this->peakProfit - $stopLoss;
                if ($stopLoss > 0 && $variables['profit'] <= $threshold) {
                    $this->msg('🛑 *STOP LOSS* atingido!');
                    Notify::notifyUser($this->userId, 'stopLoss', 'Stop Loss atingido — Lucro: R$ ' . number_format((float) $variables['profit'], 2, '.', ''), 'Mega Roulette - Brazilian', 'BLAZE');
                    $stopped = true;
                }
            }
        } elseif (($settings['stopType'] ?? '') === 'QUANTIDADE') {
            if ((int) $variables['countWin'] >= $stopGain) {
                $this->msg('🏆 *STOP WIN* atingido! ' . (int) $variables['countWin'] . ' vitórias');
                Notify::notifyUser($this->userId, 'stopWin', 'Stop Win atingido — ' . (int) $variables['countWin'] . ' vitórias', 'Mega Roulette - Brazilian', 'BLAZE');
                $stopped = true;
            } elseif ((int) $variables['countLoss'] >= $stopLoss) {
                $this->msg('🛑 *STOP LOSS* atingido! ' . (int) $variables['countLoss'] . ' derrotas');
                Notify::notifyUser($this->userId, 'stopLoss', 'Stop Loss atingido — ' . (int) $variables['countLoss'] . ' derrotas', 'Mega Roulette - Brazilian', 'BLAZE');
                $stopped = true;
            }
        }

        if ($stopped) {
            $this->stop();
            UserRepository::update($this->userId, ['isActive' => 0]);
        }
    }

    private function detectSignal(array $settings): ?string
    {
        if (count($this->history) < 1) {
            return null;
        }
        $lastColors = array_map(static fn (array $h) => $h['color'], array_slice($this->history, 0, 14));
        $type = $settings['strategyType'] ?? 'SEQUÊNCIA';
        if ($type === 'SYSTEM' || $type === 'BRANQUINHO DO AUTOWIN') {
            $type = 'SEQUÊNCIA';
        }

        if ($type === 'SEQUÊNCIA') {
            $strategies = array_filter(
                $this->cachedStrategies ?? $this->loadStrategies(),
                static fn ($s) => ($s['strategyType'] ?? 'SEQUÊNCIA') === 'SEQUÊNCIA'
            );
            foreach ($strategies as $strategy) {
                $seq = array_map(static fn ($s) => strtoupper(trim($s)), explode(',', (string) $strategy['sequence']));
                if (count($seq) > count($lastColors)) {
                    continue;
                }
                $match = true;
                foreach ($seq as $idx => $o) {
                    if ($o === 'X') {
                        continue;
                    }
                    if (($lastColors[count($seq) - 1 - $idx] ?? null) !== $o) {
                        $match = false;
                        break;
                    }
                }
                if ($match) {
                    $this->lastMatchedPattern = $strategy['sequence'];
                    $this->lastMatchedPatternAccuracy = null;
                    return strtoupper((string) $strategy['color']);
                }
            }
            return null;
        }

        // COLUNAS: só configura repetições (settings.columnReps) — sem lista de estratégias
        // N× mesma coluna → entra nas outras duas (0 quebra)
        if ($type === 'COLUNAS') {
            $reps = max(2, min(15, (int) ($settings['columnReps'] ?? 2) ?: 2));
            // fallback legado: se ainda houver strategy COLUNAS salva
            if (!isset($settings['columnReps']) || (int) ($settings['columnReps'] ?? 0) < 2) {
                $legacy = array_filter(
                    $this->cachedStrategies ?? $this->loadStrategies(),
                    static fn ($s) => ($s['strategyType'] ?? '') === 'COLUNAS'
                );
                foreach ($legacy as $strategy) {
                    $r = (int) preg_replace('/\D+/', '', (string) $strategy['sequence']);
                    if ($r >= 2) {
                        $reps = max(2, min(15, $r));
                        break;
                    }
                }
            }
            if (count($this->history) < $reps) {
                return null;
            }
            $cols = [];
            for ($i = 0; $i < $reps; $i++) {
                $roll = (int) ($this->history[$i]['roll'] ?? -1);
                $c = self::columnOf($roll);
                if ($c === 0) {
                    return null; // 0 quebra
                }
                $cols[] = $c;
            }
            $first = $cols[0];
            foreach ($cols as $c) {
                if ($c !== $first) {
                    return null;
                }
            }
            $others = array_values(array_filter([1, 2, 3], static fn ($x) => $x !== $first));
            $this->lastMatchedPattern = "Col{$first}×{$reps}→C" . implode('+C', $others);
            $this->lastMatchedPatternAccuracy = null;
            return 'COLS:' . implode(',', $others);
        }

        // NÚMEROS (legado) ou SEQUÊNCIA E VIZINHOS — padrão misto número/cor/X + entrada em color field
        if ($type === 'NÚMEROS' || $type === 'SEQUÊNCIA E VIZINHOS') {
            $strategies = array_filter(
                $this->cachedStrategies ?? $this->loadStrategies(),
                static fn ($s) => in_array(($s['strategyType'] ?? ''), ['NÚMEROS', 'SEQUÊNCIA E VIZINHOS'], true)
            );
            foreach ($strategies as $strategy) {
                if ($this->matchMixedSequence((string) $strategy['sequence'])) {
                    $this->lastMatchedPattern = $strategy['sequence'];
                    $this->lastMatchedPatternAccuracy = null;
                    $entry = trim((string) $strategy['color']);
                    // legado: só "VERMELHO" sem prefixo
                    if ($entry !== '' && !str_contains($entry, ':')) {
                        $entry = 'COR:' . strtoupper($entry);
                    }
                    return $entry !== '' ? $entry : null;
                }
            }
            return null;
        }

        return null;
    }

    /**
     * Sequência mista: cores, números 0–36, terminais T0–T9 e X (qualquer).
     * Ordem no builder: mais recente → mais antigo.
     */
    private function matchMixedSequence(string $sequence): bool
    {
        $items = array_map(static fn ($s) => strtoupper(trim($s)), explode(',', $sequence));
        $items = array_values(array_filter($items, static fn ($s) => $s !== ''));
        if ($items === [] || count($items) > count($this->history)) {
            return false;
        }
        foreach ($items as $idx => $item) {
            $result = $this->history[count($items) - 1 - $idx] ?? null;
            if (!$result) {
                return false;
            }
            if ($item === 'X') {
                continue;
            }
            // Terminal: T0–T9 ou TERM0–TERM9 (final do número)
            if (preg_match('/^T(?:ERM)?([0-9])$/', $item, $m)) {
                $digit = (int) $m[1];
                $roll = (int) ($result['roll'] ?? -1);
                if ($roll < 0 || ($roll % 10) !== $digit) {
                    return false;
                }
                continue;
            }
            if (preg_match('/^\d+$/', $item)) {
                if ((int) $result['roll'] !== (int) $item) {
                    return false;
                }
            } else {
                $want = $item;
                if ($want === 'V') {
                    $want = 'VERMELHO';
                }
                if ($want === 'P') {
                    $want = 'PRETO';
                }
                if ($want === 'B') {
                    $want = 'BRANCO';
                }
                if (($result['color'] ?? '') !== $want) {
                    return false;
                }
            }
        }
        return true;
    }

    /** Roda europeia (mesma ordem da mesa / vizinhos). */
    private const EURO_WHEEL = [
        0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
    ];

    /** Coluna da mesa (1/2/3). 0 e inválidos → 0 (sem coluna). */
    public static function columnOf(int $roll): int
    {
        if ($roll < 1 || $roll > 36) {
            return 0;
        }
        return (($roll - 1) % 3) + 1;
    }

    /** @return list<int> */
    public static function numbersInColumn(int $col): array
    {
        if ($col < 1 || $col > 3) {
            return [];
        }
        $out = [];
        for ($n = $col; $n <= 36; $n += 3) {
            $out[] = $n;
        }
        return $out;
    }

    /**
     * Expande entrada salva no campo color.
     * COR:VERMELHO | NUM:1,20,33 | VIZ:1@1 | TERM:1@2 | COLS:2,3 | COLS_OTHER
     *
     * @return array{mode:string,color?:string,numbers:list<int>,columns?:list<int>}
     */
    public static function expandEntryTargets(string $entry): array
    {
        $entry = trim($entry);
        if ($entry === '') {
            return ['mode' => 'color', 'color' => 'VERMELHO', 'numbers' => []];
        }
        if (str_starts_with($entry, 'COR:')) {
            return ['mode' => 'color', 'color' => strtoupper(substr($entry, 4)), 'numbers' => []];
        }
        if ($entry === 'COLS_OTHER') {
            // placeholder — detectSignal já resolve COLS:x,y
            return ['mode' => 'numbers', 'numbers' => []];
        }
        if (str_starts_with($entry, 'COLS:')) {
            $cols = [];
            foreach (explode(',', substr($entry, 5)) as $p) {
                $c = (int) trim($p);
                if ($c >= 1 && $c <= 3) {
                    $cols[] = $c;
                }
            }
            $cols = array_values(array_unique($cols));
            $nums = [];
            foreach ($cols as $c) {
                foreach (self::numbersInColumn($c) as $n) {
                    $nums[] = $n;
                }
            }
            $nums = array_values(array_unique($nums));
            sort($nums);
            return ['mode' => 'numbers', 'numbers' => $nums, 'columns' => $cols];
        }
        if (str_starts_with($entry, 'NUM:')) {
            $nums = [];
            foreach (explode(',', substr($entry, 4)) as $p) {
                $n = (int) trim($p);
                if ($n >= 0 && $n <= 36) {
                    $nums[] = $n;
                }
            }
            return ['mode' => 'numbers', 'numbers' => array_values(array_unique($nums))];
        }
        if (str_starts_with($entry, 'VIZ:')) {
            $body = substr($entry, 4);
            [$center, $neigh] = array_pad(explode('@', $body, 2), 2, '0');
            return [
                'mode' => 'numbers',
                'numbers' => self::neighborsOf((int) $center, max(0, (int) $neigh)),
            ];
        }
        if (str_starts_with($entry, 'TERM:')) {
            $body = substr($entry, 5);
            [$terms, $neigh] = array_pad(explode('@', $body, 2), 2, '0');
            $n = max(0, (int) $neigh);
            $set = [];
            foreach (explode(',', $terms) as $t) {
                $d = (int) trim($t);
                foreach (self::terminalsOf($d) as $num) {
                    foreach (self::neighborsOf($num, $n) as $x) {
                        $set[$x] = true;
                    }
                }
            }
            $nums = array_map('intval', array_keys($set));
            sort($nums);
            return ['mode' => 'numbers', 'numbers' => $nums];
        }
        // legado cor pura
        $u = strtoupper($entry);
        if (in_array($u, ['VERMELHO', 'PRETO', 'BRANCO'], true)) {
            return ['mode' => 'color', 'color' => $u, 'numbers' => []];
        }
        return ['mode' => 'color', 'color' => $u, 'numbers' => []];
    }

    /** @return list<int> */
    public static function neighborsOf(int $center, int $n): array
    {
        $wheel = self::EURO_WHEEL;
        $idx = array_search($center, $wheel, true);
        if ($idx === false) {
            return [$center];
        }
        $len = count($wheel);
        $set = [$center => true];
        for ($i = 1; $i <= $n; $i++) {
            $set[$wheel[($idx - $i + $len) % $len]] = true;
            $set[$wheel[($idx + $i) % $len]] = true;
        }
        $out = array_map('intval', array_keys($set));
        sort($out);
        return $out;
    }

    /** @return list<int> */
    public static function terminalsOf(int $digit): array
    {
        $d = (($digit % 10) + 10) % 10;
        $out = [];
        for ($n = 0; $n <= 36; $n++) {
            if ($n % 10 === $d) {
                $out[] = $n;
            }
        }
        return $out;
    }

    public static function entryWins(string $entry, string $resultColor, int $roll): bool
    {
        $t = self::expandEntryTargets($entry);
        if (($t['mode'] ?? '') === 'color') {
            return strtoupper((string) ($t['color'] ?? '')) === strtoupper($resultColor);
        }
        $nums = $t['numbers'] ?? [];
        return $roll >= 0 && in_array($roll, $nums, true);
    }

    public static function formatEntryLabel(string $entry): string
    {
        $t = self::expandEntryTargets($entry);
        if (($t['mode'] ?? '') === 'color') {
            return '*' . ($t['color'] ?? '?') . '*';
        }
        if (!empty($t['columns']) && is_array($t['columns'])) {
            return '*Colunas ' . implode('+', $t['columns']) . '* (' . count($t['numbers'] ?? []) . ' nº)';
        }
        $nums = $t['numbers'] ?? [];
        $preview = implode(',', array_slice($nums, 0, 12));
        if (count($nums) > 12) {
            $preview .= '…';
        }
        return '*' . count($nums) . ' nº* [' . $preview . ']';
    }

    /** Entrada já cobre o zero (não aplicar proteção no 0). */
    public static function entryIncludesZero(string $entry): bool
    {
        $t = self::expandEntryTargets($entry);
        if (($t['mode'] ?? '') === 'color') {
            return strtoupper((string) ($t['color'] ?? '')) === 'BRANCO';
        }
        $nums = $t['numbers'] ?? [];
        return in_array(0, $nums, true);
    }

    private function calcBetAmount(array $settings): float
    {
        if ($this->cycleBaseAmount > 0) {
            $amount = $this->cycleBaseAmount;
        } elseif (($settings['enterType'] ?? '') === 'PORCENTAGEM') {
            $amount = $this->simulatedBalance * ((float) ($settings['enterPercent'] ?? 0) / 100);
        } else {
            $amount = (float) ($settings['enterValue'] ?? 0);
        }
        if ($this->currentGale > 0) {
            $multiplier = (float) ($settings['martingaleMultiplier'] ?? 2);
            $amount *= pow($multiplier ?: 2, $this->currentGale);
        }
        $amount = round($amount, 2);
        if ($amount <= 0) {
            return 0.0;
        }
        // Mesa exige mínimo R$ 0,50 por casa
        return max(self::MIN_BET, $amount);
    }

    private function syncBalance(): float
    {
        if ($this->isDemo) {
            $existing = Database::fetch('SELECT balance FROM variables WHERE ownerId = ?', [$this->userId]);
            if ($existing && (float) $existing['balance'] > 0) {
                $this->simulatedBalance = (float) $existing['balance'];
            }
            if ($this->simulatedBalance <= 0) {
                $this->simulatedBalance = 1000.0;
            }
            Database::update('variables', ['balance' => $this->simulatedBalance], 'ownerId = :oid', ['oid' => $this->userId]);
            return $this->simulatedBalance;
        }
        try {
            $wallet = $this->api?->getWallet();
            $bal = $wallet ? $this->api->extractBalance($wallet) : 0.0;
            $this->simulatedBalance = $bal;
            Database::update('variables', ['balance' => $bal], 'ownerId = :oid', ['oid' => $this->userId]);
            return $bal;
        } catch (\Throwable) {
            return $this->simulatedBalance;
        }
    }

    private function initVariables(): void
    {
        $vars = Database::fetch('SELECT * FROM variables WHERE ownerId = ?', [$this->userId]);
        if (!$vars) {
            return;
        }
        $mode = $this->isDemo ? 'DEMO' : 'REAL';
        $today = date('Y-m-d');
        $lastDate = $vars['firstBalanceDate'] ? date('Y-m-d', strtotime((string) $vars['firstBalanceDate'])) : null;
        $newDay = $lastDate !== $today;
        $modeChanged = ($vars['firstBalanceMode'] ?? null) !== $mode;

        if ($this->forceReset || $newDay || $modeChanged) {
            \App\Bot\BotEntryLogger::resetSessionCounters('variables', $this->userId, $this->simulatedBalance);
            Database::update('variables', [
                'firstBalanceMode' => $mode,
            ], 'ownerId = :oid', ['oid' => $this->userId]);
            if ($this->forceReset) {
                $this->msg('💰 Sessão reiniciada — vitórias/derrotas do painel zeradas (relatório do mês mantido)');
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
            self::GAME_TYPE,
            'BLAZE',
            $signal,
            $result,
            $pattern,
            $bet,
            $profit,
            $gale,
            $this->isDemo ? 'DEMO' : 'REAL'
        );
    }
}
