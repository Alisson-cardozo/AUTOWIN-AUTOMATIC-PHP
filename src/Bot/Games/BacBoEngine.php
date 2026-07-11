<?php

declare(strict_types=1);

namespace App\Bot\Games;

use App\Bot\Blaze\BlazeAPI;
use App\Bot\PatternAccuracy;
use App\Database;
use App\Models\UserRepository;
use App\Services\BotCommandService;
use App\Services\EvolutionBacBo;

/**
 * Motor Bac Bo — estratégias/gale/stop iguais ao Double.
 *
 * DEMO: saldo virtual + resultados via poll/webhook (multi-usuário por ownerId).
 * REAL: token Blaze do usuário → launch Evolution → WS bacbo.bet (por userId).
 * Sessões isoladas em storage/bacbo-evo/{userId}.json — não mistura contas.
 */
final class BacBoEngine
{
    private const COOLDOWN_ROUNDS = 2;
    // Payout líquido (lucro, não retorno total) de uma vitória no Empate —
    // Bac Bo paga tipicamente 8:1 no empate contra 1:1 em Player/Banker.
    private const EMPATE_NET_MULTIPLIER = 8;
    // Mesa real Blaze bac-bo (BacBo00000000001): tableMinLimit = 5.
    private const MIN_BET_DEMO = 5.0;
    private const MIN_BET_REAL = 5.0;

    private int $userId;
    private bool $forceReset;
    private bool $isDemo;
    private ?BlazeAPI $api;
    private bool $running = false;

    /** @var list<array{winner:string,score:int,player1:int,player2:int,banker1:int,banker2:int}> */
    private array $history = [];
    private ?string $lastSeenId = null;
    private int $liveRoundsCount = 0;
    // Começa em 0 — senão as 2 primeiras rodadas bloqueiam entrada pós-observação
    private int $cooldownRoundsRemaining = 0;

    private int $currentGale = 0;
    private float $currentBetAmount = 0;
    private float $currentProtectionAmount = 0;
    private int $cycleCount = 0;
    private float $cycleBaseAmount = 0;
    private float $simulatedBalance = 1000;

    private string $lastMatchedPattern = '';
    private ?float $lastMatchedPatternAccuracy = null;

    // Pular Primeira Entrada / Entrada Após Loss — mesmo mecanismo de
    // observação usado em DoubleEngine, adaptado pro fluxo de "1 chamada por
    // rodada nova" (Bac Bo não tem janela de aposta separada do resultado).
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
    /** Sinal REAL pendente (falha de mesa / aguardando janela) — re-tenta sem redetectar. */
    private ?string $pendingRealSignal = null;

    private ?array $cachedSettings = null;
    private ?array $cachedStrategies = null;
    private float $lastPollAt = 0;

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
        $this->initVariables();
        $this->preloadHistory();
        $this->cachedSettings = $this->getSettings();
        $this->cachedStrategies = $this->loadStrategies();
        // Primeira leitura só ancora lastSeenId (se ainda não veio do preload)
        // — não deve tratar o histórico inteiro como "rodadas ao vivo".
        $this->pollSource();
        $this->lastPollAt = microtime(true);

