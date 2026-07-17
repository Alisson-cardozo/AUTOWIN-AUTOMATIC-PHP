<?php

declare(strict_types=1);

namespace App\Bot\Games;

use App\Bot\BotEntryLogger;
use App\Database;
use App\Models\UserRepository;
use App\Services\BotCommandService;
use App\Services\IqOptionBridge;
use App\Services\Notify;

/**
 * Motor Day Trade / IQ Option — horários + gale.
 * Entradas reais via IqOptionBridge (conta DEMO/REAL).
 */
final class DayTradeEngine
{
    public const GAME_TYPE = 'DAY_TRADE';

    private int $userId;
    private bool $forceReset;
    private bool $running = false;
    private bool $pendingStop = false;
    private bool $betInFlight = false;
    private float $lastTick = 0;

    private int $currentGale = 0;
    private float $currentAmount = 0;
    private string $currentDirection = '';
    private string $currentAsset = '';
    private ?string $pendingOptionId = null;
    private int $pendingExpireAt = 0;
    /** Preço de abertura (vela) para fallback de resultado */
    private float $pendingOpenPrice = 0.0;
    private float $pendingBalanceBefore = 0.0;
    private int $pendingExpMin = 1;
    private int $pendingEntryId = 0;

    /** Ciclos de loss completo (entrada + gales) — igual Double/Bac Bo */
    private int $cycleCount = 0;
    /**
     * Pular 1ª / Entrada após loss — espelha Double (Blaze):
     * - skipFirst: em TODA entrada observa 1 rodada; se não bater → entra de verdade (mesmo sinal)
     * - afterLoss: em TODA entrada simula entrada+gales; se sequência perderia → entra de verdade
     */
    private bool $skipFirstEnabled = false;
    private bool $skipAfterLossEnabled = false;
    private bool $observeActive = false;
    private bool $observeSimulateGales = false;
    private int $observeGale = 0;
    private int $observeMaxGale = 0;
    private string $observeDir = '';
    private string $observeAsset = '';
    private string $observeLabel = '';
    private int $observeExp = 3;
    private int $observeUntil = 0;
    private float $observePrice = 0.0;
    /** sfeReady do Double: próxima aposta usa o sinal observado (não re-detecta) */
    private bool $sfeReady = false;
    private string $readyDir = '';
    private string $readyAsset = '';
    private string $readyLabel = '';
    private int $readyExp = 3;
    /** Padrão da entrada em curso (gale reutiliza) */
    private string $pendingPattern = '';
    /** Rotação de estratégias por parâmetros */
    private int $strategyRotateIndex = 0;
    /** Cooldown após fechar uma entrada (segundos unix) */
    private int $nextEntryAfter = 0;
    /** Cache de velas por ativo [asset => ['ts'=>int,'candles'=>array]] */
    private array $candleCache = [];
    /** Hedging: se true, próxima entrada força direção oposta */
    private ?string $hedgeForceDir = null;

    private ?array $cachedSettings = null;
    private ?array $cachedStrategies = null;

    public function __construct(int $userId, bool $forceReset = false)
    {
        $this->userId = $userId;
        $this->forceReset = $forceReset;
    }

