<?php

declare(strict_types=1);

namespace App\Bot\Games;

use App\Bot\Blaze\BlazeAPI;
use App\Bot\PatternAccuracy;
use App\Database;
use App\Models\ConfigRepository;
use App\Models\UserRepository;

use App\Services\BotCommandService;
use App\Services\EvolutionBacBo;
use App\Services\Notify;
use App\Services\TelegramBridge;

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
    // Mesa Bac Bo Ao Vivo: tableMinLimit = 2.50 (entrada e proteção).
    private const MIN_BET_LIVE = 2.5;

    private int $userId;
    private bool $forceReset;
    private bool $isDemo;
    private ?BlazeAPI $api;
    /** @var 'bacbo'|'bacbo_live' sala Blaze (dados e mesa separados) */
    private string $room;
    private string $gameTypeCode;
    private string $roomLabel;
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

    // ── Telegram / COPIAR SALA DE SINAL ──────────────────────────
    private ?string $pendingTelegramSignal = null;
    private int $lastTgMsgId = 0;
    private bool $tgCursorSeeded = false;
    private float $lastTgPoll = 0;
    private bool $tgAnnounced = false;
    private ?string $tgSession = null;
    private ?string $tgGroupId = null;
    /** @var list<string> */
    private array $tgKeywords = [];
    private ?string $tgSignalKeyword = null;
    private bool $tgSignalKeywordVerified = false;
    private bool $tgConfigured = false;

    private ?array $cachedSettings = null;
    private ?array $cachedStrategies = null;
    private float $lastPollAt = 0;

    public function __construct(
        int $userId,
        bool $forceReset = false,
        ?BlazeAPI $api = null,
        bool $isDemo = true,
        string $room = 'bacbo'
    ) {
        $this->userId = $userId;
        $this->forceReset = $forceReset;
        $this->api = $api;
        $this->isDemo = $isDemo || $api === null || $api->getToken() === null || $api->getToken() === '';
        $this->room = ($room === 'bacbo_live' || $room === 'bacbo-live' || $room === 'BACBO_LIVE')
            ? 'bacbo_live'
            : 'bacbo';
        $this->gameTypeCode = $this->room === 'bacbo_live' ? 'BACBO_LIVE' : 'BACBO';
        $this->roomLabel = $this->room === 'bacbo_live' ? 'Bac Bo Ao Vivo' : 'Bac Bo';
    }

    /** Tabela isolada por sala. */
    private function tbl(string $suffix): string
    {
        return $this->room === 'bacbo_live' ? 'bacbo_live_' . $suffix : 'bacbo_' . $suffix;
    }

    private function resultsGameKey(): string
    {
        return $this->room === 'bacbo_live' ? 'bacbo-live' : 'bacbo';
    }

    private function blazePlaySlug(): string
    {
        return $this->room === 'bacbo_live' ? 'bac-bo-ao-vivo' : 'bac-bo';
    }

    public function start(): void
    {
        $this->running = true;
        $this->initVariables();
        $this->preloadHistory();
        $this->cachedSettings = $this->getSettings();
        $this->cachedStrategies = $this->loadStrategies();
        $this->loadTelegramConfig();
        // Primeira leitura só ancora lastSeenId (se ainda não veio do preload)
        // — não deve tratar o histórico inteiro como "rodadas ao vivo".
        $this->pollSource();
        $this->lastPollAt = microtime(true);

        $stype = (string) ($this->cachedSettings['strategyType'] ?? 'SEQUÊNCIA');
        if ($this->isDemo) {
            $this->msg('🟢 Bot ' . $this->roomLabel . ' iniciado (DEMO) — entradas simuladas · ' . $stype);
        } else {
            $this->msg('🟢 Bot ' . $this->roomLabel . ' iniciado (REAL) — sessão Evolution isolada · ' . $stype);
            $this->warmRealSession();
        }

        if ($stype === 'COPIAR SALA DE SINAL') {
            if ($this->tgConfigured) {
                $this->msg('📡 Telegram conectado — aguardando sinais do grupo (PLAYER / BANKER / EMPATE)…');
                $this->tgAnnounced = true;
            } else {
                $this->msg('⚠️ COPIAR SALA DE SINAL: Telegram não configurado. Conecte o grupo em Estratégias (aba ' . $this->roomLabel . ').');
            }
        }
    }

    public function stop(): void
    {
        $this->running = false;
        $this->pendingTelegramSignal = null;
        // Não apaga sessão Evolution no stop curto — reutiliza no próximo start REAL
        // (clear só se logout/falha grave). Isolamento por userId permanece.
    }

    private function minBet(): float
    {
        if ($this->room === 'bacbo_live') {
            return self::MIN_BET_LIVE;
        }
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
                Database::update($this->tbl('variables'), [
                    'balance' => $bal,
                    'firstBalance' => $bal,
                    'profit' => 0,
                ], 'ownerId = :oid', ['oid' => $this->userId]);
            }
        } catch (\Throwable) {
            // mantém saldo já em bacbo_variables
        }
        try {
            $play = $this->api->playBacBo('BRL', $this->blazePlaySlug());
            $launchUrl = BlazeAPI::extractBacBoLaunchUrl(is_array($play) ? $play : []);
            $res = EvolutionBacBo::ensureSession($this->userId, $token, $launchUrl);
            if (!empty($res['ok'])) {
                $this->msg('🔗 Mesa Evolution pronta (user #' . $this->userId . ') · table ' . ($res['tableId'] ?? '?'));
            } else {
                $code = (string) ($res['code'] ?? '');
                $err = (string) ($res['error'] ?? 'falhou');
                if ($code === 'AKAMAI_BLOCKED' || str_contains($err, 'Akamai')) {
                    $this->msg(
                        '🚫 Launch Evolution bloqueado pela **Akamai** (IP VPS). '
                        . 'Configure proxy residencial em **Admin → Proxy** — modo REAL mantido.'
                    );
                } else {
                    $this->msg('⚠️ Launch Evolution: ' . $err . ' — tentará de novo em cada entrada (modo REAL mantido).');
                }
            }
        } catch (\Throwable $e) {
            $this->msg('⚠️ Launch ' . $this->roomLabel . ': ' . $e->getMessage() . ' — modo REAL mantido.');
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
        $this->loadTelegramConfig();
    }

    public function tick(): void
    {
        if (!$this->running) {
            return;
        }
        $now = microtime(true);
        $settings = $this->cachedSettings ?? $this->getSettings();
        $stype = (string) ($settings['strategyType'] ?? 'SEQUÊNCIA');

        // COPIAR SALA: poll Telegram (~1.5s) e tenta entrar assim que o sinal chega
        if ($stype === 'COPIAR SALA DE SINAL') {
            if (!$this->tgConfigured) {
                $this->loadTelegramConfig();
            }
            if ($this->tgConfigured && $now - $this->lastTgPoll >= 1.5) {
                $this->lastTgPoll = $now;
                try {
                    $this->pollTelegramSignals();
                } catch (\Throwable $e) {
                    log_msg('[bacbo] tg poll: ' . $e->getMessage(), 'bot');
                }
            }
            // Sinal Telegram pronto + sem aposta em andamento → entra (REAL espera janela na mesa)
            if (
                $this->pendingTelegramSignal
                && !$this->betInFlight
                && !$this->sfeObserving
                && $this->running
            ) {
                $this->cooldownRoundsRemaining = 0;
                try {
                    $this->decideEntry();
                } catch (\Throwable $e) {
                    log_msg('[bacbo] decideEntry tg: ' . $e->getMessage(), 'bot');
                }
            }
        }

        // Resultados TipMiner / feed (resolve WIN/LOSS + sequências)
        if ($now - $this->lastPollAt >= 1.5) {
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
        log_msg("[{$this->gameTypeCode}:{$this->userId}] $m", 'bot');
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
        return Database::fetch('SELECT * FROM ' . $this->tbl('settings') . ' WHERE ownerId = ?', [$this->userId]);
    }

    private function loadStrategies(): array
    {
        return Database::fetchAll('SELECT * FROM ' . $this->tbl('strategies') . ' WHERE ownerId = ?', [$this->userId]);
    }

    private function preloadHistory(): void
    {
        $rows = Database::fetchAll('SELECT * FROM ' . $this->tbl('results') . ' ORDER BY id DESC LIMIT 14');
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
        $results = BacBoSource::fetchSource($this->resultsGameKey());
        if (!$results) {
            return;
        }
        try {
            BacBoSource::persistNew($results, $this->resultsGameKey());
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
                log_msg("[{$this->gameTypeCode}:{$this->userId}] pós-observação → entrada após resultado ({$this->sfeColor})", 'bot');
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
            log_msg("[BACBO-DEBUG:{$this->userId}] decideEntry abortado: cachedSettings vazio", 'bot');
            return;
        }

        $vars = Database::fetch('SELECT * FROM ' . $this->tbl('variables') . ' WHERE ownerId = ?', [$this->userId]);
        if (!$vars) {
            log_msg("[BACBO-DEBUG:{$this->userId}] decideEntry abortado: tabela variables vazia", 'bot');
            return;
        }
        $user = UserRepository::find($this->userId);
        if (!$user) {
            log_msg("[BACBO-DEBUG:{$this->userId}] decideEntry abortado: usuario nao encontrado no banco", 'bot');
            return;
        }

        if ($this->licenseExpired($user)) {
            $this->msg('⛔ Licença expirada — bot parado.');
            log_msg("[BACBO-DEBUG:{$this->userId}] Licenca expirada", 'bot');
            $this->stop();
            UserRepository::update($this->userId, ['isActive' => 0]);
            return;
        }

        $inGale = !empty($vars['isGale']) && !empty($user['colorBefore']);
        $fromSfe = false;
        $signal = '';

        if ($this->pendingRealSignal !== null && $this->pendingRealSignal !== '') {
            // Re-tentativa REAL (mesa falhou / janela fechada) — não redetecta padrão
            $signal = $this->pendingRealSignal;
            log_msg("[BACBO-DEBUG:{$this->userId}] Usando sinal pendente: {$signal}", 'bot');
        } elseif ($inGale) {
            $signal = (string) $user['colorBefore'];
            log_msg("[BACBO-DEBUG:{$this->userId}] Usando sinal de Gale (colorBefore): {$signal}", 'bot');
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
            log_msg("[BACBO-DEBUG:{$this->userId}] Usando sinal do SFE: {$signal}", 'bot');
        } else {
            $signal = $this->detectSignal($settings);
            if (!$signal) {
                log_msg("[BACBO-DEBUG:{$this->userId}] Nenhum padrao de estrategia detectado nesta rodada.", 'bot');
                return;
            }
            log_msg("[BACBO-DEBUG:{$this->userId}] Padrao detectado! Sinal: {$signal}", 'bot');

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

        $amount = $this->calcBetAmount($settings, $signal);
        log_msg("[BACBO-DEBUG:{$this->userId}] Valor calculado para aposta: R$ {$amount}", 'bot');
        if ($amount <= 0) {
            log_msg("[BACBO-DEBUG:{$this->userId}] Aposta abortada: valor calculado e <= 0", 'bot');
            return;
        }

        $ok = $this->placeBet($signal, $settings, $vars);
        log_msg("[BACBO-DEBUG:{$this->userId}] Chamada placeBet finalizada. Retorno: " . ($ok ? 'true' : 'false'), 'bot');
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
                log_msg("[{$this->gameTypeCode}:{$this->userId}] entrada pendente mantida (*{$signal}*) — re-tentará com janela aberta", 'bot');
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
                $slug = $this->blazePlaySlug();
                $proxyRaw = EvolutionBacBo::resolveProxyUrl();
                $proxyHint = $proxyRaw !== ''
                    ? (string) preg_replace('/:[^:@\/]+@/', ':***@', $proxyRaw)
                    : 'nenhum';
                log_msg(
                    "[{$this->gameTypeCode}-bet:{$this->userId}] INÍCIO room={$this->room} slug={$slug}"
                    . " proxy={$proxyHint} signal={$signal} amount=" . number_format($amount, 2, '.', ''),
                    'bacbo-bet'
                );

                $launchUrl = null;
                try {
                    $play = $this->api->playBacBo('BRL', $slug);
                    $launchUrl = BlazeAPI::extractBacBoLaunchUrl(is_array($play) ? $play : []);
                    log_msg(
                        "[{$this->gameTypeCode}-bet:{$this->userId}] Blaze /play slug={$slug}"
                        . " launch=" . ($launchUrl ? 'ok' : 'vazio')
                        . " keys=" . (is_array($play) ? implode(',', array_slice(array_keys($play), 0, 8)) : '?'),
                        'bacbo-bet'
                    );
                } catch (\Throwable $ePlay) {
                    log_msg(
                        "[{$this->gameTypeCode}-bet:{$this->userId}] Blaze /play EXCEÇÃO: " . $ePlay->getMessage(),
                        'bacbo-bet'
                    );
                }
                $this->msg(
                    "⏳ *{$signal}* R$ " . number_format($amount, 2, '.', '')
                    . " — [{$this->roomLabel}] abrindo mesa Evolution"
                    . ($proxyRaw !== '' ? " via proxy…" : " (sem proxy)…")
                );
                $res = EvolutionBacBo::placeBet(
                    $this->userId,
                    $token,
                    $signal,
                    $amount,
                    $this->currentProtectionAmount,
                    $launchUrl,
                    $slug
                );
                $exitIp = (string) ($res['exitIp'] ?? '');
                log_msg(
                    "[{$this->gameTypeCode}-bet:{$this->userId}] RESULT {$signal} R$ " . number_format($amount, 2, '.', '')
                    . ($exitIp !== '' ? " exitIp={$exitIp}" : '')
                    . ' → ' . json_encode($res, JSON_UNESCAPED_UNICODE),
                    'bacbo-bet'
                );
                if (empty($res['ok'])) {
                    $err = (string) ($res['error'] ?? 'erro desconhecido');
                    $code = (string) ($res['code'] ?? '');
                    $busy = $code === 'connectionAlreadyExists'
                        || str_contains($err, 'connectionAlreadyExists')
                        || str_contains($err, 'já em uso')
                        || str_contains($err, 'ja em uso');
                    $akamai = $code === 'AKAMAI_BLOCKED'
                        || str_contains($err, 'Akamai')
                        || str_contains($err, 'bloqueou o /entry');
                    $hopHint = '';
                    if (!empty($res['hops']) && is_array($res['hops'])) {
                        $parts = [];
                        foreach ($res['hops'] as $h) {
                            if (!is_array($h)) {
                                continue;
                            }
                            $parts[] = ($h['step'] ?? '?') . '=' . ($h['status'] ?? $h['error'] ?? '?');
                        }
                        if ($parts) {
                            $hopHint = "\n🔎 hops: " . implode(' · ', array_slice($parts, 0, 6));
                        }
                    }
                    if ($exitIp !== '') {
                        $hopHint .= "\n🌐 IP saída: `{$exitIp}`";
                    }
                    if ($akamai) {
                        // Só HTTPS — sem fallback de navegador/Chrome do cliente
                        $this->msg(
                            "❌ Akamai bloqueou a sessão REAL [{$this->roomLabel}].\n"
                            . "💡 Confira o **proxy residencial** (Admin → Proxy) e tente de novo.\n"
                            . "🔁 Mantendo *{$signal}* — tenta de novo no próximo sinal."
                            . $hopHint
                        );
                        log_msg(
                            "[{$this->gameTypeCode}-bet:{$this->userId}] AKAMAI_BLOCKED (sem browser fallback)",
                            'bacbo-bet'
                        );
                        return false;
                    } elseif ($busy) {
                        $this->msg(
                            "❌ Sessão Evolution **ocupada** [{$this->roomLabel}].\n"
                            . "💡 *Feche o Bac Bo no site* e **não** rode `bacbo-ws-feed` com a sessão do bot.\n"
                            . "🔁 Mantendo *{$signal}* — re-tentando com sessão nova exclusiva…"
                            . $hopHint
                        );
                    } else {
                        $this->msg(
                            "❌ Aposta REAL *não* enviada [{$this->roomLabel}]: {$err}\n"
                            . "📡 proxy: `{$proxyHint}` · code: " . ($code !== '' ? $code : '—') . "\n"
                            . "🔁 Mantendo *{$signal}* — no próximo resultado tenta de novo."
                            . $hopHint
                        );
                    }
                    return false;
                }
                $conf = !empty($res['confirmed']) ? 'confirmada' : 'enviada';
                $gid = $res['gameId'] ?? '?';
                $this->msg(
                    "📡 Aposta REAL {$conf} [{$this->roomLabel}] mesa " . ($res['tableId'] ?? '?')
                    . " · game {$gid} · R$ " . number_format($amount, 2, '.', '')
                    . " [janela aberta ✓]"
                );
            } catch (\Throwable $e) {
                log_msg("[{$this->gameTypeCode}-bet:{$this->userId}] exceção: " . $e->getMessage(), 'bacbo-bet');
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
            Notify::notifyUser($this->userId, 'entrada', "Entrando: {$signal} — R$ " . number_format($amount, 2, '.', ''), 'Bac Bo', 'BLAZE');
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
            $vars = Database::fetch('SELECT * FROM ' . $this->tbl('variables') . ' WHERE ownerId = ?', [$this->userId]);
            if ($vars) {
                $this->checkStop(array_merge($vars, ['profit' => $profit]));
            }
        } else {
            $res = $this->handleLoss($resultOutcome);
            if ($res['exhausted']) {
                $this->cooldownRoundsRemaining = self::COOLDOWN_ROUNDS;
                $vars = Database::fetch('SELECT * FROM ' . $this->tbl('variables') . ' WHERE ownerId = ?', [$this->userId]);
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
            $vars = Database::fetch('SELECT * FROM ' . $this->tbl('variables') . ' WHERE ownerId = ?', [$this->userId]);
            $signal = $this->currentSignalColor !== ''
                ? $this->currentSignalColor
                : (string) ($betColor ?? '');
            if ($settings && $vars && $signal !== '') {
                $this->pendingRealSignal = $signal;
                log_msg("[{$this->gameTypeCode}:{$this->userId}] LOSS → gale G{$this->currentGale} {$signal} (espera janela se REAL)", 'bot');
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
        $vars = Database::fetch('SELECT * FROM ' . $this->tbl('variables') . ' WHERE ownerId = ?', [$this->userId]);
        $profit = $newBalance - (float) ($vars['firstBalance'] ?? $newBalance);
        // Lucro da rodada (não o acumulado da sessão) — usado no histórico/relatório mensal
        $roundProfit = round($newBalance - (float) ($vars['balance'] ?? $newBalance), 2);
        if (abs($roundProfit) < 0.001) {
            $roundProfit = $this->currentBetAmount;
        }

        Database::update($this->tbl('variables'), [
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
        Notify::notifyUser($this->userId, 'win', "WIN — {$resultOutcome} | Lucro: R$ " . number_format($profit, 2, '.', ''), 'Bac Bo', 'BLAZE');
        $this->logEntry('WIN', $this->currentSignalColor, $resultOutcome, $this->currentSignalPattern, $this->currentBetAmount, $roundProfit, (int) ($vars['countMartingale'] ?? 0));
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
        $vars = Database::fetch('SELECT * FROM ' . $this->tbl('variables') . ' WHERE ownerId = ?', [$this->userId]);
        $newMartingale = (int) ($vars['countMartingale'] ?? 0) + 1;
        $newBalance = $this->simulatedBalance;
        $profit = $newBalance - (float) ($vars['firstBalance'] ?? $newBalance);
        // Lucro da rodada (não o acumulado da sessão) — usado no histórico/relatório mensal
        $roundProfit = round($newBalance - (float) ($vars['balance'] ?? $newBalance), 2);
        if (abs($roundProfit) < 0.001) {
            $roundProfit = -$this->currentBetAmount;
        }

        if ($newMartingale <= $maxGale) {
            $this->currentGale = $newMartingale;
            Database::update($this->tbl('variables'), [
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
            // GALE intermediário — ciclo ainda não finalizado, não conta como LOSS no relatório
            $this->logEntry(
                'GALE',
                $this->currentSignalColor,
                $resultOutcome,
                $this->currentSignalPattern,
                $this->currentBetAmount,
                $roundProfit,
                $newMartingale - 1
            );
            return ['exhausted' => false, 'newProfit' => $profit];
        }

        $this->cycleCount++;
        $this->currentGale = 0;
        Database::update($this->tbl('variables'), [
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
            Notify::notifyUser($this->userId, 'loss', "LOSS — {$resultOutcome} | Lucro: R$ " . number_format($profit, 2, '.', ''), 'Bac Bo', 'BLAZE');
            $this->logEntry('LOSS', $this->currentSignalColor, $resultOutcome, $this->currentSignalPattern, $this->currentBetAmount, $roundProfit, $newMartingale);
            return ['exhausted' => false, 'newProfit' => $profit];
        }

        $this->cycleCount = 0;
        $this->cycleBaseAmount = 0;
        $this->msg("❌ *LOSS* — {$resultOutcome} | Gales esgotados\nLucro: R$ " . number_format($profit, 2, '.', '') . "\nBanca atual: R$ " . number_format($newBalance, 2, '.', ''));
        Notify::notifyUser($this->userId, 'loss', "LOSS — {$resultOutcome} | Lucro: R$ " . number_format($profit, 2, '.', ''), 'Bac Bo', 'BLAZE');
        $this->logEntry('LOSS', $this->currentSignalColor, $resultOutcome, $this->currentSignalPattern, $this->currentBetAmount, $roundProfit, $newMartingale);
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
                Notify::notifyUser($this->userId, 'stopWin', 'Stop Win atingido — Lucro: R$ ' . number_format((float) $variables['profit'], 2, '.', ''), 'Bac Bo', 'BLAZE');
                $stopped = true;
            } else {
                $threshold = $this->peakProfit - $stopLoss;
                if ($stopLoss > 0 && $variables['profit'] <= $threshold) {
                    $lost = $this->peakProfit > 0
                        ? 'Proteção ativada! Lucro protegido: R$ ' . number_format($threshold, 2, '.', '')
                        : 'Perda: R$ ' . number_format(abs((float) $variables['profit']), 2, '.', '');
                    $this->msg("🛑 *STOP LOSS* atingido! {$lost}");
                    Notify::notifyUser($this->userId, 'stopLoss', "Stop Loss atingido! {$lost}", 'Bac Bo', 'BLAZE');
                    $stopped = true;
                }
            }
        } elseif (($settings['stopType'] ?? '') === 'QUANTIDADE') {
            if ((int) $variables['countWin'] >= $stopGain) {
                $this->msg('🏆 *STOP WIN* atingido! ' . (int) $variables['countWin'] . ' vitórias');
                Notify::notifyUser($this->userId, 'stopWin', 'Stop Win atingido — ' . (int) $variables['countWin'] . ' vitórias', 'Bac Bo', 'BLAZE');
                $stopped = true;
            } elseif ((int) $variables['countLoss'] >= $stopLoss) {
                $this->msg('🛑 *STOP LOSS* atingido! ' . (int) $variables['countLoss'] . ' derrotas');
                Notify::notifyUser($this->userId, 'stopLoss', 'Stop Loss atingido — ' . (int) $variables['countLoss'] . ' derrotas', 'Bac Bo', 'BLAZE');
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
                    $acc = PatternAccuracy::computeBacBoWithTimeout(
                        $seq,
                        $target,
                        (int) ($settings['martingale'] ?? 0),
                        3000,
                        7,
                        $this->tbl('results')
                    );
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

        // COPIAR SALA DE SINAL — consome sinal pendente do poll Telegram
        if ($type === 'COPIAR SALA DE SINAL') {
            if ($this->pendingTelegramSignal) {
                $spot = $this->pendingTelegramSignal;
                $this->pendingTelegramSignal = null;
                $this->lastMatchedPattern = 'Telegram';
                $this->lastMatchedPatternAccuracy = null;
                return $spot;
            }
            return null;
        }

        return null;
    }

    // ── Telegram / COPIAR SALA (Bac Bo: PLAYER | BANKER | EMPATE) ──

    private function loadTelegramConfig(): void
    {
        $this->tgConfigured = false;
        $this->tgSession = null;
        $this->tgGroupId = null;
        $this->tgKeywords = [];
        $this->tgSignalKeyword = null;
        $this->tgSignalKeywordVerified = false;

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
            $this->tgKeywords = is_array($decoded) ? array_values(array_map('strval', $decoded)) : [];
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
            log_msg("[{$this->gameTypeCode}:{$this->userId}] tg: TELEGRAM_API_ID/HASH ausentes no admin", 'bot');
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
            log_msg("[{$this->gameTypeCode}:{$this->userId}] tg poll error: " . ($result['error'] ?? '?'), 'bot');
            return;
        }

        if (isset($result['authorized']) && $result['authorized'] === false) {
            log_msg("[{$this->gameTypeCode}:{$this->userId}] sessão Telegram inválida — desconectando", 'bot');
            Database::update('telegram_userbots', ['isConnected' => 0], 'ownerId = :oid', ['oid' => $this->userId]);
            $this->tgConfigured = false;
            $this->msg('⚠️ Sessão do Telegram expirada. Reconecte em Estratégias.');
            return;
        }

        $messages = $result['messages'] ?? [];
        if (!is_array($messages)) {
            return;
        }

        // Primeira leitura: só ancora o cursor (não processa histórico antigo)
        if (!$this->tgCursorSeeded) {
            $maxId = $this->lastTgMsgId;
            foreach ($messages as $m) {
                $id = (int) ($m['id'] ?? 0);
                if ($id > $maxId) {
                    $maxId = $id;
                }
            }
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
            log_msg("[{$this->gameTypeCode}:{$this->userId}] tg cursor seed id={$this->lastTgMsgId}", 'bot');
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
        // Filtro: mensagem-chave tem prioridade; senão keywords
        if ($this->tgSignalKeyword) {
            $tpl = preg_replace('/PLAYER|BANKER|EMPATE|TIE|AZUL|VERMELHO|PRETO|BRANCO|🔵|🔴|🟡|⚪|⚫|⬛/iu', '', $this->tgSignalKeyword) ?? '';
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

        $spot = null;
        if ($this->tgSignalKeyword) {
            $spot = $this->extractBacBoFromSignalKeyword($this->tgSignalKeyword, $msg)
                ?? $this->extractBacBoFromMessage($msg);
        } else {
            $spot = $this->extractBacBoFromMessage($msg);
        }

        if (!$spot) {
            return;
        }

        // Calibração da mensagem-chave (1ª detecção não aposta)
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
            $this->msg(
                "⚙️ *Calibração da Mensagem-Chave*\n"
                . "✅ Lado detectado: *{$spot}*\n\n"
                . "Mensagem-chave validada! A próxima entrada será realizada normalmente."
            );
            log_msg("[{$this->gameTypeCode}:{$this->userId}] tg calibração OK spot={$spot}", 'bot');
            return;
        }

        // Se já tem aposta em voo, ignora novo sinal (não empilha)
        if ($this->betInFlight) {
            log_msg("[{$this->gameTypeCode}:{$this->userId}] tg sinal {$spot} ignorado — aposta em andamento", 'bot');
            return;
        }

        $this->pendingTelegramSignal = $spot;
        log_msg("[{$this->gameTypeCode}:{$this->userId}] tg SINAL PENDENTE: {$spot} | " . mb_substr($msg, 0, 100), 'bot');
        $this->msg("📡 Sinal Telegram capturado: *{$spot}* — entrando quando a mesa abrir apostas…");
    }

    private function extractBacBoFromSignalKeyword(string $keyword, string $msg): ?string
    {
        $template = preg_replace('/PLAYER|BANKER|EMPATE|TIE|AZUL|VERMELHO|PRETO|BRANCO|🔵|🔴|🟡|⚪|⚫|⬛/iu', '', $keyword) ?? '';
        $template = preg_replace('/\s+/', ' ', trim($template)) ?? '';
        if (mb_strlen($template) < 2) {
            return null;
        }
        $tplLow = mb_strtolower($template);
        foreach (preg_split('/\r\n|\n|\r/', $msg) ?: [] as $line) {
            if (!str_contains(mb_strtolower($line), $tplLow)) {
                continue;
            }
            $c = $this->pickBacBoSpot($line);
            if ($c) {
                return $c;
            }
        }
        return null;
    }

    private function extractBacBoFromMessage(string $msg): ?string
    {
        $text = mb_strtoupper($msg);
        $entryRe = '/ENTRADA|ENTRAR|APOSTAR|APOSTE|APOSTA|SINAL|SIGNAL|BET|JOGAR|JOGUE|COMPRA|COMPRE|CONFIRMA|CONFIRMADO|PREVISÃO|PREVISAO|BAC\s*BO|BACBO/u';

        if (!preg_match($entryRe, $text) && !$this->tgKeywords && !$this->tgSignalKeyword) {
            // sem palavra de entrada e sem filtro de grupo → exige palavra-chave
            return null;
        }

        // Linha com ENTRADA + lado
        foreach (preg_split('/\r\n|\n|\r/', $msg) ?: [] as $line) {
            $up = mb_strtoupper($line);
            if (!preg_match($entryRe, $up) && !preg_match('/PLAYER|BANKER|EMPATE|TIE|🔵|🔴|🟡/u', $line)) {
                continue;
            }
            $c = $this->pickBacBoSpot($line);
            if ($c) {
                return $c;
            }
        }

        // Fallback: qualquer menção clara no texto inteiro
        return $this->pickBacBoSpot($msg);
    }

    private function pickBacBoSpot(string $s): ?string
    {
        $t = mb_strtoupper($s);
        // EMPATE antes de BANKER/PLAYER genéricos
        if (
            str_contains($t, 'EMPATE')
            || str_contains($t, 'TIE')
            || str_contains($s, '🟡')
            || (str_contains($s, '⚪') && (str_contains($t, 'EMPATE') || str_contains($t, 'TIE') || str_contains($t, 'PROTEGER')))
        ) {
            return 'EMPATE';
        }
        if (
            str_contains($t, 'PLAYER')
            || str_contains($t, 'AZUL')
            || str_contains($s, '🔵')
            || preg_match('/\bP\b/', $t)
        ) {
            // evita confundir "P" sozinho em palavras — só se tiver contexto de entrada
            if (str_contains($t, 'PLAYER') || str_contains($t, 'AZUL') || str_contains($s, '🔵')) {
                return 'PLAYER';
            }
        }
        if (
            str_contains($t, 'BANKER')
            || str_contains($t, 'BANK')
            || str_contains($t, 'VERMELHO')
            || str_contains($s, '🔴')
        ) {
            return 'BANKER';
        }
        // Linhas curtas tipo "🔵 PLAYER" já cobertas; "Apostar no P"
        if (preg_match('/(?:ENTRADA|APOSTAR|SINAL|BET).{0,30}?\bP(?:LAYER)?\b/u', $t)) {
            return 'PLAYER';
        }
        if (preg_match('/(?:ENTRADA|APOSTAR|SINAL|BET).{0,30}?\bB(?:ANKER)?\b/u', $t)) {
            return 'BANKER';
        }
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
        $existing = Database::fetch('SELECT * FROM ' . $this->tbl('variables') . ' WHERE ownerId = ?', [$this->userId]);
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
            Database::update($this->tbl('variables'), $data, 'ownerId = :oid', ['oid' => $this->userId]);
        } else {
            $start = $this->isDemo ? 1000.0 : max(0.0, $balance);
            $this->simulatedBalance = $start;
            Database::insert($this->tbl('variables'), [
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
            Database::insert($this->tbl('bot_entries'), [
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
            $this->gameTypeCode,
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
