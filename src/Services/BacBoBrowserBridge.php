<?php

declare(strict_types=1);

namespace App\Services;

use App\Database;

/**
 * Aposta REAL de Bac Bo via navegador do cliente — reaproveita a conexão
 * WebSocket já aberta e autenticada na Evolution (aberta pelo próprio
 * navegador ao entrar no jogo, já passou pela checagem de IP da Akamai),
 * em vez de a VPS tentar abrir uma conexão nova (sempre bloqueada).
 *
 * Fluxo:
 *   1) Engine grava um pedido de aposta (status=pending)
 *   2) Script no navegador do cliente dá poll em /api/user/bacbo-bridge/poll,
 *      pega o pedido (status=sent) e manda a aposta pela conexão real dele
 *   3) Navegador reporta o resultado em /api/user/bacbo-bridge/result
 *   4) Engine (aqui) fica esperando (poll no banco) até confirmar ou expirar
 */
final class BacBoBrowserBridge
{
    private const POLL_INTERVAL_US = 500_000; // 0.5s

    /** Janela de tolerância pro heartbeat do poll (script roda a cada 2s no navegador). */
    private const HEARTBEAT_WINDOW_SECONDS = 10;

    /** Janela de tolerância pro dispositivo pareado (app Android faz poll a cada 2s). */
    private const DEVICE_WINDOW_SECONDS = 30;

    /**
     * Existe um bridge ativo agora pra esse usuário — seja o app Android
     * pareado (device_tokens), seja uma aba de navegador com
     * public/bacbo-bridge.js rodando e dando poll de verdade
     * (bacbo_bridge_heartbeat)? Qualquer um dos dois conta.
     */
    public static function deviceConnected(int $userId): bool
    {
        $device = Database::fetch(
            "SELECT id FROM device_tokens WHERE ownerId = ? AND revokedAt IS NULL "
            . "AND lastSeenAt IS NOT NULL AND lastSeenAt >= (NOW() - INTERVAL " . self::DEVICE_WINDOW_SECONDS . " SECOND) "
            . "LIMIT 1",
            [$userId]
        );
        if ($device) {
            return true;
        }

        $browser = Database::fetch(
            "SELECT ownerId FROM bacbo_bridge_heartbeat WHERE ownerId = ? "
            . "AND lastPollAt >= (NOW() - INTERVAL " . self::HEARTBEAT_WINDOW_SECONDS . " SECOND) LIMIT 1",
            [$userId]
        );
        return (bool) $browser;
    }

    /**
     * Marca que o navegador do usuário acabou de dar poll — chamado em TODA
     * chamada de /api/user/bacbo-bridge/poll, tenha ou não aposta pendente,
     * pra deviceConnected() saber que a aba está viva agora.
     */
    public static function recordPoll(int $userId): void
    {
        $exists = Database::fetch('SELECT ownerId FROM bacbo_bridge_heartbeat WHERE ownerId = ?', [$userId]);
        if ($exists) {
            Database::update('bacbo_bridge_heartbeat', ['lastPollAt' => now()], 'ownerId = ?', [$userId]);
            return;
        }
        Database::insert('bacbo_bridge_heartbeat', ['ownerId' => $userId, 'lastPollAt' => now()]);
    }

    /**
     * Status do canal de aposta REAL (browser bridge e/ou app Android).
     *
     * @return array{
     *   ready: bool,
     *   browserOnline: bool,
     *   deviceOnline: bool,
     *   lastBrowserPollAt: ?string,
     *   lastDeviceSeenAt: ?string
     * }
     */
    public static function status(int $userId): array
    {
        $hb = Database::fetch(
            'SELECT lastPollAt FROM bacbo_bridge_heartbeat WHERE ownerId = ?',
            [$userId]
        );
        $lastBrowser = $hb['lastPollAt'] ?? null;
        $browserOnline = $lastBrowser !== null
            && strtotime((string) $lastBrowser) >= time() - self::HEARTBEAT_WINDOW_SECONDS;

        $dev = Database::fetch(
            "SELECT lastSeenAt FROM device_tokens WHERE ownerId = ? AND revokedAt IS NULL "
            . "AND lastSeenAt IS NOT NULL ORDER BY lastSeenAt DESC LIMIT 1",
            [$userId]
        );
        $lastDevice = $dev['lastSeenAt'] ?? null;
        $deviceOnline = $lastDevice !== null
            && strtotime((string) $lastDevice) >= time() - self::DEVICE_WINDOW_SECONDS;

        return [
            'ready' => $browserOnline || $deviceOnline,
            'browserOnline' => $browserOnline,
            'deviceOnline' => $deviceOnline,
            'lastBrowserPollAt' => $lastBrowser ? (string) $lastBrowser : null,
            'lastDeviceSeenAt' => $lastDevice ? (string) $lastDevice : null,
        ];
    }

    /**
     * @return array<string, mixed> mesmo formato de EvolutionBacBo::placeBet()
     */
    public static function placeBet(
        int $userId,
        string $spot,
        float $amount,
        float $protectionAmount,
        int $timeoutMs = 60000
    ): array {
        $id = Database::insert('bacbo_bridge_bets', [
            'userId' => $userId,
            'spot' => strtoupper($spot),
            'amount' => $amount,
            'protectionAmount' => $protectionAmount,
            'status' => 'pending',
        ]);

        $deadline = microtime(true) + ($timeoutMs / 1000);
        while (microtime(true) < $deadline) {
            usleep(self::POLL_INTERVAL_US);
            $row = Database::fetch('SELECT * FROM bacbo_bridge_bets WHERE id = ?', [$id]);
            if (!$row) {
                return ['ok' => false, 'error' => 'Pedido de aposta sumiu (bridge).'];
            }
            $status = (string) $row['status'];
            if ($status === 'confirmed' || $status === 'failed') {
                $result = json_decode((string) ($row['resultJson'] ?? ''), true);
                return is_array($result) ? $result : ['ok' => $status === 'confirmed'];
            }
        }

        Database::update('bacbo_bridge_bets', ['status' => 'timeout', 'updatedAt' => now()], 'id = ?', [$id]);
        return [
            'ok' => false,
            'error' => 'Timeout esperando o navegador do cliente confirmar a aposta REAL (bridge). '
                . 'O cliente precisa estar com o Bac Bo aberto no navegador e o script de bridge ativo.',
        ];
    }

    /**
     * Pega o pedido pendente mais antigo do usuário e marca como "sent".
     *
     * @return array<string, mixed>|null
     */
    public static function nextPending(int $userId): ?array
    {
        $row = Database::fetch(
            "SELECT * FROM bacbo_bridge_bets WHERE userId = ? AND status = 'pending' ORDER BY id ASC LIMIT 1",
            [$userId]
        );
        if (!$row) {
            return null;
        }
        Database::update('bacbo_bridge_bets', ['status' => 'sent', 'updatedAt' => now()], 'id = ?', [$row['id']]);
        return $row;
    }

    /**
     * @param array<string, mixed> $result
     */
    public static function reportResult(int $userId, int $betId, bool $ok, array $result): bool
    {
        $row = Database::fetch('SELECT id FROM bacbo_bridge_bets WHERE id = ? AND userId = ?', [$betId, $userId]);
        if (!$row) {
            return false;
        }
        Database::update('bacbo_bridge_bets', [
            'status' => $ok ? 'confirmed' : 'failed',
            'resultJson' => json_encode($result, JSON_UNESCAPED_UNICODE),
            'updatedAt' => now(),
        ], 'id = ?', [$betId]);
        return true;
    }
}
