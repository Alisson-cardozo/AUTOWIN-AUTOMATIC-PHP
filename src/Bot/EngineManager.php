<?php

declare(strict_types=1);

namespace App\Bot;

use App\Bot\Blaze\BlazeAPI;
use App\Bot\Blaze\BlazeAuth;
use App\Bot\Games\BacBoEngine;
use App\Bot\Games\DayTradeEngine;
use App\Bot\Games\DoubleEngine;
use App\Bot\Games\FortuneEngine;
use App\Bot\Games\MegaRouletteEngine;
use App\Bot\Jonbet\JonbetAPI;
use App\Bot\Jonbet\JonbetAuth;
use App\Database;
use App\Models\ConfigRepository;
use App\Models\UserRepository;
use App\Services\BotCommandService;

final class EngineManager
{
    public static function startBlaze(array $user, bool $preserveState = false): void
    {
        $userId = (int) $user['id'];
        self::stopBlaze($userId, false);

        $isDemo = ($user['accountType'] ?? 'DEMO') === 'DEMO';
        $forceReset = !$preserveState;
        $api = new BlazeAPI();

        if (!empty($user['token'])) {
            $api->setToken((string) $user['token']);
            $ttl = $api->getTokenTtlMs();
            if ($ttl < 4 * 60 * 60 * 1000 && !empty($user['blazeEmail']) && !empty($user['password'])) {
                $ref = BlazeAuth::login($api, (string) $user['blazeEmail'], (string) $user['password']);
                if ($ref) {
                    UserRepository::update($userId, ['token' => $ref['token'], 'wallet' => $ref['wallet']]);
                }
            }
            $api->initSession();
        }

        EngineRegistry::$blazeApis[$userId] = $api;
        $game = strtoupper((string) ($user['gameType'] ?? 'DOUBLE'));
        // Crash removido do produto (Blaze + Jonbet)
        if ($game === 'CRASH') {
            $game = 'DOUBLE';
            UserRepository::update($userId, ['gameType' => 'DOUBLE']);
            log_msg("[blaze:{$userId}] gameType CRASH migrado para DOUBLE", 'bot');
        }
        if ($game === 'DAY_TRADE') {
            BotCommandService::pushMessage(
                $userId,
                '📈 Day Trade ainda em desenvolvimento — motor de opções binárias em breve.',
                'BLAZE'
            );
            log_msg("[blaze:{$userId}] start bloqueado: DAY_TRADE em breve", 'bot');
            return;
        }
        $engine = match ($game) {
            'FORTUNE' => new FortuneEngine($userId, $api, $isDemo, 'BLAZE', $forceReset),
            // Bac Bo: isDemo só pelo accountType do usuário.
            // Token ausente NÃO vira DEMO automaticamente (evita flip REAL↔DEMO no painel).
            'BACBO' => new BacBoEngine(
                $userId,
                $forceReset,
                $api,
                $isDemo,
                'bacbo'
            ),
            'BACBO_LIVE' => new BacBoEngine(
                $userId,
                $forceReset,
                $api,
                $isDemo,
                'bacbo_live'
            ),
            'ROLETA' => new MegaRouletteEngine($userId, $forceReset, $api, $isDemo),
            default => new DoubleEngine($userId, $api, $isDemo, 'BLAZE', $forceReset),
        };
        EngineRegistry::$blaze[$userId] = $engine;
        $engine->start();
        UserRepository::update($userId, ['isActive' => 1]);
        BotCommandService::pushMessage($userId, "▶️ Engine {$game} iniciada", 'BLAZE');
    }

