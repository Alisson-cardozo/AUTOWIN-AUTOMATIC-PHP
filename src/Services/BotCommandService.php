<?php

declare(strict_types=1);

namespace App\Services;

use App\Database;

/**
 * IPC via MySQL entre o painel web e o worker de bots (processo longo).
 */
final class BotCommandService
{
    public static function enqueue(int $userId, string $action, string $platform = 'BLAZE', ?array $payload = null): int
    {
        return Database::insert('bot_commands', [
            'userId' => $userId,
            'platform' => $platform,
            'action' => $action,
            'payload' => $payload ? json_encode($payload, JSON_UNESCAPED_UNICODE) : null,
            'status' => 'pending',
            'createdAt' => now(),
        ]);
    }

    public static function pending(int $limit = 50): array
    {
        // Prioriza start/stop/refresh — connect com captcha não pode travar a fila
        return Database::fetchAll(
            "SELECT * FROM bot_commands WHERE status = 'pending'
             ORDER BY
               CASE action
                 WHEN 'stop' THEN 0
                 WHEN 'start' THEN 1
                 WHEN 'refresh-cache' THEN 2
                 ELSE 3
               END,
               id ASC
             LIMIT " . (int) $limit
        );
    }

    /** Marca connect/comandos presos (ex: captcha demorado) como error. */
    public static function expireStale(int $olderThanSeconds = 180): int
    {
        $cutoff = date('Y-m-d H:i:s', time() - $olderThanSeconds);
        $stmt = Database::query(
            "UPDATE bot_commands SET status = 'error', processedAt = ?
             WHERE status = 'pending' AND createdAt < ?
               AND action IN ('connect-blaze','connect-jonbet')",
            [now(), $cutoff]
        );
        return $stmt->rowCount();
    }

    public static function mark(int $id, string $status): void
    {
        Database::update('bot_commands', [
            'status' => $status,
            'processedAt' => now(),
        ], 'id = :id', ['id' => $id]);
    }

    public static function pushMessage(int $userId, string $message, string $platform = 'BLAZE', string $strategyType = ''): void
    {
        Database::insert('bot_messages', [
            'userId' => $userId,
            'platform' => $platform,
            'message' => $message,
            'strategyType' => $strategyType !== '' ? $strategyType : null,
            'createdAt' => now(),
        ]);
        // mantém só as últimas 300 mensagens por usuário (LogParser precisa
        // desse histórico pra reconstruir corretamente as entradas mescladas)
        Database::query(
            'DELETE FROM bot_messages WHERE userId = ? AND id NOT IN (
                SELECT id FROM (
                    SELECT id FROM bot_messages WHERE userId = ? ORDER BY id DESC LIMIT 300
                ) t
            )',
            [$userId, $userId]
        );
    }

    public static function history(int $userId, string $platform = 'BLAZE', int $limit = 300): array
    {
        return Database::fetchAll(
            'SELECT id, message, strategyType, createdAt FROM bot_messages WHERE userId = ? AND platform = ? ORDER BY id DESC LIMIT ' . (int) $limit,
            [$userId, $platform]
        );
    }

    public static function clearHistory(int $userId, string $platform = 'BLAZE'): void
    {
        Database::delete('bot_messages', 'userId = ? AND platform = ?', [$userId, $platform]);
    }
}
