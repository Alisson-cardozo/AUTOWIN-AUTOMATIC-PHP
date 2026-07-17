<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Auth\Auth;
use App\Bot\EngineManager;
use App\Database;
use App\Models\UserRepository;
use App\Services\BotCommandService;
use App\Services\BotWorker;
use App\Services\IqOptionBridge;

final class DayTradeController
{
    public function status(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        UserRepository::ensureDayTradeDefaults($uid);
        $u = UserRepository::find($uid);
        $settings = Database::fetch('SELECT * FROM daytrade_settings WHERE ownerId = ?', [$uid]);
        $vars = Database::fetch('SELECT * FROM daytrade_variables WHERE ownerId = ?', [$uid]);
        $strats = Database::fetchAll('SELECT * FROM daytrade_strategies WHERE ownerId = ? ORDER BY id DESC', [$uid]);
        $entries = Database::fetchAll(
            'SELECT * FROM daytrade_entries WHERE ownerId = ? ORDER BY id DESC LIMIT 80',
            [$uid]
        );
        $accountType = strtoupper((string) ($u['iqAccountType'] ?? 'DEMO'));
        if (!in_array($accountType, ['DEMO', 'REAL'], true)) {
            $accountType = 'DEMO';
        }
        json_response([
            'connected' => !empty($u['iqSsid']),
            'iqEmail' => $u['iqEmail'] ?? null,
            'iqAccountType' => $accountType,
            'iqBalanceId' => $u['iqBalanceId'] ?? null,
            'balance' => isset($vars['balance']) ? (float) $vars['balance'] : null,
            'daytradeIsActive' => (bool) ($u['daytradeIsActive'] ?? 0),
            'daytradeIsBetting' => (bool) ($u['daytradeIsBetting'] ?? 0),
            'daytradeConnectPending' => (bool) ($u['daytradeConnectPending'] ?? 0),
            'daytradeConnectError' => $u['daytradeConnectError'] ?? null,
            'settings' => $this->normalizeSettings($settings),
            'variables' => $this->normalizeVars($vars),
            'strategies' => $strats,
            'entries' => $entries,
            'assets' => array_keys(self::assets()),
            'catalog' => array_values(self::strategyCatalog()),
        ]);
    }

    public function conta(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        UserRepository::ensureDayTradeDefaults($uid);
        $method = request_method();

        if ($method === 'PATCH') {
            $data = [];
            $accountType = null;
            if (input('iqAccountType') !== null && input('iqAccountType') !== '') {
                $t = strtoupper((string) input('iqAccountType'));
                if (in_array($t, ['DEMO', 'REAL'], true)) {
                    $data['iqAccountType'] = $t;
                    $accountType = $t;
                }
            }
            if ($data) {
                UserRepository::update($uid, $data);
            }
            $u = UserRepository::find($uid);
            $type = strtoupper((string) ($u['iqAccountType'] ?? 'DEMO'));
            $payload = [
                'iqAccountType' => $type,
                'connected' => !empty($u['iqSsid']),
            ];
            // Ao trocar DEMO/REAL, re-seleciona o balanceId e saldo da IQ
            if ($accountType !== null && !empty($u['iqSsid'])) {
                $synced = $this->syncBalanceForUser($uid, (string) $u['iqSsid'], $type);
                $payload = array_merge($payload, $synced);
            }
            json_response($payload);
        }

        if ($method === 'POST') {
            $email = trim((string) input('email', ''));
            $password = (string) input('password', '');
            if ($email === '' || $password === '') {
                json_response(['error' => 'Email e senha da IQ Option são obrigatórios.'], 400);
            }
            $typeIn = strtoupper(trim((string) input('iqAccountType', input('accountType', 'DEMO'))));
            if (!in_array($typeIn, ['DEMO', 'REAL'], true)) {
                $typeIn = 'DEMO';
            }
            UserRepository::update($uid, [
                'daytradeConnectPending' => 1,
                'daytradeConnectError' => null,
                'iqEmail' => $email,
                'iqPassword' => $password,
                'iqAccountType' => $typeIn,
                // limpa sessão anterior para não mostrar "conectado" falso durante o login
                'iqSsid' => null,
                'iqBalanceId' => null,
            ]);
            json_response_and_continue(['pending' => true, 'iqAccountType' => $typeIn]);
            try {
                EngineManager::connectIqOption($uid, $email, $password);
            } catch (\Throwable $e) {
                UserRepository::update($uid, [
                    'daytradeConnectPending' => 0,
                    'daytradeConnectError' => 'Erro: ' . $e->getMessage(),
                ]);
            }
            exit;
        }

        if ($method === 'DELETE') {
            UserRepository::update($uid, [
                'iqSsid' => null,
                'iqBalanceId' => null,
                'iqEmail' => null,
                'iqPassword' => null,
                'daytradeIsActive' => 0,
                'daytradeIsBetting' => 0,
                'daytradeConnectPending' => 0,
                'daytradeConnectError' => null,
            ]);
            json_response(['success' => true]);
        }

        json_response(['error' => 'Método inválido'], 405);
    }

    public function balance(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        $u = UserRepository::find($uid);
        $ssid = (string) ($u['iqSsid'] ?? '');
        if ($ssid === '') {
            json_response(['error' => 'Não conectado'], 400);
        }
        $type = strtoupper((string) ($u['iqAccountType'] ?? 'DEMO'));
        $synced = $this->syncBalanceForUser($uid, $ssid, $type);
        if (!empty($synced['error']) && empty($synced['balances'])) {
            json_response([
                'error' => $synced['error'],
                'balances' => [],
                'iqAccountType' => $type,
            ], 400);
        }
        json_response(array_merge(['iqAccountType' => $type], $synced));
    }

    /**
     * Escolhe o saldo DEMO (practice type 4/2) ou REAL (type 1) e grava no user.
     *
     * @return array{balance:float,balanceId:int,balances:list<array>,currency:string,accountLabel:string,error?:string}
     */
    private function syncBalanceForUser(int $uid, string $ssid, string $accountType): array
    {
        $res = IqOptionBridge::balances($ssid, true);
        if (empty($res['ok'])) {
            return [
                'balance' => 0.0,
                'balanceId' => 0,
                'balances' => [],
                'currency' => 'USD',
                'accountLabel' => $accountType,
                'error' => (string) ($res['error'] ?? 'Falha ao ler saldo'),
                'synced' => false,
            ];
        }
        $balances = is_array($res['balances'] ?? null) ? $res['balances'] : [];
        $chosen = self::pickBalance($balances, $accountType, false);
        if (!$chosen) {
            return [
                'balance' => 0.0,
                'balanceId' => 0,
                'balances' => $balances,
                'currency' => 'USD',
                'accountLabel' => $accountType,
                'error' => $accountType === 'REAL'
                    ? 'Conta REAL não encontrada nesta sessão IQ. Confira se a conta tem saldo real liberado.'
                    : 'Conta DEMO (practice) não encontrada nesta sessão IQ.',
                'synced' => false,
            ];
        }
        $amount = (float) ($chosen['amount'] ?? 0);
        $balId = (int) ($chosen['id'] ?? 0);
        $currency = (string) ($chosen['currency'] ?? 'USD');
        if ($balId > 0) {
            UserRepository::update($uid, ['iqBalanceId' => $balId]);
        }
        try {
            Database::update('daytrade_variables', ['balance' => $amount], 'ownerId = :oid', ['oid' => $uid]);
        } catch (\Throwable) {
        }
        return [
            'balance' => $amount,
            'balanceId' => $balId,
            'balances' => $balances,
            'currency' => $currency !== '' ? $currency : 'USD',
            'accountLabel' => $accountType,
            'synced' => $balId > 0,
            'balanceType' => (int) ($chosen['type'] ?? 0),
        ];
    }