    /**
     * @return bool true se parou de imediato; false se ficou pendente (aposta em andamento)
     */
    public static function stopBlaze(int $userId, bool $updateDb = true): bool
    {
        $stoppedImmediately = true;
        if (isset(EngineRegistry::$blaze[$userId])) {
            $eng = EngineRegistry::$blaze[$userId];
            if (method_exists($eng, 'requestStop') && !$eng->requestStop()) {
                // Aposta em andamento — engine para sozinha após WIN/LOSS
                $stoppedImmediately = false;
            } else {
                if (method_exists($eng, 'stop')) {
                    $eng->stop();
                }
                unset(EngineRegistry::$blaze[$userId], EngineRegistry::$blazeApis[$userId]);
            }
        }
        // Só zera isActive/isBetting se parou de verdade.
        // Se pendente, o engine atualiza o banco no fim da entrada.
        if ($updateDb && $stoppedImmediately) {
            UserRepository::update($userId, [
                'isActive' => 0,
                'isBetting' => 0,
                'colorBet' => null,
                'colorBefore' => null,
            ]);
        }
        return $stoppedImmediately;
    }

    public static function startJonbet(array $user, bool $preserveState = false): void
    {
        $userId = (int) $user['id'];
        self::stopBlaze($userId, true);
        self::stopJonbet($userId, false);

        UserRepository::ensureDefaults($userId);
        $isDemo = ($user['jonbetAccountType'] ?? 'DEMO') === 'DEMO';
        $forceReset = !$preserveState;
        $api = new JonbetAPI();

        if (!empty($user['jonbetToken'])) {
            $api->setToken((string) $user['jonbetToken']);
            $ttl = $api->getTokenTtlMs();
            if ($ttl < 4 * 60 * 60 * 1000 && !empty($user['jonbetEmail']) && !empty($user['jonbetPassword'])) {
                $ref = JonbetAuth::loginJonbet($api, (string) $user['jonbetEmail'], (string) $user['jonbetPassword']);
                if ($ref) {
                    UserRepository::update($userId, ['jonbetToken' => $ref['token']]);
                    $api->setToken($ref['token']);
                    log_msg("[jonbet:{$userId}] token renovado automaticamente", 'bot');
                } elseif ($ttl < 0) {
                    log_msg("[jonbet:{$userId}] token expirado e renovação falhou", 'bot');
                }
            }
            $api->initSession();
        }

        EngineRegistry::$jonbetApis[$userId] = $api;
        $game = strtoupper((string) ($user['jonbetGameType'] ?? 'DOUBLE'));
        // Crash removido do produto (Blaze + Jonbet)
        if ($game === 'CRASH') {
            $game = 'DOUBLE';
            UserRepository::update($userId, ['jonbetGameType' => 'DOUBLE']);
            log_msg("[jonbet:{$userId}] jonbetGameType CRASH migrado para DOUBLE", 'bot');
        }
        $engine = match ($game) {
            'FORTUNE' => new FortuneEngine($userId, $api, $isDemo, 'JONBET', $forceReset),
            default => new DoubleEngine($userId, $api, $isDemo, 'JONBET', $forceReset),
        };
        EngineRegistry::$jonbet[$userId] = $engine;
        $engine->start();
        UserRepository::update($userId, ['jonbetIsActive' => 1]);
        BotCommandService::pushMessage($userId, "▶️ Engine Jonbet {$game} iniciada", 'JONBET');
    }

    /**
     * @return bool true se parou de imediato; false se ficou pendente
     */
    public static function stopJonbet(int $userId, bool $updateDb = true): bool
    {
        $stoppedImmediately = true;
        if (isset(EngineRegistry::$jonbet[$userId])) {
            $eng = EngineRegistry::$jonbet[$userId];
            if (method_exists($eng, 'requestStop') && !$eng->requestStop()) {
                $stoppedImmediately = false;
            } else {
                if (method_exists($eng, 'stop')) {
                    $eng->stop();
                }
                unset(EngineRegistry::$jonbet[$userId], EngineRegistry::$jonbetApis[$userId]);
            }
        }
        if ($updateDb && $stoppedImmediately) {
            UserRepository::update($userId, [
                'jonbetIsActive' => 0,
                'jonbetIsBetting' => 0,
            ]);
        }
        return $stoppedImmediately;
    }

