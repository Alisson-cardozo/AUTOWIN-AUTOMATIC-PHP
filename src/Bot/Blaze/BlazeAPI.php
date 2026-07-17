<?php

declare(strict_types=1);

namespace App\Bot\Blaze;

use App\Bot\HttpClient;

final class BlazeAPI
{
    private HttpClient $client;
    private ?string $token = null;
    private ?int $walletId = null;
    private string $blazeUsername = '';
    private string $blazeRank = 'bronze';
    private string $sessionId;

    public function __construct()
    {
        $this->sessionId = substr(bin2hex(random_bytes(8)), 0, 10);
        $this->client = new HttpClient('https://blaze.bet.br', [
            'Content-Type' => 'application/json',
            'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Origin' => 'https://blaze.bet.br',
            'Referer' => 'https://blaze.bet.br/pt/games/double',
            'Accept' => 'application/json, text/plain, */*',
            'Accept-Language' => 'pt-BR,pt;q=0.9,en;q=0.8',
            'X-Client-Version' => '2ecb1ba89',
            'ipcountry' => 'BR',
        ]);
    }

    public function setToken(string $token): void
    {
        $this->token = $token;
        $this->client->setHeader('Authorization', 'Bearer ' . $token);
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
            $payload = json_decode(base64_decode(strtr($parts[1], '-_', '+/')), true);
            if (!isset($payload['exp'])) {
                return INF;
            }
            return $payload['exp'] * 1000 - (microtime(true) * 1000);
        } catch (\Throwable) {
            return -1;
        }
    }

    public function setUserAgent(string $ua): void
    {
        $this->client->setHeader('User-Agent', $ua);
    }

    public function initSession(): void
    {
        try {
            $profile = $this->getProfile();
            $wallet = $this->getWallet();
            $this->blazeUsername = $profile['data']['username'] ?? $profile['username'] ?? '';
            $this->blazeRank = $profile['data']['rank'] ?? $profile['rank'] ?? 'bronze';
            $wId = $wallet['data']['preferred']['id'] ?? ($wallet[0]['id'] ?? null);
            if ($wId) {
                $this->walletId = (int) $wId;
            }
        } catch (\Throwable $e) {
            log_msg('[blaze:api] initSession: ' . $e->getMessage(), 'bot');
        }
    }

    public function login(string $email, string $password, string $captchaToken): array
    {
        return $this->client->put('/api/auth/password', [
            'username' => $email,
            'password' => $password,
            'two_factor_code' => '',
        ], ['x-turnstile-response' => $captchaToken]);
    }

    public function getProfile(): array
    {
        return $this->client->get('/api/users/me');
    }

    public function getWallet(): array
    {
        return $this->client->get('/api/wallets');
    }

    public function getRecentDouble(): array
    {
        return $this->client->get('/api/singleplayer-originals/originals/roulette_games/recent/1?t=' . time());
    }

    public function getCurrentDouble(): array
    {
        return $this->client->get('/api/singleplayer-originals/originals/roulette_games/current/1?t=' . time());
    }

    public function betDouble(int $colorId, float $amount, string $currencyType = 'BRL'): array
    {
        return $this->client->post('/api/singleplayer-originals/originals/roulette_bets', [
            'amount' => number_format($amount, 2, '.', ''),
            'currency_type' => $currencyType,
            'color' => $colorId,
            'free_bet' => false,
            'room_id' => 1,
            'username' => $this->blazeUsername,
            'rank' => $this->blazeRank,
            'wallet_id' => $this->walletId,
        ]);
    }

    public function getRecentCrash(): array
    {
        return $this->client->get('/api/singleplayer-originals/originals/crash_games/recent/4?t=' . time());
    }

    public function getCurrentCrash(): array
    {
        return $this->client->get('/api/singleplayer-originals/originals/crash_games/current/4?t=' . time());
    }

    public function enterCrash(float $amount, float $targetMultiplier, string $currencyType = 'BRL'): array
    {
        return $this->client->post('/api/singleplayer-originals/originals/crash_v2/round/enter', [
            'amount' => number_format($amount, 2, '.', ''),
            'type' => $currencyType,
            'auto_cashout_at' => number_format($targetMultiplier, 2, '.', ''),
            'room_id' => 4,
            'username' => $this->blazeUsername,
            'rank' => $this->blazeRank,
            'wallet_id' => $this->walletId,
        ]);
    }

    public function getRecentFortune(): array
    {
        return $this->client->get('/api/singleplayer-originals/originals/fortune_double_games/recent/1');
    }

    public function getCurrentFortune(): array
    {
        return $this->client->get('/api/singleplayer-originals/originals/fortune_double_games/current/1');
    }

    public function betFortune(int $colorId, float $amount, string $currencyType = 'BRL'): array
    {
        return $this->client->post('/api/singleplayer-originals/originals/fortune_double/round/enter', [
            'room_id' => '1',
            'amount' => number_format($amount, 2, '.', ''),
            'type' => $currencyType,
            'color' => $colorId,
            'free_bet' => false,
            'username' => $this->blazeUsername,
            'rank' => $this->blazeRank,
            'wallet_id' => $this->walletId,
        ]);
    }

    /**
     * Abre sessão Bac Bo (Evolution).
     *
     * @param string $currencyType BRL
     * @param string|null $preferredSlug 'bac-bo' | 'bac-bo-ao-vivo' — prioriza a sala pedida
     * @return array<string,mixed>
     */
    public function playBacBo(string $currencyType = 'BRL', ?string $preferredSlug = null): array
    {
        $body = ['selected_currency_type' => $currencyType];
        $slug = $preferredSlug !== null && $preferredSlug !== ''
            ? trim($preferredSlug, '/')
            : 'bac-bo';
        // Ordem: sala pedida primeiro; fallback na outra se falhar
        if ($slug === 'bac-bo-ao-vivo') {
            $paths = [
                '/api/games/bac-bo-ao-vivo/play',
                '/api/games/bac-bo/play',
            ];
        } else {
            $paths = [
                '/api/games/bac-bo/play',
                '/api/games/bac-bo-ao-vivo/play',
            ];
        }
        $last = [];
        foreach ($paths as $path) {
            try {
                $res = $this->client->post($path, $body);
                if (is_array($res) && self::extractBacBoLaunchUrl($res) !== null) {
                    return $res;
                }
                $last = is_array($res) ? $res : ['raw' => $res];
            } catch (\Throwable $e) {
                $last = ['error' => $e->getMessage(), 'path' => $path];
            }
        }
        return is_array($last) ? $last : [];
    }

    /**
     * Extrai URL de launch Evolution a partir da resposta do /play.
     */
    public static function extractBacBoLaunchUrl(array $playResponse): ?string
    {
        $candidates = [
            $playResponse['game_url'] ?? null,
            $playResponse['url'] ?? null,
            $playResponse['launch_url'] ?? null,
            $playResponse['gameUrl'] ?? null,
            $playResponse['data']['game_url'] ?? null,
            $playResponse['data']['url'] ?? null,
            $playResponse['data']['launch_url'] ?? null,
            $playResponse['data']['gameUrl'] ?? null,
            $playResponse['game']['url'] ?? null,
        ];
        foreach ($candidates as $u) {
            if (is_string($u) && str_contains($u, 'http')) {
                return $u;
            }
        }
        // procura recursiva por string com evo-games / entry
        $found = self::findUrlDeep($playResponse);
        return $found;
    }

    /** @param mixed $node */
    private static function findUrlDeep(mixed $node): ?string
    {
        if (is_string($node) && (str_contains($node, 'evo-games.com') || str_contains($node, '/entry'))) {
            return $node;
        }
        if (!is_array($node)) {
            return null;
        }
        foreach ($node as $v) {
            $f = self::findUrlDeep($v);
            if ($f) {
                return $f;
            }
        }
        return null;
    }

    public function extractBalance(array $wallet): float
    {
        $preferred = $wallet['data']['preferred'] ?? null;
        if (is_array($preferred) && isset($preferred['balance'])) {
            return (float) $preferred['balance'];
        }
        if (isset($wallet[0]['balance'])) {
            return (float) $wallet[0]['balance'];
        }
        return 0.0;
    }
}
