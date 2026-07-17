<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Auth\Auth;
use App\Bot\EngineManager;
use App\Bot\LogParser;
use App\Bot\PatternAccuracy;
use App\Database;
use App\Models\ConfigRepository;
use App\Models\UserRepository;
use App\Services\BacBoBrowserBridge;
use App\Services\BotCommandService;
use App\Services\BotWorker;
use App\Services\EvolutionBacBo;
use App\Services\MercadoPago;
use App\Services\TelegramBridge;

final class UserController
{
    /** Crash removido do produto — sempre oculto na UI e bloqueado no backend. */
    private static function withCrashHidden(string $hiddenGamesCsv): string
    {
        $parts = array_values(array_filter(array_map('trim', explode(',', $hiddenGamesCsv))));
        if (!in_array('CRASH', $parts, true)) {
            $parts[] = 'CRASH';
        }
        return implode(',', $parts);
    }

    /** @return list<string> */
    private static function hiddenGamesList(string $configKey = 'HIDDEN_GAMES_CONTA_BLAZE'): array
    {
        $raw = self::withCrashHidden((string) (ConfigRepository::get($configKey, '') ?? ''));
        return array_values(array_filter(array_map('trim', explode(',', $raw))));
    }

    /**
     * Cláusula SQL pra excluir do relatório mensal (bot_entries) jogos ocultados
     * pelo admin — cada plataforma (Blaze/Jonbet) tem sua própria lista.
     * @return array{0: string, 1: list<mixed>}
     */
    private static function hiddenGamesSqlClause(int $uid, string $monthStart): array
    {
        $hiddenBlaze = self::hiddenGamesList('HIDDEN_GAMES_CONTA_BLAZE');
        $hiddenJonbet = self::hiddenGamesList('HIDDEN_GAMES_CONTA_JONBET');
        $params = [$uid, $monthStart];
        $clauses = [];
        if ($hiddenBlaze) {
            $clauses[] = "(platform = 'BLAZE' AND gameType IN (" . implode(',', array_fill(0, count($hiddenBlaze), '?')) . '))';
            $params = array_merge($params, $hiddenBlaze);
        }
        if ($hiddenJonbet) {
            $clauses[] = "(platform = 'JONBET' AND gameType IN (" . implode(',', array_fill(0, count($hiddenJonbet), '?')) . '))';
            $params = array_merge($params, $hiddenJonbet);
        }
        // Aba Day Trade oculta (HIDDEN_TABS) → some IQ Option / DAY_TRADE do relatório
        $hiddenTabs = array_values(array_filter(array_map(
            'trim',
            explode(',', (string) (ConfigRepository::get('HIDDEN_TABS', '') ?? ''))
        )));
        $dayTradeHidden = in_array('day-trade', $hiddenTabs, true)
            || in_array('DAY_TRADE', $hiddenTabs, true)
            || in_array('daytrade', $hiddenTabs, true);
        if ($dayTradeHidden) {
            $clauses[] = "(platform = 'IQOPTION' OR gameType = 'DAY_TRADE')";
        }
        $sql = $clauses ? ' AND NOT (' . implode(' OR ', $clauses) . ')' : '';
        return [$sql, $params];
    }

    public function bot(): void
    {
        $user = Auth::requireUser();
        $method = request_method();

        if ($method === 'GET') {
            $rows = BotCommandService::history((int) $user['id'], 'BLAZE', 300);
            json_response(['history' => LogParser::build(array_reverse($rows))]);
        }

        $action = (string) input('action', '');
        if ($action === 'start') {
            if (ConfigRepository::emergencyStop()) {
                json_response(['error' => 'O sistema está temporariamente pausado pelo administrador.'], 503);
            }
            $isDemo = ($user['accountType'] ?? 'DEMO') === 'DEMO';
            $gtStart = strtoupper((string) ($user['gameType'] ?? ''));
            $isBacBo = $gtStart === 'BACBO' || $gtStart === 'BACBO_LIVE';
            if ($gtStart === 'DAY_TRADE') {
                json_response([
                    'error' => 'Day Trade ainda em desenvolvimento. Em breve: operações binárias automatizadas.',
                ], 400);
            }
            // Bac Bo / Ao Vivo REAL precisam de token Blaze (launch Evolution).
            // DEMO pode rodar sem token (saldo virtual).
            if (!$isDemo && empty($user['token'])) {
                json_response(['error' => 'Configure sua conta Blaze antes de iniciar.'], 400);
            }
            if (!UserRepository::licenseOk($user)) {
                json_response(['error' => 'Você não possui uma licença ativa.'], 403);
            }
            $settings = $gtStart === 'BACBO_LIVE'
                ? ($user['bacBoLiveSettings'] ?? null)
                : ($gtStart === 'BACBO' ? ($user['bacBoSettings'] ?? null) : ($user['settings'] ?? null));
            $enter = ($settings['enterType'] ?? '') === 'PORCENTAGEM'
                ? (float) ($settings['enterPercent'] ?? 0)
                : (float) ($settings['enterValue'] ?? 0);
            if ($enter <= 0) {
                json_response(['error' => 'Configure o Valor de Entrada no Config. Bot antes de iniciar o bot.'], 400);
            }
            // exclusão mútua: para jonbet se ativo
            if (!empty($user['jonbetIsActive'])) {
                BotCommandService::enqueue((int) $user['id'], 'stop', 'JONBET');
                UserRepository::update((int) $user['id'], ['jonbetIsActive' => 0]);
            }
            $uid = (int) $user['id'];
            // Zera painel da sessão (vitórias/derrotas/lucro) — relatório do mês fica na tela inicial
            if ($isBacBo) {
                $bacboVarsTable = $gtStart === 'BACBO_LIVE' ? 'bacbo_live_variables' : 'bacbo_variables';
                // DEMO Bac Bo: banca virtual sempre reinicia em R$ 1.000
                $demoBal = $isDemo ? 1000.0 : null;
                \App\Bot\BotEntryLogger::resetSessionCounters($bacboVarsTable, $uid, $demoBal);
                if ($isDemo) {
                    try {
                        Database::update($bacboVarsTable, [
                            'balance' => 1000,
                            'firstBalance' => 1000,
                            'profit' => 0,
                            'countWin' => 0,
                            'countLoss' => 0,
                            'countMartingale' => 0,
                            'isGale' => 0,
                            'firstBalanceDate' => now(),
                        ], 'ownerId = :oid', ['oid' => $uid]);
                    } catch (\Throwable) {
                    }
                }
            } else {
                $demoBal = $isDemo ? 1000.0 : null;
                \App\Bot\BotEntryLogger::resetSessionCounters('variables', $uid, $demoBal);
                if ($isDemo) {
                    try {
                        Database::update('variables', [
                            'balance' => 1000,
                            'firstBalance' => 1000,
                            'profit' => 0,
                            'firstBalanceMode' => 'DEMO',
                            'firstBalanceDate' => now(),
                        ], 'ownerId = :oid', ['oid' => $uid]);
                    } catch (\Throwable) {
                    }
                }
            }
            // Histórico visual da sessão limpa ao iniciar (WIN/LOSS já foram pro relatório mensal)
            BotCommandService::clearHistory($uid, 'BLAZE');
            // Worker processa start/tick — sem ele não há entradas nem cards
            BotWorker::ensureRunning();
            BotCommandService::enqueue($uid, 'start', 'BLAZE');
            UserRepository::update($uid, ['isActive' => 1]);
            BotCommandService::pushMessage(
                $uid,
                '▶️ Solicitação de start enviada ao worker…',
                'BLAZE',
                (string) (($settings['strategyType'] ?? '') ?: '')
            );
            json_response(['success' => true, 'isActive' => true, 'sessionReset' => true]);
        }

        if ($action === 'stop') {
            BotWorker::ensureRunning();
            $uid = (int) $user['id'];
            $isBetting = !empty($user['isBetting']);

            // Igual ao original: se tem entrada em andamento, NÃO zera isActive —
            // o worker/engine termina a rodada e só então para de verdade.
            if ($isBetting) {
                BotCommandService::enqueue($uid, 'stop', 'BLAZE');
                // Mensagem imediata no histórico (o engine também emite a dela)
                BotCommandService::pushMessage(
                    $uid,
                    '⏸️ Estou no meio de uma entrada — assim que sair o resultado (WIN ou LOSS), vou parar o sistema e todas as operações.',
                    'BLAZE',
                    (string) (($user['settings']['strategyType'] ?? '') ?: '')
                );
                json_response(['success' => true, 'isActive' => true, 'pendingStop' => true]);
            }

            BotCommandService::enqueue($uid, 'stop', 'BLAZE');
            UserRepository::update($uid, [
                'isActive' => 0,
                'isBetting' => 0,
                'colorBet' => null,
                'colorBefore' => null,
            ]);
            json_response(['success' => true, 'isActive' => false]);
        }

        if ($action === 'reset-history') {
            BotCommandService::clearHistory((int) $user['id'], 'BLAZE');
            json_response(['success' => true]);
        }

        json_response(['error' => 'Ação inválida'], 400);
    }