    /**
     * @param  list<array<string,mixed>>  $balances
     * @param  bool  $allowCrossTypeFallback  se false, REAL não cai em DEMO e vice-versa
     * @return array<string,mixed>|null
     */
    public static function pickBalance(array $balances, string $accountType, bool $allowCrossTypeFallback = false): ?array
    {
        $wantDemo = strtoupper($accountType) !== 'REAL';
        $chosen = null;
        $fallbackPractice = null;
        $fallbackReal = null;
        foreach ($balances as $b) {
            if (!is_array($b)) {
                continue;
            }
            $type = (int) ($b['type'] ?? 0);
            // IQ Option: 1 = real, 4 = practice (demo), 2 = torneio/practice antigo
            $isPractice = $type === 4 || $type === 2;
            $isReal = $type === 1;
            if ($isPractice && $fallbackPractice === null) {
                $fallbackPractice = $b;
            }
            if ($isReal && $fallbackReal === null) {
                $fallbackReal = $b;
            }
            if ($wantDemo && $isPractice) {
                $chosen = $b;
                break;
            }
            if (!$wantDemo && $isReal) {
                $chosen = $b;
                break;
            }
        }
        if ($chosen) {
            return $chosen;
        }
        if ($wantDemo) {
            return $fallbackPractice ?? ($allowCrossTypeFallback ? ($balances[0] ?? null) : null);
        }
        return $fallbackReal ?? ($allowCrossTypeFallback ? ($balances[0] ?? null) : null);
    }

    public function configuracoes(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        UserRepository::ensureDayTradeDefaults($uid);
        if (request_method() === 'GET') {
            json_response($this->normalizeSettings(Database::fetch('SELECT * FROM daytrade_settings WHERE ownerId = ?', [$uid])));
        }
        $body = request_json();
        if (!$body) {
            // fallback form-urlencoded
            $body = $_POST;
        }
        $data = [];
        if (array_key_exists('enterType', $body)) {
            $data['enterType'] = strtoupper((string) $body['enterType']) === 'PORCENTAGEM' ? 'PORCENTAGEM' : 'VALOR';
        }
        if (array_key_exists('enterValue', $body)) {
            $data['enterValue'] = max(2, (float) $body['enterValue']);
        }
        if (array_key_exists('enterPercent', $body)) {
            $data['enterPercent'] = max(0.01, (float) $body['enterPercent']);
        }
        if (array_key_exists('stopType', $body)) {
            $st = strtoupper((string) $body['stopType']);
            $data['stopType'] = $st === 'QUANTIDADE' ? 'QUANTIDADE' : 'VALOR';
        }
        if (array_key_exists('stopGain', $body)) {
            $data['stopGain'] = (string) $body['stopGain'];
        }
        if (array_key_exists('stopLoss', $body)) {
            $data['stopLoss'] = (string) $body['stopLoss'];
        }
        if (array_key_exists('martingale', $body)) {
            $data['martingale'] = max(0, min(10, (int) $body['martingale']));
        }
        if (array_key_exists('martingaleMultiplier', $body)) {
            $data['martingaleMultiplier'] = max(1, (float) $body['martingaleMultiplier']);
        }
        if (array_key_exists('expirationMinutes', $body)) {
            $data['expirationMinutes'] = max(1, min(60, (int) $body['expirationMinutes']));
        }
        if (array_key_exists('minPayout', $body)) {
            $data['minPayout'] = max(1, min(100, (float) $body['minPayout']));
        }
        if (array_key_exists('quantityCycles', $body)) {
            $data['quantityCycles'] = max(1, (int) $body['quantityCycles']);
        }
        if (array_key_exists('skipFirstEntry', $body)) {
            $data['skipFirstEntry'] = !empty($body['skipFirstEntry']) && $body['skipFirstEntry'] !== '0' && $body['skipFirstEntry'] !== false ? 1 : 0;
        }
        if (array_key_exists('skipEntryAfterLoss', $body)) {
            $data['skipEntryAfterLoss'] = !empty($body['skipEntryAfterLoss']) && $body['skipEntryAfterLoss'] !== '0' && $body['skipEntryAfterLoss'] !== false ? 1 : 0;
        }
        // exclusão mútua (igual Blaze/Jonbet)
        if (array_key_exists('skipFirstEntry', $data) || array_key_exists('skipEntryAfterLoss', $data)) {
            $sfe = (int) ($data['skipFirstEntry'] ?? 0);
            $sal = (int) ($data['skipEntryAfterLoss'] ?? 0);
            if ($sfe === 1 && $sal === 1) {
                // se ambos vieram ligados, prioriza o que o client mandou por último na intenção
                // (UI já exclui; se colidir, mantém skipEntryAfterLoss desligado)
                $data['skipEntryAfterLoss'] = 0;
            } elseif ($sfe === 1) {
                $data['skipEntryAfterLoss'] = 0;
            } elseif ($sal === 1) {
                $data['skipFirstEntry'] = 0;
            }
        }
        if (array_key_exists('defaultAsset', $body) && is_string($body['defaultAsset'])) {
            $data['defaultAsset'] = mb_substr(trim($body['defaultAsset']), 0, 500);
        }
        // Tipo de UI: MODELOS (padrões/indicadores) | HORARIOS — igual Blaze strategyType
        if (array_key_exists('strategyType', $body) && is_string($body['strategyType'])) {
            $st = strtoupper(trim($body['strategyType']));
            // normaliza aliases
            if (in_array($st, ['HORARIO', 'HORÁRIOS', 'HORARIOS', 'PREMIUM_LIST'], true)) {
                $data['strategyType'] = 'HORARIOS';
            } elseif (in_array($st, ['MODELOS', 'MODELO', 'PARAMETROS', 'PADROES', 'PADRÕES', 'PADROES / INDICADORES'], true)) {
                $data['strategyType'] = 'MODELOS';
            } else {
                // permite valor livre curto (legado) mas limita tamanho
                $data['strategyType'] = mb_substr($st !== '' ? $st : 'MODELOS', 0, 50);
            }
        }
        if (!$data) {
            json_response(['error' => 'Nenhum campo para salvar'], 400);
        }
        try {
            Database::update('daytrade_settings', $data, 'ownerId = :oid', ['oid' => $uid]);
            BotCommandService::enqueue($uid, 'refresh-cache', 'DAYTRADE');
        } catch (\Throwable $e) {
            log_msg('[daytrade config] ' . $e->getMessage(), 'daytrade');
            json_response(['error' => 'Falha ao salvar: ' . $e->getMessage()], 500);
        }
        $saved = $this->normalizeSettings(Database::fetch('SELECT * FROM daytrade_settings WHERE ownerId = ?', [$uid]));
        json_response($saved);
    }

