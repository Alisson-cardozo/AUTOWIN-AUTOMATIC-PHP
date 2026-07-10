<?php

declare(strict_types=1);

namespace App\Bot;

use App\Database;

/**
 * Shared BLAZE/JONBET field + settings/variables helpers used by game engines.
 */
trait PlatformContext
{
    protected string $platform = 'BLAZE';
    protected int $userId = 0;

    protected function pf(string $field): string
    {
        if ($this->platform !== 'JONBET') {
            return $field;
        }
        return 'jonbet' . ucfirst($field);
    }

    protected function uf(array $user, string $field): mixed
    {
        return $user[$this->pf($field)] ?? null;
    }

    protected function varsTable(): string
    {
        return $this->platform === 'JONBET' ? 'jonbet_variables' : 'variables';
    }

    protected function settingsTable(): string
    {
        return $this->platform === 'JONBET' ? 'jonbet_settings' : 'settings';
    }

    protected function getVars(): ?array
    {
        return Database::fetch(
            'SELECT * FROM `' . $this->varsTable() . '` WHERE ownerId = ? LIMIT 1',
            [$this->userId]
        );
    }

    protected function getSettingsRow(): ?array
    {
        return Database::fetch(
            'SELECT * FROM `' . $this->settingsTable() . '` WHERE ownerId = ? LIMIT 1',
            [$this->userId]
        );
    }

    protected function updateVars(array $data): void
    {
        $sets = [];
        $params = ['ownerId' => $this->userId];
        foreach ($data as $k => $v) {
            if (is_array($v) && isset($v['increment'])) {
                $sets[] = "`$k` = `$k` + :" . $k;
                $params[$k] = (int) $v['increment'];
            } else {
                $sets[] = "`$k` = :$k";
                $params[$k] = $v;
            }
        }
        if (!$sets) {
            return;
        }
        Database::query(
            'UPDATE `' . $this->varsTable() . '` SET ' . implode(', ', $sets) . ' WHERE ownerId = :ownerId',
            $params
        );
    }

    protected function ensureVars(array $data): void
    {
        $existing = $this->getVars();
        if ($existing) {
            $this->updateVars($data);
            return;
        }
        $data['ownerId'] = $this->userId;
        Database::insert($this->varsTable(), $data);
    }

    protected function updateUserFields(array $data): void
    {
        $mapped = [];
        foreach ($data as $k => $v) {
            $mapped[$this->pf($k)] = $v;
        }
        Database::update('users', $mapped, 'id = :id', ['id' => $this->userId]);
    }

    protected function loadUser(): ?array
    {
        return Database::fetch('SELECT * FROM users WHERE id = ? LIMIT 1', [$this->userId]);
    }

    protected function isLicenseExpired(?array $u): bool
    {
        if (!$u) {
            return true;
        }
        if (!empty($u['isAdminAccount'])) {
            return false;
        }
        $hasValidExpiry = !empty($u['expireIn']) && strtotime((string) $u['expireIn']) > time();
        $ok = $hasValidExpiry && (
            ($u['paymentStatus'] ?? '') === 'PAID' || !empty($u['isTesting'])
        );
        return !$ok;
    }

    protected function createBotEntry(array $data): void
    {
        try {
            $row = array_merge([
                'platform' => $this->platform,
                'ownerId' => $this->userId,
                'createdAt' => now(),
            ], $data);
            Database::insert('bot_entries', $row);
        } catch (\Throwable) {
        }
    }

    protected function nowMs(): float
    {
        return microtime(true) * 1000;
    }
}