    public function jonbetBot(): void
    {
        $user = Auth::requireUser();
        $method = request_method();
        if ($method === 'GET') {
            $rows = BotCommandService::history((int) $user['id'], 'JONBET', 300);
            json_response(['history' => LogParser::build(array_reverse($rows))]);
        }
        $action = (string) input('action', '');
        if ($action === 'start') {
            if (ConfigRepository::emergencyStop()) {
                json_response(['error' => 'Sistema pausado pelo administrador.'], 503);
            }
            if (!UserRepository::licenseOk($user)) {
                json_response(['error' => 'Licença inativa.'], 403);
            }
            $isDemo = ($user['jonbetAccountType'] ?? 'DEMO') === 'DEMO';
            if (!$isDemo && empty($user['jonbetToken'])) {
                json_response(['error' => 'Configure sua conta Jonbet antes de iniciar.'], 400);
            }
            BotWorker::ensureRunning();
            $uid = (int) $user['id'];
            if (!empty($user['isActive'])) {
                BotCommandService::enqueue($uid, 'stop', 'BLAZE');
                UserRepository::update($uid, ['isActive' => 0]);
            }
            // Zera painel da sessão Jonbet — relatório do mês fica na tela inicial
            \App\Bot\BotEntryLogger::resetSessionCounters('jonbet_variables', $uid);
            BotCommandService::clearHistory($uid, 'JONBET');
            BotCommandService::enqueue($uid, 'start', 'JONBET');
            UserRepository::update($uid, ['jonbetIsActive' => 1]);
            json_response(['success' => true, 'isActive' => true, 'sessionReset' => true]);
        }
        if ($action === 'stop') {
            BotWorker::ensureRunning();
            $uid = (int) $user['id'];
            if (!empty($user['jonbetIsBetting'])) {
                BotCommandService::enqueue($uid, 'stop', 'JONBET');
                BotCommandService::pushMessage(
                    $uid,
                    '⏸️ Estou no meio de uma entrada — assim que sair o resultado (WIN ou LOSS), vou parar o sistema e todas as operações.',
                    'JONBET',
                    (string) (($user['jonbetSettings']['strategyType'] ?? '') ?: '')
                );
                json_response(['success' => true, 'isActive' => true, 'pendingStop' => true]);
            }
            BotCommandService::enqueue($uid, 'stop', 'JONBET');
            UserRepository::update($uid, [
                'jonbetIsActive' => 0,
                'jonbetIsBetting' => 0,
            ]);
            json_response(['success' => true, 'isActive' => false]);
        }
        if ($action === 'reset-history') {
            BotCommandService::clearHistory((int) $user['id'], 'JONBET');
            json_response(['success' => true]);
        }
        json_response(['error' => 'Ação inválida'], 400);
    }

    /** Normaliza row de settings do MySQL pro formato do frontend React (booleans + números). */
    private function normalizeSettingsRow(?array $s): ?array
    {
        if (!$s) {
            return null;
        }
        $bools = ['whiteEntryGaleEnabled', 'skipFirstEntry', 'skipEntryAfterLoss'];
        $nums = [
            'enterValue', 'enterPercent', 'protectionValue', 'martingale', 'martingaleMultiplier',
            'whiteMultiplier', 'whiteEntryGale', 'whiteEntryGaleMultiplier', 'whiteEntryValue',
            'whiteEntryPercent', 'quantityCycles', 'columnReps',
        ];
        foreach ($bools as $b) {
            if (array_key_exists($b, $s)) {
                $s[$b] = (bool) (int) $s[$b];
            }
        }
        foreach ($nums as $n) {
            if (array_key_exists($n, $s) && $s[$n] !== null) {
                $s[$n] = (float) $s[$n];
            }
        }
        return $s;
    }

    public function configuracoes(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        self::ensureColumnRepsColumn();
        if (request_method() === 'GET') {
            $s = Database::fetch('SELECT * FROM settings WHERE ownerId = ?', [$uid]);
            if (!$s) {
                json_response(['error' => 'Configurações não encontradas'], 404);
            }
            json_response($this->normalizeSettingsRow($s));
        }
        $body = request_json();
        $fields = [
            'strategyType', 'enterType', 'enterValue', 'enterPercent', 'stopType', 'stopGain', 'stopLoss',
            'protectionHand', 'protectionValue', 'martingale', 'whiteMartingale', 'martingaleMultiplier',
            'whiteMultiplier', 'whiteEntryGaleEnabled', 'whiteEntryGale', 'whiteEntryGaleMultiplier',
            'whiteEntryType', 'whiteEntryValue', 'whiteEntryPercent', 'quantityCycles', 'columnReps',
            'skipFirstEntry', 'skipEntryAfterLoss',
        ];
        $data = [];
        foreach ($fields as $f) {
            if (array_key_exists($f, $body)) {
                $data[$f] = $body[$f];
                if (in_array($f, ['whiteEntryGaleEnabled', 'skipFirstEntry', 'skipEntryAfterLoss'], true)) {
                    $data[$f] = $body[$f] ? 1 : 0;
                }
                if ($f === 'columnReps') {
                    $data[$f] = max(2, min(15, (int) $body[$f]));
                }
            }
        }
        if ($data) {
            self::ensureColumnRepsColumn();
            Database::update('settings', $data, 'ownerId = :oid', ['oid' => $uid]);
            BotCommandService::enqueue($uid, 'refresh-cache', 'BLAZE');
        }
        json_response($this->normalizeSettingsRow(Database::fetch('SELECT * FROM settings WHERE ownerId = ?', [$uid])));
    }

    /** Garante coluna settings.columnReps (roleta COLUNAS). */
    private static function ensureColumnRepsColumn(): void
    {
        static $done = false;
        if ($done) {
            return;
        }
        $done = true;
        try {
            $row = Database::fetch("SHOW COLUMNS FROM settings LIKE 'columnReps'");
            if (!$row) {
                Database::query('ALTER TABLE settings ADD COLUMN columnReps INT NOT NULL DEFAULT 2');
            }
        } catch (\Throwable) {
            /* ignore */
        }
    }

    public function jonbetConfiguracoes(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        if (request_method() === 'GET') {
            json_response($this->normalizeSettingsRow(Database::fetch('SELECT * FROM jonbet_settings WHERE ownerId = ?', [$uid])));
        }
        $body = request_json();
        $fields = [
            'strategyType', 'enterType', 'enterValue', 'enterPercent', 'stopType', 'stopGain', 'stopLoss',
            'protectionHand', 'protectionValue', 'martingale', 'whiteMartingale', 'martingaleMultiplier',
            'whiteMultiplier', 'whiteEntryGaleEnabled', 'whiteEntryGale', 'whiteEntryGaleMultiplier',
            'whiteEntryType', 'whiteEntryValue', 'whiteEntryPercent', 'quantityCycles',
            'skipFirstEntry', 'skipEntryAfterLoss',
        ];
        $data = [];
        foreach ($fields as $f) {
            if (array_key_exists($f, $body)) {
                $data[$f] = is_bool($body[$f]) ? ($body[$f] ? 1 : 0) : $body[$f];
            }
        }
        if ($data) {
            Database::update('jonbet_settings', $data, 'ownerId = :oid', ['oid' => $uid]);
            BotCommandService::enqueue($uid, 'refresh-cache', 'JONBET');
        }
        json_response($this->normalizeSettingsRow(Database::fetch('SELECT * FROM jonbet_settings WHERE ownerId = ?', [$uid])));
    }

    public function bacboConfiguracoes(): void
    {
        $this->bacboRoomConfiguracoes('bacbo_settings');
    }

    public function bacboLiveConfiguracoes(): void
    {
        $this->bacboRoomConfiguracoes('bacbo_live_settings');
    }