    public function estrategias(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        UserRepository::ensureDayTradeDefaults($uid);
        $method = request_method();
        if ($method === 'GET') {
            json_response(Database::fetchAll(
                'SELECT * FROM daytrade_strategies WHERE ownerId = ? ORDER BY id DESC',
                [$uid]
            ));
        }
        if ($method === 'POST') {
            try {
                UserRepository::ensureDayTradeSchema();
            } catch (\Throwable) {
            }
            $catalog = self::strategyCatalog();
            $strategyType = strtoupper(trim((string) input('strategyType', input('id', 'SMA_CROSS'))));
            // normaliza aliases de horário
            if (in_array($strategyType, ['HORARIO', 'HORÁRIOS', 'HORARIOS', 'PREMIUM_LIST'], true)) {
                $strategyType = $strategyType === 'PREMIUM_LIST' ? 'PREMIUM_LIST' : 'HORARIO';
            }

            // ── Horários (igual Double): sequence=HH:MM, color=CALL/PUT ──
            if ($strategyType === 'HORARIO' || $strategyType === 'PREMIUM_LIST') {
                $timeRaw = trim((string) input('sequence', input('time', input('name', ''))));
                if (!preg_match('/^(\d{1,2}):(\d{2})$/', $timeRaw, $tm)) {
                    json_response(['error' => 'Horário inválido. Use HH:MM (ex: 14:30).'], 400);
                }
                $sequence = sprintf('%02d:%02d', ((int) $tm[1]) % 24, ((int) $tm[2]) % 60);
                $dir = strtoupper(trim((string) input('color', input('direction', 'CALL'))));
                if (!in_array($dir, ['CALL', 'PUT'], true)) {
                    // aceita emoji/texto comum
                    $rawDir = mb_strtolower((string) input('color', input('direction', '')));
                    if (str_contains($rawDir, 'put') || str_contains($rawDir, '🔴') || str_contains($rawDir, 'venda')) {
                        $dir = 'PUT';
                    } else {
                        $dir = 'CALL';
                    }
                }
                $exp = max(1, min(60, (int) input('expirationMinutes', 3)));
                $assetsIn = input('assets', input('selectedAssets', input('asset', null)));
                $assetList = [];
                if (is_array($assetsIn)) {
                    $assetList = $assetsIn;
                } elseif (is_string($assetsIn) && trim($assetsIn) !== '') {
                    $assetList = array_map('trim', explode(',', $assetsIn));
                }
                if (!$assetList) {
                    $assetList = ['EURUSD-OTC'];
                }
                $clean = [];
                foreach ($assetList as $a) {
                    $a = trim((string) $a);
                    if ($a !== '') {
                        $clean[] = $a;
                    }
                }
                $clean = array_values(array_unique($clean)) ?: ['EURUSD-OTC'];
                $assetCsv = implode(',', $clean);
                try {
                    // mesmo horário + mesma direção + mesmo asset → atualiza
                    $existing = Database::fetch(
                        'SELECT id FROM daytrade_strategies WHERE ownerId = ? AND strategyType IN (\'HORARIO\',\'PREMIUM_LIST\',\'HORÁRIOS\') AND sequence = ? AND color = ? LIMIT 1',
                        [$uid, $sequence, $dir]
                    );
                    if ($existing) {
                        Database::update(
                            'daytrade_strategies',
                            [
                                'strategyType' => 'HORARIO',
                                'sequence' => $sequence,
                                'color' => $dir,
                                'asset' => $assetCsv,
                                'expirationMinutes' => $exp,
                            ],
                            'id = :id AND ownerId = :oid',
                            ['id' => (int) $existing['id'], 'oid' => $uid]
                        );
                        BotCommandService::enqueue($uid, 'refresh-cache', 'DAYTRADE');
                        json_response(Database::fetch('SELECT * FROM daytrade_strategies WHERE id = ?', [(int) $existing['id']]));
                    }
                    $id = Database::insert('daytrade_strategies', [
                        'ownerId' => $uid,
                        'strategyType' => 'HORARIO',
                        'sequence' => $sequence,
                        'color' => $dir,
                        'asset' => $assetCsv,
                        'expirationMinutes' => $exp,
                    ]);
                    BotCommandService::enqueue($uid, 'refresh-cache', 'DAYTRADE');
                    json_response(Database::fetch('SELECT * FROM daytrade_strategies WHERE id = ?', [$id]));
                } catch (\Throwable $e) {
                    log_msg('[daytrade horario] ' . $e->getMessage(), 'daytrade');
                    json_response(['error' => 'Falha ao salvar horário: ' . $e->getMessage()], 500);
                }
            }

            // Modelo de estratégia técnica: type define o sinal; exp/ativo vêm do modelo
            $model = $catalog[$strategyType] ?? null;
            if (!$model) {
                foreach ($catalog as $key => $m) {
                    if (strcasecmp($key, $strategyType) === 0 || strcasecmp((string) ($m['id'] ?? ''), $strategyType) === 0) {
                        $model = $m;
                        $strategyType = $key;
                        break;
                    }
                }
            }
            if (!$model) {
                json_response(['error' => 'Estratégia inválida. Escolha um dos 10 modelos ou use Horários.'], 400);
            }
            $name = trim((string) input('name', input('sequence', $model['name'])));
            $expIn = input('expirationMinutes', null);
            $exp = $expIn !== null && $expIn !== ''
                ? max(1, min(60, (int) $expIn))
                : max(1, min(60, (int) ($model['expirationMinutes'] ?? 3)));
            $color = 'AUTO';
            $assetsIn = input('assets', input('selectedAssets', null));
            $assetList = [];
            if (is_array($assetsIn)) {
                $assetList = $assetsIn;
            } elseif (is_string($assetsIn) && trim($assetsIn) !== '') {
                $assetList = array_map('trim', explode(',', $assetsIn));
            }
            if (!$assetList) {
                $assetList = [(string) ($model['asset'] ?? 'EURUSD-OTC')];
            }
            $allowed = self::assets();
            $clean = [];
            foreach ($assetList as $a) {
                $a = trim((string) $a);
                if ($a === '') {
                    continue;
                }
                $found = null;
                foreach (array_keys($allowed) as $cat) {
                    if (strcasecmp($cat, $a) === 0) {
                        $found = $cat;
                        break;
                    }
                }
                $clean[] = $found ?? $a;
            }
            $clean = array_values(array_unique($clean));
            if (!$clean) {
                $clean = [(string) ($model['asset'] ?? 'EURUSD-OTC')];
            }
            $finalName = function_exists('mb_substr')
                ? mb_substr($name !== '' ? $name : (string) $model['name'], 0, 200)
                : substr($name !== '' ? $name : (string) $model['name'], 0, 200);
            $assetCsv = implode(',', $clean);
            $isDefaultName = strcasecmp($finalName, (string) $model['name']) === 0;
            try {
                if ($isDefaultName) {
                    $existing = Database::fetch(
                        'SELECT id FROM daytrade_strategies WHERE ownerId = ? AND strategyType = ? LIMIT 1',
                        [$uid, $strategyType]
                    );
                    if ($existing) {
                        Database::update(
                            'daytrade_strategies',
                            [
                                'sequence' => $finalName,
                                'color' => $color,
                                'asset' => $assetCsv,
                                'expirationMinutes' => $exp,
                            ],
                            'id = :id AND ownerId = :oid',
                            ['id' => (int) $existing['id'], 'oid' => $uid]
                        );
                        BotCommandService::enqueue($uid, 'refresh-cache', 'DAYTRADE');
                        json_response(Database::fetch('SELECT * FROM daytrade_strategies WHERE id = ?', [(int) $existing['id']]));
                    }
                }
                $id = Database::insert('daytrade_strategies', [
                    'ownerId' => $uid,
                    'strategyType' => $strategyType,
                    'sequence' => $finalName,
                    'color' => $color,
                    'asset' => $assetCsv,
                    'expirationMinutes' => $exp,
                ]);
                BotCommandService::enqueue($uid, 'refresh-cache', 'DAYTRADE');
                $row = Database::fetch('SELECT * FROM daytrade_strategies WHERE id = ?', [$id]);
                if (!$row) {
                    json_response(['error' => 'Estratégia salva mas não foi possível reler. Atualize a página.'], 500);
                }
                json_response($row);
            } catch (\Throwable $e) {
                log_msg('[daytrade estrategias] ' . $e->getMessage(), 'daytrade');
                json_response(['error' => 'Falha ao salvar estratégia: ' . $e->getMessage()], 500);
            }
        }
        if ($method === 'DELETE') {
            $id = (int) ($_GET['id'] ?? input('id', 0));
            if ($id > 0) {
                Database::delete('daytrade_strategies', 'id = ? AND ownerId = ?', [$id, $uid]);
            } else {
                Database::delete('daytrade_strategies', 'ownerId = ?', [$uid]);
            }
            BotCommandService::enqueue($uid, 'refresh-cache', 'DAYTRADE');
            json_response(['success' => true]);
        }
        json_response(['error' => 'Método inválido'], 405);
    }

