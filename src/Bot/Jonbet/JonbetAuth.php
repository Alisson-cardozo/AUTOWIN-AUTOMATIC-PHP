<?php

declare(strict_types=1);

namespace App\Bot\Jonbet;

use App\Bot\HttpClient;
use App\Models\ConfigRepository;

/**
 * Port of bot/jonbet/auth.ts
 */
final class JonbetAuth
{
    /** Último erro legível pro painel (connectError). */
    public static ?string $lastError = null;

    /** @return array{antiCaptchaApiKey:string,turnstileSiteKey:string} */
    public static function getCaptchaConfig(): array
    {
        return [
            'antiCaptchaApiKey' => (string) (ConfigRepository::get('ANTI_CAPTCHA_API_KEY') ?: env('ANTI_CAPTCHA_API_KEY', '')),
            'turnstileSiteKey' => (string) (ConfigRepository::get('JONBET_TURNSTILE_SITE_KEY')
                ?: env('JONBET_TURNSTILE_SITE_KEY', '0x4AAAAAABOYk0pSWlbHhm-u')),
        ];
    }

    public static function solveTurnstile(): ?string
    {
        self::$lastError = null;
        $config = self::getCaptchaConfig();
        if ($config['antiCaptchaApiKey'] === '') {
            self::$lastError = 'Configure ANTI_CAPTCHA_API_KEY em Admin → Configurações (ou no .env).';
            return null;
        }

        // timeout 30s por request (anti-captcha pode demorar)
        $http = new HttpClient('', [
            'Content-Type' => 'application/json',
            'Accept' => 'application/json',
        ], 30);

        try {
            $create = $http->post('https://api.anti-captcha.com/createTask', [
                'clientKey' => $config['antiCaptchaApiKey'],
                'task' => [
                    'type' => 'TurnstileTaskProxyless',
                    'websiteURL' => 'https://jonbet.bet.br',
                    'websiteKey' => $config['turnstileSiteKey'],
                ],
            ]);
            $taskId = is_array($create) ? ($create['taskId'] ?? null) : null;
            $apiErr = is_array($create) ? ($create['errorDescription'] ?? $create['errorCode'] ?? null) : null;
            if (!$taskId) {
                self::$lastError = $apiErr
                    ? ('Anti-Captcha: ' . $apiErr)
                    : 'Anti-Captcha não criou a task. Verifique a chave e o saldo.';
                log_msg('[jonbet:auth] createTask falhou: ' . json_encode($create), 'bot');
                return null;
            }

            for ($i = 0; $i < 24; $i++) {
                usleep(5_000_000);
                $result = $http->post('https://api.anti-captcha.com/getTaskResult', [
                    'clientKey' => $config['antiCaptchaApiKey'],
                    'taskId' => $taskId,
                ]);
                if (!is_array($result)) {
                    continue;
                }
                if (($result['status'] ?? '') === 'ready') {
                    $token = $result['solution']['token'] ?? null;
                    if (!$token) {
                        self::$lastError = 'Anti-Captcha retornou solution vazia.';
                        return null;
                    }
                    return (string) $token;
                }
                if (!empty($result['errorDescription']) || !empty($result['errorCode'])) {
                    self::$lastError = 'Anti-Captcha: ' . ($result['errorDescription'] ?? $result['errorCode']);
                    return null;
                }
            }
            self::$lastError = 'Timeout resolvendo captcha (Anti-Captcha demorou demais).';
            return null;
        } catch (\Throwable $err) {
            self::$lastError = 'Erro Anti-Captcha: ' . $err->getMessage();
            log_msg('[jonbet:auth] erro anti-captcha: ' . $err->getMessage(), 'bot');
            return null;
        }
    }

    /** @return array{token:string,wallet:string}|null */
    public static function loginJonbet(
        JonbetAPI $api,
        string $email,
        string $password,
        ?string $manualToken = null
    ): ?array {
        self::$lastError = null;
        $captchaToken = $manualToken ?: self::solveTurnstile();
        if (!$captchaToken) {
            if (!self::$lastError) {
                self::$lastError = 'Captcha não resolvido — verifique ANTI_CAPTCHA_API_KEY.';
            }
            log_msg('[jonbet:auth] ' . self::$lastError, 'bot');
            return null;
        }

        try {
            $data = $api->login($email, $password, $captchaToken);
            $token = is_array($data)
                ? ($data['data']['auth_token'] ?? $data['access_token'] ?? null)
                : null;
            if (!$token) {
                $err = is_array($data)
                    ? ($data['error'] ?? $data['message'] ?? $data['data']['message'] ?? null)
                    : null;
                self::$lastError = $err
                    ? ('Login Jonbet: ' . (is_string($err) ? $err : json_encode($err)))
                    : 'Login na Jonbet falhou. Verifique email e senha.';
                log_msg('[jonbet:auth] login sem token: ' . json_encode($data), 'bot');
                return null;
            }
            $api->setToken((string) $token);
            $wallet = $api->getWallet();
            $walletId = is_array($wallet)
                ? ($wallet['data']['preferred']['id'] ?? $wallet[0]['id'] ?? '')
                : '';
            log_msg('[jonbet:auth] login ok', 'bot');
            return ['token' => (string) $token, 'wallet' => (string) $walletId];
        } catch (\Throwable $err) {
            self::$lastError = 'Login Jonbet falhou: ' . $err->getMessage();
            log_msg('[jonbet:auth] login falhou: ' . $err->getMessage(), 'bot');
            return null;
        }
    }

    /** @return array{token:string,wallet:string}|null */
    public static function loginJonbetWithToken(JonbetAPI $api, string $bearerToken): ?array
    {
        try {
            $api->setToken($bearerToken);
            $wallet = $api->getWallet();
            $walletId = is_array($wallet)
                ? ($wallet['data']['preferred']['id'] ?? $wallet[0]['id'] ?? '')
                : '';
            return ['token' => $bearerToken, 'wallet' => (string) $walletId];
        } catch (\Throwable $err) {
            self::$lastError = 'Token Jonbet inválido: ' . $err->getMessage();
            log_msg('[jonbet:auth] token login falhou: ' . $err->getMessage(), 'bot');
            return null;
        }
    }
}