    public static function connectBlaze(int $userId, string $email, string $password): void
    {
        log_msg("[connect] blaze start user={$userId}", 'bot');
        $api = new BlazeAPI();
        $res = BlazeAuth::login($api, $email, $password);
        if ($res) {
            $balance = 0.0;
            try {
                $wallet = $api->getWallet();
                $bal = $wallet['data']['preferred']['real_balance']
                    ?? $wallet['data']['preferred']['balance']
                    ?? $wallet[0]['real_balance']
                    ?? $wallet[0]['balance']
                    ?? 0;
                $balance = (float) $bal;
            } catch (\Throwable $e) {
                // ok
            }
            UserRepository::update($userId, [
                'token' => $res['token'],
                'wallet' => $res['wallet'],
                'blazeEmail' => $email,
                'password' => $password,
                'connectPending' => 0,
                'connectError' => null,
            ]);
            // Só grava saldo real se a conta estiver em modo REAL
            // (DEMO usa banca virtual de R$ 1000 e não pode ser sobrescrita)
            $u = UserRepository::find($userId);
            $isDemo = (($u['accountType'] ?? 'DEMO') === 'DEMO');
            if ($balance > 0 && !$isDemo) {
                try {
                    Database::update('variables', [
                        'balance' => $balance,
                        'firstBalanceMode' => 'REAL',
                    ], 'ownerId = :oid', ['oid' => $userId]);
                } catch (\Throwable $e) {
                }
            }
            BotCommandService::pushMessage($userId, '✅ Conta Blaze conectada', 'BLAZE');
            log_msg("[connect] blaze ok user={$userId}", 'bot');
        } else {
            $err = BlazeAuth::$lastError
                ?: 'Falha no login (captcha/credenciais). Configure ANTI_CAPTCHA_API_KEY em Admin → Configurações.';
            UserRepository::update($userId, [
                'connectPending' => 0,
                'connectError' => $err,
            ]);
            BotCommandService::pushMessage($userId, '❌ Falha ao conectar Blaze: ' . $err, 'BLAZE');
            log_msg("[connect] blaze fail user={$userId}: {$err}", 'bot');
        }
    }

    public static function connectJonbet(int $userId, string $email, string $password): void
    {
        log_msg("[connect] jonbet start user={$userId}", 'bot');
        $api = new \App\Bot\Jonbet\JonbetAPI();
        $res = \App\Bot\Jonbet\JonbetAuth::loginJonbet($api, $email, $password);
        if ($res) {
            UserRepository::update($userId, [
                'jonbetToken' => $res['token'],
                'jonbetWallet' => $res['wallet'],
                'jonbetEmail' => $email,
                'jonbetPassword' => $password,
                'jonbetConnectPending' => 0,
                'jonbetConnectError' => null,
            ]);
            BotCommandService::pushMessage($userId, '✅ Conta Jonbet conectada', 'JONBET');
            log_msg("[connect] jonbet ok user={$userId}", 'bot');
        } else {
            $err = \App\Bot\Jonbet\JonbetAuth::$lastError
                ?: 'Login na Jonbet falhou. Verifique email/senha e ANTI_CAPTCHA_API_KEY.';
            UserRepository::update($userId, [
                'jonbetConnectPending' => 0,
                'jonbetConnectError' => $err,
            ]);
            BotCommandService::pushMessage($userId, '❌ Falha ao conectar Jonbet: ' . $err, 'JONBET');
            log_msg("[connect] jonbet fail user={$userId}: {$err}", 'bot');
        }
    }

