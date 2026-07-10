<?php

declare(strict_types=1);

namespace App\Models;

use App\Database;

final class UserRepository
{
    public static function find(int $id): ?array
    {
        return Database::fetch('SELECT * FROM users WHERE id = ?', [$id]);
    }

    public static function findByEmail(string $email): ?array
    {
        return Database::fetch('SELECT * FROM users WHERE email = ? LIMIT 1', [$email]);
    }

    public static function findAdminAccount(): ?array
    {
        return Database::fetch('SELECT * FROM users WHERE isAdminAccount = 1 LIMIT 1');
    }

    public static function findWithRelations(int $id): ?array
    {
        $user = self::find($id);
        if (!$user) {
            return null;
        }
        $user['settings'] = Database::fetch('SELECT * FROM settings WHERE ownerId = ?', [$id]);
        $user['variables'] = Database::fetch('SELECT * FROM variables WHERE ownerId = ?', [$id]);
        $user['jonbetSettings'] = Database::fetch('SELECT * FROM jonbet_settings WHERE ownerId = ?', [$id]);
        $user['jonbetVariables'] = Database::fetch('SELECT * FROM jonbet_variables WHERE ownerId = ?', [$id]);
        $user['strategies'] = Database::fetchAll('SELECT * FROM strategies WHERE ownerId = ?', [$id]);
        $user['bacBoSettings'] = Database::fetch('SELECT * FROM bacbo_settings WHERE ownerId = ?', [$id]);
        $user['bacBoVariables'] = Database::fetch('SELECT * FROM bacbo_variables WHERE ownerId = ?', [$id]);
        $user['bacBoStrategies'] = Database::fetchAll('SELECT * FROM bacbo_strategies WHERE ownerId = ?', [$id]);
        $user['telegramUserbot'] = Database::fetch('SELECT * FROM telegram_userbots WHERE ownerId = ?', [$id]);
        return $user;
    }

    public static function ensureDefaults(int $userId): void
    {
        if (!Database::fetch('SELECT id FROM settings WHERE ownerId = ?', [$userId])) {
            Database::insert('settings', [
                'ownerId' => $userId,
                'strategyType' => 'SEQUÊNCIA',
                'enterType' => 'VALOR',
                'enterValue' => 2,
                'stopGain' => '20',
                'stopLoss' => '10',
                'martingale' => 2,
                'martingaleMultiplier' => 2,
            ]);
        }
        if (!Database::fetch('SELECT id FROM variables WHERE ownerId = ?', [$userId])) {
            Database::insert('variables', ['ownerId' => $userId]);
        }
        if (!Database::fetch('SELECT id FROM jonbet_settings WHERE ownerId = ?', [$userId])) {
            Database::insert('jonbet_settings', [
                'ownerId' => $userId,
                'strategyType' => 'SEQUÊNCIA',
                'enterType' => 'VALOR',
                'enterValue' => 2,
                'stopGain' => '20',
                'stopLoss' => '10',
                'martingale' => 2,
                'martingaleMultiplier' => 2,
            ]);
        }
        if (!Database::fetch('SELECT id FROM jonbet_variables WHERE ownerId = ?', [$userId])) {
            Database::insert('jonbet_variables', ['ownerId' => $userId]);
        }
        if (!Database::fetch('SELECT id FROM bacbo_settings WHERE ownerId = ?', [$userId])) {
            Database::insert('bacbo_settings', [
                'ownerId' => $userId,
                'strategyType' => 'SEQUÊNCIA',
                'enterType' => 'VALOR',
                'enterValue' => 2,
                'stopGain' => '20',
                'stopLoss' => '10',
                'martingale' => 2,
                'martingaleMultiplier' => 2,
            ]);
        }
        if (!Database::fetch('SELECT id FROM bacbo_variables WHERE ownerId = ?', [$userId])) {
            Database::insert('bacbo_variables', ['ownerId' => $userId]);
        }
    }

    public static function create(array $data): int
    {
        $id = Database::insert('users', $data);
        self::ensureDefaults($id);
        return $id;
    }

    public static function update(int $id, array $data): void
    {
        if (!$data) {
            return;
        }
        Database::update('users', $data, 'id = :id', ['id' => $id]);
    }

    public static function all(int $limit = 500, int $offset = 0): array
    {
        return Database::fetchAll(
            'SELECT * FROM users ORDER BY id DESC LIMIT ' . (int) $limit . ' OFFSET ' . (int) $offset
        );
    }

    public static function count(): int
    {
        $row = Database::fetch('SELECT COUNT(*) AS c FROM users');
        return (int) ($row['c'] ?? 0);
    }

    public static function hasFeature(array $user, string $feature): bool
    {
        if (!empty($user['isAdminAccount'])) {
            return true;
        }
        $features = feature_list($user['features'] ?? null);
        if ($features === null) {
            return true; // usuários antigos sem restrição
        }
        return in_array($feature, $features, true);
    }

    public static function licenseOk(array $user): bool
    {
        if (!empty($user['isAdminAccount'])) {
            return true;
        }
        $expireOk = !empty($user['expireIn']) && strtotime((string) $user['expireIn']) > time();
        $paidOrTest = ($user['paymentStatus'] ?? '') === 'PAID' || !empty($user['isTesting']);
        return $expireOk && $paidOrTest;
    }

    public static function toPublic(array $user): array
    {
        unset($user['password'], $user['webPassword'], $user['token'], $user['jonbetPassword'], $user['jonbetToken'], $user['hashedToken']);
        // cast bools
        foreach ([
            'alreadyTested', 'connectPending', 'isActive', 'isTesting', 'isAdminAccount',
            'isBetting', 'jonbetConnectPending', 'jonbetIsActive', 'jonbetIsBetting',
        ] as $b) {
            if (array_key_exists($b, $user)) {
                $user[$b] = (bool) $user[$b];
            }
        }
        return $user;
    }
}
