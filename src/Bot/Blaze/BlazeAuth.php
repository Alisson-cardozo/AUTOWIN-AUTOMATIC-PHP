<?php

declare(strict_types=1);

namespace App\Bot\Blaze;

use App\Models\ConfigRepository;
use App\Services\HttpClient;

final class BlazeAuth
{
    /** Último erro legível para gravar em connectError no painel. */
    public static ?string $lastError = null;

    public static function solveCaptcha(): ?array
    {
        self::$lastError = null;
        $antiKey = ConfigRepository::get('ANTI_CAPTCHA_API_KEY', '') ?: (string) env('ANTI_CAPTCHA_API_KEY', '');
        $turnstile = ConfigRepository::get('TURNSTILE_SITE_KEY', '0x4AAAAAABNpvJayiqOm2i7m') ?: '0x4AAAAAABNpvJayiqOm2i7m';
        $hUrl = ConfigRepository::get('HCAPTCHA_SERVICE_URL', '') ?: (string) env('HCAPTCHA_SERVICE_URL', '');
        $hSite = ConfigRepository::get('HCAPTCHA_SITE_KEY', '') ?: '';

        if ($antiKey === '' && $hUrl === '') {
            self::$lastError = 'Configure ANTI_CAPTCHA_API_KEY em Admin → Configurações (necessário para o captcha da Blaze).';
            return null;
        }

        if ($antiKey !== '') {
            $client = new HttpClient('https://api.anti-captcha.com', ['Content-Type' => 'application/json'], 60);
            $create = $client->post('/createTask', [
                'clientKey' => $antiKey,
                'task' => [
                    'type' => 'TurnstileTaskProxyless',
                    'websiteURL' => 'https://blaze.bet.br',
                    'websiteKey' => $turnstile,
                ],
            ]);
            $createData = is_array($create['data'] ?? null) ? $create['data'] : [];
            $taskId = $createData['taskId'] ?? null;
            $apiErr = $createData['errorDescription'] ?? $createData['errorCode'] ?? null;
            if (!$taskId) {
                self::$lastError = $apiErr
                    ? ('Anti-Captcha: ' . $apiErr)
                    : 'Anti-Captcha não criou a task. Verifique a chave e o saldo.';
                log_msg('[blaze:auth] createTask falhou: ' . json_encode($createData), 'bot');
                return null;
            }
            for ($i = 0; $i < 24; $i++) {
                usleep(5_000_000);
                $result = $client->post('/getTaskResult', [
                    'clientKey' => $antiKey,
                    'taskId' => $taskId,
                ]);
                $rd = is_array($result['data'] ?? null) ? $result['data'] : [];
                if (($rd['status'] ?? '') === 'ready') {
                    $token = $rd['solution']['token'] ?? null;
                    if (!$token) {
                        self::$lastError = 'Anti-Captcha retornou solution vazia.';
                        return null;
                    }
                    return [
                        'token' => $token,
                        'userAgent' => $rd['solution']['userAgent'] ?? null,
                    ];
                }
                if (!empty($rd['errorDescription']) || !empty($rd['errorCode'])) {
                    self::$lastError = 'Anti-Captcha: ' . ($rd['errorDescription'] ?? $rd['errorCode']);
                    return null;
                }
            }
            self::$lastError = 'Timeout resolvendo captcha (Anti-Captcha demorou demais).';
            return null;
        }

        if ($hUrl) {
            $client = new HttpClient('', ['Content-Type' => 'application/json']);
            $res = $client->post($hUrl, ['sitekey' => $hSite, 'url' => 'https://blaze.bet.br']);
            $token = $res['data']['token'] ?? null;
            if (!$token) {
                self::$lastError = 'Serviço HCaptcha não retornou token.';
                return null;
            }
            return ['token' => $token];
        }
        return null;
    }

    /**
     * @return array{token:string,wallet:string}|null
     */
    public static function login(BlazeAPI $api, string $email, string $password, ?string $manualToken = null): ?array
    {
        self::$lastError = null;
        $captchaToken = $manualToken;
        $ua = null;
        if (!$captchaToken) {
            $solved = self::solveCaptcha();
            $captchaToken = $solved['token'] ?? null;
            $ua = $solved['userAgent'] ?? null;
        }
        if (!$captchaToken) {
            if (!self::$lastError) {
                self::$lastError = 'Falha no captcha. Configure ANTI_CAPTCHA_API_KEY.';
            }
            return null;
        }
        try {
            if ($ua) {
                $api->setUserAgent($ua);
            }
            $data = $api->login($email, $password, $captchaToken);
            $token = $data['data']['auth_token'] ?? $data['access_token'] ?? null;
            if (!$token) {
                $err = $data['error'] ?? $data['message'] ?? $data['data']['message'] ?? null;
                self::$lastError = $err
                    ? ('Login Blaze: ' . (is_string($err) ? $err : json_encode($err)))
                    : 'Login na Blaze falhou. Verifique email e senha.';
                log_msg('[blaze:auth] login sem token: ' . json_encode($data), 'bot');
                return null;
            }
            $api->setToken($token);
            $wallet = $api->getWallet();
            $walletId = $wallet['data']['preferred']['id'] ?? ($wallet[0]['id'] ?? '');
            return ['token' => $token, 'wallet' => (string) $walletId];
        } catch (\Throwable $e) {
            self::$lastError = 'Erro ao conectar na Blaze: ' . $e->getMessage();
            log_msg('[blaze:auth] ' . $e->getMessage(), 'bot');
            return null;
        }
    }
}