    public static function processCommands(): void
    {
        // connect antigos (captcha) não devem bloquear start/stop
        try {
            BotCommandService::expireStale(120);
        } catch (\Throwable) {
        }

        $cmds = BotCommandService::pending(30);
        foreach ($cmds as $cmd) {
            $id = (int) $cmd['id'];
            $userId = (int) $cmd['userId'];
            $action = $cmd['action'];
            $platform = $cmd['platform'] ?? 'BLAZE';
            $payload = $cmd['payload'] ? json_decode((string) $cmd['payload'], true) : [];
            if (!is_array($payload)) {
                $payload = [];
            }

            try {
                $user = UserRepository::findWithRelations($userId);
                if (!$user && $action !== 'stop') {
                    BotCommandService::mark($id, 'error');
                    continue;
                }
                match ($action) {
                    'start' => match ($platform) {
                        'JONBET' => self::startJonbet($user, false),
                        'DAYTRADE' => self::startDayTrade($user, false),
                        default => self::startBlaze($user, false),
                    },
                    'stop' => match ($platform) {
                        'JONBET' => self::stopJonbet($userId),
                        'DAYTRADE' => self::stopDayTrade($userId),
                        default => self::stopBlaze($userId),
                    },
                    'refresh-cache' => self::refresh($userId, $platform),
                    'connect-blaze' => self::connectBlaze($userId, (string) ($payload['email'] ?? ''), (string) ($payload['password'] ?? '')),
                    'connect-jonbet' => self::connectJonbet($userId, (string) ($payload['email'] ?? ''), (string) ($payload['password'] ?? '')),
                    'connect-iqoption' => self::connectIqOption($userId, (string) ($payload['email'] ?? ''), (string) ($payload['password'] ?? '')),
                    default => null,
                };
                BotCommandService::mark($id, 'done');
            } catch (\Throwable $e) {
                log_msg("[cmd:{$id}] " . $e->getMessage(), 'bot');
                BotCommandService::mark($id, 'error');
                // limpa pending de connect se o worker crashar no meio
                if ($action === 'connect-blaze') {
                    UserRepository::update($userId, [
                        'connectPending' => 0,
                        'connectError' => 'Erro interno ao conectar: ' . $e->getMessage(),
                    ]);
                }
                if ($action === 'connect-jonbet') {
                    UserRepository::update($userId, [
                        'jonbetConnectPending' => 0,
                        'jonbetConnectError' => 'Erro interno ao conectar: ' . $e->getMessage(),
                    ]);
                }
                if ($action === 'connect-iqoption') {
                    UserRepository::update($userId, [
                        'daytradeConnectPending' => 0,
                        'daytradeConnectError' => 'Erro interno ao conectar: ' . $e->getMessage(),
                    ]);
                }
            }
        }
    }

