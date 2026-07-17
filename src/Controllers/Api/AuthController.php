<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Auth\Auth;
use App\Database;
use App\Models\UserRepository;

final class AuthController
{
    public function login(): void
    {
        $email = trim((string) input('email', ''));
        $password = (string) input('password', '');
        if ($email === '' || $password === '') {
            json_response(['error' => 'Preencha todos os campos.'], 400);
        }

        // Admin
        $admin = Database::fetch('SELECT * FROM admin_users WHERE email = ? LIMIT 1', [$email]);
        if ($admin) {
            if (!password_verify($password, $admin['password'])) {
                json_response(['error' => 'Email ou senha incorretos.'], 401);
            }
            Auth::loginAdmin((int) $admin['id']);

            $adminAccount = UserRepository::findAdminAccount();
            if (!$adminAccount) {
                $id = UserRepository::create([
                    'name' => $admin['username'] ?: 'Admin',
                    'email' => $admin['email'],
                    'isAdminAccount' => 1,
                    'webPassword' => $admin['password'],
                    'paymentStatus' => 'PAID',
                    'createdAt' => now(),
                ]);
                $adminAccount = UserRepository::find($id);
            }
            if ($adminAccount) {
                Auth::loginUser((int) $adminAccount['id']);
            }
            json_response(['success' => true, 'isAdmin' => true]);
        }

        // Usuário
        $user = UserRepository::findByEmail($email);
        if (!$user || empty($user['webPassword'])) {
            json_response(['error' => 'Usuário não encontrado ou sem acesso ao painel.'], 401);
        }
        if (!password_verify($password, $user['webPassword'])) {
            json_response(['error' => 'Email ou senha incorretos.'], 401);
        }
        Auth::loginUser((int) $user['id']);
        // Conta isAdminAccount → já libera cookie admin (botão Painel Admin)
        $elevated = !empty($user['isAdminAccount']) && Auth::ensureAdminSession();
        json_response(['success' => true, 'isAdmin' => $elevated]);
    }

    public function logout(): void
    {
        Auth::logoutUser();
        Auth::logoutAdmin();
        json_response(['success' => true]);
    }