    /**
     * Premium Day Trade — gera lista de ~20 entradas (horário + CALL/PUT + ativo)
     * com base nos ativos selecionados e nos sinais técnicos (velas IQ).
     */
    public function premiumGenerate(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        UserRepository::ensureDayTradeDefaults($uid);

        $u = UserRepository::find($uid);
        $ssid = (string) ($u['iqSsid'] ?? '');
        if ($ssid === '') {
            json_response(['error' => 'Conecte a IQ Option na aba Day Trade antes de gerar a lista.'], 400);
        }

        $assetsIn = input('assets', input('selectedAssets', null));
        $assetList = [];
        if (is_array($assetsIn)) {
            $assetList = array_values(array_filter(array_map('strval', $assetsIn)));
        } elseif (is_string($assetsIn) && trim($assetsIn) !== '') {
            $assetList = array_values(array_filter(array_map('trim', explode(',', $assetsIn))));
        }
        if (!$assetList) {
            $assetList = ['EURUSD-OTC', 'GBPUSD-OTC', 'USDJPY-OTC'];
        }
        $assetList = array_values(array_unique(array_slice($assetList, 0, 30)));

        $strategyType = strtoupper(trim((string) input('strategyType', 'SMA_CROSS')));
        $catalog = self::strategyCatalog();
        if (!isset($catalog[$strategyType])) {
            $strategyType = 'SMA_CROSS';
        }
        $count = max(5, min(40, (int) input('count', 20)));
        $expMin = max(1, min(15, (int) input('expirationMinutes', $catalog[$strategyType]['expirationMinutes'] ?? 3)));
        // espaçamento entre horários da lista (min) — default = expiração
        $spacing = max(2, min(30, (int) input('spacingMinutes', $expMin)));
        // começa daqui a N minutos
        $startOffset = max(3, min(60, (int) input('startOffsetMinutes', 10)));

        // Analisa cada ativo (sinal atual)
        $signals = [];
        foreach ($assetList as $asset) {
            $res = IqOptionBridge::candles($ssid, $asset, 60, 120);
            if (empty($res['ok']) || empty($res['candles']) || !is_array($res['candles'])) {
                continue;
            }
            $params = [];
            if ($strategyType === 'SMA_CROSS') {
                $params = ['fast' => 8, 'slow' => 21];
            } elseif ($strategyType === 'EMA_CROSS') {
                $params = ['fast' => 11, 'slow' => 56];
            } elseif ($strategyType === 'RSI_DIV' || $strategyType === 'RSI') {
                $params = ['period' => 14];
            }
            $dir = \App\Bot\Games\DayTradeSignals::detect($strategyType, $res['candles'], $params);
            if ($dir === null) {
                continue;
            }
            // confiança simples: força do último movimento (range relativo)
            $candles = $res['candles'];
            $n = count($candles);
            $c0 = (float) ($candles[$n - 1]['close'] ?? 0);
            $c1 = (float) ($candles[$n - 5]['close'] ?? $c0);
            $move = $c0 > 0 ? abs($c0 - $c1) / $c0 : 0;
            $confidence = min(0.95, 0.55 + $move * 40);
            $signals[] = [
                'asset' => $asset,
                'direction' => $dir,
                'confidence' => round($confidence, 3),
            ];
        }

        if (!$signals) {
            // fallback: gera lista com CALL/PUT alternados nos ativos pedidos (sem sinal técnico)
            foreach ($assetList as $i => $asset) {
                $signals[] = [
                    'asset' => $asset,
                    'direction' => ($i % 2 === 0) ? 'CALL' : 'PUT',
                    'confidence' => 0.5,
                ];
            }
        }

        // ordena por confiança (melhor primeiro) e monta 20 slots de horário
        usort($signals, static fn ($a, $b) => ($b['confidence'] <=> $a['confidence']));

        $tz = new \DateTimeZone('America/Sao_Paulo');
        $now = new \DateTime('now', $tz);
        $cursor = clone $now;
        $cursor->modify('+' . $startOffset . ' minutes');
        // arredonda para o próximo minuto “cheio”
        $sec = (int) $cursor->format('s');
        if ($sec > 0) {
            $cursor->modify('+' . (60 - $sec) . ' seconds');
        }

        $entries = [];
        $sigCount = count($signals);
        for ($i = 0; $i < $count; $i++) {
            $sig = $signals[$i % $sigCount];
            // rotaciona direção a cada volta se vários slots no mesmo asset
            $dir = $sig['direction'];
            if ($i >= $sigCount && ($i / $sigCount) % 2 >= 1) {
                // segunda passagem: mantém dir do sinal (não inverte — sinal é a tese)
                $dir = $sig['direction'];
            }
            $entries[] = [
                'time' => $cursor->format('H:i'),
                'direction' => $dir,
                'asset' => $sig['asset'],
                'confidence' => $sig['confidence'],
                'expirationMinutes' => $expMin,
                'strategyType' => $strategyType,
            ];
            $cursor->modify('+' . $spacing . ' minutes');
        }

        json_response([
            'success' => true,
            'count' => count($entries),
            'strategyType' => $strategyType,
            'strategyName' => $catalog[$strategyType]['name'] ?? $strategyType,
            'expirationMinutes' => $expMin,
            'spacingMinutes' => $spacing,
            'signalsFound' => count(array_filter($signals, static fn ($s) => ($s['confidence'] ?? 0) > 0.5)),
            'assetsAnalyzed' => count($assetList),
            'entries' => $entries,
            'generatedAt' => (new \DateTime('now', $tz))->format('Y-m-d H:i:s'),
            'timezone' => 'America/Sao_Paulo',
        ]);
    }