    public static function connectIqOption(int $userId, string $email, string $password): void
    {
        log_msg("[connect] iqoption start user={$userId}", 'daytrade');
        $res = \App\Services\IqOptionBridge::login($email, $password);
        if (empty($res['ok']) || empty($res['ssid'])) {
            $err = (string) ($res['error'] ?? 'Login IQ Option falhou');
            // Mensagens amigáveis para erros comuns da API
            $code = (string) ($res['code'] ?? '');
            if (stripos($err, 'invalid_credentials') !== false || $code === 'invalid_credentials') {
                $err = 'Email ou senha da IQ Option incorretos.';
            } elseif (stripos($err, '2fa') !== false || stripos($err, 'two_factor') !== false) {
                $err = 'Conta com 2FA. Desative a verificação em 2 etapas na IQ Option ou use app password se disponível.';
            }
            UserRepository::update($userId, [
                'daytradeConnectPending' => 0,
                'daytradeConnectError' => $err,
                'iqSsid' => null,
                'iqBalanceId' => null,
            ]);
            BotCommandService::pushMessage($userId, '❌ IQ Option: ' . $err, 'DAYTRADE');
            log_msg("[connect] iq fail user={$userId}: {$err}", 'daytrade');
            return;
        }
        $ssid = (string) $res['ssid'];
        $balances = is_array($res['balances'] ?? null) ? $res['balances'] : [];
        // Se login não trouxe balances, tenta de novo (force, sem cache)
        if (!$balances) {
            $b2 = \App\Services\IqOptionBridge::balances($ssid, true);
            if (!empty($b2['ok']) && is_array($b2['balances'] ?? null)) {
                $balances = $b2['balances'];
            } else {
                log_msg(
                    '[connect] iq balances empty user=' . $userId . ' err=' . (string) ($b2['error'] ?? 'n/a'),
                    'daytrade'
                );
            }
        }
        $u = UserRepository::find($userId);
        $accountType = strtoupper((string) ($u['iqAccountType'] ?? 'DEMO'));
        if (!in_array($accountType, ['DEMO', 'REAL'], true)) {
            $accountType = 'DEMO';
        }
        $chosen = \App\Controllers\Api\DayTradeController::pickBalance($balances, $accountType, false);
        $bal = (float) ($chosen['amount'] ?? 0);
        $balId = (int) ($chosen['id'] ?? 0);
        $currency = (string) ($chosen['currency'] ?? 'USD');
        // se pediu REAL mas só veio practice, não inventa saldo
        $matchedType = $chosen ? (int) ($chosen['type'] ?? 0) : 0;
        $isPractice = $matchedType === 4 || $matchedType === 2;
        if ($accountType === 'REAL' && $chosen && $isPractice) {
            log_msg("[connect] iq REAL requested but only practice balance found user={$userId}", 'daytrade');
        }
        UserRepository::update($userId, [
            'iqEmail' => $email,
            'iqPassword' => $password,
            'iqSsid' => $ssid,
            'iqAccountType' => $accountType,
            'iqBalanceId' => $balId > 0 ? $balId : null,
            'daytradeConnectPending' => 0,
            'daytradeConnectError' => null,
        ]);
        try {
            // Nunca deixa o placeholder 10000 se ainda não sincronizou de verdade
            if ($balId > 0) {
                $existing = Database::fetch('SELECT * FROM daytrade_variables WHERE ownerId = ?', [$userId]);
                $modeChanged = strtoupper((string) ($existing['firstBalanceMode'] ?? '')) !== $accountType;
                $payload = [
                    'balance' => $bal,
                    'firstBalanceMode' => $accountType,
                ];
                // âncora de banca (relatório início) ao conectar ou trocar DEMO/REAL
                if ($modeChanged || empty($existing['firstBalanceDate']) || (float) ($existing['firstBalance'] ?? 0) <= 0) {
                    $payload['firstBalance'] = $bal;
                    $payload['firstBalanceDate'] = now();
                    $payload['monthStartBalance'] = $bal;
                    $payload['monthStartDate'] = now();
                    $payload['profit'] = 0;
                } else {
                    // mantém firstBalance; só atualiza saldo ao vivo
                    $payload['firstBalance'] = (float) ($existing['firstBalance'] ?? $bal);
                }
                Database::update('daytrade_variables', $payload, 'ownerId = :oid', ['oid' => $userId]);
            } else {
                Database::update('daytrade_variables', [
                    'balance' => 0,
                ], 'ownerId = :oid', ['oid' => $userId]);
            }
        } catch (\Throwable $e) {
            log_msg('[connect] iq vars update fail: ' . $e->getMessage(), 'daytrade');
        }
        $label = $accountType === 'REAL' ? 'REAL' : 'DEMO';
        $msg = $balId > 0
            ? "✅ IQ Option conectada ({$label}) · {$currency} " . number_format($bal, 2, '.', '')
            : "✅ IQ Option conectada ({$label}) · saldo ainda não sincronizado — clique em Atualizar saldo";
        BotCommandService::pushMessage($userId, $msg, 'DAYTRADE');
        log_msg("[connect] iq ok user={$userId} type={$accountType} bal={$bal} balId={$balId} nBal=" . count($balances), 'daytrade');
    }

    public static function startDayTrade(array $user, bool $preserveState = false): void
    {
        $userId = (int) $user['id'];
        self::stopDayTrade($userId, false);
        UserRepository::ensureDayTradeDefaults($userId);
        if (empty($user['iqSsid'])) {
            BotCommandService::pushMessage($userId, '⚠️ Conecte a conta IQ Option antes de iniciar.', 'DAYTRADE');
            return;
        }
        $engine = new DayTradeEngine($userId, !$preserveState);
        EngineRegistry::$daytrade[$userId] = $engine;
        $engine->start();
        UserRepository::update($userId, ['daytradeIsActive' => 1]);
    }