    private function bacboRoomConfiguracoes(string $settingsTable): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        UserRepository::ensureDefaults($uid);
        if (request_method() === 'GET') {
            json_response($this->normalizeSettingsRow(Database::fetch('SELECT * FROM ' . $settingsTable . ' WHERE ownerId = ?', [$uid])));
        }
        $body = request_json();
        $fields = [
            'strategyType', 'enterType', 'enterValue', 'enterPercent', 'stopType', 'stopGain', 'stopLoss',
            'protectionHand', 'protectionValue', 'whiteMultiplier', 'martingale', 'martingaleMultiplier',
            'whiteEntryGaleEnabled', 'whiteEntryGale', 'whiteEntryGaleMultiplier',
            'whiteEntryType', 'whiteEntryValue', 'whiteEntryPercent', 'quantityCycles',
            'skipFirstEntry', 'skipEntryAfterLoss',
        ];
        $data = [];
        foreach ($fields as $f) {
            if (array_key_exists($f, $body)) {
                $data[$f] = is_bool($body[$f]) ? ($body[$f] ? 1 : 0) : $body[$f];
            }
        }
        if ($data) {
            Database::update($settingsTable, $data, 'ownerId = :oid', ['oid' => $uid]);
        }
        json_response($this->normalizeSettingsRow(Database::fetch('SELECT * FROM ' . $settingsTable . ' WHERE ownerId = ?', [$uid])));
    }

    public function estrategias(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        $method = request_method();
        $platform = (string) ($_GET['platform'] ?? input('platform', 'BLAZE'));

        if ($method === 'GET') {
            $gameType = $_GET['gameType'] ?? null;
            $strategyType = $_GET['strategyType'] ?? null;
            $sql = 'SELECT * FROM strategies WHERE ownerId = ? AND platform = ?';
            $params = [$uid, $platform];
            if ($gameType) {
                $sql .= ' AND gameType = ?';
                $params[] = $gameType;
            }
            if ($strategyType) {
                $sql .= ' AND strategyType = ?';
                $params[] = $strategyType;
            }
            $sql .= ' ORDER BY id ASC';
            json_response(Database::fetchAll($sql, $params));
        }
        if ($method === 'POST') {
            $sequence = (string) input('sequence', '');
            $color = (string) input('color', '');
            $gameType = (string) input('gameType', 'DOUBLE');
            $strategyType = (string) input('strategyType', 'SEQUÊNCIA');
            if ($sequence === '' || $color === '') {
                json_response(['error' => 'Sequência e entrada (cor/números/vizinhos) são obrigatórios.'], 400);
            }
            if (strlen($color) > 500) {
                json_response(['error' => 'Entrada muito longa (máx. 500 caracteres).'], 400);
            }
            $dup = Database::fetch(
                'SELECT id FROM strategies WHERE ownerId = ? AND platform = ? AND gameType = ? AND strategyType = ? AND sequence = ?',
                [$uid, $platform, $gameType, $strategyType, $sequence]
            );
            if ($dup) {
                json_response(['error' => 'Você já tem uma estratégia cadastrada com essa mesma sequência.'], 409);
            }
            $id = Database::insert('strategies', [
                'sequence' => $sequence,
                'color' => $color,
                'gameType' => $gameType,
                'strategyType' => $strategyType,
                'platform' => $platform,
                'ownerId' => $uid,
            ]);
            BotCommandService::enqueue($uid, 'refresh-cache', $platform);
            json_response(Database::fetch('SELECT * FROM strategies WHERE id = ?', [$id]));
        }
        if ($method === 'DELETE') {
            $id = (int) ($_GET['id'] ?? input('id', 0));
            if ($id > 0) {
                Database::delete('strategies', 'id = ? AND ownerId = ?', [$id, $uid]);
                BotCommandService::enqueue($uid, 'refresh-cache', $platform);
                json_response(['success' => true]);
            }
            $gameType = (string) ($_GET['gameType'] ?? input('gameType', ''));
            $strategyType = (string) ($_GET['strategyType'] ?? input('strategyType', ''));
            if ($gameType === '' || $strategyType === '') {
                json_response(['error' => 'Parâmetros inválidos'], 400);
            }
            Database::delete(
                'strategies',
                'ownerId = ? AND platform = ? AND gameType = ? AND strategyType = ?',
                [$uid, $platform, $gameType, $strategyType]
            );
            BotCommandService::enqueue($uid, 'refresh-cache', $platform);
            json_response(['success' => true]);
        }
        json_response(['error' => 'Método inválido'], 405);
    }

    public function bacboEstrategias(): void
    {
        $this->bacboRoomEstrategias('bacbo_strategies', 'bacbo_settings', 'bacbo');
    }

    public function bacboLiveEstrategias(): void
    {
        $this->bacboRoomEstrategias('bacbo_live_strategies', 'bacbo_live_settings', 'bacbo-live');
    }

    private function bacboRoomEstrategias(string $stratTable, string $settingsTable, string $resultsKey): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        UserRepository::ensureDefaults($uid);
        $method = request_method();

        if ($method === 'GET') {
            $strategyType = (string) ($_GET['strategyType'] ?? 'SEQUÊNCIA');
            $rows = Database::fetchAll(
                'SELECT * FROM ' . $stratTable . ' WHERE ownerId = ? AND strategyType = ? ORDER BY id DESC',
                [$uid, $strategyType]
            );
            $settings = Database::fetch('SELECT * FROM ' . $settingsTable . ' WHERE ownerId = ?', [$uid]);
            $gales = (int) ($settings['martingale'] ?? 1);
            $resultsTable = \App\Bot\Games\BacBoSource::resultsTable($resultsKey);

            $rowsWithStats = array_map(function (array $row) use ($gales, $resultsTable): array {
                try {
                    $seq = array_map(static fn ($v) => strtoupper(trim((string) $v)), explode(',', (string) $row['sequence']));
                    $target = strtoupper(trim((string) $row['color']));
                    $res = PatternAccuracy::computeBacBoWithTimeout($seq, $target, $gales, 2800, 1, $resultsTable);
                    if ($res) {
                        return $row + [
                            'wins' => $res['hits'],
                            'losses' => $res['total'] - $res['hits'],
                            'assertividade' => $res['pct'],
                            'occurrences' => $res['total'],
                        ];
                    }
                } catch (\Throwable $e) {
                    log_msg('Backtest failed for bacbo strategy row ' . $row['id'] . ': ' . $e->getMessage(), 'bot');
                }
                return $row + ['wins' => 0, 'losses' => 0, 'assertividade' => null, 'occurrences' => 0];
            }, $rows);

            json_response($rowsWithStats);
        }

        if ($method === 'POST') {
            $sequence = (string) input('sequence', '');
            $color = (string) input('color', '');
            $strategyType = (string) input('strategyType', 'SEQUÊNCIA');
            if ($sequence === '' || $color === '') {
                json_response(['error' => 'Sequência e cor são obrigatórios.'], 400);
            }

            $dup = Database::fetch(
                'SELECT id FROM ' . $stratTable . ' WHERE ownerId = ? AND strategyType = ? AND sequence = ?',
                [$uid, $strategyType, $sequence]
            );
            if ($dup) {
                json_response(['error' => 'Você já tem uma estratégia cadastrada com essa mesma sequência.'], 409);
            }

            $id = Database::insert($stratTable, [
                'sequence' => $sequence,
                'color' => $color,
                'strategyType' => $strategyType,
                'ownerId' => $uid,
            ]);
            json_response(Database::fetch('SELECT * FROM ' . $stratTable . ' WHERE id = ?', [$id]));
        }

        if ($method === 'DELETE') {
            $id = (int) ($_GET['id'] ?? input('id', 0));
            if ($id) {
                Database::delete($stratTable, 'id = ? AND ownerId = ?', [$id, $uid]);
                json_response(['success' => true]);
            }
            $strategyType = (string) ($_GET['strategyType'] ?? input('strategyType', ''));
            if ($strategyType === '') {
                json_response(['error' => 'Parâmetros inválidos'], 400);
            }
            Database::delete($stratTable, 'ownerId = ? AND strategyType = ?', [$uid, $strategyType]);
            json_response(['success' => true]);
        }
        json_response(['error' => 'Método inválido'], 405);
    }

    public function conta(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        $method = request_method();

        if ($method === 'PATCH') {
            $data = [];
            if (input('accountType')) {
                $data['accountType'] = (string) input('accountType');
            }
            if (input('gameType')) {
                $gt = strtoupper(trim((string) input('gameType')));
                if ($gt === 'CRASH') {
                    json_response(['error' => 'O jogo Crash foi removido. Use Double, Fortune ou Bac Bo.'], 400);
                }
                $hidden = self::hiddenGamesList();
                if (in_array($gt, $hidden, true)) {
                    json_response(['error' => 'Este jogo está desabilitado pelo administrador.'], 403);
                }
                $data['gameType'] = $gt;
            }
            if ($data) {
                UserRepository::update($uid, $data);
            }
            // DEMO = banca virtual R$ 1000 (não misturar com saldo real da Blaze)
            if (isset($data['accountType']) && $data['accountType'] === 'DEMO') {
                $demoReset = [
                    'balance' => 1000,
                    'firstBalance' => 1000,
                    'profit' => 0,
                    'countWin' => 0,
                    'countLoss' => 0,
                    'countMartingale' => 0,
                    'isGale' => 0,
                    'firstBalanceDate' => now(),
                ];
                try {
                    Database::update('variables', array_merge($demoReset, [
                        'firstBalanceMode' => 'DEMO',
                    ]), 'ownerId = :oid', ['oid' => $uid]);
                } catch (\Throwable) {
                }
                // Bac Bo / Ao Vivo têm tabelas próprias de variáveis
                try {
                    Database::update('bacbo_variables', $demoReset, 'ownerId = :oid', ['oid' => $uid]);
                } catch (\Throwable) {
                }
                try {
                    Database::update('bacbo_live_variables', $demoReset, 'ownerId = :oid', ['oid' => $uid]);
                } catch (\Throwable) {
                }
            }
            $u = UserRepository::find($uid);
            json_response(['accountType' => $u['accountType'], 'gameType' => $u['gameType']]);
        }

        if ($method === 'POST') {
            $email = trim((string) input('email', ''));
            $password = (string) input('password', '');
            if ($email === '' || $password === '') {
                json_response(['error' => 'Email e senha são obrigatórios.'], 400);
            }
            UserRepository::update($uid, [
                'connectPending' => 1,
                'connectError' => null,
                'blazeEmail' => $email,
                'password' => $password,
            ]);
            // Responde na hora e processa captcha/login neste request (após
            // liberar a conexão). Assim não depende do worker.php estar rodando.
            json_response_and_continue(['pending' => true]);
            try {
                EngineManager::connectBlaze($uid, $email, $password);
            } catch (\Throwable $e) {
                log_msg('[api connect-blaze] ' . $e->getMessage(), 'bot');
                UserRepository::update($uid, [
                    'connectPending' => 0,
                    'connectError' => 'Erro ao conectar: ' . $e->getMessage(),
                ]);
            }
            exit;
        }

        if ($method === 'DELETE') {
            UserRepository::update($uid, [
                'token' => null,
                'wallet' => null,
                'blazeEmail' => null,
                'password' => null,
                'connectPending' => 0,
                'connectError' => null,
            ]);
            json_response(['success' => true]);
        }

        json_response(['error' => 'Método inválido'], 405);
    }

    public function jonbetConta(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        $method = request_method();

        if ($method === 'PATCH') {
            $data = [];
            if (input('jonbetAccountType')) {
                $data['jonbetAccountType'] = (string) input('jonbetAccountType');
            }
            if (input('jonbetGameType')) {
                $jgt = strtoupper(trim((string) input('jonbetGameType')));
                if ($jgt === 'CRASH') {
                    json_response(['error' => 'O jogo Crash foi removido da Jonbet. Use Double ou Fortune.'], 400);
                }
                $hiddenJonbet = self::hiddenGamesList('HIDDEN_GAMES_CONTA_JONBET');
                if (in_array($jgt, $hiddenJonbet, true)) {
                    json_response(['error' => 'Este jogo está desabilitado pelo administrador.'], 403);
                }
                $data['jonbetGameType'] = $jgt;
            }
            if ($data) {
                UserRepository::update($uid, $data);
            }
            json_response(UserRepository::find($uid));
        }
        if ($method === 'POST') {
            $email = trim((string) input('email', ''));
            $password = (string) input('password', '');
            if ($email === '' || $password === '') {
                json_response(['error' => 'Email e senha são obrigatórios.'], 400);
            }
            UserRepository::update($uid, [
                'jonbetConnectPending' => 1,
                'jonbetConnectError' => null,
                'jonbetEmail' => $email,
                'jonbetPassword' => $password,
            ]);
            json_response_and_continue(['pending' => true]);
            try {
                EngineManager::connectJonbet($uid, $email, $password);
            } catch (\Throwable $e) {
                log_msg('[api connect-jonbet] ' . $e->getMessage(), 'bot');
                UserRepository::update($uid, [
                    'jonbetConnectPending' => 0,
                    'jonbetConnectError' => 'Erro ao conectar: ' . $e->getMessage(),
                ]);
            }
            exit;
        }
        if ($method === 'DELETE') {
            UserRepository::update($uid, [
                'jonbetToken' => null,
                'jonbetWallet' => null,
                'jonbetEmail' => null,
                'jonbetPassword' => null,
            ]);
            json_response(['success' => true]);
        }
        json_response(['error' => 'Método inválido'], 405);
    }

    public function balance(): void
    {
        $user = Auth::requireUser();
        $accountType = (string) ($user['accountType'] ?? 'DEMO');
        $gameType = (string) ($user['gameType'] ?? 'DOUBLE');
        $isBacBo = $gameType === 'BACBO' || $gameType === 'BACBO_LIVE';
        // Bac Bo / Ao Vivo têm tabela própria — não misturar com variables do Double
        $varsTable = $gameType === 'BACBO_LIVE'
            ? 'bacbo_live_variables'
            : ($gameType === 'BACBO' ? 'bacbo_variables' : 'variables');
        $vars = $gameType === 'BACBO_LIVE'
            ? (is_array($user['bacBoLiveVariables'] ?? null) ? $user['bacBoLiveVariables'] : [])
            : ($gameType === 'BACBO'
                ? (is_array($user['bacBoVariables'] ?? null) ? $user['bacBoVariables'] : [])
                : (is_array($user['variables'] ?? null) ? $user['variables'] : []));
        $uid = (int) $user['id'];

        // DEMO: nunca puxa carteira real; garante banca virtual
        if ($accountType === 'DEMO') {
            $bal = (float) ($vars['balance'] ?? 0);
            $mode = (string) ($vars['firstBalanceMode'] ?? '');
            // bacbo_variables pode não ter firstBalanceMode — usa balance <= 0
            if (($mode !== '' && $mode !== 'DEMO') || $bal <= 0) {
                $bal = 1000.0;
                try {
                    $payload = [
                        'balance' => 1000,
                        'firstBalance' => 1000,
                        'profit' => 0,
                    ];
                    if (!$isBacBo) {
                        $payload['firstBalanceMode'] = 'DEMO';
                    }
                    Database::update($varsTable, $payload, 'ownerId = :oid', ['oid' => $uid]);
                } catch (\Throwable) {
                }
            }
            json_response([
                'balance' => $bal,
                'profit' => (float) ($vars['profit'] ?? 0),
                'countWin' => (int) ($vars['countWin'] ?? 0),
                'countLoss' => (int) ($vars['countLoss'] ?? 0),
                'monthStartBalance' => (float) ($vars['monthStartBalance'] ?? 0),
                'monthCountWin' => (int) ($vars['monthCountWin'] ?? 0),
                'monthCountLoss' => (int) ($vars['monthCountLoss'] ?? 0),
                'firstBalance' => (float) ($vars['firstBalance'] ?? 1000),
                'isActive' => (bool) $user['isActive'],
                'isBetting' => (bool) $user['isBetting'],
                'accountType' => $accountType,
                'gameType' => $gameType,
                'live' => false,
            ]);
        }

        // REAL: tenta saldo ao vivo da Blaze
        if (!empty($user['token'])) {
            try {
                $api = new \App\Bot\Blaze\BlazeAPI();
                $api->setToken((string) $user['token']);
                $wallet = $api->getWallet();
                $bal = $api->extractBalance($wallet);
                Database::update($varsTable, ['balance' => $bal], 'ownerId = :oid', ['oid' => $uid]);
                // também espelha em variables (Double) se não for Bac Bo only
                if (!$isBacBo) {
                    // already updated variables
                }
                json_response([
                    'balance' => $bal,
                    'profit' => (float) ($vars['profit'] ?? 0),
                    'countWin' => (int) ($vars['countWin'] ?? 0),
                    'countLoss' => (int) ($vars['countLoss'] ?? 0),
                    'monthStartBalance' => (float) ($vars['monthStartBalance'] ?? 0),
                    'monthCountWin' => (int) ($vars['monthCountWin'] ?? 0),
                    'monthCountLoss' => (int) ($vars['monthCountLoss'] ?? 0),
                    'firstBalance' => (float) ($vars['firstBalance'] ?? 0),
                    'isActive' => (bool) $user['isActive'],
                    'isBetting' => (bool) $user['isBetting'],
                    'accountType' => $accountType,
                    'gameType' => $gameType,
                    'live' => true,
                ]);
            } catch (\Throwable) {
                // fallback vars
            }
        }

        json_response([
            'balance' => (float) ($vars['balance'] ?? 0),
            'profit' => (float) ($vars['profit'] ?? 0),
            'countWin' => (int) ($vars['countWin'] ?? 0),
            'countLoss' => (int) ($vars['countLoss'] ?? 0),
            'monthStartBalance' => (float) ($vars['monthStartBalance'] ?? 0),
            'monthCountWin' => (int) ($vars['monthCountWin'] ?? 0),
            'monthCountLoss' => (int) ($vars['monthCountLoss'] ?? 0),
            'firstBalance' => (float) ($vars['firstBalance'] ?? 0),
            'isActive' => (bool) $user['isActive'],
            'isBetting' => (bool) $user['isBetting'],
            'accountType' => $accountType,
            'gameType' => $gameType,
            'live' => false,
        ]);
    }

    public function jonbetBalance(): void
    {
        $user = Auth::requireUser();
        $vars = is_array($user['jonbetVariables'] ?? null) ? $user['jonbetVariables'] : [];
        $accountType = (string) ($user['jonbetAccountType'] ?? 'DEMO');

        if ($accountType === 'DEMO') {
            $bal = (float) ($vars['balance'] ?? 0);
            $mode = (string) ($vars['firstBalanceMode'] ?? '');
            if ($mode !== 'DEMO' || $bal <= 0) {
                $bal = 1000.0;
                try {
                    Database::update('jonbet_variables', [
                        'balance' => 1000,
                        'firstBalance' => 1000,
                        'firstBalanceMode' => 'DEMO',
                        'profit' => 0,
                    ], 'ownerId = :oid', ['oid' => (int) $user['id']]);
                } catch (\Throwable) {
                }
            }
            json_response([
                'balance' => $bal,
                'profit' => (float) ($vars['profit'] ?? 0),
                'countWin' => (int) ($vars['countWin'] ?? 0),
                'countLoss' => (int) ($vars['countLoss'] ?? 0),
                'monthStartBalance' => (float) ($vars['monthStartBalance'] ?? 0),
                'monthCountWin' => (int) ($vars['monthCountWin'] ?? 0),
                'monthCountLoss' => (int) ($vars['monthCountLoss'] ?? 0),
                'isActive' => (bool) $user['jonbetIsActive'],
                'isBetting' => (bool) $user['jonbetIsBetting'],
                'accountType' => $accountType,
                'gameType' => $user['jonbetGameType'],
                'live' => false,
            ]);
        }

        json_response([
            'balance' => (float) ($vars['balance'] ?? 0),
            'profit' => (float) ($vars['profit'] ?? 0),
            'countWin' => (int) ($vars['countWin'] ?? 0),
            'countLoss' => (int) ($vars['countLoss'] ?? 0),
            'monthStartBalance' => (float) ($vars['monthStartBalance'] ?? 0),
            'monthCountWin' => (int) ($vars['monthCountWin'] ?? 0),
            'monthCountLoss' => (int) ($vars['monthCountLoss'] ?? 0),
            'isActive' => (bool) $user['jonbetIsActive'],
            'isBetting' => (bool) $user['jonbetIsBetting'],
            'accountType' => $accountType,
            'gameType' => $user['jonbetGameType'],
            'live' => false,
        ]);
    }

    /**
     * Reseta o relatório do cliente: apaga todo o histórico de entradas
     * (Double/Fortune, Bac Bo, Blaze + Jonbet) e redefine a banca inicial
     * de cada plataforma com o saldo REAL atual (busca ao vivo; se não
     * tiver token/saldo real disponível, mantém o saldo já registrado).
     */
    public function resetReport(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];

        Database::delete('bot_entries', 'ownerId = ?', [$uid]);
        Database::delete('bacbo_bot_entries', 'ownerId = ?', [$uid]);
        try {
            Database::delete('bacbo_live_bot_entries', 'ownerId = ?', [$uid]);
        } catch (\Throwable) {
        }

        $blazeBalance = null;
        if (!empty($user['token'])) {
            try {
                $api = new \App\Bot\Blaze\BlazeAPI();
                $api->setToken((string) $user['token']);
                $blazeBalance = $api->extractBalance($api->getWallet());
            } catch (\Throwable) {
                $blazeBalance = null;
            }
        }

        $jonbetBalance = null;
        if (!empty($user['jonbetToken'])) {
            try {
                $api = new \App\Bot\Jonbet\JonbetAPI();
                $api->setToken((string) $user['jonbetToken']);
                $jonbetBalance = $api->extractBalance($api->getWallet());
            } catch (\Throwable) {
                $jonbetBalance = null;
            }
        }

        $iqBalance = null;
        if (!empty($user['iqSsid'])) {
            try {
                $b = \App\Services\IqOptionBridge::balances((string) $user['iqSsid'], true);
                if (!empty($b['ok']) && !empty($b['balances'])) {
                    $picked = \App\Controllers\Api\DayTradeController::pickBalance(
                        $b['balances'],
                        (string) ($user['iqAccountType'] ?? 'DEMO'),
                        true
                    );
                    if ($picked) {
                        $iqBalance = (float) ($picked['amount'] ?? 0);
                    }
                }
            } catch (\Throwable) {
                $iqBalance = null;
            }
        }

        $resetVars = static function (string $table, ?float $realBalance, ?string $mode = null) use ($uid): void {
            $bal = $realBalance ?? 0;
            $data = [
                'balance' => $bal,
                'firstBalance' => $bal,
                'profit' => 0,
                'countWin' => 0,
                'countLoss' => 0,
                'monthCountWin' => 0,
                'monthCountLoss' => 0,
                'countMartingale' => 0,
                'isGale' => 0,
                'firstBalanceDate' => now(),
            ];
            try {
                // colunas extras quando existirem
                $data['monthStartBalance'] = $bal;
                $data['monthStartDate'] = now();
            } catch (\Throwable) {
            }
            if ($mode !== null) {
                $data['firstBalanceMode'] = $mode;
            }
            Database::update($table, $data, 'ownerId = :oid', ['oid' => $uid]);
        };

        // Double/Fortune (Blaze) e Bac Bo usam o saldo real da Blaze;
        // variables não tem firstBalanceMode obrigatório em bacbo_variables.
        try {
            $resetVars('variables', $blazeBalance);
        } catch (\Throwable) {
        }
        try {
            $resetVars('bacbo_variables', $blazeBalance);
        } catch (\Throwable) {
        }
        try {
            $resetVars('bacbo_live_variables', $blazeBalance);
        } catch (\Throwable) {
        }
        try {
            $resetVars('jonbet_variables', $jonbetBalance);
        } catch (\Throwable) {
        }
        try {
            $iqMode = strtoupper((string) ($user['iqAccountType'] ?? 'DEMO'));
            $resetVars('daytrade_variables', $iqBalance, $iqMode);
        } catch (\Throwable) {
        }

        json_response([
            'success' => true,
            'blazeBalance' => $blazeBalance,
            'jonbetBalance' => $jonbetBalance,
            'iqBalance' => $iqBalance,
        ]);
    }

    /** Port de platformSummary() em app/api/user/dashboard-summary/route.ts. */
    private function platformSummary(?array $vars, ?string $currentMode): array
    {
        // Dado gravado num modo diferente do atual (ex: sobrou de uma sessão
        // DEMO e o usuário trocou pra REAL sem reiniciar o robô ainda) tem
        // escala de saldo incompatível — trata como se não tivesse sessão.
        if ($vars && !empty($vars['firstBalanceMode']) && $currentMode && $vars['firstBalanceMode'] !== $currentMode) {
            $vars = null;
        }
        $balance = (float) ($vars['balance'] ?? 0);
        $firstBalance = (float) ($vars['firstBalance'] ?? 0);
        $monthStartBalance = (float) ($vars['monthStartBalance'] ?? 0);
        $profitToday = round($balance - $firstBalance, 2);
        $profitMonth = round($balance - $monthStartBalance, 2);
        return [
            'balance' => $balance,
            'firstBalance' => $firstBalance,
            'countWin' => (int) ($vars['countWin'] ?? 0),
            'countLoss' => (int) ($vars['countLoss'] ?? 0),
            'monthCountWin' => (int) ($vars['monthCountWin'] ?? 0),
            'monthCountLoss' => (int) ($vars['monthCountLoss'] ?? 0),
            'profitToday' => $profitToday,
            'lossToday' => min($profitToday, 0),
            'profitMonth' => $profitMonth,
        ];
    }

    public function dashboardSummary(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        $blazeVars = Database::fetch('SELECT * FROM variables WHERE ownerId = ?', [$uid]);
        $jonbetVars = Database::fetch('SELECT * FROM jonbet_variables WHERE ownerId = ?', [$uid]);
        $bacboVars = Database::fetch('SELECT * FROM bacbo_variables WHERE ownerId = ?', [$uid]);
        $bacboLiveVars = Database::fetch('SELECT * FROM bacbo_live_variables WHERE ownerId = ?', [$uid]);

        // Lucro em R$ só conta REAL; contadores de W/L do mês entram de qualquer modo.
        $accountType = (string) ($user['accountType'] ?? '');
        $jonbetAccountType = (string) ($user['jonbetAccountType'] ?? '');
        $blaze = $this->platformSummary($accountType === 'DEMO' ? null : $blazeVars, $accountType ?: null);
        $jonbet = $this->platformSummary($jonbetAccountType === 'DEMO' ? null : $jonbetVars, $jonbetAccountType ?: null);

        // Contagem e lucro do mês vêm de bot_entries (fonte confiável — só REAL,
        // sem jogos ocultados pelo admin). O fallback por saldo (variables.*)
        // só entra se a query falhar de verdade: comparar saldo atual com
        // monthStartBalance é frágil e já causou lucro mensal absurdo quando a
        // banca foi resetada/testada manualmente sem essa coluna acompanhar.
        $monthStart = date('Y-m-01 00:00:00');
        [$hiddenSql, $params] = self::hiddenGamesSqlClause($uid, $monthStart);
        $entriesAvailable = false;
        $monthWin = 0;
        $monthLoss = 0;
        $combinedMonthProfit = 0.0;
        try {
            $agg = Database::fetch(
                "SELECT
                    SUM(CASE WHEN type = 'WIN' THEN 1 ELSE 0 END) AS wins,
                    SUM(CASE WHEN type = 'LOSS' THEN 1 ELSE 0 END) AS losses,
                    COALESCE(SUM(CASE WHEN type IN ('WIN','LOSS') THEN profit ELSE 0 END), 0) AS profitSum
                 FROM bot_entries
                 WHERE ownerId = ? AND createdAt >= ? AND type IN ('WIN','LOSS') AND accountType = 'REAL'" . $hiddenSql,
                $params
            );
            if ($agg) {
                $monthWin = (int) ($agg['wins'] ?? 0);
                $monthLoss = (int) ($agg['losses'] ?? 0);
                $combinedMonthProfit = round((float) ($agg['profitSum'] ?? 0), 2);
                $entriesAvailable = true;
            }
        } catch (\Throwable) {
            $entriesAvailable = false;
        }

        $daytradeVars = null;
        try {
            $daytradeVars = Database::fetch('SELECT * FROM daytrade_variables WHERE ownerId = ?', [$uid]);
        } catch (\Throwable) {
            $daytradeVars = null;
        }
        $iqAccountType = strtoupper((string) ($user['iqAccountType'] ?? 'DEMO'));
        if (!in_array($iqAccountType, ['DEMO', 'REAL'], true)) {
            $iqAccountType = 'DEMO';
        }
        // Aba Day Trade oculta → não expõe banca/lucro IQ no dashboard
        $hiddenTabsDash = array_values(array_filter(array_map(
            'trim',
            explode(',', (string) (ConfigRepository::get('HIDDEN_TABS', '') ?? ''))
        )));
        $dayTradeTabHidden = in_array('day-trade', $hiddenTabsDash, true)
            || in_array('DAY_TRADE', $hiddenTabsDash, true)
            || in_array('daytrade', $hiddenTabsDash, true);

        // Lucro no relatório só conta REAL (igual Blaze/Jonbet)
        $daytrade = $dayTradeTabHidden
            ? $this->platformSummary(null, null)
            : $this->platformSummary(
                $iqAccountType === 'DEMO' ? null : $daytradeVars,
                $iqAccountType ?: null
            );
        // Card de banca IQ: SEMPRE usa o saldo gravado (não aplica filtro de modo)
        // — evita zerar o card quando firstBalanceMode ficou defasado.
        $dtBal = $dayTradeTabHidden ? 0.0 : (float) ($daytradeVars['balance'] ?? 0);
        $dtFirst = $dayTradeTabHidden ? 0.0 : (float) ($daytradeVars['firstBalance'] ?? $dtBal);
        // se firstBalance ainda é placeholder (10000) e saldo real é outro, ancora no saldo
        if (!$dayTradeTabHidden && $dtFirst >= 9999 && $dtBal > 0 && $dtBal < 1000) {
            $dtFirst = $dtBal;
        }
        $daytradeBank = $dayTradeTabHidden
            ? [
                'balance' => 0.0,
                'firstBalance' => 0.0,
                'countWin' => 0,
                'countLoss' => 0,
                'monthCountWin' => 0,
                'monthCountLoss' => 0,
                'profitToday' => 0.0,
                'lossToday' => 0.0,
                'profitMonth' => 0.0,
                'sessionProfit' => 0.0,
            ]
            : [
                'balance' => $dtBal,
                'firstBalance' => $dtFirst,
                'countWin' => (int) ($daytradeVars['countWin'] ?? 0),
                'countLoss' => (int) ($daytradeVars['countLoss'] ?? 0),
                'monthCountWin' => (int) ($daytradeVars['monthCountWin'] ?? 0),
                'monthCountLoss' => (int) ($daytradeVars['monthCountLoss'] ?? 0),
                'profitToday' => round($dtBal - $dtFirst, 2),
                'lossToday' => min(round($dtBal - $dtFirst, 2), 0),
                'profitMonth' => round($dtBal - (float) ($daytradeVars['monthStartBalance'] ?? $dtFirst), 2),
                'sessionProfit' => (float) ($daytradeVars['profit'] ?? 0),
            ];
        // se REAL e daytrade veio zerado por modo, usa bank
        if (!$dayTradeTabHidden && $iqAccountType === 'REAL' && (float) ($daytrade['balance'] ?? 0) <= 0 && $dtBal > 0) {
            $daytrade = $daytradeBank;
        }

        if (!$entriesAvailable) {
            $monthWin = (int) ($blazeVars['monthCountWin'] ?? 0)
                + (int) ($jonbetVars['monthCountWin'] ?? 0)
                + (int) ($bacboVars['monthCountWin'] ?? 0)
                + (int) ($bacboLiveVars['monthCountWin'] ?? 0)
                + ($dayTradeTabHidden ? 0 : (int) ($daytradeVars['monthCountWin'] ?? 0));
            $monthLoss = (int) ($blazeVars['monthCountLoss'] ?? 0)
                + (int) ($jonbetVars['monthCountLoss'] ?? 0)
                + (int) ($bacboVars['monthCountLoss'] ?? 0)
                + (int) ($bacboLiveVars['monthCountLoss'] ?? 0)
                + ($dayTradeTabHidden ? 0 : (int) ($daytradeVars['monthCountLoss'] ?? 0));
            $combinedMonthProfit = round(
                (float) ($blaze['profitMonth'] ?? 0)
                + (float) ($jonbet['profitMonth'] ?? 0)
                + ($dayTradeTabHidden ? 0.0 : (float) ($daytrade['profitMonth'] ?? 0)),
                2
            );
        }

        json_response([
            'blaze' => $blaze,
            'jonbet' => $jonbet,
            'daytrade' => $daytrade,
            'daytradeBank' => $daytradeBank,
            'iqAccountType' => $iqAccountType === 'REAL' ? 'REAL' : 'DEMO',
            'dayTradeHidden' => $dayTradeTabHidden,
            'combinedProfitToday' => round(
                $blaze['profitToday'] + $jonbet['profitToday'] + ($dayTradeTabHidden ? 0.0 : (float) ($daytrade['profitToday'] ?? 0)),
                2
            ),
            'combinedProfitMonth' => $combinedMonthProfit,
            'monthCountWin' => $monthWin,
            'monthCountLoss' => $monthLoss,
            'monthLabel' => date('m/Y'),
        ]);
    }

    public function botEntries(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        // Relatório do mês corrente (últimos 500 para performance)
        // Só conta REAL (accountType) e ignora jogos desabilitados pelo admin.
        $monthStart = date('Y-m-01 00:00:00');
        [$hiddenSql, $params] = self::hiddenGamesSqlClause($uid, $monthStart);
        try {
            $rows = Database::fetchAll(
                "SELECT * FROM bot_entries
                 WHERE ownerId = ? AND createdAt >= ? AND type IN ('WIN','LOSS','GALE') AND accountType = 'REAL'" . $hiddenSql . "
                 ORDER BY id DESC LIMIT 500",
                $params
            );
        } catch (\Throwable) {
            $rows = Database::fetchAll(
                'SELECT * FROM bot_entries WHERE ownerId = ? ORDER BY id DESC LIMIT 200',
                [$uid]
            );
        }
        $rows = array_map(static function (array $r): array {
            if (isset($r['betAmount'])) {
                $r['betAmount'] = $r['betAmount'] !== null ? (float) $r['betAmount'] : null;
            }
            if (isset($r['profit'])) {
                $r['profit'] = $r['profit'] !== null ? (float) $r['profit'] : null;
            }
            if (isset($r['galeLevel'])) {
                $r['galeLevel'] = $r['galeLevel'] !== null ? (int) $r['galeLevel'] : null;
            }
            $r['id'] = (int) $r['id'];
            $r['gameType'] = $r['gameType'] ?? null;
            return $r;
        }, $rows);
        json_response($rows);
    }

    public function announcement(): void
    {
        Auth::requireUser();
        $raw = ConfigRepository::get('ANNOUNCEMENT', '');
        $announcement = null;
        if ($raw) {
            $decoded = json_decode($raw, true);
            $announcement = is_array($decoded) ? $decoded : null;
        }
        json_response(['announcement' => $announcement]);
    }

    public function publicConfig(): void
    {
        $hidden = (string) (ConfigRepository::get('HIDDEN_STRATEGY_TYPES', '') ?? '');
        $hiddenGames = self::hiddenGamesList();
        json_response([
            'instagram' => ConfigRepository::get('SOCIAL_INSTAGRAM', '') ?? '',
            'telegram' => ConfigRepository::get('SOCIAL_TELEGRAM', '') ?? '',
            'github' => ConfigRepository::get('SOCIAL_GITHUB', '') ?? '',
            'appName' => env('APP_NAME', 'AutoWin'),
            'hiddenStrategyTypes' => array_values(array_filter(array_map('trim', explode(',', $hidden)))),
            'hiddenGames' => $hiddenGames,
        ]);
    }

    public function plans(): void
    {
        $options = json_decode((string) ConfigRepository::get('LICENSE_OPTIONS', '[]'), true);
        json_response([
            'plans' => is_array($options) ? $options : [],
            'trialHours' => (float) (ConfigRepository::get('TRIAL_HOURS', '1') ?? '1'),
            'hiddenTabs' => ConfigRepository::get('HIDDEN_TABS', '') ?? '',
            'hiddenGames' => self::withCrashHidden((string) (ConfigRepository::get('HIDDEN_GAMES', '') ?? '')),
            'hiddenStrategies' => ConfigRepository::get('HIDDEN_STRATEGY_TYPES', '') ?? '',
            'social' => [
                'instagram' => ConfigRepository::get('SOCIAL_INSTAGRAM', '') ?? '',
                'telegram' => ConfigRepository::get('SOCIAL_TELEGRAM', '') ?? '',
                'github' => ConfigRepository::get('SOCIAL_GITHUB', '') ?? '',
            ],
        ]);
    }

    public function paymentCreate(): void
    {
        $user = Auth::requireUser();
        $planIndex = (int) input('planIndex', -1);
        $raw = ConfigRepository::get('LICENSE_OPTIONS', '[]');
        $options = json_decode((string) $raw, true) ?: [];
        if (!isset($options[$planIndex])) {
            // try PLANS format
            $options = ConfigRepository::plans();
            if (!isset($options[$planIndex])) {
                json_response(['error' => 'Plano inválido'], 400);
            }
            $plan = $options[$planIndex];
            $plan = [
                'title' => $plan['name'] ?? $plan['title'] ?? 'Plano',
                'days' => $plan['days'] ?? 30,
                'amount' => $plan['price'] ?? $plan['amount'] ?? 0,
                'features' => $plan['features'] ?? [],
            ];
        } else {
            $plan = $options[$planIndex];
        }

        $result = MercadoPago::createPix(
            (int) $user['id'],
            (float) ($plan['amount'] ?? 0),
            (string) ($plan['title'] ?? 'Licença'),
            (string) ($user['email'] ?: 'user' . $user['id'] . '@autowin.bot')
        );
        if (!$result || empty($result['paymentId'])) {
            json_response(['error' => 'Erro ao criar pagamento. Verifique o token Mercado Pago.'], 500);
        }

        UserRepository::update((int) $user['id'], [
            'paymentId' => $result['paymentId'],
            'paymentExpireIn' => (int) ($plan['days'] ?? 30),
            'paymentStatus' => 'PENDING',
            'pendingFeatures' => json_encode($plan['features'] ?? [], JSON_UNESCAPED_UNICODE),
        ]);

        json_response([
            'paymentId' => $result['paymentId'],
            'qrCode' => $result['pixKey'],
            'qrCodeBase64' => $result['qrCodeBase64'],
            'amount' => $result['amount'],
            'days' => $plan['days'] ?? 30,
            'title' => $plan['title'] ?? 'Licença',
        ]);
    }

    public function trialStart(): void
    {
        $user = Auth::requireUser();
        if (!empty($user['alreadyTested'])) {
            json_response(['error' => 'Teste já utilizado.'], 400);
        }
        // Prefer TRIAL_HOURS (original Next) — fallback TRIAL_DAYS
        $hours = (float) (ConfigRepository::get('TRIAL_HOURS', '0') ?: 0);
        if ($hours <= 0) {
            $days = (int) (ConfigRepository::get('TRIAL_DAYS', '1') ?: 1);
            $hours = $days * 24;
        }
        $expireIn = date('Y-m-d H:i:s', time() + (int) round($hours * 3600));
        UserRepository::update((int) $user['id'], [
            'isTesting' => 1,
            'alreadyTested' => 1,
            'paymentStatus' => 'PAID',
            'expireIn' => $expireIn,
        ]);
        json_response(['success' => true, 'days' => $hours / 24, 'expireIn' => $expireIn]);
    }

    public function primeiroAcesso(): void
    {
        $email = trim((string) input('email', ''));
        $password = (string) input('password', '');
        $name = trim((string) input('name', ''));
        if ($email === '' || $password === '') {
            json_response(['error' => 'Preencha email e senha.'], 400);
        }
        $existing = UserRepository::findByEmail($email);
        if ($existing && !empty($existing['webPassword'])) {
            json_response(['error' => 'Este email já possui senha de painel.'], 400);
        }
        if ($existing) {
            UserRepository::update((int) $existing['id'], [
                'webPassword' => password_hash($password, PASSWORD_BCRYPT),
                'name' => $name ?: $existing['name'],
            ]);
            Auth::loginUser((int) $existing['id']);
            json_response(['success' => true]);
        }
        $id = UserRepository::create([
            'email' => $email,
            'name' => $name ?: $email,
            'webPassword' => password_hash($password, PASSWORD_BCRYPT),
            'paymentStatus' => 'PENDING',
            'createdAt' => now(),
        ]);
        Auth::loginUser($id);
        json_response(['success' => true, 'id' => $id]);
    }

    public function notifications(): void
    {
        $user = Auth::requireUser();
        if (request_method() === 'GET') {
            $prefs = $user['notifyPrefs'] ? json_decode((string) $user['notifyPrefs'], true) : null;
            json_response(['prefs' => $prefs]);
        }
        $prefs = input('prefs', request_json());
        UserRepository::update((int) $user['id'], [
            'notifyPrefs' => json_encode($prefs, JSON_UNESCAPED_UNICODE),
        ]);
        json_response(['success' => true]);
    }

    public function notificationsTest(): void
    {
        $user = Auth::requireUser();
        \App\Services\Notify::sendTestNotification((int) $user['id']);
        json_response(['success' => true]);
    }

    public function vapidPublicKey(): void
    {
        json_response(['publicKey' => \App\Services\Notify::getVapidPublicKey()]);
    }

    public function pushSubscribe(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        $body = request_json();

        if (request_method() === 'DELETE') {
            $endpoint = (string) ($body['endpoint'] ?? '');
            if ($endpoint === '') {
                json_response(['error' => 'endpoint obrigatório'], 400);
            }
            Database::delete('push_subscriptions', 'endpoint = ? AND ownerId = ?', [$endpoint, $uid]);
            json_response(['success' => true]);
        }

        $endpoint = (string) ($body['endpoint'] ?? '');
        $keys = is_array($body['keys'] ?? null) ? $body['keys'] : [];
        $p256dh = (string) ($keys['p256dh'] ?? '');
        $auth = (string) ($keys['auth'] ?? '');
        if ($endpoint === '' || $p256dh === '' || $auth === '') {
            json_response(['error' => 'Inscrição inválida'], 400);
        }

        $existing = Database::fetch('SELECT id FROM push_subscriptions WHERE endpoint = ?', [$endpoint]);
        if ($existing) {
            Database::update('push_subscriptions', [
                'p256dh' => $p256dh,
                'auth' => $auth,
                'ownerId' => $uid,
            ], 'id = :id', ['id' => $existing['id']]);
        } else {
            Database::insert('push_subscriptions', [
                'endpoint' => $endpoint,
                'p256dh' => $p256dh,
                'auth' => $auth,
                'ownerId' => $uid,
                'createdAt' => now(),
            ]);
        }
        json_response(['success' => true]);
    }

    public function telegramUserbot(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        $method = request_method();

        // GET — status (mesmo shape do route.ts original)
        if ($method === 'GET') {
            $row = Database::fetch(
                'SELECT phone, groupId, groupName, keywords, signalKeyword, signalKeywordVerified, isConnected FROM telegram_userbots WHERE ownerId = ?',
                [$uid]
            );
            if (!$row) {
                json_response(['isConnected' => false]);
            }
            $keywords = [];
            if (!empty($row['keywords'])) {
                $decoded = json_decode((string) $row['keywords'], true);
                $keywords = is_array($decoded) ? $decoded : [];
            }
            json_response([
                'isConnected' => !empty($row['isConnected']),
                'phone' => $row['phone'] ?? null,
                'groupId' => $row['groupId'] ?? null,
                'groupName' => $row['groupName'] ?? null,
                'keywords' => $keywords,
                'signalKeyword' => $row['signalKeyword'] ?? null,
                'signalKeywordVerified' => !empty($row['signalKeywordVerified']),
            ]);
        }

        if ($method === 'DELETE') {
            $this->tgClearPending($uid);
            Database::delete('telegram_userbots', 'ownerId = ?', [$uid]);
            json_response(['success' => true]);
        }

        if ($method !== 'POST') {
            json_response(['error' => 'Método inválido'], 405);
        }

        $body = request_json();
        $action = (string) ($body['action'] ?? '');

        // ── SEND CODE ────────────────────────────────────────────────────────
        if ($action === 'send-code') {
            $phone = trim((string) ($body['phone'] ?? ''));
            if ($phone === '') {
                json_response(['error' => 'Telefone obrigatório'], 400);
            }
            [$apiId, $apiHash] = $this->tgApiCredentials();
            if ($apiId <= 0 || $apiHash === '') {
                json_response([
                    'error' => 'Credenciais Telegram não configuradas no painel admin (Sistema → API ID / API Hash).',
                ], 400);
            }

            @set_time_limit(90);
            $result = TelegramBridge::call([
                'action' => 'send-code',
                'userId' => $uid,
                'phone' => $phone,
                'apiId' => $apiId,
                'apiHash' => $apiHash,
            ]);
            if (empty($result['ok'])) {
                json_response(['error' => (string) ($result['error'] ?? 'Erro ao enviar código')], 500);
            }
            json_response(['success' => true]);
        }

        // ── VERIFY CODE ──────────────────────────────────────────────────────
        if ($action === 'verify-code') {
            $code = preg_replace('/\D+/', '', (string) ($body['code'] ?? '')) ?? '';
            if ($code === '') {
                json_response(['error' => 'Código obrigatório'], 400);
            }
            [$apiId, $apiHash] = $this->tgApiCredentials();
            if ($apiId <= 0 || $apiHash === '') {
                json_response([
                    'error' => 'Credenciais Telegram não configuradas no painel admin (Sistema → API ID / API Hash).',
                ], 400);
            }

            @set_time_limit(90);
            $result = TelegramBridge::call([
                'action' => 'verify-code',
                'userId' => $uid,
                'code' => $code,
                'apiId' => $apiId,
                'apiHash' => $apiHash,
            ]);
            if (empty($result['ok'])) {
                json_response(['error' => (string) ($result['error'] ?? 'Código inválido')], 400);
            }

            $session = (string) ($result['session'] ?? '');
            $phone = (string) ($result['phone'] ?? '');
            $existing = Database::fetch('SELECT id FROM telegram_userbots WHERE ownerId = ?', [$uid]);
            $data = [
                'session' => $session,
                'phone' => $phone,
                'isConnected' => 1,
            ];
            if ($existing) {
                Database::update('telegram_userbots', $data, 'ownerId = :oid', ['oid' => $uid]);
            } else {
                $data['ownerId'] = $uid;
                Database::insert('telegram_userbots', $data);
            }
            json_response(['success' => true]);
        }

        // ── SEARCH GROUPS ────────────────────────────────────────────────────
        if ($action === 'search-groups') {
            $row = Database::fetch(
                'SELECT session, isConnected FROM telegram_userbots WHERE ownerId = ?',
                [$uid]
            );
            if (!$row || empty($row['session']) || empty($row['isConnected'])) {
                json_response(['error' => 'Não conectado'], 400);
            }
            [$apiId, $apiHash] = $this->tgApiCredentials();
            @set_time_limit(90);
            $result = TelegramBridge::call([
                'action' => 'search-groups',
                'session' => (string) $row['session'],
                'apiId' => $apiId,
                'apiHash' => $apiHash,
            ]);
            if (empty($result['ok'])) {
                json_response(['error' => (string) ($result['error'] ?? 'Erro ao buscar grupos')], 500);
            }
            // Front espera array puro (mesmo do route.ts)
            json_response($result['groups'] ?? []);
        }

        // ── FETCH MESSAGES ───────────────────────────────────────────────────
        if ($action === 'fetch-messages') {
            $groupId = (string) ($body['groupId'] ?? '');
            $row = Database::fetch(
                'SELECT session, isConnected FROM telegram_userbots WHERE ownerId = ?',
                [$uid]
            );
            if (!$row || empty($row['session']) || empty($row['isConnected'])) {
                json_response(['error' => 'Não conectado'], 400);
            }
            [$apiId, $apiHash] = $this->tgApiCredentials();
            @set_time_limit(90);
            $result = TelegramBridge::call([
                'action' => 'fetch-messages',
                'session' => (string) $row['session'],
                'apiId' => $apiId,
                'apiHash' => $apiHash,
                'groupId' => $groupId,
            ]);
            if (empty($result['ok'])) {
                json_response(['error' => (string) ($result['error'] ?? 'Erro ao buscar mensagens')], 500);
            }
            json_response($result['messages'] ?? []);
        }

        // ── SELECT GROUP ─────────────────────────────────────────────────────
        if ($action === 'select-group') {
            $groupId = (string) ($body['groupId'] ?? '');
            $groupName = (string) ($body['groupName'] ?? '');
            $keywords = $body['keywords'] ?? [];
            $signalKeyword = $body['signalKeyword'] ?? null;

            $current = Database::fetch(
                'SELECT id, signalKeyword FROM telegram_userbots WHERE ownerId = ?',
                [$uid]
            );
            if (!$current) {
                json_response(['error' => 'Conecte o Telegram antes de selecionar o grupo'], 400);
            }

            $keywordChanged = ((string) ($signalKeyword ?? '')) !== ((string) ($current['signalKeyword'] ?? ''));
            $data = [
                'groupId' => $groupId,
                'groupName' => $groupName,
                'keywords' => is_string($keywords) ? $keywords : json_encode($keywords, JSON_UNESCAPED_UNICODE),
                'signalKeyword' => $signalKeyword !== null ? (string) $signalKeyword : null,
            ];
            if ($keywordChanged) {
                $data['signalKeywordVerified'] = 0;
            }
            Database::update('telegram_userbots', $data, 'ownerId = :oid', ['oid' => $uid]);
            json_response(['success' => true]);
        }

        // ── DISCONNECT ───────────────────────────────────────────────────────
        if ($action === 'disconnect') {
            $this->tgClearPending($uid);
            $existing = Database::fetch('SELECT id FROM telegram_userbots WHERE ownerId = ?', [$uid]);
            if ($existing) {
                Database::update('telegram_userbots', [
                    'session' => null,
                    'isConnected' => 0,
                    'groupId' => null,
                    'groupName' => null,
                ], 'ownerId = :oid', ['oid' => $uid]);
            } else {
                Database::insert('telegram_userbots', [
                    'ownerId' => $uid,
                    'isConnected' => 0,
                ]);
            }
            json_response(['success' => true]);
        }

        json_response(['error' => 'Ação inválida'], 400);
    }

    /** @return array{0: int, 1: string} */
    private function tgApiCredentials(): array
    {
        $apiId = (int) (ConfigRepository::get('TELEGRAM_API_ID', '0') ?: '0');
        $apiHash = (string) (ConfigRepository::get('TELEGRAM_API_HASH', '') ?? '');
        return [$apiId, $apiHash];
    }

    private function tgClearPending(int $uid): void
    {
        $path = storage_path('telegram-pending/' . $uid . '.json');
        if (is_file($path)) {
            @unlink($path);
        }
    }
    /**
     * OPTIONS /api/user/bacbo-bridge/* — preflight CORS (script no domínio do jogo).
     */
    public function bacboBridgeCors(): void
    {
        cors_bridge_preflight();
    }

    /**
     * GET /api/user/bacbo-bridge/poll
     * Chamado pelo script no navegador do cliente para pegar a aposta pendente mais antiga.
     * Retorna a aposta e muda status para 'sent' (para não duplicar).
     * Auth: cookie (mesma origem) OU Authorization: Bearer (device/bridge token).
     */
    public function bacboBridgePoll(): void
    {
        $cors = cors_bridge_headers();
        $uid = Auth::requireUserIdFromCookieOrDevice($cors);
        BacBoBrowserBridge::recordPoll($uid);
        $row = BacBoBrowserBridge::nextPending($uid);
        if (!$row) {
            json_response(['pending' => false], 200, $cors);
        }
        json_response([
            'pending' => true,
            'betId'   => (int) $row['id'],
            'spot'    => (string) $row['spot'],
            'amount'  => (float) $row['amount'],
            'protectionAmount' => (float) ($row['protectionAmount'] ?? 0),
        ], 200, $cors);
    }

    /**
     * POST /api/user/bacbo-bridge/result
     * Body: { betId: int, ok: bool, result: object }
     * Chamado pelo script no navegador após confirmar ou falhar o envio da aposta.
     */
    public function bacboBridgeResult(): void
    {
        $cors = cors_bridge_headers();
        $uid  = Auth::requireUserIdFromCookieOrDevice($cors);
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $betId  = (int) ($body['betId'] ?? 0);
        $ok     = !empty($body['ok']);
        $result = is_array($body['result'] ?? null) ? $body['result'] : ['ok' => $ok];
        if ($betId <= 0) {
            json_response(['error' => 'betId inválido'], 400, $cors);
        }
        $saved = BacBoBrowserBridge::reportResult($uid, $betId, $ok, $result);
        json_response(['saved' => $saved], 200, $cors);
    }

    /**
     * GET /api/user/bacbo-bridge/status
     * Painel: bridge do browser e/ou app Android online?
     */
    public function bacboBridgeStatus(): void
    {
        Auth::requireUserId();
        $uid = (int) Auth::userId();
        $st = BacBoBrowserBridge::status($uid);
        json_response(['ok' => true] + $st);
    }

    /**
     * POST /api/user/bacbo-bridge/script
     * Gera (ou reusa fluxo de) token de bridge + snippet pronto pra colar no
     * console da mesa Bac Bo (Blaze/Evolution). Equivalente prático ao
     * auto_bet do bacbominer: aposta sai do IP/navegador do usuário.
     */
    public function bacboBridgeScript(): void
    {
        Auth::requireUserId();
        $uid = (int) Auth::userId();
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $label = trim((string) ($body['deviceLabel'] ?? '')) ?: 'Browser Bridge';

        // Revoga tokens antigos com o mesmo label (evita acumular “browser bridge”)
        Database::query(
            "UPDATE device_tokens SET revokedAt = ? WHERE ownerId = ? AND revokedAt IS NULL "
            . "AND deviceLabel = ?",
            [now(), $uid, $label]
        );

        $raw = bin2hex(random_bytes(32));
        Database::insert('device_tokens', [
            'ownerId' => $uid,
            'tokenHash' => hash('sha256', $raw),
            'deviceLabel' => $label,
        ]);

        $base = public_base_url();
        // Inline completo: CSP da Evolution costuma bloquear <script src> externo.
        $bridgePath = public_path('bacbo-bridge.js');
        $bridgeBody = is_file($bridgePath) ? (string) file_get_contents($bridgePath) : '';
        if ($bridgeBody === '') {
            json_response(['error' => 'Arquivo bacbo-bridge.js não encontrado no servidor.'], 500);
        }
        $script = "window.__AUTOWIN_BRIDGE__=" . json_encode([
            'baseUrl' => $base,
            'token' => $raw,
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . ";\n"
            . "if(window.__stopBacBoBridge){try{window.__stopBacBoBridge()}catch(e){}}\n"
            . $bridgeBody;

        json_response([
            'ok' => true,
            'baseUrl' => $base,
            'token' => $raw,
            'script' => $script,
            'hint' => 'Abra o Bac Bo na Blaze, F12 → Console, cole o script e mantenha a aba aberta.',
        ]);
    }

    /**
     * POST /api/user/device/pair
     * Gera um token novo pro app Android (motor de aposta local) e devolve
     * o valor cru (só desta vez — só o hash fica salvo).
     */
    public function devicePair(): void
    {
        Auth::requireUserId();
        $uid = (int) Auth::userId();
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $label = trim((string) ($body['deviceLabel'] ?? '')) ?: null;

        $raw = bin2hex(random_bytes(32));
        Database::insert('device_tokens', [
            'ownerId' => $uid,
            'tokenHash' => hash('sha256', $raw),
            'deviceLabel' => $label,
        ]);

        json_response(['ok' => true, 'token' => $raw]);
    }

    /**
     * POST /api/user/device/unpair
     * Body: { deviceId: int } — revoga um dispositivo pareado do usuário logado.
     */
    public function deviceUnpair(): void
    {
        Auth::requireUserId();
        $uid = (int) Auth::userId();
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $deviceId = (int) ($body['deviceId'] ?? 0);
        if ($deviceId <= 0) {
            json_response(['error' => 'deviceId inválido'], 400);
        }
        $row = Database::fetch('SELECT id FROM device_tokens WHERE id = ? AND ownerId = ?', [$deviceId, $uid]);
        if (!$row) {
            json_response(['ok' => false, 'error' => 'Dispositivo não encontrado.'], 404);
        }
        Database::update('device_tokens', ['revokedAt' => now()], 'id = ?', [$deviceId]);
        json_response(['ok' => true]);
    }

    /**
     * GET /api/user/device/status
     * Status do(s) dispositivo(s) pareado(s) do usuário logado — usado pela
     * UI (portal-src/pages/premium-bacbo.tsx) pra mostrar conectado/desconectado.
     */
    public function deviceStatus(): void
    {
        Auth::requireUserId();
        $uid = (int) Auth::userId();
        $rows = Database::fetchAll(
            'SELECT id, deviceLabel, createdAt, lastSeenAt FROM device_tokens '
            . 'WHERE ownerId = ? AND revokedAt IS NULL ORDER BY id DESC',
            [$uid]
        );
        // "Conectado" = viu o dispositivo nos últimos 30s (poll nativo é a cada 2s).
        $connected = false;
        foreach ($rows as $r) {
            if (!empty($r['lastSeenAt']) && strtotime((string) $r['lastSeenAt']) >= time() - 30) {
                $connected = true;
                break;
            }
        }
        json_response(['ok' => true, 'connected' => $connected, 'devices' => $rows]);
    }

    /**
     * GET /api/user/bacbo-bridge/entry-url
     * Chamado pelo app Android (celular do cliente) ao iniciar o motor local:
     * devolve a URL de entrada da Evolution pra WebView navegar de verdade
     * (login Blaze feito aqui no servidor, o resto é o celular quem segue).
     */
    public function bacboBridgeEntryUrl(): void
    {
        $cors = cors_bridge_headers();
        $uid = Auth::requireUserIdFromCookieOrDevice($cors);
        $user = UserRepository::find($uid);
        $token = (string) ($user['token'] ?? '');
        if ($token === '') {
            json_response(['ok' => false, 'error' => 'Conta Blaze não conectada.'], 400, $cors);
        }
        $slug = (string) ($user['gameType'] ?? '') === 'BACBO_LIVE' ? 'bac-bo-ao-vivo' : 'bac-bo';
        $res = EvolutionBacBo::getEntryUrl($uid, $token, $slug);
        json_response($res, 200, $cors);
    }
}