    /**
     * Empurra a lista gerada como estratégias HORÁRIOS no Day Trade
     * (sequence = HH:MM, color = CALL/PUT, asset, exp).
     */
    public function premiumPushList(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        UserRepository::ensureDayTradeDefaults($uid);

        $entries = input('entries', []);
        if (!is_array($entries) || !$entries) {
            json_response(['error' => 'Lista vazia.'], 400);
        }
        $replace = !empty(input('replace', false));
        if ($replace) {
            try {
                // remove só horários gerados pelo premium (strategyType HORARIO/HORÁRIOS)
                Database::delete(
                    'daytrade_strategies',
                    "ownerId = ? AND (strategyType = 'HORARIO' OR strategyType = 'HORÁRIOS' OR strategyType = 'PREMIUM_LIST')",
                    [$uid]
                );
            } catch (\Throwable) {
            }
        }

        $inserted = 0;
        foreach (array_slice($entries, 0, 40) as $e) {
            if (!is_array($e)) {
                continue;
            }
            $time = trim((string) ($e['time'] ?? ''));
            $dir = strtoupper(trim((string) ($e['direction'] ?? 'CALL')));
            $asset = trim((string) ($e['asset'] ?? 'EURUSD-OTC'));
            $exp = max(1, min(60, (int) ($e['expirationMinutes'] ?? 3)));
            if (!preg_match('/^\d{1,2}:\d{2}$/', $time)) {
                continue;
            }
            if (!in_array($dir, ['CALL', 'PUT'], true)) {
                $dir = 'CALL';
            }
            // normaliza HH:MM
            [$h, $m] = array_map('intval', explode(':', $time));
            $time = sprintf('%02d:%02d', $h % 24, $m % 60);
            try {
                Database::insert('daytrade_strategies', [
                    'ownerId' => $uid,
                    'strategyType' => 'PREMIUM_LIST',
                    'sequence' => $time,
                    'color' => $dir,
                    'asset' => mb_substr($asset, 0, 200),
                    'expirationMinutes' => $exp,
                ]);
                $inserted++;
            } catch (\Throwable) {
            }
        }
        BotCommandService::enqueue($uid, 'refresh-cache', 'DAYTRADE');
        json_response(['success' => true, 'inserted' => $inserted]);
    }

    public function bot(): void
    {
        $user = Auth::requireUser();
        $uid = (int) $user['id'];
        UserRepository::ensureDayTradeDefaults($uid);
        $method = request_method();

        if ($method === 'GET') {
            $u = UserRepository::find($uid) ?? $user;
            $msgs = BotCommandService::history($uid, 'DAYTRADE', 200);
            $entries = Database::fetchAll(
                'SELECT * FROM daytrade_entries WHERE ownerId = ? ORDER BY id DESC LIMIT 80',
                [$uid]
            );
            // Cards no padrão Blaze/Jonbet (com horário + WIN/LOSS embutido)
            $history = $this->buildDayTradeHistory($entries, $msgs);
            json_response([
                'messages' => $msgs,
                'entries' => $entries,
                'history' => $history,
                'isActive' => (bool) ($u['daytradeIsActive'] ?? 0),
                'isBetting' => (bool) ($u['daytradeIsBetting'] ?? 0),
                'daytradeIsBetting' => (bool) ($u['daytradeIsBetting'] ?? 0),
            ]);
        }

        $action = (string) input('action', '');
        if ($action === 'start') {
            if (!UserRepository::licenseOk($user)) {
                json_response(['error' => 'Licença inativa.'], 403);
            }
            $u = UserRepository::find($uid);
            if (empty($u['iqSsid'])) {
                json_response(['error' => 'Conecte a conta IQ Option antes de iniciar.'], 400);
            }
            $settings = Database::fetch('SELECT * FROM daytrade_settings WHERE ownerId = ?', [$uid]);
            $enter = ($settings['enterType'] ?? '') === 'PORCENTAGEM'
                ? (float) ($settings['enterPercent'] ?? 0)
                : (float) ($settings['enterValue'] ?? 0);
            if (($settings['enterType'] ?? '') !== 'PORCENTAGEM' && $enter < 2) {
                json_response(['error' => 'Valor de entrada mínimo é R$ 2,00.'], 400);
            }
            if ($enter <= 0) {
                json_response(['error' => 'Configure o valor de entrada.'], 400);
            }
            BotWorker::ensureRunning();
            // para blaze se ativo
            if (!empty($user['isActive'])) {
                BotCommandService::enqueue($uid, 'stop', 'BLAZE');
                UserRepository::update($uid, ['isActive' => 0]);
            }
            // zera sessão (igual outros bots) ANTES de start
            try {
                BotCommandService::clearHistory($uid, 'DAYTRADE');
            } catch (\Throwable) {
            }
            try {
                Database::delete('daytrade_entries', 'ownerId = ?', [$uid]);
            } catch (\Throwable) {
            }
            $bal = null;
            try {
                $uFresh = UserRepository::find($uid);
                if (!empty($uFresh['iqSsid'])) {
                    $b = IqOptionBridge::balances((string) $uFresh['iqSsid'], true);
                    if (!empty($b['ok']) && !empty($b['balances'])) {
                        $picked = self::pickBalance($b['balances'], (string) ($uFresh['iqAccountType'] ?? 'DEMO'), true);
                        if ($picked) {
                            $bal = (float) ($picked['amount'] ?? 0);
                        }
                    }
                }
            } catch (\Throwable) {
            }
            // Zera painel da sessão (vitórias/derrotas/lucro) — relatório do mês fica na tela Início
            try {
                \App\Bot\BotEntryLogger::resetSessionCounters('daytrade_variables', $uid, $bal);
            } catch (\Throwable) {
            }
            try {
                $uMode = UserRepository::find($uid);
                $iqMode = strtoupper((string) ($uMode['iqAccountType'] ?? 'DEMO'));
                if (!in_array($iqMode, ['DEMO', 'REAL'], true)) {
                    $iqMode = 'DEMO';
                }
                $balUse = $bal !== null ? $bal : 0;
                Database::update(
                    'daytrade_variables',
                    [
                        'countWin' => 0,
                        'countLoss' => 0,
                        'countMartingale' => 0,
                        'isGale' => 0,
                        'profit' => 0,
                        'balance' => $balUse,
                        'firstBalance' => $balUse,
                        'firstBalanceDate' => now(),
                        'firstBalanceMode' => $iqMode,
                    ],
                    'ownerId = :oid',
                    ['oid' => $uid]
                );
            } catch (\Throwable $e) {
                log_msg('[daytrade start reset] ' . $e->getMessage(), 'daytrade');
            }
            UserRepository::update($uid, ['daytradeIsActive' => 1, 'daytradeIsBetting' => 0]);
            BotCommandService::enqueue($uid, 'start', 'DAYTRADE');
            // start síncrono com forceReset (preserveState=false) — zera de novo no engine
            try {
                EngineManager::startDayTrade(UserRepository::findWithRelations($uid) ?? $user, false);
            } catch (\Throwable $e) {
                log_msg('[daytrade start] ' . $e->getMessage(), 'daytrade');
            }
            // re-lê e força zeros na resposta (fonte da verdade pro painel)
            $vars = Database::fetch('SELECT * FROM daytrade_variables WHERE ownerId = ?', [$uid]);
            $norm = $this->normalizeVars($vars) ?? [];
            $norm['countWin'] = 0;
            $norm['countLoss'] = 0;
            $norm['countMartingale'] = 0;
            $norm['isGale'] = false;
            $norm['profit'] = 0.0;
            if ($bal !== null) {
                $norm['balance'] = $bal;
                $norm['firstBalance'] = $bal;
            } elseif (!isset($norm['balance'])) {
                $norm['balance'] = 0;
            }
            json_response([
                'success' => true,
                'isActive' => true,
                'sessionReset' => true,
                'daytradeIsBetting' => false,
                'variables' => $norm,
            ]);
        }
        if ($action === 'stop') {
            $ok = true;
            try {
                $ok = EngineManager::stopDayTrade($uid, true);
            } catch (\Throwable) {
            }
            BotCommandService::enqueue($uid, 'stop', 'DAYTRADE');
            if ($ok) {
                UserRepository::update($uid, ['daytradeIsActive' => 0, 'daytradeIsBetting' => 0]);
            }
            json_response(['success' => true, 'isActive' => !$ok, 'pendingStop' => !$ok]);
        }
        if ($action === 'test-entry') {
            $u = UserRepository::find($uid);
            if (empty($u['iqSsid']) || empty($u['iqBalanceId'])) {
                json_response(['error' => 'Conecte a IQ Option e aguarde o balanceId.'], 400);
            }
            $settings = Database::fetch('SELECT * FROM daytrade_settings WHERE ownerId = ?', [$uid]);
            $dir = strtoupper((string) input('direction', 'CALL'));
            if (!in_array($dir, ['CALL', 'PUT'], true)) {
                $dir = 'CALL';
            }
            $asset = trim((string) input('asset', $settings['defaultAsset'] ?? 'EURUSD-OTC'));
            $amount = (float) input('amount', $settings['enterValue'] ?? 1);
            $exp = max(1, min(15, (int) input('expirationMinutes', $settings['expirationMinutes'] ?? 1)));
            $res = IqOptionBridge::placeOption([
                'ssid' => (string) $u['iqSsid'],
                'balanceId' => (int) $u['iqBalanceId'],
                'asset' => $asset,
                'direction' => strtolower($dir),
                'amount' => max(1, $amount),
                'expirationMinutes' => $exp,
            ]);
            if (empty($res['ok'])) {
                json_response(['error' => $res['error'] ?? 'Falha na ordem', 'detail' => $res], 400);
            }
            Database::insert('daytrade_entries', [
                'ownerId' => $uid,
                'type' => 'TESTE',
                'asset' => $asset,
                'direction' => $dir,
                'amount' => max(1, $amount),
                'expiration' => $exp,
                'mode' => strtoupper((string) ($u['iqAccountType'] ?? 'DEMO')),
                'externalId' => isset($res['optionId']) ? (string) $res['optionId'] : null,
                'pattern' => 'TESTE_MANUAL',
            ]);
            BotCommandService::pushMessage(
                $uid,
                "🧪 Teste {$dir} {$asset} · $" . number_format(max(1, $amount), 2, '.', ''),
                'DAYTRADE'
            );
            json_response(['success' => true, 'result' => $res]);
        }
        json_response(['error' => 'Ação inválida'], 400);
    }

