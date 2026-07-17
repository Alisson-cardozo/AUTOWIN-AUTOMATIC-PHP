<?php

declare(strict_types=1);

namespace App\Auth;

use App\Database;
use App\Models\UserRepository;

final class Auth
{
    /** Admin id elevado nesta request (cookie ainda não está em $_COOKIE). */
    private static ?int $elevatedAdminId = null;

    public static function userId(): ?int
    {
        $token = cookie(Token::userCookieName());
        if (!$token) {
            return null;
        }
        return Token::verifyUserToken($token);
    }

    public static function user(): ?array
    {
        $id = self::userId();
        if (!$id) {
            return null;
        }
        return UserRepository::findWithRelations($id);
    }

    public static function requireUser(): array
    {
        $user = self::user();
        if (!$user) {
            json_response(['error' => 'Não autorizado'], 401);
        }
        return $user;
    }

    public static function requireUserId(): int
    {
        $id = self::userId();
        if (!$id) {
            json_response(['error' => 'Não autorizado'], 401);
        }
        return $id;
    }

    /**
     * Identidade a partir de um token de dispositivo (app Android, motor de
     * aposta local) — independente da sessão web (cookie). Revogável por
     * aparelho (device_tokens.revokedAt) sem afetar o login no navegador.
     */
    public static function userIdFromDeviceToken(string $token): ?int
    {
        $token = trim($token);
        if ($token === '') {
            return null;
        }
        $hash = hash('sha256', $token);
        $row = Database::fetch(
            'SELECT id, ownerId FROM device_tokens WHERE tokenHash = ? AND revokedAt IS NULL',
            [$hash]
        );
        if (!$row) {
            return null;
        }
        Database::update('device_tokens', ['lastSeenAt' => now()], 'id = ?', [$row['id']]);
        return (int) $row['ownerId'];
    }

    /**
     * Autentica por cookie (navegador) OU header "Authorization: Bearer
     * <deviceToken>" (chamadas nativas do app Android / browser bridge) —
     * usado pelas rotas de bridge que tanto o site quanto o app podem chamar.
     *
     * @param  array<string, string>  $errorHeaders  ex.: CORS do bridge
     */
    public static function requireUserIdFromCookieOrDevice(array $errorHeaders = []): int
    {
        $viaCookie = self::userId();
        if ($viaCookie) {
            return $viaCookie;
        }
        // Alguns proxies/hosts só expõem o bearer em REDIRECT_HTTP_AUTHORIZATION
        $header = $_SERVER['HTTP_AUTHORIZATION']
            ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
            ?? '';
        if (is_string($header) && preg_match('/^Bearer\s+(\S+)$/i', $header, $m)) {
            $viaDevice = self::userIdFromDeviceToken($m[1]);
            if ($viaDevice) {
                return $viaDevice;
            }
        }
        json_response(['error' => 'Não autorizado'], 401, $errorHeaders);
        return 0; // json_response() encerra a request; nunca chega aqui.
    }

    public static function adminId(): ?int
    {
        if (self::$elevatedAdminId !== null) {
            return self::$elevatedAdminId;
        }
        $token = cookie(Token::adminCookieName());
        if (!$token) {
            return null;
        }
        return Token::verifyAdminToken($token);
    }

    public static function admin(): ?array
    {
        $id = self::adminId();
        if (!$id) {
            return null;
        }
        return Database::fetch('SELECT * FROM admin_users WHERE id = ?', [$id]);
    }

    /**
     * Garante cookie de admin quando o usuário logado é a conta isAdminAccount
     * (portal do cliente). Sem isso, /dashboard redireciona pro login e parece
     * que "saiu" do acesso — o botão Painel Admin só tinha sessão de usuário.
     */
    public static function ensureAdminSession(): bool
    {
        if (self::adminId()) {
            return true;
        }

        $userId = self::userId();
        if (!$userId) {
            return false;
        }

        $user = UserRepository::find($userId);
        if (!$user || empty($user['isAdminAccount'])) {
            return false;
        }

        // Preferência: admin_users com o mesmo email da conta
        $admin = null;
        if (!empty($user['email'])) {
            $admin = Database::fetch(
                'SELECT * FROM admin_users WHERE email = ? LIMIT 1',
                [(string) $user['email']]
            );
        }
        // Fallback: primeiro admin cadastrado
        if (!$admin) {
            $admin = Database::fetch('SELECT * FROM admin_users ORDER BY id ASC LIMIT 1');
        }
        if (!$admin) {
            return false;
        }

        self::loginAdmin((int) $admin['id']);
        return true;
    }

    public static function requireAdmin(): array
    {
        self::ensureAdminSession();
        $admin = self::admin();
        if (!$admin) {
            json_response(['error' => 'Não autorizado'], 401);
        }
        return $admin;
    }

    public static function loginUser(int $userId): void
    {
        $token = Token::createUserToken($userId);
        set_cookie(Token::userCookieName(), $token, Token::ttlSeconds());
    }

    public static function loginAdmin(int $adminId): void
    {
        self::$elevatedAdminId = $adminId;
        $token = Token::createAdminToken($adminId);
        set_cookie(Token::adminCookieName(), $token, Token::ttlSeconds());
        // Disponível já nesta request (setcookie só manda no response)
        $_COOKIE[Token::adminCookieName()] = $token;
    }

    public static function logoutUser(): void
    {
        clear_cookie(Token::userCookieName());
    }

    public static function logoutAdmin(): void
    {
        self::$elevatedAdminId = null;
        clear_cookie(Token::adminCookieName());
    }
}