    public static function stopDayTrade(int $userId, bool $updateDb = true): bool
    {
        $stoppedImmediately = true;
        if (isset(EngineRegistry::$daytrade[$userId])) {
            $eng = EngineRegistry::$daytrade[$userId];
            if (method_exists($eng, 'requestStop') && !$eng->requestStop()) {
                $stoppedImmediately = false;
            } else {
                if (method_exists($eng, 'stop')) {
                    $eng->stop();
                }
                unset(EngineRegistry::$daytrade[$userId]);
            }
        }
        if ($updateDb && $stoppedImmediately) {
            UserRepository::update($userId, [
                'daytradeIsActive' => 0,
                'daytradeIsBetting' => 0,
            ]);
        }
        return $stoppedImmediately;
    }

    private static function refresh(int $userId, string $platform): void
    {
        $map = match ($platform) {
            'JONBET' => EngineRegistry::$jonbet,
            'DAYTRADE' => EngineRegistry::$daytrade,
            default => EngineRegistry::$blaze,
        };
        if (isset($map[$userId]) && method_exists($map[$userId], 'refreshCache')) {
            $map[$userId]->refreshCache();
        }
    }

    public static function resumeActive(): void
    {
        if (ConfigRepository::emergencyStop()) {
            log_msg('[resume] EMERGENCY_STOP ativo — bots não serão religados automaticamente', 'bot');
            return;
        }

        $rows = Database::fetchAll('SELECT id FROM users WHERE isActive = 1');
        foreach ($rows as $r) {
            $user = UserRepository::findWithRelations((int) $r['id']);
            if ($user) {
                try {
                    self::startBlaze($user, true);
                } catch (\Throwable $e) {
                    log_msg('[resume blaze] ' . $e->getMessage(), 'bot');
                }
            }
        }
        $rows = Database::fetchAll('SELECT id FROM users WHERE jonbetIsActive = 1');
        foreach ($rows as $r) {
            $user = UserRepository::findWithRelations((int) $r['id']);
            if ($user) {
                try {
                    self::startJonbet($user, true);
                } catch (\Throwable $e) {
                    log_msg('[resume jonbet] ' . $e->getMessage(), 'bot');
                }
            }
        }
        try {
            $rows = Database::fetchAll('SELECT id FROM users WHERE daytradeIsActive = 1');
            foreach ($rows as $r) {
                $user = UserRepository::findWithRelations((int) $r['id']);
                if ($user) {
                    try {
                        self::startDayTrade($user, true);
                    } catch (\Throwable $e) {
                        log_msg('[resume daytrade] ' . $e->getMessage(), 'bot');
                    }
                }
            }
        } catch (\Throwable) {
            // coluna pode não existir ainda
        }
    }

    public static function tickAll(): void
    {
        foreach (EngineRegistry::$blaze as $eng) {
            if (method_exists($eng, 'tick')) {
                try {
                    $eng->tick();
                } catch (\Throwable $e) {
                    log_msg('[tick blaze] ' . $e->getMessage(), 'bot');
                }
            }
        }
        foreach (EngineRegistry::$jonbet as $eng) {
            if (method_exists($eng, 'tick')) {
                try {
                    $eng->tick();
                } catch (\Throwable $e) {
                    log_msg('[tick jonbet] ' . $e->getMessage(), 'bot');
                }
            }
        }
        foreach (EngineRegistry::$daytrade as $eng) {
            if (method_exists($eng, 'tick')) {
                try {
                    $eng->tick();
                } catch (\Throwable $e) {
                    log_msg('[tick daytrade] ' . $e->getMessage(), 'bot');
                }
            }
        }
    }
}
