<?php

declare(strict_types=1);

namespace App\Models;

use App\Database;

final class ConfigRepository
{
    /**
     * Copia chaves de API do .env para system_config se ainda não existirem
     * (ou estiverem vazias). Admin → Configurações continua podendo sobrescrever.
     */
    public static function seedFromEnv(): void
    {
        $map = [
            'ANTI_CAPTCHA_API_KEY' => env('ANTI_CAPTCHA_API_KEY', ''),
            'TURNSTILE_SITE_KEY' => env('TURNSTILE_SITE_KEY', '0x4AAAAAABNpvJayiqOm2i7m'),
            'JONBET_TURNSTILE_SITE_KEY' => env('JONBET_TURNSTILE_SITE_KEY', '0x4AAAAAABOYk0pSWlbHhm-u'),
            'HCAPTCHA_SERVICE_URL' => env('HCAPTCHA_SERVICE_URL', ''),
            'HCAPTCHA_SITE_KEY' => env('HCAPTCHA_SITE_KEY', ''),
            'MERCADOPAGO_ACCESS_TOKEN' => env('MERCADOPAGO_ACCESS_TOKEN', ''),
            'BOT_SECRET' => env('BOT_SECRET', ''),
            'TRIAL_HOURS' => env('TRIAL_HOURS', '1'),
            'TELEGRAM_API_ID' => env('TELEGRAM_API_ID', ''),
            'TELEGRAM_API_HASH' => env('TELEGRAM_API_HASH', ''),
        ];
        foreach ($map as $key => $val) {
            $val = is_string($val) ? trim($val) : '';
            if ($val === '') {
                continue;
            }
            $current = self::get($key, null);
            if ($current === null || $current === '') {
                self::set($key, $val);
            }
        }
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        $row = Database::fetch('SELECT `value` FROM system_config WHERE `key` = ?', [$key]);
        if (!$row) {
            // fallback .env (mesmo padrão do Node: env é fallback do banco)
            $fromEnv = env($key, null);
            if ($fromEnv !== null && $fromEnv !== '') {
                return (string) $fromEnv;
            }
            return $default;
        }
        $value = (string) $row['value'];
        if ($value === '') {
            $fromEnv = env($key, null);
            if ($fromEnv !== null && $fromEnv !== '') {
                return (string) $fromEnv;
            }
        }
        return $value !== '' ? $value : $default;
    }

    public static function set(string $key, string $value): void
    {
        $existing = Database::fetch('SELECT id FROM system_config WHERE `key` = ?', [$key]);
        if ($existing) {
            Database::update('system_config', ['value' => $value], '`key` = :k', ['k' => $key]);
        } else {
            Database::insert('system_config', ['key' => $key, 'value' => $value]);
        }
    }

    public static function all(): array
    {
        $rows = Database::fetchAll('SELECT `key`, `value` FROM system_config');
        $out = [];
        foreach ($rows as $r) {
            $out[$r['key']] = $r['value'];
        }
        return $out;
    }

    public static function emergencyStop(): bool
    {
        return self::get('EMERGENCY_STOP', 'false') === 'true';
    }

    public static function plans(): array
    {
        $raw = self::get('PLANS', '[]');
        $decoded = json_decode((string) $raw, true);
        return is_array($decoded) ? $decoded : [];
    }
}
