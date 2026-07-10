<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\ConfigRepository;

final class MercadoPago
{
    public static function createPix(
        int $userId,
        float $amount,
        string $description,
        string $payerEmail,
        int $expirationMinutes = 30
    ): ?array {
        $token = ConfigRepository::get('MERCADOPAGO_ACCESS_TOKEN', '');
        if (!$token) {
            return null;
        }

        $client = new HttpClient('https://api.mercadopago.com', [
            'Authorization' => 'Bearer ' . $token,
            'Content-Type' => 'application/json',
            'X-Idempotency-Key' => $userId . '-' . time(),
        ]);

        $expires = (new \DateTimeImmutable('now'))
            ->modify("+{$expirationMinutes} minutes")
            ->format('c');

        $res = $client->post('/v1/payments', [
            'transaction_amount' => $amount,
            'description' => $description,
            'payment_method_id' => 'pix',
            'payer' => ['email' => $payerEmail],
            'date_of_expiration' => $expires,
            'metadata' => ['user_id' => $userId],
        ]);

        if (!$res['ok'] || !is_array($res['data'])) {
            log_msg('[mercadopago] create failed: ' . ($res['raw'] ?? ''), 'payments');
            return null;
        }

        $data = $res['data'];
        $td = $data['point_of_interaction']['transaction_data'] ?? [];
        return [
            'paymentId' => $data['id'] ?? null,
            'pixKey' => $td['qr_code'] ?? null,
            'qrCodeBase64' => $td['qr_code_base64'] ?? null,
            'amount' => $amount,
            'expiresAt' => $expires,
        ];
    }

    public static function getStatus(int|string $paymentId): ?string
    {
        $token = ConfigRepository::get('MERCADOPAGO_ACCESS_TOKEN', '');
        if (!$token) {
            return null;
        }
        $client = new HttpClient('https://api.mercadopago.com', [
            'Authorization' => 'Bearer ' . $token,
        ]);
        $res = $client->get('/v1/payments/' . $paymentId);
        if (!$res['ok'] || !is_array($res['data'])) {
            return null;
        }
        return $res['data']['status'] ?? null;
    }
}
