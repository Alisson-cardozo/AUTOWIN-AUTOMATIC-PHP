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