    /**
     * 10 modelos técnicos (expiração/ativo/params embutidos — cliente só escolhe o modelo).
     *
     * @return array<string, array{id:string,name:string,desc:string,asset:string,expirationMinutes:int,icon:string}>
     */
    public static function strategyCatalog(): array
    {
        return [
            'SMA_CROSS' => [
                'id' => 'SMA_CROSS',
                'name' => 'Cruzamento de Médias (SMA 8/21)',
                'desc' => 'SMA 8/21 (ou EMA 11/56) · Call: cruza p/ cima · Put: p/ baixo · Exp 3m',
                'asset' => 'EURUSD-OTC',
                'expirationMinutes' => 3,
                'icon' => '📈',
            ],
            'SUPPORT_RES' => [
                'id' => 'SUPPORT_RES',
                'name' => 'Suporte e Resistência + Velas',
                'desc' => 'Call no suporte com vela de alta · Put na resistência com vela de baixa',
                'asset' => 'EURUSD-OTC',
                'expirationMinutes' => 3,
                'icon' => '🧱',
            ],
            'RSI_DIV' => [
                'id' => 'RSI_DIV',
                'name' => 'RSI + Momentum',
                'desc' => 'Call: RSI sai de oversold (<30) · Put: sai de overbought (>70)',
                'asset' => 'EURUSD-OTC',
                'expirationMinutes' => 3,
                'icon' => '📊',
            ],
            'BOLLINGER' => [
                'id' => 'BOLLINGER',
                'name' => 'Bollinger Bands',
                'desc' => 'Toca banda inferior + alta → Call · banda superior + baixa → Put',
                'asset' => 'EURUSD-OTC',
                'expirationMinutes' => 3,
                'icon' => '🎀',
            ],
            'TREND_ADX' => [
                'id' => 'TREND_ADX',
                'name' => 'Tendência (Trend Following)',
                'desc' => 'Opera a favor da tendência (EMA 21/55) · exp 5m',
                'asset' => 'GBPUSD-OTC',
                'expirationMinutes' => 5,
                'icon' => '🚀',
            ],
            'CANDLE_PATTERN' => [
                'id' => 'CANDLE_PATTERN',
                'name' => 'Padrões de Velas (T5)',
                'desc' => 'Hammer / shooting star / engulfing · exp 1–3m',
                'asset' => 'EURUSD-OTC',
                'expirationMinutes' => 2,
                'icon' => '🕯️',
            ],
            'BREAKOUT' => [
                'id' => 'BREAKOUT',
                'name' => 'Breakout de Canal',
                'desc' => 'Rompe topo → Call · rompe fundo → Put',
                'asset' => 'USDJPY-OTC',
                'expirationMinutes' => 3,
                'icon' => '💥',
            ],
            'PSAR_EMA' => [
                'id' => 'PSAR_EMA',
                'name' => 'Parabolic SAR + EMA',
                'desc' => 'SAR inverte + EMA confirma tendência',
                'asset' => 'EURUSD-OTC',
                'expirationMinutes' => 3,
                'icon' => '🔵',
            ],
            'HEDGING' => [
                'id' => 'HEDGING',
                'name' => 'Hedging (Proteção)',
                'desc' => 'Após loss com gales, abre na direção oposta (corredor)',
                'asset' => 'EURUSD-OTC',
                'expirationMinutes' => 5,
                'icon' => '🛡️',
            ],
            'NEWS_SR' => [
                'id' => 'NEWS_SR',
                'name' => 'Notícias + Suporte/Resistência',
                'desc' => 'Evita janelas de notícia · opera S/R no impulso',
                'asset' => 'EURUSD-OTC',
                'expirationMinutes' => 3,
                'icon' => '📰',
            ],
        ];
    }

    /**
     * Catálogo amplo (nome → active_id). Preferência: arquivo bot/iqoption-assets.cjs via JSON export,
     * com fallback embutido.
     *
     * @return array<string, int>
     */
    public static function assets(): array
    {
        static $cache = null;
        if (is_array($cache)) {
            return $cache;
        }
        $path = base_path('bot/iqoption-assets.cjs');
        if (is_file($path)) {
            // extrai pares "KEY": number do module.exports (JS simples)
            $raw = (string) file_get_contents($path);
            $map = [];
            if (preg_match_all('/["\']([A-Za-z0-9:._-]+)["\']\s*:\s*(\d+)/', $raw, $m, PREG_SET_ORDER)) {
                foreach ($m as $row) {
                    $map[$row[1]] = (int) $row[2];
                }
            }
            // também KEY: number sem aspas
            if (preg_match_all('/\b([A-Z][A-Za-z0-9:._-]*)\s*:\s*(\d+)/', $raw, $m2, PREG_SET_ORDER)) {
                foreach ($m2 as $row) {
                    if (!isset($map[$row[1]])) {
                        $map[$row[1]] = (int) $row[2];
                    }
                }
            }
            if ($map) {
                $cache = $map;
                return $cache;
            }
        }
        $cache = [
            'EURUSD-OTC' => 76,
            'EURUSD' => 1,
            'GBPUSD-OTC' => 81,
            'GBPUSD' => 5,
            'USDJPY-OTC' => 85,
            'USDJPY' => 6,
            'AUDUSD' => 99,
            'EURGBP-OTC' => 77,
            'EURJPY-OTC' => 79,
            'USDCHF-OTC' => 78,
            'BTCUSD' => 816,
            'ETHUSD' => 818,
            'XAUUSD' => 74,
        ];
        return $cache;
    }

