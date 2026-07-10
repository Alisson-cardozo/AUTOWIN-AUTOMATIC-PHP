<?php

declare(strict_types=1);

namespace App\Services;

use App\Database;
use App\Models\ConfigRepository;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

/**
 * Port de lib/notify.ts — Web Push (VAPID) via minishlink/web-push.
 */
final class Notify
{
    private const EVENT_LABELS = [
        'entrada' => '🎯 Entrada',
        'win' => '✅ Win',
        'loss' => '❌ Loss',
        'stopWin' => '🏆 Stop Win',
        'stopLoss' => '🛑 Stop Loss',
    ];

    /** @return array{publicKey:string,privateKey:string}|null */
    private static function vapidConfig(): ?array
    {
        $public = ConfigRepository::get('VAPID_PUBLIC_KEY', '');
        $private = ConfigRepository::get('VAPID_PRIVATE_KEY', '');
        if (!$public || !$private) {
            return null;
        }
        return ['publicKey' => $public, 'privateKey' => $private];
    }

    public static function getVapidPublicKey(): ?string
    {
        return self::vapidConfig()['publicKey'] ?? null;
    }

    private static function sendPushToUser(int $userId, string $title, string $body): void
    {
        $vapid = self::vapidConfig();
        if (!$vapid) {
            return;
        }
        $subscriptions = Database::fetchAll('SELECT * FROM push_subscriptions WHERE ownerId = ?', [$userId]);
        if (!$subscriptions) {
            return;
        }

        $webPush = new WebPush([
            'VAPID' => [
                'subject' => 'mailto:contato@autowin.local',
                'publicKey' => $vapid['publicKey'],
                'privateKey' => $vapid['privateKey'],
            ],
        ]);

        $payload = json_encode(['title' => $title, 'body' => $body], JSON_UNESCAPED_UNICODE);

        foreach ($subscriptions as $sub) {
            $webPush->queueNotification(
                Subscription::create([
                    'endpoint' => $sub['endpoint'],
                    'publicKey' => $sub['p256dh'],
                    'authToken' => $sub['auth'],
                ]),
                $payload
            );
        }

        foreach ($webPush->flush() as $report) {
            if ($report->isSuccess()) {
                continue;
            }
            $statusCode = $report->getResponse()?->getStatusCode();
            // 404/410 = inscrição expirada/revogada pelo navegador — remove.
            if ($statusCode === 404 || $statusCode === 410) {
                Database::delete('push_subscriptions', 'endpoint = ?', [$report->getEndpoint()]);
            }
        }
    }

    /** Usado só pelo botão "Enviar teste" da tela de Notificações. */
    public static function sendTestNotification(int $userId): void
    {
        self::sendPushToUser(
            $userId,
            '🔔 Teste',
            'Notificação de teste do Autowin — se você recebeu isso, o navegador está configurado corretamente.'
        );
    }

    /** Aviso de pausa do sistema (Emergency Stop) — sempre envia, ignora notifyPrefs. */
    public static function notifySystemPause(int $userId, string $message): void
    {
        try {
            self::sendPushToUser($userId, '⏸️ Sistema Pausado', $message);
        } catch (\Throwable) {
        }
    }

    /** Aviso importante do admin — transmite pra todos os clientes. */
    public static function notifyAnnouncement(string $message): void
    {
        try {
            $users = Database::fetchAll('SELECT id FROM users');
            foreach ($users as $u) {
                try {
                    self::sendPushToUser((int) $u['id'], '📢 Aviso Importante', $message);
                } catch (\Throwable) {
                }
            }
        } catch (\Throwable) {
        }
    }

    /** Notificação de evento de rodada (entrada/win/loss/stopWin/stopLoss), respeitando notifyPrefs. */
    public static function notifyUser(int $userId, string $event, string $message): void
    {
        try {
            $user = Database::fetch('SELECT notifyPrefs FROM users WHERE id = ?', [$userId]);
            if (!$user) {
                return;
            }
            $prefs = $user['notifyPrefs'] ? json_decode((string) $user['notifyPrefs'], true) : [];
            if (!empty($prefs['browser'][$event])) {
                self::sendPushToUser($userId, self::EVENT_LABELS[$event] ?? $event, $message);
            }
        } catch (\Throwable) {
        }
    }
}