    public function me(): void
    {
        $user = Auth::requireUser();
        $hiddenTabs = \App\Models\ConfigRepository::get('HIDDEN_TABS', '') ?? '';

        // Cada aba tem sua própria lista independente de jogos ocultos —
        // ocultar um jogo em Conta Blaze não afeta Conta Jonbet/Premium/etc.
        $parseHiddenList = static function (string $key, bool $forceCrash = false): array {
            $raw = (string) (\App\Models\ConfigRepository::get($key, '') ?? '');
            $list = array_values(array_filter(array_map('trim', explode(',', $raw))));
            if ($forceCrash && !in_array('CRASH', $list, true)) {
                $list[] = 'CRASH';
            }
            return $list;
        };
        $hiddenContaBlazeList = $parseHiddenList('HIDDEN_GAMES_CONTA_BLAZE', true);
        $hiddenContaJonbetList = $parseHiddenList('HIDDEN_GAMES_CONTA_JONBET', true);
        $hiddenPremiumBlazeList = $parseHiddenList('HIDDEN_GAMES_PREMIUM_BLAZE');
        $hiddenPremiumJonbetList = $parseHiddenList('HIDDEN_GAMES_PREMIUM_JONBET');
        $hiddenGamesContaBlaze = implode(',', $hiddenContaBlazeList);
        $hiddenGamesContaJonbet = implode(',', $hiddenContaJonbetList);
        $hiddenGamesPremiumBlaze = implode(',', $hiddenPremiumBlazeList);
        $hiddenGamesPremiumJonbet = implode(',', $hiddenPremiumJonbetList);
        $hiddenStrategies = \App\Models\ConfigRepository::get('HIDDEN_STRATEGY_TYPES', '') ?? '';
        $hiddenLiveGames = (string) (\App\Models\ConfigRepository::get('HIDDEN_LIVE_GAMES', '') ?? '');

        // Se o jogo ativo do usuário foi ocultado (ou era CRASH), troca pra um permitido
        $gameType = strtoupper((string) ($user['gameType'] ?? 'DOUBLE'));
        $jonbetGameType = strtoupper((string) ($user['jonbetGameType'] ?? 'DOUBLE'));
        $fallbackGames = ['DOUBLE', 'FORTUNE', 'BACBO', 'BACBO_LIVE', 'ROLETA', 'DAY_TRADE'];
        if ($gameType === 'CRASH' || ($gameType !== '' && in_array($gameType, $hiddenContaBlazeList, true))) {
            $next = 'DOUBLE';
            foreach ($fallbackGames as $g) {
                if (!in_array($g, $hiddenContaBlazeList, true)) {
                    $next = $g;
                    break;
                }
            }
            if ($next !== $gameType) {
                \App\Models\UserRepository::update((int) $user['id'], ['gameType' => $next]);
                $gameType = $next;
                $user['gameType'] = $next;
            }
        }
        if ($jonbetGameType === 'CRASH' || ($jonbetGameType !== '' && in_array($jonbetGameType, $hiddenContaJonbetList, true))) {
            $next = 'DOUBLE';
            foreach (['DOUBLE', 'FORTUNE'] as $g) {
                if (!in_array($g, $hiddenContaJonbetList, true)) {
                    $next = $g;
                    break;
                }
            }
            if ($next !== $jonbetGameType) {
                \App\Models\UserRepository::update((int) $user['id'], ['jonbetGameType' => $next]);
                $jonbetGameType = $next;
                $user['jonbetGameType'] = $next;
            }
        }

        $normalizeSettings = static function (?array $s): ?array {
            if (!$s) {
                return null;
            }
            foreach (['whiteEntryGaleEnabled', 'skipFirstEntry', 'skipEntryAfterLoss'] as $b) {
                if (array_key_exists($b, $s)) {
                    $s[$b] = (bool) (int) $s[$b];
                }
            }
            foreach ([
                'enterValue', 'enterPercent', 'protectionValue', 'martingale', 'martingaleMultiplier',
                'whiteMultiplier', 'whiteEntryGale', 'whiteEntryGaleMultiplier', 'whiteEntryValue',
                'whiteEntryPercent', 'quantityCycles',
            ] as $n) {
                if (array_key_exists($n, $s) && $s[$n] !== null) {
                    $s[$n] = (float) $s[$n];
                }
            }
            return $s;
        };
        $normalizeVars = static function (?array $v): ?array {
            if (!$v) {
                return null;
            }
            foreach (['balance', 'profit', 'firstBalance', 'monthStartBalance'] as $n) {
                if (array_key_exists($n, $v) && $v[$n] !== null) {
                    $v[$n] = (float) $v[$n];
                }
            }
            foreach (['countWin', 'countLoss', 'countMartingale', 'monthCountWin', 'monthCountLoss'] as $n) {
                if (array_key_exists($n, $v) && $v[$n] !== null) {
                    $v[$n] = (int) $v[$n];
                }
            }
            if (array_key_exists('isGale', $v)) {
                $v['isGale'] = (bool) (int) $v['isGale'];
            }
            return $v;
        };

        json_response([
            'id' => (int) $user['id'],
            'name' => $user['name'],
            'email' => $user['email'],
            'accountType' => $user['accountType'],
            'gameType' => $gameType,
            'isActive' => (bool) $user['isActive'],
            'isBetting' => (bool) $user['isBetting'],
            'paymentStatus' => $user['paymentStatus'],
            'expireIn' => $user['expireIn'],
            'isTesting' => (bool) $user['isTesting'],
            'isAdminAccount' => (bool) $user['isAdminAccount'],
            'alreadyTested' => (bool) $user['alreadyTested'],
            'features' => $user['features'],
            'hasToken' => !empty($user['token']),
            'blazeEmail' => $user['blazeEmail'] ?? null,
            'connectPending' => (bool) ($user['connectPending'] ?? false),
            'connectError' => $user['connectError'] ?? null,
            'hasJonbetToken' => !empty($user['jonbetToken']),
            'jonbetConnectPending' => (bool) ($user['jonbetConnectPending'] ?? false),
            'jonbetConnectError' => $user['jonbetConnectError'] ?? null,
            'jonbetEmail' => $user['jonbetEmail'] ?? null,
            'jonbetAccountType' => $user['jonbetAccountType'] ?? 'DEMO',
            'jonbetGameType' => $jonbetGameType,
            'jonbetIsActive' => (bool) ($user['jonbetIsActive'] ?? false),
            'jonbetIsBetting' => (bool) ($user['jonbetIsBetting'] ?? false),
            // Day Trade / IQ Option — trava menu lateral como Blaze/Jonbet
            'daytradeIsActive' => (bool) ($user['daytradeIsActive'] ?? 0),
            'daytradeIsBetting' => (bool) ($user['daytradeIsBetting'] ?? 0),
            'hiddenTabs' => $hiddenTabs,
            'hiddenGamesContaBlaze' => $hiddenGamesContaBlaze,
            'hiddenGamesContaJonbet' => $hiddenGamesContaJonbet,
            'hiddenGamesPremiumBlaze' => $hiddenGamesPremiumBlaze,
            'hiddenGamesPremiumJonbet' => $hiddenGamesPremiumJonbet,
            'hiddenLiveGames' => $hiddenLiveGames,
            'hiddenStrategies' => $hiddenStrategies,
            'settings' => $normalizeSettings(is_array($user['settings'] ?? null) ? $user['settings'] : null),
            'variables' => $normalizeVars($this->demoSafeVariables(
                is_array($user['variables'] ?? null) ? $user['variables'] : null,
                (string) ($user['accountType'] ?? 'DEMO')
            )),
            'strategies' => $user['strategies'] ?? [],
            'bacBoSettings' => $normalizeSettings(is_array($user['bacBoSettings'] ?? null) ? $user['bacBoSettings'] : null),
            // Bac Bo DEMO usa a mesma banca virtual R$ 1000 (não misturar com lixo de sessão)
            'bacBoVariables' => $normalizeVars($this->demoSafeVariables(
                is_array($user['bacBoVariables'] ?? null) ? $user['bacBoVariables'] : null,
                (string) ($user['accountType'] ?? 'DEMO')
            )),
            'bacBoLiveSettings' => $normalizeSettings(is_array($user['bacBoLiveSettings'] ?? null) ? $user['bacBoLiveSettings'] : null),
            'bacBoLiveVariables' => $normalizeVars($this->demoSafeVariables(
                is_array($user['bacBoLiveVariables'] ?? null) ? $user['bacBoLiveVariables'] : null,
                (string) ($user['accountType'] ?? 'DEMO')
            )),
            'jonbetSettings' => $normalizeSettings(is_array($user['jonbetSettings'] ?? null) ? $user['jonbetSettings'] : null),
            'jonbetVariables' => $normalizeVars($this->demoSafeVariables(
                is_array($user['jonbetVariables'] ?? null) ? $user['jonbetVariables'] : null,
                (string) ($user['jonbetAccountType'] ?? 'DEMO')
            )),
        ]);
    }

