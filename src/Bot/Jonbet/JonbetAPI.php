<?php

declare(strict_types=1);

namespace App\Bot\Jonbet;

use App\Bot\HttpClient;

/**
 * Port of bot/jonbet/api.ts — same endpoints as Blaze on jonbet.bet.br
 */
final class JonbetAPI
{
    private const BASE_URL = 'https://jonbet.bet.br';

    private HttpClient $client;
    private ?string $token = null;
    private ?int $walletId = null;
    private string $username = '';
    private string $rank = 'bronze';
    private string $sessionId;

    public function __construct()
    {
        $this->sessionId = self::randomSessionId();
        // Igual ao axios do bot/jonbet/api.ts (baseURL + timeout 15s + headers)
        $this->client = new HttpClient(self::BASE_URL, [
            'Content-Type' => 'application/json',
            'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Origin' => 'https://jonbet.bet.br',
            'Referer' => 'https://jonbet.bet.br/pt/games/double',
            'Accept' => 'application/json, text/plain, */*',
            'Accept-Language' => 'pt-BR,pt;q=0.9,en;q=0.8',
            'x-client-version' => 'e672a0517',
            'ipcountry' => 'BR',
        ], 15);
    }

    private static function randomSessionId(): string
    {
        $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        $out = '';
        for ($i = 0; $i < 10; $i++) {
            $out .= $chars[random_int(0, strlen($chars) - 1)];
        }
        return $out;
    }

    public function setToken(string $token): void
    {
        $this->token = $token;
        $this->client->setHeader('Authorization', "Bearer $token");
        $this->client->setHeader('X-Session-ID', $this->sessionId);
    }

    public function getToken(): ?string
    {
        return $this->token;
    }

    public function getTokenTtlMs(): float
    {
        if (!$this->token) {
            return -1;
        }
        try {
            $parts = explode('.', $this->token);
            if (count($parts) < 2) {
                return -1;
            }
            $b64 = strtr($parts[1], '-_', '+/');
            $pad = strlen($b64) % 4;
            if ($pad) {
                $b64 .= str_repeat('=', 4 - $pad);
            }
            $payload = json_decode(base64_decode($b64) ?: '', true);
            if (!is_array($payload) || !isset($payload['exp'])) {
                return INF;
            }
            return ((float) $payload['exp'] * 1000) - (microtime(true) * 1000);
        } catch (\Throwable) {
            return -1;
        }
    }

    public function setUserAgent(string $userAgent): void
    {
        $this->client->setHeader('User-Agent', $userAgent);
    }

    public function initSession(): void
    {
        try {
            $profile = $this->getProfile();
            $wallet = $this->getWallet();
            $this->username = (string) ($profile['data']['username'] ?? $profile['username'] ?? '');
            $this->rank = (string) ($profile['data']['rank'] ?? $profile['rank'] ?? 'bronze');
            $wId = $wallet['data']['preferred']['id'] ?? $wallet[0]['id'] ?? null;
            if ($wId !== null) {
                $this->walletId = (int) $wId;
            }
            echo "[jonbet:api] session init — user={$this->username} rank={$this->rank} wallet={$this->walletId}\n";
        } catch (\Throwable $err) {
            echo '[jonbet:api] initSession error: ' . $err->getMessage() . "\n";
        }
    }

    public function login(string $email, string $password, string $captchaToken): mixed
    {
        return $this->client->put('/api/auth/password', [
            'username' => $email,
            'password' => $password,
            'two_factor_code' => '',
        ], [
            'x-turnstile-response' => $captchaToken,
        ]);
    }

    public function getProfile(): mixed
    {
        return $this->client->get('/api/users/me');
    }

    public function getWallet(): mixed
    {
        return $this->client->get('/api/wallets');
    }

    public function getBootstrapMe(): mixed
    {
        return $this->client->get('/api/bootstrap/me');
    }

    public function getCurrentDouble(): mixed
    {
        $t = (int) (microtime(true) * 1000);
        return $this->client->get("/api/singleplayer-originals/originals/roulette_games/current/1?t=$t");
    }

    public function getRecentDouble(): mixed
    {
        $t = (int) (microtime(true) * 1000);
        return $this->client->get("/api/singleplayer-originals/originals/roulette_games/recent/1?t=$t");
    }

    public function betDouble(int $colorId, float $amount, string $currencyType = 'BRL'): mixed
    {
        return $this->client->post('/api/singleplayer-originals/originals/roulette_bets', [
            'amount' => number_format($amount, 2, '.', ''),
            'currency_type' => $currencyType,
            'color' => $colorId,
            'free_bet' => false,
            'room_id' => 1,
            'username' => $this->username,
            'rank' => $this->rank,
            'wallet_id' => $this->walletId,
        ]);
    }

    public function getCurrentFortune(): mixed
    {
        return $this->client->get('/api/singleplayer-originals/originals/fortune_double_games/current/1');
    }

    public function getRecentFortune(): mixed
    {
        return $this->client->get('/api/singleplayer-originals/originals/fortune_double_games/recent/1');
    }

    public function betFortune(int $colorId, float $amount, string $currencyType = 'BRL'): mixed
    {
        return $this->client->post('/api/singleplayer-originals/originals/fortune_double/round/enter', [
            'room_id' => '1',
            'amount' => number_format($amount, 2, '.', ''),
            'type' => $currencyType,
            'color' => $colorId,
            'free_bet' => false,
            'username' => $this->username,
            'rank' => $this->rank,
            'wallet_id' => $this->walletId,
        ]);
    }

    public function getCurrentCrash(): mixed
    {
        $t = (int) (microtime(true) * 1000);
        return $this->client->get("/api/singleplayer-originals/originals/crash_games/current/4?t=$t");
    }

    public function getRecentCrash(): mixed
    {
        $t = (int) (microtime(true) * 1000);
        return $this->client->get("/api/singleplayer-originals/originals/crash_games/recent/4?t=$t");
    }

    public function enterCrash(float $amount, float $targetMultiplier, string $currencyType = 'BRL'): mixed
    {
        return $this->client->post('/api/singleplayer-originals/originals/crash_v2/round/enter', [
            'amount' => number_format($amount, 2, '.', ''),
            'type' => $currencyType,
            'auto_cashout_at' => number_format($targetMultiplier, 2, '.', ''),
            'room_id' => 4,
            'username' => $this->username,
            'rank' => $this->rank,
            'wallet_id' => $this->walletId,
        ]);
    }

    public function cashoutCrash(): mixed
    {
        return $this->client->post('/api/singleplayer-originals/originals/crash_v2/round/cashout', []);
    }

    public function availableBalance(mixed $wallet = null): float
    {
        try {
            $wallet = $wallet ?? $this->getWallet();
            if (is_array($wallet)) {
                if (isset($wallet['data']['balance']['available'])) {
                    return (float) $wallet['data']['balance']['available'];
                }
                if (isset($wallet[0]['balance'])) {
                    return (float) $wallet[0]['balance'];
                }
            }
        } catch (\Throwable) {
        }
        return 0.0;
    }

    /**
     * Alias com o mesmo nome usado por BlazeAPI, para que DoubleEngine/CrashEngine/FortuneEngine
     * possam chamar $this->api->extractBalance($wallet) independente da plataforma.
     */
    public function extractBalance(mixed $wallet): float
    {
        return $this->availableBalance($wallet);
    }
}