        if ($this->isDemo) {
            $this->msg('🟢 Bot Bac Bo iniciado (DEMO) — entradas simuladas');
        } else {
            $this->msg('🟢 Bot Bac Bo iniciado (REAL) — sessão Evolution isolada deste usuário');
            $this->warmRealSession();
        }
    }

    public function stop(): void
    {
        $this->running = false;
        // Não apaga sessão Evolution no stop curto — reutiliza no próximo start REAL
        // (clear só se logout/falha grave). Isolamento por userId permanece.
    }

    private function minBet(): float
    {
        return $this->isDemo ? self::MIN_BET_DEMO : self::MIN_BET_REAL;
    }

    private function warmRealSession(): void
    {
        $token = $this->api?->getToken();
        if (!$token) {
            // NÃO muda isDemo aqui — o usuário pediu CONTA REAL.
            // Entradas falham com erro claro até reconectar a Blaze.
            $this->msg('⚠️ Token Blaze ausente — modo REAL sem token. Conecte a conta Blaze e reinicie o bot.');
            return;
        }
        // Espelha banca real no painel Bac Bo (não deixar R$ 1000 de DEMO)
        try {
            $wallet = $this->api->getWallet();
            $bal = $this->api->extractBalance($wallet);
            if ($bal > 0) {
                $this->simulatedBalance = $bal;
                Database::update('bacbo_variables', [
                    'balance' => $bal,
                    'firstBalance' => $bal,
                    'profit' => 0,
                ], 'ownerId = :oid', ['oid' => $this->userId]);
            }
        } catch (\Throwable) {
            // mantém saldo já em bacbo_variables
        }
        try {
            $play = $this->api->playBacBo('BRL');
            $launchUrl = BlazeAPI::extractBacBoLaunchUrl(is_array($play) ? $play : []);
            $res = EvolutionBacBo::ensureSession($this->userId, $token, $launchUrl);
            if (!empty($res['ok'])) {
                $this->msg('🔗 Mesa Evolution pronta (user #' . $this->userId . ') · table ' . ($res['tableId'] ?? '?'));
            } else {
                $this->msg('⚠️ Launch Evolution: ' . ($res['error'] ?? 'falhou') . ' — tentará de novo em cada entrada (modo REAL mantido).');
            }
        } catch (\Throwable $e) {
            $this->msg('⚠️ Launch Bac Bo: ' . $e->getMessage() . ' — modo REAL mantido.');
        }
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
        if ($now - $this->lastPollAt >= 4) {
            $this->lastPollAt = $now;
            try {
                $this->pollSource();
            } catch (\Throwable $e) {
                log_msg('[bacbo] erro no poll: ' . $e->getMessage(), 'bot');
            }
        }
    }

    private function msg(string $m): void
    {
        $strategyType = (string) ($this->cachedSettings['strategyType'] ?? 'SEQUÊNCIA');
        BotCommandService::pushMessage($this->userId, $m, 'BLAZE', $strategyType);
        log_msg("[bacbo:{$this->userId}] $m", 'bot');
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
        return Database::fetch('SELECT * FROM bacbo_settings WHERE ownerId = ?', [$this->userId]);
    }

    private function loadStrategies(): array
    {
        return Database::fetchAll('SELECT * FROM bacbo_strategies WHERE ownerId = ?', [$this->userId]);
    }

    private function preloadHistory(): void
    {
        $rows = Database::fetchAll('SELECT * FROM bacbo_results ORDER BY id DESC LIMIT 14');
        if (!$rows) {
            return;
        }
        $this->history = array_map(static function (array $r): array {
            $winner = (string) $r['winner'];
            $pt = (int) ($r['playerTotal'] ?? ((int) $r['player1'] + (int) $r['player2']));
            $bt = (int) ($r['bankerTotal'] ?? ((int) $r['banker1'] + (int) $r['banker2']));
            $score = match ($winner) {
                'PlayerWon' => $pt,
                'BankerWon' => $bt,
                default => max($pt, $bt),
            };
            return [
                'winner' => $winner,
                'score' => $score,
                'player1' => (int) $r['player1'],
                'player2' => (int) $r['player2'],
                'banker1' => (int) $r['banker1'],
                'banker2' => (int) $r['banker2'],
                'playerTotal' => $pt,
                'bankerTotal' => $bt,
            ];
        }, $rows);
        $this->lastSeenId = (string) $rows[0]['externalId'];
    }

    /** @param array{id:string,created_at:string,diceplayer1:int,diceplayer2:int,dicebanker1:int,dicebanker2:int,winner:string,score?:int} $raw */
    private function pushHistory(array $raw): void
    {
        $winner = (string) $raw['winner'];
        $score = (int) ($raw['score'] ?? 0);
        if ($score <= 0) {
            $score = BacBoSource::scoreOfResult([
                'winner' => $winner,
                'player1' => (int) $raw['diceplayer1'],
                'player2' => (int) $raw['diceplayer2'],
                'banker1' => (int) $raw['dicebanker1'],
                'banker2' => (int) $raw['dicebanker2'],
            ]);
        }
        array_unshift($this->history, [
            'winner' => $winner,
            'score' => $score,
            'player1' => (int) $raw['diceplayer1'],
            'player2' => (int) $raw['diceplayer2'],
            'banker1' => (int) $raw['dicebanker1'],
            'banker2' => (int) $raw['dicebanker2'],
            'playerTotal' => $winner === 'PlayerWon' || $winner === 'Tie' ? $score : 0,
            'bankerTotal' => $winner === 'BankerWon' || $winner === 'Tie' ? $score : 0,
        ]);
        if (count($this->history) > 14) {
            array_pop($this->history);
        }
    }

    /**
     * Busca a fonte, persiste no banco (compartilhado com /api/game/bacbo/recent)
     * e dispara onNewResult() pra cada rodada ainda não vista por essa engine.
     */
    private function pollSource(): void
    {
        if (!$this->running) {
            return;
        }
        $results = BacBoSource::fetchSource();
        if (!$results) {
            return;
        }
        try {
            BacBoSource::persistNew($results);
        } catch (\Throwable $e) {
            log_msg('[bacbo] erro ao persistir: ' . $e->getMessage(), 'bot');
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
        $fresh = $knownIdx === null ? [$results[0]] : array_slice($results, 0, $knownIdx);
        if (!$fresh) {
            return;
        }
        $this->lastSeenId = $results[0]['id'];

        foreach (array_reverse($fresh) as $r) {
            if (!$this->running) {
                break;
            }
            $this->onNewResult($r);
        }
    }

    /** @param array{id:string,created_at:string,diceplayer1:int,diceplayer2:int,dicebanker1:int,dicebanker2:int,winner:string} $raw */
    private function onNewResult(array $raw): void
    {
        $this->liveRoundsCount++;
        if ($this->cooldownRoundsRemaining > 0) {
            $this->cooldownRoundsRemaining--;
        }

        $resultOutcome = BacBoSource::OUTCOME_NAME[BacBoSource::winnerCode((string) $raw['winner'])];

        if ($this->sfeObserving) {
            $this->handleObservationResult($resultOutcome);
            $this->pushHistory($raw);
            // Pós-observação: após o resultado, tenta entrar (REAL espera janela da mesa no bridge).
            if ($this->sfeReady && $this->running) {
                $this->cooldownRoundsRemaining = 0;
                log_msg("[bacbo:{$this->userId}] pós-observação → entrada após resultado ({$this->sfeColor})", 'bot');
                if (!$this->isDemo) {
                    $this->msg("📡 Resultado da observação recebido — verificando se a janela de apostas está aberta…");
                }
                $this->decideEntry();
            }
            return;
        }

        if ($this->betInFlight) {
            $this->resolveBet($resultOutcome);
            // resolveBet já tenta gale (com espera de janela em REAL); se bet em voo, para
            if ($this->betInFlight || !$this->running) {
                $this->pushHistory($raw);
                return;
            }
        }

        $this->pushHistory($raw);

        if ($this->betInFlight || !$this->running) {
            return;
        }
        if ($this->liveRoundsCount < 1) {
            return;
        }
        // Entrada pendente (pós-obs / falha REAL / gale) ignora cooldown e re-tenta
        if ($this->cooldownRoundsRemaining > 0 && !$this->sfeReady && $this->pendingRealSignal === null) {
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

        $vars = Database::fetch('SELECT * FROM bacbo_variables WHERE ownerId = ?', [$this->userId]);
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

        if ($this->pendingRealSignal !== null && $this->pendingRealSignal !== '') {
            // Re-tentativa REAL (mesa falhou / janela fechada) — não redetecta padrão
            $signal = $this->pendingRealSignal;
        } elseif ($inGale) {
            $signal = (string) $user['colorBefore'];
            if ($this->currentSignalColor === '') {
                $this->currentSignalColor = $signal;
            }
            if ($this->currentSignalPattern === '' && $this->lastMatchedPattern !== '') {
                $this->currentSignalPattern = $this->lastMatchedPattern;
            }
        } elseif ($this->sfeReady) {
            // NÃO limpa sfeReady antes de placeBet — se a aposta REAL falhar,
            // re-tenta na próxima rodada sem voltar para "observação".
            $signal = $this->sfeColor;
            $fromSfe = true;
            $this->lastMatchedPattern = $this->sfePattern;
            $this->lastMatchedPatternAccuracy = $this->sfeAccuracy;
        } else {
            $signal = $this->detectSignal($settings);
            if (!$signal) {
                return;
            }

            if (!empty($settings['skipFirstEntry'])) {
                $this->sfeObserving = true;
                $this->sfeSimulateGales = false;
                $this->sfeColor = $signal;
                $this->sfePattern = $this->lastMatchedPattern;
                $this->sfeAccuracy = $this->lastMatchedPatternAccuracy;
                $this->msg("🔍 Sinal detectado: *{$signal}* | 📋 {$this->lastMatchedPattern}{$this->accuracySuffix()}\n⏳ Aguardando 1ª rodada para confirmar...");
                return;
            }
            if (!empty($settings['skipEntryAfterLoss'])) {
                $usesWhiteGale = !empty($settings['whiteEntryGaleEnabled']) && $signal === 'EMPATE';
                $this->sfeObserving = true;
                $this->sfeSimulateGales = true;
                $this->sfeVirtualGaleCount = 0;
                $this->sfeMaxGale = $usesWhiteGale ? (int) $settings['whiteEntryGale'] : (int) $settings['martingale'];
                $this->sfeColor = $signal;
                $this->sfePattern = $this->lastMatchedPattern;
                $this->sfeAccuracy = $this->lastMatchedPatternAccuracy;
                $this->msg("🔍 Sinal detectado: *{$signal}* | 📋 {$this->lastMatchedPattern}{$this->accuracySuffix()}\n⏳ Simulando sequência de gale antes de confirmar...");
                return;
            }
        }

        $ok = $this->placeBet($signal, $settings, $vars);
        if ($ok) {
            $this->pendingRealSignal = null;
            if ($fromSfe) {
                $this->sfeReady = false;
                $this->sfeColor = '';
                $this->sfePattern = '';
                $this->sfeAccuracy = null;
            }
        } else {
            // Mantém sinal pendente (REAL sem mesa ou falha) — re-tenta no próximo resultado/tick
            $this->pendingRealSignal = $signal;
            if ($fromSfe) {
                log_msg("[bacbo:{$this->userId}] entrada pendente mantida (*{$signal}*) — re-tentará com janela aberta", 'bot');
            }
        }
    }

    private function handleObservationResult(string $resultOutcome): void
    {
        $settings = $this->cachedSettings ?? [];
        $protectionActive = ($settings['protectionHand'] ?? '') === 'SIM'
            && (float) ($settings['protectionValue'] ?? 0) > 0
            && $this->sfeColor !== 'EMPATE';
        $wouldWin = $resultOutcome === $this->sfeColor || ($resultOutcome === 'EMPATE' && $protectionActive);

        if ($wouldWin) {
            $this->sfeObserving = false;
            $this->sfeSimulateGales = false;
            $this->msg("⚠️ *Observação*: saiu {$resultOutcome} ✅ — sinal teria ganhado, resetando\n🔍 Aguardando novo sinal...");
            $this->logEntry('OBS_WIN', $this->sfeColor, $resultOutcome, $this->sfePattern);
            $this->sfeColor = '';
            $this->sfePattern = '';
            $this->sfeAccuracy = null;
        } elseif (!$this->sfeSimulateGales) {
            $this->sfeObserving = false;
            $waitHint = $this->isDemo
                ? "⏭️ Entrando em *{$this->sfeColor}* na próxima rodada"
                : "⏭️ Entrando em *{$this->sfeColor}* quando a mesa abrir apostas";
            $this->msg("✅ *Observação*: saiu {$resultOutcome} — não foi {$this->sfeColor}\n{$waitHint}");
            $this->logEntry('OBS_LOSS', $this->sfeColor, $resultOutcome, $this->sfePattern);
            $this->sfeReady = true;
        } else {
            $this->sfeVirtualGaleCount++;
            if ($this->sfeVirtualGaleCount <= $this->sfeMaxGale) {
                $this->msg("🔍 *Observação*: gale virtual {$this->sfeVirtualGaleCount}/{$this->sfeMaxGale} de *{$this->sfeColor}* também perderia — continuando a simular...");
            } else {
                $this->sfeObserving = false;
                $this->sfeSimulateGales = false;
                $waitHint = $this->isDemo
                    ? '— entrando na próxima rodada'
                    : '— entrando quando a mesa abrir apostas';
                $this->msg("✅ *Observação*: sequência de gale inteira de *{$this->sfeColor}* perderia ({$this->sfeMaxGale} gales) {$waitHint}");
                $this->logEntry('OBS_LOSS', $this->sfeColor, $resultOutcome, $this->sfePattern);
                $this->sfeReady = true;
            }
        }
    }

    /** @return bool true se a entrada foi aberta (betInFlight) */
    private function placeBet(string $signal, array $settings, array $vars): bool
    {
        $amount = $this->calcBetAmount($settings, $signal);
        if ($amount <= 0) {
            return false;
        }
        $min = $this->minBet();
        if ($amount < $min) {
            $amount = $min;
        }
        $this->currentBetAmount = $amount;

        $usesWhiteGale = !empty($settings['whiteEntryGaleEnabled']) && $signal === 'EMPATE';
        // Sincroniza gale com o banco (isGale / countMartingale) — evita entrada "sem mult" no gale
        $galeNum = (int) ($vars['countMartingale'] ?? 0);
        if (!empty($vars['isGale']) && $galeNum > 0) {
            $this->currentGale = $galeNum;
        }
        $maxGale = $usesWhiteGale ? (int) $settings['whiteEntryGale'] : (int) $settings['martingale'];
        // Recalcula amount se currentGale acabou de sincronizar
        if ($this->currentGale > 0) {
            $amount = $this->calcBetAmount($settings, $signal);
            if ($amount < $min) {
                $amount = $min;
            }
            $this->currentBetAmount = $amount;
        }

        $baseProt = (float) ($settings['protectionValue'] ?? 0);
        $rawHasProt = ($settings['protectionHand'] ?? '') === 'SIM' && $baseProt > 0 && $signal !== 'EMPATE';
        $protAmount = $rawHasProt
            ? round($baseProt * pow((float) ($settings['whiteMultiplier'] ?? 1), $this->currentGale), 2)
            : 0.0;
        $hasProt = $rawHasProt && $protAmount >= $min;
        $this->currentProtectionAmount = $hasProt ? $protAmount : 0;
        $protText = $hasProt ? ' + 🛡️ EMPATE R$ ' . number_format($protAmount, 2, '.', '') : '';

        // REAL: SOMENTE ficha na mesa Evolution (HTTP/WS). Sem "REAL-API" fantasma.
        // Fluxo: resultado (TipMiner) → bridge espera AcceptingBets/WaitingForBets → bacbo.bet.
        $modeTag = 'DEMO';
        if (!$this->isDemo) {
            $token = $this->api?->getToken();
            if (!$token) {
                $this->msg('⚠️ Sem token Blaze — entrada REAL abortada (reconecte a conta).');
                return false;
            }
            $modeTag = 'REAL';
            try {
                $launchUrl = null;
                try {
                    $play = $this->api->playBacBo('BRL');
                    $launchUrl = BlazeAPI::extractBacBoLaunchUrl(is_array($play) ? $play : []);
                } catch (\Throwable) {
                }
                $this->msg(
                    "⏳ *{$signal}* R$ " . number_format($amount, 2, '.', '')
                    . " — aguardando **janela de apostas aberta** na mesa Evolution…"
                );
                $res = EvolutionBacBo::placeBet(
                    $this->userId,
                    $token,
                    $signal,
                    $amount,
                    $this->currentProtectionAmount,
                    $launchUrl
                );
                if (empty($res['ok'])) {
                    $err = (string) ($res['error'] ?? 'erro desconhecido');
                    $this->msg(
                        "❌ Aposta REAL *não* enviada na mesa: {$err}\n"
                        . "🔁 Mantendo *{$signal}* — no próximo resultado tenta de novo **só com janela aberta**.\n"
                        . "💡 Feche o Bac Bo no browser (1 sessão por EVOSESSIONID)."
                    );
                    return false;
                }
                $conf = !empty($res['confirmed']) ? 'confirmada' : 'enviada';
                $gid = $res['gameId'] ?? '?';
                $this->msg(
                    "📡 Aposta REAL {$conf} na mesa " . ($res['tableId'] ?? '?')
                    . " · game {$gid} · R$ " . number_format($amount, 2, '.', '')
                    . " [janela aberta ✓]"
                );
            } catch (\Throwable $e) {
                $this->msg(
                    '⚠️ Bridge Evolution: ' . $e->getMessage()
                    . "\n🔁 Mantendo *{$signal}* — re-tentando após o próximo resultado (janela aberta)."
                );
                return false;
            }
        }

        UserRepository::update($this->userId, ['isBetting' => 1, 'colorBet' => $signal]);
        $this->betInFlight = true;
        $this->currentSignalColor = $signal;
        if ($this->lastMatchedPattern !== '') {
            $this->currentSignalPattern = $this->lastMatchedPattern;
        } elseif ($this->currentSignalPattern === '') {
            $this->currentSignalPattern = $this->lastMatchedPattern;
        }

        if ($this->currentGale > 0) {
            $this->msg(
                "🔄 Gale {$galeNum}/{$maxGale}: *{$signal}* — R$ " . number_format($amount, 2, '.', '')
                . $protText . " | 📋 {$this->currentSignalPattern}{$this->accuracySuffix()} [{$modeTag}]"
            );
            $this->logEntry(
                'GALE',
                $signal,
                null,
                $this->currentSignalPattern,
                $amount,
                null,
                $galeNum
            );
        } else {
            $this->msg(
                "🎯 Entrando: *{$signal}* — R$ " . number_format($amount, 2, '.', '')
                . $protText . " | 📋 {$this->currentSignalPattern}{$this->accuracySuffix()} [{$modeTag}]"
            );
            $this->logEntry(
                'ENTRADA',
                $signal,
                null,
                $this->currentSignalPattern,
                $amount,
                null,
                0
            );
        }
        return true;
    }

    private function resolveBet(string $resultOutcome): void
    {
        $user = UserRepository::find($this->userId);
        $betColor = $user['colorBet'] ?? null;
        if (!$betColor || empty($user['isBetting'])) {
            $this->betInFlight = false;
            return;
        }

        $hasProtectionHit = $resultOutcome === 'EMPATE' && $this->currentProtectionAmount > 0;
        $mainHit = $betColor === $resultOutcome;
        $won = $mainHit || $hasProtectionHit;

        UserRepository::update($this->userId, ['isBetting' => 0, 'colorBefore' => $betColor]);
        $this->betInFlight = false;

        // DEMO: atualiza saldo simulado. REAL: tenta espelhar banca Blaze se possível.
        $pv = ($this->currentProtectionAmount > 0 && $betColor !== 'EMPATE') ? $this->currentProtectionAmount : 0;
        if ($this->isDemo) {
            if ($won) {
                if ($resultOutcome === 'EMPATE' && $betColor !== 'EMPATE') {
                    $this->simulatedBalance += $pv * self::EMPATE_NET_MULTIPLIER - $this->currentBetAmount;
                } elseif ($resultOutcome === 'EMPATE' && $betColor === 'EMPATE') {
                    $this->simulatedBalance += $this->currentBetAmount * self::EMPATE_NET_MULTIPLIER;
                } else {
                    $this->simulatedBalance += $this->currentBetAmount - $pv;
                }
            } else {
                $this->simulatedBalance -= $this->currentBetAmount + $pv;
            }
        } else {
            try {
                if ($this->api) {
                    $wallet = $this->api->getWallet();
                    $this->simulatedBalance = $this->api->extractBalance($wallet);
                }
            } catch (\Throwable) {
                // mantém estimativa local se wallet falhar
                if ($won) {
                    $this->simulatedBalance += ($resultOutcome === 'EMPATE' && $betColor === 'EMPATE')
                        ? $this->currentBetAmount * self::EMPATE_NET_MULTIPLIER
                        : $this->currentBetAmount - $pv;
                } else {
                    $this->simulatedBalance -= $this->currentBetAmount + $pv;
                }
            }
        }

        $galeContinues = false;

        if ($won) {
            $patternMissed = $betColor !== $resultOutcome;
            $profit = $this->handleWin($resultOutcome, $patternMissed);
            $this->cooldownRoundsRemaining = self::COOLDOWN_ROUNDS;
            $vars = Database::fetch('SELECT * FROM bacbo_variables WHERE ownerId = ?', [$this->userId]);
            if ($vars) {
                $this->checkStop(array_merge($vars, ['profit' => $profit]));
            }
        } else {
            $res = $this->handleLoss($resultOutcome);
            if ($res['exhausted']) {
                $this->cooldownRoundsRemaining = self::COOLDOWN_ROUNDS;
                $vars = Database::fetch('SELECT * FROM bacbo_variables WHERE ownerId = ?', [$this->userId]);
                if ($vars) {
                    $this->checkStop(array_merge($vars, ['profit' => $res['newProfit']]));
                }
            } else {
                // Ainda tem gale — NÃO para no pendingStop até fechar o ciclo (WIN ou gales esgotados)
                $galeContinues = true;
            }
        }

        // Parar só quando a "entrada" terminou de verdade (sem gale pendente)
        if ($this->pendingStop && !$galeContinues) {
            $this->pendingStop = false;
            $this->stop();
            UserRepository::update($this->userId, ['isActive' => 0, 'isBetting' => 0]);
            $this->msg('⏹️ Entrada finalizada — parando o robô e todas as operações, como solicitado.');
            return;
        }

        // Próximo gale: logo após o RESULTADO, mas a ficha REAL só sai quando a
        // mesa abrir AcceptingBets/WaitingForBets (bridge espera a janela).
        if ($galeContinues && $this->running) {
            $this->cooldownRoundsRemaining = 0;
            $this->refreshCache();
            $settings = $this->cachedSettings ?? $this->getSettings();
            $vars = Database::fetch('SELECT * FROM bacbo_variables WHERE ownerId = ?', [$this->userId]);
            $signal = $this->currentSignalColor !== ''
                ? $this->currentSignalColor
                : (string) ($betColor ?? '');
            if ($settings && $vars && $signal !== '') {
                $this->pendingRealSignal = $signal;
                log_msg("[bacbo:{$this->userId}] LOSS → gale G{$this->currentGale} {$signal} (espera janela se REAL)", 'bot');
                if (!$this->isDemo) {
                    $this->msg(
                        "📡 *LOSS* registrado — verificando se a janela de apostas está aberta para o gale *{$signal}*…"
                    );
                }
                $ok = $this->placeBet($signal, $settings, $vars);
                if ($ok) {
                    $this->pendingRealSignal = null;
                }
                // se falhou, pendingRealSignal + isGale no banco → re-tenta no próximo onNewResult
            }
            return;
        }

        $this->refreshCache();
    }

    private function handleWin(string $resultOutcome, bool $patternMissed): float
    {
        $this->currentGale = 0;
        $this->cycleCount = 0;
        $this->cycleBaseAmount = 0;
        $this->sfeReady = false;
        $this->sfeObserving = false;
        $this->sfeSimulateGales = false;
        $this->sfeVirtualGaleCount = 0;
        $this->sfeColor = '';

        $newBalance = $this->simulatedBalance;
        $vars = Database::fetch('SELECT * FROM bacbo_variables WHERE ownerId = ?', [$this->userId]);
        $profit = $newBalance - (float) ($vars['firstBalance'] ?? $newBalance);

        Database::update('bacbo_variables', [
            'countWin' => (int) ($vars['countWin'] ?? 0) + 1,
            'monthCountWin' => (int) ($vars['monthCountWin'] ?? 0) + 1,
            'countMartingale' => 0,
            'isGale' => 0,
            'lastCycleWasLoss' => $patternMissed ? 1 : 0,
            'profit' => $profit,
            'balance' => $newBalance,
        ], 'ownerId = :oid', ['oid' => $this->userId]);

        $this->peakProfit = max($this->peakProfit, $profit);
        $this->msg("✅ *WIN* — {$resultOutcome}\nLucro: R$ " . number_format($profit, 2, '.', '') . "\nBanca atual: R$ " . number_format($newBalance, 2, '.', ''));
        $this->logEntry('WIN', $this->currentSignalColor, $resultOutcome, $this->currentSignalPattern, $this->currentBetAmount, $profit, (int) ($vars['countMartingale'] ?? 0));
        return $profit;
    }

    /** @return array{exhausted:bool,newProfit:float} */
    private function handleLoss(string $resultOutcome): array
    {
        $settings = $this->cachedSettings ?? [];
        $usesWhiteGale = !empty($settings['whiteEntryGaleEnabled']) && $this->currentSignalColor === 'EMPATE';
        $maxGale = $usesWhiteGale
            ? (int) ($settings['whiteEntryGale'] ?? $settings['martingale'] ?? 1)
            : (int) ($settings['martingale'] ?? 1);
        $vars = Database::fetch('SELECT * FROM bacbo_variables WHERE ownerId = ?', [$this->userId]);
        $newMartingale = (int) ($vars['countMartingale'] ?? 0) + 1;
        $newBalance = $this->simulatedBalance;
        $profit = $newBalance - (float) ($vars['firstBalance'] ?? $newBalance);

        if ($newMartingale <= $maxGale) {
            $this->currentGale = $newMartingale;
            Database::update('bacbo_variables', [
                'countMartingale' => $newMartingale,
                'isGale' => 1,
                'profit' => $profit,
                'balance' => $newBalance,
            ], 'ownerId = :oid', ['oid' => $this->userId]);
            $this->msg(
                "❌ *LOSS* — {$resultOutcome} | próximo Gale {$newMartingale}/{$maxGale}"
                . "\nLucro: R$ " . number_format($profit, 2, '.', '')
                . ($this->isDemo ? '' : "\n⏳ Após o resultado → só aposta se a **janela da mesa** estiver aberta")
            );
            // Não loga GALE aqui — GALE/ENTRADA só quando a ficha for de fato enviada em placeBet
            $this->logEntry(
                'LOSS',
                $this->currentSignalColor,
                $resultOutcome,
                $this->currentSignalPattern,
                $this->currentBetAmount,
                $profit,
                $newMartingale - 1
            );
            return ['exhausted' => false, 'newProfit' => $profit];
        }

        $this->cycleCount++;
        $this->currentGale = 0;
        Database::update('bacbo_variables', [
            'countLoss' => (int) ($vars['countLoss'] ?? 0) + 1,
            'monthCountLoss' => (int) ($vars['monthCountLoss'] ?? 0) + 1,
            'countMartingale' => 0,
            'isGale' => 0,
            'lastCycleWasLoss' => 1,
            'profit' => $profit,
            'balance' => $newBalance,
        ], 'ownerId = :oid', ['oid' => $this->userId]);

        $qty = (int) ($settings['quantityCycles'] ?? 1);
        if ($this->cycleCount < $qty) {
            $this->cycleBaseAmount = $this->currentBetAmount;
            $this->msg("❌ *LOSS* — {$resultOutcome} | Gales esgotados\n🔁 Ciclo " . ($this->cycleCount + 1) . "/{$qty} — nova base: R$ " . number_format($this->cycleBaseAmount, 2, '.', '') . "\nLucro: R$ " . number_format($profit, 2, '.', '') . "\nBanca atual: R$ " . number_format($newBalance, 2, '.', ''));
            $this->logEntry('LOSS', $this->currentSignalColor, $resultOutcome, $this->currentSignalPattern, $this->currentBetAmount, $profit, $newMartingale);
            return ['exhausted' => false, 'newProfit' => $profit];
        }

        $this->cycleCount = 0;
        $this->cycleBaseAmount = 0;
        $this->msg("❌ *LOSS* — {$resultOutcome} | Gales esgotados\nLucro: R$ " . number_format($profit, 2, '.', '') . "\nBanca atual: R$ " . number_format($newBalance, 2, '.', ''));
        $this->logEntry('LOSS', $this->currentSignalColor, $resultOutcome, $this->currentSignalPattern, $this->currentBetAmount, $profit, $newMartingale);
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
                $stopped = true;
            } else {
                $threshold = $this->peakProfit - $stopLoss;
                if ($stopLoss > 0 && $variables['profit'] <= $threshold) {
                    $lost = $this->peakProfit > 0
                        ? 'Proteção ativada! Lucro protegido: R$ ' . number_format($threshold, 2, '.', '')
                        : 'Perda: R$ ' . number_format(abs((float) $variables['profit']), 2, '.', '');
                    $this->msg("🛑 *STOP LOSS* atingido! {$lost}");
                    $stopped = true;
                }
            }
        } elseif (($settings['stopType'] ?? '') === 'QUANTIDADE') {
            if ((int) $variables['countWin'] >= $stopGain) {
                $this->msg('🏆 *STOP WIN* atingido! ' . (int) $variables['countWin'] . ' vitórias');
                $stopped = true;
            } elseif ((int) $variables['countLoss'] >= $stopLoss) {
                $this->msg('🛑 *STOP LOSS* atingido! ' . (int) $variables['countLoss'] . ' derrotas');
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
        $lastOutcomes = array_map(
            static fn (array $h) => BacBoSource::OUTCOME_NAME[BacBoSource::winnerCode($h['winner'])],
            array_slice($this->history, 0, 14)
        );
        $type = $settings['strategyType'] ?? 'SEQUÊNCIA';

        if ($type === 'SEQUÊNCIA') {
            $strategies = array_filter(
                $this->cachedStrategies ?? $this->loadStrategies(),
                static fn ($s) => ($s['strategyType'] ?? 'SEQUÊNCIA') === 'SEQUÊNCIA'
            );
            foreach ($strategies as $strategy) {
                $seq = array_map(static fn ($s) => strtoupper(trim($s)), explode(',', (string) $strategy['sequence']));
                if (count($seq) > count($lastOutcomes)) {
                    continue;
                }
                $match = true;
                foreach ($seq as $idx => $o) {
                    if ($o === 'X') {
                        continue;
                    }
                    if (($lastOutcomes[count($seq) - 1 - $idx] ?? null) !== $o) {
                        $match = false;
                        break;
                    }
                }
                if ($match) {
                    $this->lastMatchedPattern = $strategy['sequence'];
                    $target = strtoupper((string) $strategy['color']);
                    $acc = PatternAccuracy::computeBacBoWithTimeout($seq, $target, (int) ($settings['martingale'] ?? 0));
                    $this->lastMatchedPatternAccuracy = $acc['pct'] ?? null;
                    return $target;
                }
            }
            return null;
        }

        if ($type === 'SOMA') {
            $strategies = array_filter(
                $this->cachedStrategies ?? $this->loadStrategies(),
                static fn ($s) => ($s['strategyType'] ?? '') === 'SOMA'
            );
            foreach ($strategies as $strategy) {
                $items = array_map(static fn ($s) => strtoupper(trim($s)), explode(',', (string) $strategy['sequence']));
                if (count($items) > count($this->history)) {
                    continue;
                }
                $match = true;
                foreach ($items as $idx => $item) {
                    if (!BacBoSource::matchesSomaToken($item, $this->history[count($items) - 1 - $idx])) {
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

        // COPIAR SALA DE SINAL depende do listener MTProto (Telegram) — não
        // portado ainda, mesma lacuna de DoubleEngine/CrashEngine.
        return null;
    }

    private function calcBetAmount(array $settings, ?string $entryColor): float
    {
        $usesWhiteEntry = !empty($settings['whiteEntryGaleEnabled']) && $entryColor === 'EMPATE';
        $hasWhiteOverride = $usesWhiteEntry && (float) ($settings['whiteEntryValue'] ?? 0) > 0;

        if ($this->cycleBaseAmount > 0) {
            $amount = $this->cycleBaseAmount;
        } elseif ($hasWhiteOverride) {
            $amount = (float) ($settings['whiteEntryValue'] ?? 0);
        } elseif (($settings['enterType'] ?? '') === 'PORCENTAGEM') {
            $amount = $this->simulatedBalance * ((float) ($settings['enterPercent'] ?? 0) / 100);
        } else {
            $amount = (float) ($settings['enterValue'] ?? 0);
        }

        if ($this->currentGale > 0) {
            $multiplier = $usesWhiteEntry
                ? (float) ($settings['whiteEntryGaleMultiplier'] ?? $settings['martingaleMultiplier'] ?? 2)
                : (float) ($settings['martingaleMultiplier'] ?? 2);
            $amount *= pow($multiplier ?: 2, $this->currentGale);
        }

        return max(0.0, round($amount, 2));
    }

    private function initVariables(): void
    {
        $existing = Database::fetch('SELECT * FROM bacbo_variables WHERE ownerId = ?', [$this->userId]);
        if ($existing) {
            $this->simulatedBalance = (float) $existing['balance'];
        }

        $today = date('Y-m-d');
        $lastDate = $existing['firstBalanceDate'] ?? null;
        $isNewDay = (!$lastDate || date('Y-m-d', strtotime((string) $lastDate)) !== $today);
        $forceReset = $isNewDay || $this->forceReset;

        // DEMO: toda nova sessão (start do bot / novo dia) reinicia em R$ 1.000
        if ($this->isDemo && $forceReset) {
            $this->simulatedBalance = 1000.0;
        } elseif ($this->isDemo && $this->simulatedBalance <= 0) {
            $this->simulatedBalance = 1000.0;
        }

        // REAL: puxa carteira Blaze (nunca força 1000)
        if (!$this->isDemo && $this->api && $this->api->getToken()) {
            try {
                $wallet = $this->api->getWallet();
                $live = $this->api->extractBalance($wallet);
                if ($live > 0) {
                    $this->simulatedBalance = $live;
                }
            } catch (\Throwable) {
            }
        }

        $balance = $this->simulatedBalance;

        $monthKey = date('Y-m');
        $lastMonthDate = $existing['monthStartDate'] ?? null;
        $isNewMonth = (!$lastMonthDate || date('Y-m', strtotime((string) $lastMonthDate)) !== $monthKey);

        $abandonedGale = !empty($existing['isGale']);

        if ($existing) {
            $data = [
                'balance' => $balance,
                'profit' => 0,
                'firstBalance' => $balance,
                'firstBalanceDate' => now(),
                'countMartingale' => 0,
                'isGale' => 0,
            ];
            if ($abandonedGale) {
                $data['lastCycleWasLoss'] = 1;
            }
            if ($forceReset) {
                $data['countWin'] = 0;
                $data['countLoss'] = 0;
                // garante firstBalance alinhado à banca DEMO de 1000
                if ($this->isDemo) {
                    $data['balance'] = 1000;
                    $data['firstBalance'] = 1000;
                    $this->simulatedBalance = 1000.0;
                }
            }
            if ($isNewMonth) {
                $data['monthStartBalance'] = $this->isDemo ? 1000 : $balance;
                $data['monthStartDate'] = now();
                $data['monthCountWin'] = 0;
                $data['monthCountLoss'] = 0;
            }
            Database::update('bacbo_variables', $data, 'ownerId = :oid', ['oid' => $this->userId]);
        } else {
            $start = $this->isDemo ? 1000.0 : max(0.0, $balance);
            $this->simulatedBalance = $start;
            Database::insert('bacbo_variables', [
                'ownerId' => $this->userId,
                'balance' => $start,
                'firstBalance' => $start,
                'firstBalanceDate' => now(),
                'monthStartBalance' => $start,
                'monthStartDate' => now(),
            ]);
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
        try {
            Database::insert('bacbo_bot_entries', [
                'type' => $type,
                'signalColor' => $signal,
                'resultColor' => $result,
                'pattern' => $pattern,
                'betAmount' => $bet,
                'profit' => $profit,
                'galeLevel' => $gale,
                'ownerId' => $this->userId,
                'createdAt' => now(),
            ]);
        } catch (\Throwable) {
        }
        // Também no relatório mensal unificado (tela inicial)
        \App\Bot\BotEntryLogger::log(
            $this->userId,
            $type,
            'BACBO',
            'BLAZE',
            $signal,
            $result,
            $pattern,
            $bet,
            $profit,
            $gale
        );
    }
}
