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
        $user['bacBoLiveSettings'] = Database::fetch('SELECT * FROM bacbo_live_settings WHERE ownerId = ?', [$id]);
        $user['bacBoLiveVariables'] = Database::fetch('SELECT * FROM bacbo_live_variables WHERE ownerId = ?', [$id]);
        $user['bacBoLiveStrategies'] = Database::fetchAll('SELECT * FROM bacbo_live_strategies WHERE ownerId = ?', [$id]);
        $user['telegramUserbot'] = Database::fetch('SELECT * FROM telegram_userbots WHERE ownerId = ?', [$id]);
        try {
            $user['daytradeSettings'] = Database::fetch('SELECT * FROM daytrade_settings WHERE ownerId = ?', [$id]);
            $user['daytradeVariables'] = Database::fetch('SELECT * FROM daytrade_variables WHERE ownerId = ?', [$id]);
            $user['daytradeStrategies'] = Database::fetchAll('SELECT * FROM daytrade_strategies WHERE ownerId = ?', [$id]);
        } catch (\Throwable) {
            $user['daytradeSettings'] = null;
            $user['daytradeVariables'] = null;
            $user['daytradeStrategies'] = [];
        }
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
            Database::insert('bacbo_variables', [
                'ownerId' => $userId,
                'balance' => 1000,
                'firstBalance' => 1000,
                'monthStartBalance' => 1000,
                'firstBalanceDate' => now(),
                'monthStartDate' => now(),
            ]);
        }
        if (!Database::fetch('SELECT id FROM bacbo_live_settings WHERE ownerId = ?', [$userId])) {
            Database::insert('bacbo_live_settings', [
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
        if (!Database::fetch('SELECT id FROM bacbo_live_variables WHERE ownerId = ?', [$userId])) {
            Database::insert('bacbo_live_variables', [
                'ownerId' => $userId,
                'balance' => 1000,
                'firstBalance' => 1000,
                'monthStartBalance' => 1000,
                'firstBalanceDate' => now(),
                'monthStartDate' => now(),
            ]);
        }
        self::ensureDayTradeDefaults($userId);
    }

    /** Tabelas + defaults Day Trade / IQ Option (cria schema se faltar). */
    public static function ensureDayTradeDefaults(int $userId): void
    {
        self::ensureDayTradeSchema();
        try {
            if (!Database::fetch('SELECT id FROM daytrade_settings WHERE ownerId = ?', [$userId])) {
                Database::insert('daytrade_settings', [
                    'ownerId' => $userId,
                    'strategyType' => 'HORÁRIOS',
                    'enterType' => 'VALOR',
                    'enterValue' => 2,
                    'stopGain' => '20',
                    'stopLoss' => '10',
                    'martingale' => 1,
                    'martingaleMultiplier' => 2,
                    'expirationMinutes' => 1,
                    'minPayout' => 70,
                    'defaultAsset' => 'EURUSD-OTC',
                    'quantityCycles' => 1,
                ]);
            }
            if (!Database::fetch('SELECT id FROM daytrade_variables WHERE ownerId = ?', [$userId])) {
                Database::insert('daytrade_variables', [
                    'ownerId' => $userId,
                    'balance' => 10000,
                    'firstBalance' => 10000,
                    'monthStartBalance' => 10000,
                    'firstBalanceDate' => now(),
                    'monthStartDate' => now(),
                ]);
            }
        } catch (\Throwable $e) {
            log_msg('[daytrade] ensureDefaults: ' . $e->getMessage(), 'daytrade');
        }
    }

    public static function ensureDayTradeSchema(): void
    {
        static $done = false;
        if ($done) {
            return;
        }
        $done = true;
        $cols = [
            'iqEmail' => "VARCHAR(200) NULL",
            'iqPassword' => "VARCHAR(255) NULL",
            'iqSsid' => "TEXT NULL",
            'iqBalanceId' => "BIGINT NULL",
            'iqAccountType' => "VARCHAR(10) NOT NULL DEFAULT 'DEMO'",
            'daytradeIsActive' => "TINYINT(1) NOT NULL DEFAULT 0",
            'daytradeIsBetting' => "TINYINT(1) NOT NULL DEFAULT 0",
            'daytradeConnectPending' => "TINYINT(1) NOT NULL DEFAULT 0",
            'daytradeConnectError' => "TEXT NULL",
        ];
        foreach ($cols as $name => $def) {
            try {
                $row = Database::fetch("SHOW COLUMNS FROM users LIKE '{$name}'");
                if (!$row) {
                    Database::query("ALTER TABLE users ADD COLUMN `{$name}` {$def}");
                }
            } catch (\Throwable) {
            }
        }
        // multi-ativos: defaultAsset guarda CSV (ex: EURUSD-OTC,GBPUSD-OTC)
        try {
            $col = Database::fetch("SHOW COLUMNS FROM daytrade_settings LIKE 'defaultAsset'");
            if ($col && stripos((string) ($col['Type'] ?? ''), 'varchar(50)') !== false) {
                Database::query("ALTER TABLE `daytrade_settings` MODIFY COLUMN `defaultAsset` VARCHAR(500) NOT NULL DEFAULT 'EURUSD-OTC'");
            }
        } catch (\Throwable) {
        }
        // asset da estratégia: lista CSV de vários pares em 1 card
        try {
            $col = Database::fetch("SHOW COLUMNS FROM daytrade_strategies LIKE 'asset'");
            if ($col && stripos((string) ($col['Type'] ?? ''), 'varchar') !== false) {
                Database::query("ALTER TABLE `daytrade_strategies` MODIFY COLUMN `asset` TEXT NOT NULL");
            }
        } catch (\Throwable) {
        }

        $sqls = [
            "CREATE TABLE IF NOT EXISTS `daytrade_settings` (
              `id` INT NOT NULL AUTO_INCREMENT,
              `ownerId` INT NOT NULL,
              `strategyType` VARCHAR(50) NOT NULL DEFAULT 'HORÁRIOS',
              `enterType` VARCHAR(20) NOT NULL DEFAULT 'VALOR',
              `enterValue` DOUBLE NOT NULL DEFAULT 1,
              `enterPercent` DOUBLE NOT NULL DEFAULT 1,
              `stopType` VARCHAR(20) NOT NULL DEFAULT 'VALOR',
              `stopGain` VARCHAR(20) NOT NULL DEFAULT '20',
              `stopLoss` VARCHAR(20) NOT NULL DEFAULT '10',
              `martingale` INT NOT NULL DEFAULT 1,
              `martingaleMultiplier` DOUBLE NOT NULL DEFAULT 2,
              `expirationMinutes` INT NOT NULL DEFAULT 1,
              `minPayout` DOUBLE NOT NULL DEFAULT 70,
              `defaultAsset` VARCHAR(500) NOT NULL DEFAULT 'EURUSD-OTC',
              `quantityCycles` INT NOT NULL DEFAULT 1,
              `skipFirstEntry` TINYINT(1) NOT NULL DEFAULT 0,
              `skipEntryAfterLoss` TINYINT(1) NOT NULL DEFAULT 0,
              PRIMARY KEY (`id`),
              UNIQUE KEY `daytrade_settings_ownerId_unique` (`ownerId`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
            "CREATE TABLE IF NOT EXISTS `daytrade_variables` (
              `id` INT NOT NULL AUTO_INCREMENT,
              `ownerId` INT NOT NULL,
              `balance` DOUBLE NOT NULL DEFAULT 10000,
              `firstBalance` DOUBLE NOT NULL DEFAULT 10000,
              `profit` DOUBLE NOT NULL DEFAULT 0,
              `countWin` INT NOT NULL DEFAULT 0,
              `countLoss` INT NOT NULL DEFAULT 0,
              `countMartingale` INT NOT NULL DEFAULT 0,
              `isGale` TINYINT(1) NOT NULL DEFAULT 0,
              `monthCountWin` INT NOT NULL DEFAULT 0,
              `monthCountLoss` INT NOT NULL DEFAULT 0,
              `monthStartBalance` DOUBLE NOT NULL DEFAULT 10000,
              `firstBalanceDate` DATETIME NULL,
              `monthStartDate` DATETIME NULL,
              `firstBalanceMode` VARCHAR(10) NULL,
              `lastDirection` VARCHAR(10) NULL,
              `lastAsset` VARCHAR(50) NULL,
              PRIMARY KEY (`id`),
              UNIQUE KEY `daytrade_variables_ownerId_unique` (`ownerId`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
            "CREATE TABLE IF NOT EXISTS `daytrade_strategies` (
              `id` INT NOT NULL AUTO_INCREMENT,
              `ownerId` INT NOT NULL,
              `strategyType` VARCHAR(50) NOT NULL DEFAULT 'HORÁRIOS',
              `sequence` VARCHAR(200) NOT NULL,
              `color` VARCHAR(50) NOT NULL DEFAULT 'CALL',
              `asset` TEXT NOT NULL,
              `expirationMinutes` INT NOT NULL DEFAULT 1,
              `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`),
              KEY `daytrade_strategies_owner_idx` (`ownerId`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
            "CREATE TABLE IF NOT EXISTS `daytrade_entries` (
              `id` INT NOT NULL AUTO_INCREMENT,
              `ownerId` INT NOT NULL,
              `type` VARCHAR(30) NOT NULL,
              `asset` VARCHAR(50) NULL,
              `direction` VARCHAR(10) NULL,
              `amount` DOUBLE NULL,
              `expiration` INT NULL,
              `result` VARCHAR(20) NULL,
              `profit` DOUBLE NULL,
              `pattern` VARCHAR(200) NULL,
              `mode` VARCHAR(10) NULL,
              `externalId` VARCHAR(80) NULL,
              `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`),
              KEY `daytrade_entries_owner_idx` (`ownerId`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        ];
        foreach ($sqls as $sql) {
            try {
                Database::query($sql);
            } catch (\Throwable) {
            }
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