    /**
     * Histórico no formato dos cards Blaze/Jonbet (LogParser-like).
     * Fonte principal: daytrade_entries (tem result/profit/horário).
     * Mensagens INFO (observação, start, etc.) intercaladas por horário.
     *
     * @param list<array<string,mixed>> $entries
     * @param list<array<string,mixed>> $msgs
     * @return list<array<string,mixed>>
     */
    private function buildDayTradeHistory(array $entries, array $msgs): array
    {
        // Reconstrói cards no padrão Blaze (LogParser): horário + ENTRADA/GALE + WIN/LOSS
        $history = [];
        $tz = new \DateTimeZone('America/Sao_Paulo');

        $fmtTime = static function (?string $createdAt) use ($tz): array {
            if (!$createdAt) {
                return ['ts' => 0, 'time' => ''];
            }
            try {
                $dt = new \DateTime($createdAt);
                $dt->setTimezone($tz);
                return ['ts' => $dt->getTimestamp(), 'time' => $dt->format('H:i:s')];
            } catch (\Throwable) {
                $ts = strtotime($createdAt);
                return ['ts' => $ts ?: 0, 'time' => $ts ? date('H:i:s', $ts) : ''];
            }
        };

        $findUnresolved = static function (array $history): ?int {
            foreach ($history as $i => $e) {
                $t = $e['type'] ?? '';
                if (in_array($t, ['ENTRADA', 'GALE', 'OBSERVING'], true) && empty($e['resolved'])) {
                    return $i;
                }
            }
            return null;
        };

        // 1) Entradas reais do banco (fonte de verdade p/ valor e resultado)
        foreach ($entries as $e) {
            $ft = $fmtTime(isset($e['createdAt']) ? (string) $e['createdAt'] : null);
            $dir = strtoupper((string) ($e['direction'] ?? ''));
            $result = strtoupper((string) ($e['result'] ?? ''));
            $resolved = $result !== '' && $result !== 'NULL';
            $type = strtoupper((string) ($e['type'] ?? 'ENTRADA')) === 'GALE' ? 'GALE' : 'ENTRADA';
            $asset = (string) ($e['asset'] ?? '');
            $pattern = trim((string) ($e['pattern'] ?? ''));
            $patternLabel = $pattern !== '' && $asset !== ''
                ? "{$asset} · {$pattern}"
                : ($pattern !== '' ? $pattern : ($asset !== '' ? $asset : null));
            $profit = isset($e['profit']) && $e['profit'] !== null ? (float) $e['profit'] : null;
            $history[] = [
                'id' => 'e-' . (int) ($e['id'] ?? 0),
                'sort' => $ft['ts'],
                'time' => $ft['time'],
                'type' => $type,
                'color' => $dir !== '' ? $dir : null,
                'amount' => isset($e['amount']) ? (float) $e['amount'] : null,
                'initialAmount' => isset($e['amount']) ? (float) $e['amount'] : null,
                'pattern' => $patternLabel,
                'strategyType' => 'DAY_TRADE',
                'mode' => (string) ($e['mode'] ?? ''),
                'asset' => $asset,
                'resolved' => $resolved,
                'resultWin' => $resolved ? ($result === 'WIN') : null,
                'resultColor' => $resolved
                    ? ($result === 'EMPATE' ? 'EMPATE' : ($dir !== '' ? $dir : $result))
                    : null,
                'resultProfit' => $resolved ? $profit : null,
                'gale' => $type === 'GALE' ? max(1, (int) ($e['galeLevel'] ?? 1)) : 0,
                'maxGale' => 0,
                'statusLabel' => $resolved ? null : 'aguardando resultado...',
            ];
        }

        // 2) Mensagens → sinal/observação/gale/info (mais antigas primeiro)
        $chronological = array_reverse($msgs);
        foreach ($chronological as $m) {
            $text = (string) ($m['message'] ?? $m['msg'] ?? '');
            if ($text === '') {
                continue;
            }
            $ft = $fmtTime((string) ($m['createdAt'] ?? $m['created_at'] ?? ''));
            $mid = 'm-' . (string) ($m['id'] ?? ($ft['ts'] . '-' . substr(md5($text), 0, 8)));
            $full = $text;
            $line1 = trim(explode("\n", $text)[0]);

            // Ignora ruído de “sem resultado” / liberando (já tratado no engine)
            if (str_contains($text, 'Sem resultado') || str_contains($text, 'liberando bot') || str_contains($text, 'Liberando bot')) {
                continue;
            }

            // Entrada real / ordem: NÃO cria card novo — a fonte é daytrade_entries (evita duplicata + fantasma)
            // Só atualiza observação aberta → “entrando de verdade”
            if (
                preg_match('/Entrando\s+(CALL|PUT)/iu', $full, $em)
                || preg_match('/Ordem enviada:\s*(CALL|PUT)/iu', $full, $em)
                || preg_match('/Entrando de verdade/iu', $full)
            ) {
                $dir = isset($em[1]) ? strtoupper($em[1]) : null;
                $idx = $findUnresolved($history);
                if ($idx !== null && ($history[$idx]['type'] ?? '') === 'OBSERVING') {
                    if ($dir === null || ($history[$idx]['color'] ?? '') === $dir) {
                        $history[$idx]['statusLabel'] = 'confirmado — ordem enviada…';
                        $history[$idx]['time'] = $ft['time'];
                    }
                }
                continue;
            }

            // Sinal encontrado / observação (pular 1ª ou após loss)
            if (
                (str_contains($full, '🔍') || str_contains($full, 'Sinal'))
                && preg_match('/\b(CALL|PUT)\b/i', $full, $dm)
            ) {
                $dir = strtoupper($dm[1]);
                $asset = '';
                if (preg_match('/\b([A-Z]{3,6}(?:USD|JPY|GBP|EUR|CAD|CHF|OTC)?(?:-OTC)?)\b/u', $full, $am)) {
                    $asset = $am[1];
                }
                $pattern = $asset;
                if (preg_match('/📋\s*(.+?)(?:\n|$)/u', $full, $pm)) {
                    $pattern = trim($pm[1]);
                } elseif (preg_match('/\|\s*📋\s*(.+?)(?:\n|$)/u', $full, $pm)) {
                    $pattern = trim($pm[1]);
                } elseif (preg_match('/Bollinger|SMA|RSI|Tendência|Suporte|Padrões|Breakout|SAR|Hedging|Notícias/iu', $full, $nm)) {
                    $pattern = trim($line1);
                }
                $obs = str_contains($full, 'observ') || str_contains($full, 'Observ')
                    || str_contains($full, 'Pular') || str_contains($full, 'após loss')
                    || str_contains($full, 'simulando');
                $maxG = 0;
                $galeN = 0;
                if (preg_match('/\(0\/(\d+)\)/', $full, $xg)) {
                    $maxG = (int) $xg[1];
                }
                if (preg_match('/gale virtual\s*(\d+)\/(\d+)/i', $full, $xg)) {
                    $galeN = (int) $xg[1];
                    $maxG = (int) $xg[2];
                    // atualiza observação em aberto
                    $idx = $findUnresolved($history);
                    if ($idx !== null && ($history[$idx]['type'] ?? '') === 'OBSERVING') {
                        $history[$idx]['gale'] = $galeN;
                        $history[$idx]['maxGale'] = $maxG;
                        $history[$idx]['statusLabel'] = "gale virtual {$galeN}/{$maxG}";
                        $history[$idx]['time'] = $ft['time'];
                        continue;
                    }
                }
                $history[] = [
                    'id' => $mid,
                    'sort' => $ft['ts'],
                    'time' => $ft['time'],
                    'type' => $obs ? 'OBSERVING' : 'ENTRADA',
                    'color' => $dir,
                    'amount' => null,
                    'initialAmount' => null,
                    'pattern' => $pattern !== '' ? $pattern : $line1,
                    'strategyType' => 'DAY_TRADE',
                    'mode' => null,
                    'asset' => $asset,
                    'resolved' => false,
                    'resultWin' => null,
                    'resultColor' => null,
                    'resultProfit' => null,
                    'gale' => $galeN,
                    'maxGale' => $maxG,
                    'statusLabel' => $obs
                        ? ($maxG > 0 ? "observando (gale 0/{$maxG})…" : 'observando (sem aposta)…')
                        : 'sinal encontrado',
                ];
                continue;
            }

            // Gale virtual isolado
            if (preg_match('/gale virtual\s*(\d+)\/(\d+)/i', $full, $xg)) {
                $idx = $findUnresolved($history);
                if ($idx !== null) {
                    $history[$idx]['gale'] = (int) $xg[1];
                    $history[$idx]['maxGale'] = (int) $xg[2];
                    $history[$idx]['statusLabel'] = 'gale virtual ' . $xg[1] . '/' . $xg[2];
                    $history[$idx]['time'] = $ft['time'];
                }
                continue;
            }

            // WIN / LOSS nas mensagens: só enriquece card do DB se ainda sem result
            // (entries do banco já vêm com result; não cria card fantasma)

            // Observação fechou com win virtual (reset) — fecha OBSERVING
            if (str_contains($full, 'teria ganho') || str_contains($full, 'resetando')) {
                $idx = $findUnresolved($history);
                if ($idx !== null && ($history[$idx]['type'] ?? '') === 'OBSERVING') {
                    $history[$idx]['resolved'] = true;
                    $history[$idx]['resultWin'] = true;
                    $history[$idx]['resultColor'] = $history[$idx]['color'] ?? null;
                    $history[$idx]['statusLabel'] = null;
                    $history[$idx]['resultProfit'] = null;
                    $history[$idx]['obsOnly'] = true;
                }
                continue;
            }
            // Observação: não bateu / sequência perderia → vira pronto p/ entrada real
            if (
                str_contains($full, 'NÃO bateu')
                || str_contains($full, 'sequência de gale perderia')
                || str_contains($full, 'entrando na próxima de verdade')
                || str_contains($full, 'entrando de verdade')
            ) {
                $idx = $findUnresolved($history);
                if ($idx !== null && ($history[$idx]['type'] ?? '') === 'OBSERVING') {
                    $history[$idx]['statusLabel'] = 'confirmado — entrando de verdade…';
                    $history[$idx]['time'] = $ft['time'];
                }
                continue;
            }

            // Gale real anunciado
            if (preg_match('/🔄\s*Gale\s*(\d+)\/(\d+)/i', $full, $gm)) {
                $idx = $findUnresolved($history);
                if ($idx !== null) {
                    $history[$idx]['type'] = 'GALE';
                    $history[$idx]['gale'] = (int) $gm[1];
                    $history[$idx]['maxGale'] = (int) $gm[2];
                    $history[$idx]['statusLabel'] = 'gale ' . $gm[1] . '/' . $gm[2] . '…';
                }
                continue;
            }

            // INFO (start, banca, stop, etc.)
            if (
                str_contains($full, 'Bot Day Trade')
                || str_contains($full, 'Sessão reiniciada')
                || str_contains($full, 'Banca:')
                || str_contains($full, 'Pular 1ª')
                || str_contains($full, 'Entrada após loss')
                || str_contains($full, 'Stop')
                || str_contains($full, 'parado')
                || str_contains($full, '⏸️')
                || str_contains($full, '⏹️')
            ) {
                $history[] = [
                    'id' => $mid,
                    'sort' => $ft['ts'],
                    'time' => $ft['time'],
                    'type' => 'INFO',
                    'pattern' => $line1,
                ];
            }
        }

        // Ordena do mais recente → mais antigo
        usort($history, static fn (array $a, array $b): int => ($b['sort'] ?? 0) <=> ($a['sort'] ?? 0));

        // Só 1 card ENTRADA/GALE "aguardando" (o mais recente); o resto sem result some do limbo
        $openSeen = false;
        foreach ($history as $i => $h) {
            $t = $h['type'] ?? '';
            if (!in_array($t, ['ENTRADA', 'GALE'], true) || !empty($h['resolved'])) {
                continue;
            }
            if ($openSeen) {
                $history[$i]['resolved'] = true;
                $history[$i]['resultWin'] = false;
                $history[$i]['resultColor'] = 'cancelado';
                $history[$i]['statusLabel'] = null;
                $history[$i]['resultProfit'] = null;
            } else {
                $openSeen = true;
            }
        }

        return array_map(static function (array $row): array {
            unset($row['sort']);
            return $row;
        }, array_slice($history, 0, 150));
    }

