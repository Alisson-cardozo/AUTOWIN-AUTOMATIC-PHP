<?php

declare(strict_types=1);

namespace App;

final class Bootstrap
{
    public static function init(): void
    {
        self::loadEnv(base_path('.env'));

        $tz = (string) env('APP_TIMEZONE', 'America/Sao_Paulo');
        date_default_timezone_set($tz);

        if (env('APP_DEBUG', true)) {
            error_reporting(E_ALL);
            ini_set('display_errors', '1');
        } else {
            error_reporting(E_ALL & ~E_NOTICE & ~E_DEPRECATED);
            ini_set('display_errors', '0');
        }

        if (session_status() === PHP_SESSION_NONE) {
            session_name((string) env('SESSION_NAME', 'autowin_session'));
            session_start([
                'cookie_httponly' => true,
                'cookie_samesite' => 'Lax',
            ]);
        }

        // Propaga chaves de API do .env → system_config (se vazias)
        try {
            \App\Models\ConfigRepository::seedFromEnv();
        } catch (\Throwable $e) {
            // banco ainda não migrado — ok
        }
    }

    private static function loadEnv(string $path): void
    {
        if (!is_file($path)) {
            return;
        }
        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
                continue;
            }
            [$key, $value] = explode('=', $line, 2);
            $key = trim($key);
            $value = trim($value);
            if (
                (str_starts_with($value, '"') && str_ends_with($value, '"')) ||
                (str_starts_with($value, "'") && str_ends_with($value, "'"))
            ) {
                $value = substr($value, 1, -1);
            }
            $_ENV[$key] = $value;
            $_SERVER[$key] = $value;
            putenv("$key=$value");
        }
    }
}
