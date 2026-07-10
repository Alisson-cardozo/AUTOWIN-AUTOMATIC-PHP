<?php

declare(strict_types=1);

namespace App\Auth;

final class Token
{
    private const TTL_MS = 90 * 24 * 60 * 60 * 1000;

    public static function createUserToken(int $userId): string
    {
        $secret = (string) env('APP_SECRET', 'secret');
        $payload = b64url_encode(json_encode([
            'userId' => $userId,
            'exp' => (int) (microtime(true) * 1000) + self::TTL_MS,
        ], JSON_THROW_ON_ERROR));
        $sig = self::sign($secret, $payload);
        return $payload . '.' . $sig;
    }

    public static function verifyUserToken(string $token): ?int
    {
        $secret = (string) env('APP_SECRET', 'secret');
        $dot = strrpos($token, '.');
        if ($dot === false) {
            return null;
        }
        $payload = substr($token, 0, $dot);
        $sig = substr($token, $dot + 1);
        if (!hash_equals(self::sign($secret, $payload), $sig)) {
            return null;
        }
        $json = b64url_decode($payload);
        if ($json === false) {
            return null;
        }
        $data = json_decode($json, true);
        if (!is_array($data) || !isset($data['userId'], $data['exp'])) {
            return null;
        }
        if ((int) $data['exp'] < (int) (microtime(true) * 1000)) {
            return null;
        }
        return (int) $data['userId'];
    }

    public static function createAdminToken(int $adminId): string
    {
        $secret = (string) env('APP_SECRET', 'secret');
        $payload = b64url_encode(json_encode([
            'adminId' => $adminId,
            'exp' => (int) (microtime(true) * 1000) + self::TTL_MS,
        ], JSON_THROW_ON_ERROR));
        return $payload . '.' . self::sign($secret, $payload);
    }

    public static function verifyAdminToken(string $token): ?int
    {
        $secret = (string) env('APP_SECRET', 'secret');
        $dot = strrpos($token, '.');
        if ($dot === false) {
            return null;
        }
        $payload = substr($token, 0, $dot);
        $sig = substr($token, $dot + 1);
        if (!hash_equals(self::sign($secret, $payload), $sig)) {
            return null;
        }
        $json = b64url_decode($payload);
        if ($json === false) {
            return null;
        }
        $data = json_decode($json, true);
        if (!is_array($data) || !isset($data['adminId'], $data['exp'])) {
            return null;
        }
        if ((int) $data['exp'] < (int) (microtime(true) * 1000)) {
            return null;
        }
        return (int) $data['adminId'];
    }

    public static function userCookieName(): string
    {
        return (string) env('USER_COOKIE', 'user_session');
    }

    public static function adminCookieName(): string
    {
        return (string) env('ADMIN_COOKIE', 'admin_session');
    }

    public static function ttlSeconds(): int
    {
        return (int) (self::TTL_MS / 1000);
    }

    private static function sign(string $secret, string $data): string
    {
        return b64url_encode(hash_hmac('sha256', $data, $secret, true));
    }
}