    private function normalizeSettings(?array $s): ?array
    {
        if (!$s) {
            return null;
        }
        foreach (['skipFirstEntry', 'skipEntryAfterLoss'] as $b) {
            if (array_key_exists($b, $s)) {
                $s[$b] = (bool) (int) $s[$b];
            }
        }
        foreach ([
            'enterValue', 'enterPercent', 'martingaleMultiplier',
            'expirationMinutes', 'minPayout',
        ] as $n) {
            if (array_key_exists($n, $s) && $s[$n] !== null) {
                $s[$n] = (float) $s[$n];
            }
        }
        foreach (['martingale', 'quantityCycles'] as $n) {
            if (array_key_exists($n, $s) && $s[$n] !== null) {
                $s[$n] = (int) $s[$n];
            }
        }
        if (!isset($s['quantityCycles']) || (int) $s['quantityCycles'] < 1) {
            $s['quantityCycles'] = 1;
        }
        if (isset($s['enterValue']) && (float) $s['enterValue'] < 2) {
            $s['enterValue'] = 2.0;
        }
        // selectedAssets[] a partir do CSV em defaultAsset
        $rawAssets = trim((string) ($s['defaultAsset'] ?? 'EURUSD-OTC'));
        $parts = array_values(array_filter(array_map('trim', explode(',', $rawAssets !== '' ? $rawAssets : 'EURUSD-OTC'))));
        if (!$parts) {
            $parts = ['EURUSD-OTC'];
        }
        $s['selectedAssets'] = $parts;
        $s['defaultAsset'] = $parts[0];
        return $s;
    }

    private function normalizeVars(?array $v): ?array
    {
        if (!$v) {
            return null;
        }
        foreach (['balance', 'profit', 'firstBalance'] as $n) {
            if (array_key_exists($n, $v) && $v[$n] !== null) {
                $v[$n] = (float) $v[$n];
            }
        }
        foreach (['countWin', 'countLoss', 'countMartingale'] as $n) {
            if (array_key_exists($n, $v) && $v[$n] !== null) {
                $v[$n] = (int) $v[$n];
            }
        }
        if (array_key_exists('isGale', $v)) {
            $v['isGale'] = (bool) (int) $v['isGale'];
        }
        return $v;
    }
}