    /**
     * Em DEMO, se o saldo ainda for o da conta real (ou modo errado),
     * devolve banca virtual de 1000 para a UI não misturar.
     *
     * @param  array<string,mixed>|null  $vars
     * @return array<string,mixed>|null
     */
    private function demoSafeVariables(?array $vars, string $accountType): ?array
    {
        if ($accountType !== 'DEMO') {
            return $vars;
        }
        if (!$vars) {
            return [
                'balance' => 1000.0,
                'profit' => 0.0,
                'firstBalance' => 1000.0,
                'firstBalanceMode' => 'DEMO',
                'countWin' => 0,
                'countLoss' => 0,
            ];
        }
        $mode = (string) ($vars['firstBalanceMode'] ?? '');
        $bal = (float) ($vars['balance'] ?? 0);
        $fb = (float) ($vars['firstBalance'] ?? 0);
        $wins = (int) ($vars['countWin'] ?? 0);
        $losses = (int) ($vars['countLoss'] ?? 0);
        $profit = (float) ($vars['profit'] ?? 0);

        // Resíduo de conta REAL, saldo inválido, ou reset incompleto (0 win/loss e banca ≠ 1000)
        $fromReal = $mode !== '' && $mode !== 'DEMO';
        $invalid = $bal <= 0 || $fb <= 0;
        $dirtyIdle = $wins === 0 && $losses === 0 && abs($profit) < 0.001 && abs($bal - 1000.0) > 0.01;

        if ($fromReal || $invalid || $dirtyIdle) {
            $vars['balance'] = 1000.0;
            $vars['firstBalance'] = 1000.0;
            $vars['profit'] = 0.0;
            $vars['firstBalanceMode'] = 'DEMO';
        }
        return $vars;
    }
}