    public function start(): void
    {
        $this->running = true;
        $this->cachedSettings = $this->getSettings();
        $this->cachedStrategies = $this->loadStrategies();
        $this->cycleCount = 0;
        $this->currentGale = 0;
        $this->strategyRotateIndex = 0;
        $this->nextEntryAfter = 0;
        $this->hedgeForceDir = null;
        $this->candleCache = [];
        $this->observeActive = false;
        $this->sfeReady = false;
        $this->readyDir = '';
        $this->readyAsset = '';
        $this->readyLabel = '';
        $this->readyExp = 3;
        $this->observeGale = 0;
        $this->observeLabel = '';
        $this->pendingPattern = '';
        $settings = $this->cachedSettings ?? [];
        // cast int — evita empty("0")/tipos estranhos do MySQL
        $this->skipFirstEnabled = ((int) ($settings['skipFirstEntry'] ?? 0)) === 1;
        $this->skipAfterLossEnabled = ((int) ($settings['skipEntryAfterLoss'] ?? 0)) === 1;
        // exclusão mútua (igual UI)
        if ($this->skipFirstEnabled && $this->skipAfterLossEnabled) {
            $this->skipAfterLossEnabled = false;
        }
        $mode = $this->isDemo() ? 'DEMO' : 'REAL';
        $cycles = max(1, (int) ($settings['quantityCycles'] ?? 1));
        $nStrat = count($this->cachedStrategies ?? []);
        $nAssets = 0;
        foreach ($this->cachedStrategies ?? [] as $st) {
            $nAssets += count(self::parseAssetList((string) ($st['asset'] ?? '')));
        }
        // limpa log + zera sessão (igual outros bots) em todo start novo
        if ($this->forceReset) {
            try {
                BotCommandService::clearHistory($this->userId, 'DAYTRADE');
            } catch (\Throwable) {
            }
            try {
                Database::delete('daytrade_entries', 'ownerId = ?', [$this->userId]);
            } catch (\Throwable) {
            }
        }
        $this->initVariables();
        $bal = $this->syncBalance();
        if ($this->forceReset) {
            $balUse = $bal !== null ? $bal : 0.0;
            $mode = $this->isDemo() ? 'DEMO' : 'REAL';
            try {
                // Igual Double: zera contadores da sessão e ancora firstBalance no saldo atual
                BotEntryLogger::resetSessionCounters('daytrade_variables', $this->userId, $balUse);
            } catch (\Throwable) {
            }
            try {
                Database::update(
                    'daytrade_variables',
                    [
                        'countWin' => 0,
                        'countLoss' => 0,
                        'countMartingale' => 0,
                        'isGale' => 0,
                        'profit' => 0.0,
                        'balance' => $balUse,
                        'firstBalance' => $balUse,
                        'firstBalanceDate' => now(),
                        'firstBalanceMode' => $mode,
                    ],
                    'ownerId = :oid',
                    ['oid' => $this->userId]
                );
            } catch (\Throwable) {
            }
        }
        $flags = [];
        if ($this->skipFirstEnabled) {
            $flags[] = 'pular 1ª ON';
        }
        if ($this->skipAfterLossEnabled) {
            $flags[] = 'entrada após loss ON';
        }
        $this->msg(
            "🟢 Bot Day Trade (IQ Option) iniciado [{$mode}] · {$cycles} ciclo(s) · {$nStrat} estratégia(s) · {$nAssets} ativo(s)"
            . ($flags ? ' · ' . implode(' · ', $flags) : '')
        );
        if ($this->skipFirstEnabled) {
            $this->msg(
                '⏭️ Pular 1ª entrada (igual Double): em TODA oportunidade observa 1 rodada sem apostar; '
                . 'se NÃO bater, entra de verdade no mesmo sinal.'
            );
        }
        if ($this->skipAfterLossEnabled) {
            $maxG = max(0, (int) ($settings['martingale'] ?? 0));
            $this->msg(
                "⏭️ Entrada após loss (igual Double): em TODA oportunidade simula entrada + {$maxG} gale(s) virtual; "
                . 'só aposta de verdade se a sequência perderia.'
            );
        }
        if ($bal !== null) {
            $this->msg('💰 Banca: ' . number_format($bal, 2, '.', '') . ' · lucro/wins/loss zerados');
        }
        if ($nStrat === 0) {
            $this->msg('⚠️ Nenhuma estratégia cadastrada. Vá em Estratégias e adicione um modelo + ativos.');
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
            $this->msg('⏸️ Entrada em andamento — paro após o resultado.');
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
        $s = $this->cachedSettings ?? [];
        $this->skipFirstEnabled = ((int) ($s['skipFirstEntry'] ?? 0)) === 1;
        $this->skipAfterLossEnabled = ((int) ($s['skipEntryAfterLoss'] ?? 0)) === 1;
        if ($this->skipFirstEnabled && $this->skipAfterLossEnabled) {
            $this->skipAfterLossEnabled = false;
        }
    }

    public function tick(): void
    {
        if (!$this->running) {
            return;
        }
        $now = microtime(true);
        if ($now - $this->lastTick < 1.0) {
            return;
        }
        $this->lastTick = $now;

        // Resolve entrada pendente
        if ($this->betInFlight && $this->pendingExpireAt > 0 && time() >= $this->pendingExpireAt + 2) {
            $this->resolvePending();
            return;
        }
        if ($this->betInFlight) {
            return;
        }

        // Observação (pular 1ª / entrada após loss) — igual Double
        if ($this->observeActive) {
            if (time() >= $this->observeUntil) {
                $this->resolveObservation();
            }
            return;
        }

        if ($this->hitStop()) {
            return;
        }

        // Estratégias técnicas: analisa ativos um a um
        $this->checkParametros();
    }

    private function hitStop(): bool
    {
        $settings = $this->cachedSettings ?? $this->getSettings();
        if (!$settings) {
            return false;
        }
        $vars = Database::fetch('SELECT profit FROM daytrade_variables WHERE ownerId = ?', [$this->userId]);
        $profit = (float) ($vars['profit'] ?? 0);
        $stopGain = (float) ($settings['stopGain'] ?? 0);
        $stopLoss = (float) ($settings['stopLoss'] ?? 0);
        if ($stopGain > 0 && $profit >= $stopGain) {
            $this->msg('🎯 Stop Win atingido ($' . number_format($profit, 2, '.', '') . '). Bot parado.');
            Notify::notifyUser(
                $this->userId,
                'stopWin',
                'Stop Win atingido — Lucro: R$ ' . number_format($profit, 2, '.', ''),
                'Day Trade',
                'IQOPTION'
            );
            $this->stop();
            UserRepository::update($this->userId, ['daytradeIsActive' => 0, 'daytradeIsBetting' => 0]);
            return true;
        }
        if ($stopLoss > 0 && $profit <= -$stopLoss) {
            $this->msg('🛑 Stop Loss atingido ($' . number_format($profit, 2, '.', '') . '). Bot parado.');
            Notify::notifyUser(
                $this->userId,
                'stopLoss',
                'Stop Loss atingido — Lucro: R$ ' . number_format($profit, 2, '.', ''),
                'Day Trade',
                'IQOPTION'
            );
            $this->stop();
            UserRepository::update($this->userId, ['daytradeIsActive' => 0, 'daytradeIsBetting' => 0]);
            return true;
        }
        return false;
    }

    private function isDemo(): bool
    {
        $u = UserRepository::find($this->userId);
        return strtoupper((string) ($u['iqAccountType'] ?? 'DEMO')) !== 'REAL';
    }

    private function msg(string $m): void
    {
        BotCommandService::pushMessage($this->userId, $m, 'DAYTRADE');
        log_msg("[daytrade:{$this->userId}] $m", 'daytrade');
    }

    private function getSettings(): ?array
    {
        return Database::fetch('SELECT * FROM daytrade_settings WHERE ownerId = ?', [$this->userId]);
    }

    /** @return list<array> */
    private function loadStrategies(): array
    {
        return Database::fetchAll(
            'SELECT * FROM daytrade_strategies WHERE ownerId = ? ORDER BY id DESC',
            [$this->userId]
        );
    }

    private function initVariables(): void
    {
        $vars = Database::fetch('SELECT * FROM daytrade_variables WHERE ownerId = ?', [$this->userId]);
        if (!$vars) {
            return;
        }
        $mode = $this->isDemo() ? 'DEMO' : 'REAL';
        $today = date('Y-m-d');
        $lastDate = !empty($vars['firstBalanceDate'])
            ? date('Y-m-d', strtotime((string) $vars['firstBalanceDate']))
            : null;
        $newDay = $lastDate !== $today;
        $modeChanged = ($vars['firstBalanceMode'] ?? null) !== $mode;

        if ($this->forceReset || $newDay || $modeChanged) {
            // balance é sincronizado no start() — aqui só marca modo (igual Double)
            try {
                Database::update(
                    'daytrade_variables',
                    ['firstBalanceMode' => $mode],
                    'ownerId = :oid',
                    ['oid' => $this->userId]
                );
            } catch (\Throwable) {
            }
            if ($this->forceReset) {
                $this->msg('💰 Sessão reiniciada — vitórias/derrotas do painel zeradas (relatório do mês mantido)');
            }
        }
    }

    private function syncBalance(): ?float
    {
        $u = UserRepository::find($this->userId);
        $ssid = (string) ($u['iqSsid'] ?? '');
        if ($ssid === '') {
            return null;
        }
        $res = IqOptionBridge::balances($ssid);
        if (empty($res['ok']) || empty($res['balances'])) {
            return null;
        }
        $wantPractice = $this->isDemo();
        $chosen = null;
        foreach ($res['balances'] as $b) {
            $type = (int) ($b['type'] ?? 0);
            // type 1 = real, 4 = practice (comum)
            $isPractice = $type === 4 || $type === 2;
            if ($wantPractice && $isPractice) {
                $chosen = $b;
                break;
            }
            if (!$wantPractice && !$isPractice && $type === 1) {
                $chosen = $b;
                break;
            }
        }
        if (!$chosen) {
            $chosen = $res['balances'][0];
        }
        $amount = (float) ($chosen['amount'] ?? 0);
        $balId = (int) ($chosen['id'] ?? 0);
        Database::update(
            'daytrade_variables',
            ['balance' => $amount],
            'ownerId = :oid',
            ['oid' => $this->userId]
        );
        if ($balId > 0) {
            UserRepository::update($this->userId, ['iqBalanceId' => $balId]);
        }
        return $amount;
    }

    /**
     * Estratégias técnicas: lê velas, calcula sinal (CALL/PUT) e entra.
     * Direção/expiração/ativo vêm da estratégia cadastrada (modelo).
     */
    private function checkParametros(): void
    {
        // NUNCA analisa/entra se já tem ordem em voo ou gale em curso
        if ($this->betInFlight) {
            return;
        }
        // Gale: só o finishPending abre a próxima; não busca sinal novo
        if ($this->currentGale > 0) {
            return;
        }
        if ($this->observeActive) {
            return;
        }
        if ($this->nextEntryAfter > 0 && time() < $this->nextEntryAfter) {
            return;
        }
        // trava extra: flag no banco (evita race se worker duplicar tick)
        $uBet = UserRepository::find($this->userId);
        if (!empty($uBet['daytradeIsBetting'])) {
            return;
        }

        $settings = $this->cachedSettings ?? $this->getSettings();
        if (!$settings) {
            return;
        }
        // re-lê flags (igual Double lê settings a cada sinal)
        $this->skipFirstEnabled = ((int) ($settings['skipFirstEntry'] ?? 0)) === 1;
        $this->skipAfterLossEnabled = ((int) ($settings['skipEntryAfterLoss'] ?? 0)) === 1;
        if ($this->skipFirstEnabled && $this->skipAfterLossEnabled) {
            $this->skipAfterLossEnabled = false;
        }

        // sfeReady (Double): entra de verdade no sinal que a observação “não bateu”
        if ($this->sfeReady && $this->readyDir !== '' && $this->readyAsset !== '') {
            $dir = $this->readyDir;
            $asset = $this->readyAsset;
            $exp = max(1, $this->readyExp);
            $label = $this->readyLabel !== '' ? $this->readyLabel : $asset;
            $this->sfeReady = false;
            $this->readyDir = '';
            $this->readyAsset = '';
            $this->readyLabel = '';
            $this->readyExp = 3;
            $this->msg("🎯 Entrando de verdade (pós-observação): {$dir} {$asset}");
            $this->openEntry($dir, $asset, $exp, $label);
            return;
        }

        $list = array_values($this->cachedStrategies ?? $this->loadStrategies());
        if (!$list) {
            return;
        }

        $u = UserRepository::find($this->userId);
        $ssid = (string) ($u['iqSsid'] ?? '');
        if ($ssid === '') {
            return;
        }

        // Flatten: 1 estratégia × N ativos → analisa um par por vez
        $pairs = [];
        foreach ($list as $s) {
            $type = strtoupper(trim((string) ($s['strategyType'] ?? 'SMA_CROSS')));
            $assets = self::parseAssetList((string) ($s['asset'] ?? 'EURUSD-OTC'));
            foreach ($assets as $asset) {
                $pairs[] = ['s' => $s, 'asset' => $asset, 'type' => $type];
            }
        }
        if (!$pairs) {
            return;
        }

        // ── Lista Premium / Horários (sequence = HH:MM, color = CALL/PUT) ──
        // Entra quando o relógio BR bate o horário (janela de 90s).
        $nowBr = new \DateTime('now', new \DateTimeZone('America/Sao_Paulo'));
        $hhmm = $nowBr->format('H:i');
        $sec = (int) $nowBr->format('s');
        if ($sec <= 90) {
            foreach ($list as $s) {
                $type = strtoupper(trim((string) ($s['strategyType'] ?? '')));
                if (!in_array($type, ['PREMIUM_LIST', 'HORARIO', 'HORÁRIOS', 'HORARIOS'], true)) {
                    continue;
                }
                $seq = trim((string) ($s['sequence'] ?? ''));
                // normaliza 9:05 → 09:05
                if (preg_match('/^(\d{1,2}):(\d{2})$/', $seq, $m)) {
                    $seq = sprintf('%02d:%02d', (int) $m[1], (int) $m[2]);
                }
                if ($seq !== $hhmm) {
                    continue;
                }
                $dir = strtoupper((string) ($s['color'] ?? 'CALL'));
                if (!in_array($dir, ['CALL', 'PUT'], true)) {
                    $dir = 'CALL';
                }
                $assets = self::parseAssetList((string) ($s['asset'] ?? 'EURUSD-OTC'));
                $asset = $assets[0] ?? 'EURUSD-OTC';
                $exp = max(1, min(60, (int) ($s['expirationMinutes'] ?? 3)));
                $label = "Horário {$seq} · {$dir} · {$asset}";
                // sfe / after-loss iguais aos outros
                if ($this->skipFirstEnabled) {
                    $this->startObservation($dir, $asset, $exp, false, $label, 0);
                    return;
                }
                if ($this->skipAfterLossEnabled) {
                    $maxG = max(0, (int) ($settings['martingale'] ?? 0));
                    $this->startObservation($dir, $asset, $exp, true, $label, $maxG);
                    return;
                }
                $this->openEntry($dir, $asset, $exp, $label);
                // evita reentrar no mesmo minuto do horário
                $this->nextEntryAfter = time() + 95;
                return;
            }
        }

        $count = count($pairs);
        for ($k = 0; $k < $count; $k++) {
            $idx = ($this->strategyRotateIndex + $k) % $count;
            $pair = $pairs[$idx];
            $s = $pair['s'];
            $type = $pair['type'];
            $asset = $pair['asset'];
            // lista premium / horários: não rodam no loop técnico (já tratados acima)
            if (in_array($type, ['PREMIUM_LIST', 'HORARIO', 'HORÁRIOS', 'HORARIOS'], true)) {
                continue;
            }
            $label = trim((string) ($s['sequence'] ?? $type)) . ' · ' . $type;
            $exp = max(1, min(60, (int) ($s['expirationMinutes'] ?? 3)));

            if ($type === 'NEWS_SR' && !DayTradeSignals::isNewsSafeHour()) {
                continue;
            }

            if ($type === 'HEDGING') {
                if ($this->hedgeForceDir === null) {
                    continue;
                }
                $dir = $this->hedgeForceDir;
                $this->hedgeForceDir = null;
            } else {
                $candles = $this->getCandlesCached($ssid, $asset, 60, 120);
                if (!$candles || count($candles) < 30) {
                    continue;
                }
                $params = [];
                if ($type === 'SMA_CROSS') {
                    $params = ['fast' => 8, 'slow' => 21];
                } elseif ($type === 'EMA_CROSS') {
                    $params = ['fast' => 11, 'slow' => 56];
                } elseif ($type === 'RSI_DIV' || $type === 'RSI') {
                    $params = ['period' => 14];
                }
                $dir = DayTradeSignals::detect($type, $candles, $params);
                if ($dir === null && in_array(strtoupper((string) ($s['color'] ?? '')), ['CALL', 'PUT'], true)
                    && in_array($type, ['PARAMETROS', 'MANUAL', 'HORÁRIOS', 'HORARIO', 'PREMIUM_LIST'], true)) {
                    $dir = strtoupper((string) $s['color']);
                }
                if ($dir === null) {
                    continue;
                }
            }

            $this->strategyRotateIndex = ($idx + 1) % $count;

            // ── igual Double: settings.skipFirstEntry em TODA entrada nova ──
            if ($this->skipFirstEnabled) {
                $this->startObservation($dir, $asset, $exp, false, $label, 0);
                return;
            }
            // ── igual Double: skipEntryAfterLoss em TODA entrada nova ──
            if ($this->skipAfterLossEnabled) {
                $maxG = max(0, (int) ($settings['martingale'] ?? 0));
                $this->startObservation($dir, $asset, $exp, true, $label, $maxG);
                return;
            }

            $this->openEntry($dir, $asset, $exp, $label);
            return;
        }

        $this->nextEntryAfter = time() + 8;
    }

    private function startObservation(
        string $dir,
        string $asset,
        int $exp,
        bool $simulateGales,
        string $label,
        int $maxGale = 0
    ): void {
        $u = UserRepository::find($this->userId);
        $ssid = (string) ($u['iqSsid'] ?? '');
        $price = 0.0;
        if ($ssid !== '') {
            unset($this->candleCache[$asset . ':60']);
            $candles = $this->getCandlesCached($ssid, $asset, 60, 5);
            if ($candles) {
                $last = $candles[count($candles) - 1];
                $price = (float) ($last['close'] ?? 0);
            }
        }
        $this->observeActive = true;
        $this->observeSimulateGales = $simulateGales;
        $this->observeGale = 0;
        $this->observeMaxGale = max(0, $maxGale);
        $this->observeDir = $dir;
        $this->observeAsset = $asset;
        $this->observeLabel = $label;
        $this->observeExp = max(1, $exp);
        // 1 “rodada” = expiração da estratégia (mín. 45s para OTC 1m)
        $this->observeUntil = time() + max(45, $this->observeExp * 60);
        $this->observePrice = $price;
        $this->sfeReady = false;
        if ($simulateGales) {
            $this->msg(
                "🔍 Sinal: *{$dir}* | 📋 {$label} · {$asset}\n"
                . "⏳ Entrada após loss: simulando gale antes de confirmar (0/{$this->observeMaxGale})…"
            );
        } else {
            $this->msg(
                "🔍 Sinal: *{$dir}* | 📋 {$label} · {$asset}\n"
                . '⏳ Pular 1ª — aguardando rodada (sem apostar)…'
            );
        }
    }

    private function resolveObservation(): void
    {
        $u = UserRepository::find($this->userId);
        $ssid = (string) ($u['iqSsid'] ?? '');
        $open = $this->observePrice;
        $close = $open;
        if ($ssid !== '') {
            unset($this->candleCache[$this->observeAsset . ':60']);
            $candles = $this->getCandlesCached($ssid, $this->observeAsset, 60, 8);
            if ($candles && count($candles) >= 1) {
                $last = $candles[count($candles) - 1];
                $close = (float) ($last['close'] ?? $close);
                // se open zerado, usa open da vela
                if ($open <= 0) {
                    $open = (float) ($last['open'] ?? $close);
                    $this->observePrice = $open;
                }
            }
        }
        $dir = $this->observeDir;
        $eps = max(1e-8, abs($open) * 1e-6);
        $wouldWin = ($dir === 'CALL' && $close > $open + $eps)
            || ($dir === 'PUT' && $close < $open - $eps);

        // WIN na observação → reseta (igual Double: “saiu ✅ — resetando”)
        if ($wouldWin) {
            $this->msg("⚠️ Observação: {$dir} {$this->observeAsset} teria ganho ✅ — resetando (sem aposta)");
            $this->observeActive = false;
            $this->observeSimulateGales = false;
            $this->observeGale = 0;
            $this->sfeReady = false;
            $this->nextEntryAfter = time() + 2;
            return;
        }

        // LOSS na observação
        if ($this->observeSimulateGales) {
            // Entrada após loss: sobe gale virtual até esgotar (igual Double sfeVirtualGaleCount)
            $this->observeGale++;
            if ($this->observeGale <= $this->observeMaxGale) {
                $this->observePrice = $close > 0 ? $close : $this->observePrice;
                $this->observeUntil = time() + max(45, $this->observeExp * 60);
                $this->msg(
                    "🔍 Observação: gale virtual {$this->observeGale}/{$this->observeMaxGale} · {$dir} {$this->observeAsset}"
                );
                return;
            }
            $this->msg('✅ Observação: sequência de gale perderia — entrando na próxima de verdade');
        } else {
            // Pular 1ª: 1 rodada não bateu → entra de verdade no MESMO sinal (sfeReady)
            $this->msg("✅ Observação: {$dir} {$this->observeAsset} NÃO bateu — entrando de verdade no mesmo sinal");
        }

        // sfeReady: próxima tick abre este dir/asset/exp (não re-detecta nem re-observa)
        $this->sfeReady = true;
        $this->readyDir = $this->observeDir;
        $this->readyAsset = $this->observeAsset;
        $this->readyLabel = $this->observeLabel !== '' ? $this->observeLabel : $this->observeAsset;
        $this->readyExp = $this->observeExp;
        $this->observeActive = false;
        $this->observeSimulateGales = false;
        $this->observeGale = 0;
        $this->nextEntryAfter = time() + 1;
    }

    /** @return list<string> */
    public static function parseAssetList(string $raw): array
    {
        $parts = array_values(array_filter(array_map('trim', explode(',', $raw !== '' ? $raw : 'EURUSD-OTC'))));
        return $parts ?: ['EURUSD-OTC'];
    }

    /**
     * @return list<array{open:float,high:float,low:float,close:float}>|null
     */
    private function getCandlesCached(string $ssid, string $asset, int $size, int $count): ?array
    {
        $key = $asset . ':' . $size;
        $now = time();
        if (isset($this->candleCache[$key]) && ($now - (int) $this->candleCache[$key]['ts']) < 12) {
            return $this->candleCache[$key]['candles'];
        }
        $res = IqOptionBridge::candles($ssid, $asset, $size, $count);
        if (empty($res['ok']) || empty($res['candles']) || !is_array($res['candles'])) {
            return $this->candleCache[$key]['candles'] ?? null;
        }
        $this->candleCache[$key] = ['ts' => $now, 'candles' => $res['candles']];
        return $res['candles'];
    }

    private function openEntry(string $direction, string $asset, int $expMin, string $pattern): void
    {
        // Trava imediata: evita 2ª entrada enquanto a 1ª ainda está sendo enviada (placeOption demora)
        if ($this->betInFlight) {
            log_msg('[daytrade] openEntry ignorado — já há entrada em andamento', 'daytrade');
            return;
        }
        $this->betInFlight = true;

        $settings = $this->cachedSettings ?? $this->getSettings();
        $u = UserRepository::find($this->userId);
        if (!$settings || !$u) {
            $this->betInFlight = false;
            return;
        }
        $ssid = (string) ($u['iqSsid'] ?? '');
        $balId = (int) ($u['iqBalanceId'] ?? 0);
        if ($ssid === '' || $balId <= 0) {
            $this->betInFlight = false;
            $this->msg('⚠️ Sem sessão IQ Option — reconecte a conta.');
            return;
        }

        $amount = $this->calcAmount($settings);
        if ($amount < 2) {
            $this->betInFlight = false;
            $this->msg('⚠️ Valor de entrada mínimo é R$ 2,00.');
            return;
        }
        if ($this->currentGale > 0) {
            $mult = (float) ($settings['martingaleMultiplier'] ?? 2) ?: 2;
            $amount = round($amount * pow($mult, $this->currentGale), 2);
        }

        // marca no banco ANTES da API (painel trava botão / abas)
        UserRepository::update($this->userId, ['daytradeIsBetting' => 1]);

        $entryLabel = "{$direction} {$asset}";
        $this->msg(
            "⏳ Entrando {$entryLabel} · R$ " . number_format($amount, 2, '.', '')
            . " · {$expMin}m | 📋 {$pattern}"
            . ($this->currentGale > 0 ? " · Gale {$this->currentGale}" : '')
        );

        // snapshot de saldo e preço para fallback de resultado
        $balBefore = 0.0;
        $varsBal = Database::fetch('SELECT balance FROM daytrade_variables WHERE ownerId = ?', [$this->userId]);
        if ($varsBal) {
            $balBefore = (float) ($varsBal['balance'] ?? 0);
        }
        $openPrice = 0.0;
        $candles = $this->getCandlesCached($ssid, $asset, 60, 5);
        if ($candles) {
            $last = $candles[count($candles) - 1];
            $openPrice = (float) ($last['close'] ?? $last['open'] ?? 0);
        }

        $res = IqOptionBridge::placeOption([
            'ssid' => $ssid,
            'balanceId' => $balId,
            'asset' => $asset,
            'direction' => strtolower($direction),
            'amount' => $amount,
            'expirationMinutes' => $expMin,
        ]);

        if (empty($res['ok'])) {
            $err = (string) ($res['error'] ?? 'falha');
            $this->betInFlight = false;
            UserRepository::update($this->userId, ['daytradeIsBetting' => 0]);
            $this->msg("❌ Ordem não enviada: {$err}");
            log_msg('[daytrade] place fail ' . json_encode($res, JSON_UNESCAPED_UNICODE), 'daytrade');
            return;
        }

        $optionId = isset($res['optionId']) && $res['optionId'] !== null && $res['optionId'] !== ''
            ? (string) $res['optionId']
            : null;
        if ($optionId === null) {
            // tenta extrair de raw
            $raw = $res['raw'] ?? null;
            if (is_array($raw) && isset($raw['id'])) {
                $optionId = (string) $raw['id'];
            }
        }

        $this->currentAmount = $amount;
        $this->currentDirection = $direction;
        $this->currentAsset = $asset;
        $this->pendingOptionId = $optionId;
        $this->pendingOpenPrice = $openPrice;
        $this->pendingBalanceBefore = $balBefore;
        $this->pendingExpMin = $expMin;
        $this->pendingPattern = $pattern;
        // expira no horário da IQ; se bridge não mandou, expMin minutos a partir de agora
        $this->pendingExpireAt = (int) ($res['expired'] ?? (time() + $expMin * 60));
        if ($this->pendingExpireAt < time() + 30) {
            $this->pendingExpireAt = time() + $expMin * 60;
        }

        $entryId = 0;
        try {
            $entryId = (int) Database::insert('daytrade_entries', [
                'ownerId' => $this->userId,
                'type' => $this->currentGale > 0 ? 'GALE' : 'ENTRADA',
                'asset' => $asset,
                'direction' => $direction,
                'amount' => $amount,
                'expiration' => $expMin,
                'pattern' => $pattern,
                'mode' => $this->isDemo() ? 'DEMO' : 'REAL',
                'externalId' => $this->pendingOptionId,
            ]);
        } catch (\Throwable $e) {
            log_msg('[daytrade] insert entry fail: ' . $e->getMessage(), 'daytrade');
        }
        $this->pendingEntryId = $entryId;

        $this->msg(
            '✅ Ordem enviada: ' . $direction . ' ' . $asset
            . ' · $' . number_format($amount, 2, '.', '')
            . ($this->pendingOptionId ? " · id={$this->pendingOptionId}" : ' · (sem id — resultado por vela/saldo)')
            . ' · aguardando resultado…'
        );

        // push/popup igual aos outros jogos (respeita notifyPrefs do usuário)
        if ($this->currentGale === 0) {
            Notify::notifyUser(
                $this->userId,
                'entrada',
                "Entrando: {$entryLabel} — R$ " . number_format($amount, 2, '.', '') . " · {$expMin}m",
                'Day Trade',
                'IQOPTION'
            );
        }
    }

    private function resolvePending(): void
    {
        $u = UserRepository::find($this->userId);
        $ssid = (string) ($u['iqSsid'] ?? '');
        $balId = (int) ($u['iqBalanceId'] ?? 0);
        $result = null;
        $profit = null;
        $source = '';

        // 1) API IQ (position / history)
        if ($ssid !== '' && $this->pendingOptionId) {
            $res = IqOptionBridge::optionResult($ssid, $this->pendingOptionId, $balId);
            if (!empty($res['ok']) && !empty($res['result'])) {
                $result = strtoupper((string) $res['result']);
                $profit = isset($res['profit']) && $res['profit'] !== null ? (float) $res['profit'] : null;
                $source = 'IQ';
            }
        }

        // 2) Fallback por velas (preço abertura vs fechamento) — a partir de +8s do expire
        if ($result === null && $ssid !== '' && $this->currentAsset !== '' && time() >= $this->pendingExpireAt + 8) {
            unset($this->candleCache[$this->currentAsset . ':60']);
            $candles = $this->getCandlesCached($ssid, $this->currentAsset, 60, 12);
            if ($candles && count($candles) >= 2) {
                $close = (float) ($candles[count($candles) - 1]['close'] ?? 0);
                // se não capturou open na entrada, usa open da penúltima vela
                $open = $this->pendingOpenPrice > 0
                    ? $this->pendingOpenPrice
                    : (float) ($candles[count($candles) - 2]['open'] ?? $candles[count($candles) - 2]['close'] ?? 0);
                if ($close > 0 && $open > 0) {
                    $dir = strtoupper($this->currentDirection);
                    $won = ($dir === 'CALL' && $close > $open) || ($dir === 'PUT' && $close < $open);
                    $draw = abs($close - $open) / max($open, 1e-8) < 1e-6;
                    if ($draw) {
                        $result = 'EMPATE';
                        $profit = 0.0;
                    } else {
                        $result = $won ? 'WIN' : 'LOSS';
                        $profit = $won ? round($this->currentAmount * 0.80, 2) : -abs($this->currentAmount);
                    }
                    $source = 'vela';
                    log_msg(
                        "[daytrade] result via candle {$dir} open={$open} close={$close} => {$result}",
                        'daytrade'
                    );
                }
            }
        }

        // 3) Fallback por variação de saldo (+12s)
        if ($result === null && $ssid !== '' && time() >= $this->pendingExpireAt + 12) {
            $balNow = $this->syncBalance();
            if ($balNow !== null && $this->pendingBalanceBefore > 0) {
                $delta = round($balNow - $this->pendingBalanceBefore, 2);
                if ($delta >= 0.4) {
                    $result = 'WIN';
                    $profit = $delta;
                    $source = 'saldo';
                } elseif ($delta <= -0.4) {
                    $result = 'LOSS';
                    $profit = $delta;
                    $source = 'saldo';
                }
            }
        }

        // se ainda sem resultado, tenta de novo por até ~2 min após expire
        if ($result === null) {
            $grace = time() - $this->pendingExpireAt;
            if ($grace < 120) {
                return;
            }
            // último recurso: marca LOSS com stake (protege gale/ciclo) se a aposta existiu
            if ($this->currentAmount >= 1) {
                $this->msg('⏱️ IQ sem retorno — assumindo LOSS da stake (confira no app).');
                $this->finishPending('LOSS', -abs($this->currentAmount));
                return;
            }
            $this->msg('⏱️ Sem resultado da IQ após expiração — confira no app.');
            $this->finishPending(null, null);
            return;
        }

        $this->finishPending($result, $profit);
    }

    private function finishPending(?string $result, ?float $profit): void
    {
        $amount = $this->currentAmount;
        $settings = $this->cachedSettings ?? $this->getSettings();
        $maxGale = (int) ($settings['martingale'] ?? 0);

        // grava resultado na daytrade_entries
        try {
            if ($this->pendingEntryId > 0) {
                Database::query(
                    'UPDATE daytrade_entries SET result = ?, profit = ? WHERE id = ? AND ownerId = ?',
                    [$result, $profit, $this->pendingEntryId, $this->userId]
                );
            } elseif ($this->pendingOptionId) {
                Database::query(
                    'UPDATE daytrade_entries SET result = ?, profit = ? WHERE ownerId = ? AND externalId = ? ORDER BY id DESC LIMIT 1',
                    [$result, $profit, $this->userId, $this->pendingOptionId]
                );
            }
        } catch (\Throwable) {
        }

        $vars = Database::fetch('SELECT * FROM daytrade_variables WHERE ownerId = ?', [$this->userId]);
        $winCount = (int) ($vars['countWin'] ?? 0);
        $lossCount = (int) ($vars['countLoss'] ?? 0);
        $sessionProfit = (float) ($vars['profit'] ?? 0);

        $galesExhausted = false;

        $mode = $this->isDemo() ? 'DEMO' : 'REAL';
        $monthWin = (int) ($vars['monthCountWin'] ?? 0);
        $monthLoss = (int) ($vars['monthCountLoss'] ?? 0);

        if ($result === 'WIN') {
            $pnl = $profit ?? $amount; // fallback se IQ não devolver pnl
            $sessionProfit += $pnl;
            $winCount++;
            $monthWin++;
            $this->msg(
                '✅ WIN — ' . $this->currentDirection . ' ' . $this->currentAsset
                . ' | Lucro: R$ ' . number_format($pnl, 2, '.', '')
                . ' · sessão $' . number_format($sessionProfit, 2, '.', '')
            );
            $this->currentGale = 0;
            // WIN zera contador de ciclos de loss (igual Double/Bac Bo)
            $this->cycleCount = 0;
            Database::update(
                'daytrade_variables',
                [
                    'countWin' => $winCount,
                    'monthCountWin' => $monthWin,
                    'profit' => $sessionProfit,
                    'countMartingale' => 0,
                    'isGale' => 0,
                    'lastDirection' => $this->currentDirection,
                    'lastAsset' => $this->currentAsset,
                ],
                'ownerId = :oid',
                ['oid' => $this->userId]
            );
            // painel inicial (bot_entries)
            BotEntryLogger::log(
                $this->userId,
                'WIN',
                'DAY_TRADE',
                'IQOPTION',
                $this->currentDirection,
                $this->currentAsset,
                null,
                $amount,
                $pnl,
                0,
                $mode
            );
            Notify::notifyUser(
                $this->userId,
                'win',
                'WIN — ' . $this->currentDirection . ' ' . $this->currentAsset
                    . ' | Lucro: R$ ' . number_format($sessionProfit, 2, '.', ''),
                'Day Trade',
                'IQOPTION'
            );
        } elseif ($result === 'LOSS') {
            $pnl = $profit ?? -$amount;
            $sessionProfit += $pnl;
            $lossCount++;
            $this->msg(
                '❌ LOSS — ' . $this->currentDirection . ' ' . $this->currentAsset
                . ' | Lucro: R$ ' . number_format($pnl, 2, '.', '')
                . ' · sessão $' . number_format($sessionProfit, 2, '.', '')
            );
            Database::update(
                'daytrade_variables',
                [
                    'countLoss' => $lossCount,
                    'profit' => $sessionProfit,
                    'lastDirection' => $this->currentDirection,
                    'lastAsset' => $this->currentAsset,
                ],
                'ownerId = :oid',
                ['oid' => $this->userId]
            );

            if ($this->currentGale < $maxGale) {
                $this->currentGale++;
                Database::update(
                    'daytrade_variables',
                    ['countMartingale' => $this->currentGale, 'isGale' => 1],
                    'ownerId = :oid',
                    ['oid' => $this->userId]
                );
                $this->msg(
                    "🔄 Gale {$this->currentGale}/{$maxGale}: *{$this->currentDirection}* {$this->currentAsset} — em breve…"
                );
                // GALE intermediário (não conta como LOSS final no relatório mensal)
                BotEntryLogger::log(
                    $this->userId,
                    'GALE',
                    'DAY_TRADE',
                    'IQOPTION',
                    $this->currentDirection,
                    $this->currentAsset,
                    $this->pendingPattern !== '' ? $this->pendingPattern : null,
                    $amount,
                    $pnl,
                    $this->currentGale,
                    $mode
                );
            } else {
                // gales esgotados → fecha ciclo de loss
                $this->currentGale = 0;
                $galesExhausted = true;
                $monthLoss++;
                // HEDGING: marca direção oposta para a próxima entrada
                $hasHedge = false;
                foreach ($this->cachedStrategies ?? $this->loadStrategies() as $st) {
                    if (strtoupper((string) ($st['strategyType'] ?? '')) === 'HEDGING') {
                        $hasHedge = true;
                        break;
                    }
                }
                if ($hasHedge && $this->currentDirection !== '') {
                    $this->hedgeForceDir = $this->currentDirection === 'CALL' ? 'PUT' : 'CALL';
                    $this->msg('🛡️ Hedging: próxima entrada forçada em ' . $this->hedgeForceDir);
                }
                Database::update(
                    'daytrade_variables',
                    [
                        'countMartingale' => 0,
                        'isGale' => 0,
                        'monthCountLoss' => $monthLoss,
                    ],
                    'ownerId = :oid',
                    ['oid' => $this->userId]
                );
                BotEntryLogger::log(
                    $this->userId,
                    'LOSS',
                    'DAY_TRADE',
                    'IQOPTION',
                    $this->currentDirection,
                    $this->currentAsset,
                    null,
                    $amount,
                    $pnl,
                    $maxGale,
                    $mode
                );
                Notify::notifyUser(
                    $this->userId,
                    'loss',
                    'LOSS — ' . $this->currentDirection . ' ' . $this->currentAsset
                        . ' | Lucro: R$ ' . number_format($sessionProfit, 2, '.', ''),
                    'Day Trade',
                    'IQOPTION'
                );
            }
        } elseif ($result === 'EMPATE') {
            $this->msg('➖ EMPATE · stake devolvida');
            $this->currentGale = 0;
            Database::update(
                'daytrade_variables',
                ['countMartingale' => 0, 'isGale' => 0],
                'ownerId = :oid',
                ['oid' => $this->userId]
            );
        }

        $savedDir = $this->currentDirection;
        $savedAsset = $this->currentAsset;
        $savedExp = max(1, $this->pendingExpMin);
        $savedPattern = $this->pendingPattern !== '' ? $this->pendingPattern : 'GALE';
        $galeLevel = $this->currentGale;

        $this->betInFlight = false;
        $this->pendingOptionId = null;
        $this->pendingExpireAt = 0;
        $this->pendingOpenPrice = 0.0;
        $this->pendingBalanceBefore = 0.0;
        $this->pendingExpMin = 1;
        $this->pendingEntryId = 0;
        // mantém pendingPattern até o gale fechar a sequência
        UserRepository::update($this->userId, ['daytradeIsBetting' => 0]);
        $this->syncBalance();

        // Gale imediato: MESMA direção, ativo e expiração da entrada original (igual Double)
        if ($result === 'LOSS' && $galeLevel > 0 && !$this->pendingStop && $this->running) {
            $galeLabel = "GALE {$galeLevel}/{$maxGale} · {$savedPattern}";
            $this->openEntry($savedDir, $savedAsset, $savedExp, $galeLabel);
            return;
        }
        $this->pendingPattern = '';

        // Ciclos: após gales esgotados, conta 1 ciclo de loss
        if ($galesExhausted && !$this->pendingStop) {
            $this->cycleCount++;
            $qty = max(1, (int) ($settings['quantityCycles'] ?? 1));
            if ($this->cycleCount < $qty) {
                $this->msg(
                    "❌ LOSS — gales esgotados · ciclo " . ($this->cycleCount) . "/{$qty}\n"
                    . "🔁 Próxima estratégia em breve (ciclo " . ($this->cycleCount + 1) . "/{$qty})"
                );
                $this->nextEntryAfter = time() + 3;
            } else {
                $this->msg(
                    "❌ LOSS — gales esgotados · {$this->cycleCount}/{$qty} ciclo(s) concluído(s)\n"
                    . "⏹️ Quantidade de ciclos atingida — bot parado."
                );
                $this->cycleCount = 0;
                $this->stop();
                UserRepository::update($this->userId, ['daytradeIsActive' => 0, 'daytradeIsBetting' => 0]);
                return;
            }
        }

        // WIN / EMPATE / ciclo intermediário: libera próxima estratégia após curto cooldown
        if ($result === 'WIN' || $result === 'EMPATE' || ($galesExhausted && $this->running)) {
            $this->nextEntryAfter = time() + 3;
        }

        if ($this->pendingStop) {
            $this->pendingStop = false;
            $this->stop();
            UserRepository::update($this->userId, ['daytradeIsActive' => 0]);
            $this->msg('⏹️ Bot Day Trade parado.');
        }
    }

    private function calcAmount(array $settings): float
    {
        if (($settings['enterType'] ?? '') === 'PORCENTAGEM') {
            $vars = Database::fetch('SELECT balance FROM daytrade_variables WHERE ownerId = ?', [$this->userId]);
            $bal = (float) ($vars['balance'] ?? 0);
            return max(2.0, round($bal * ((float) ($settings['enterPercent'] ?? 0) / 100), 2));
        }
        return max(2.0, round((float) ($settings['enterValue'] ?? 2), 2));
    }
}
