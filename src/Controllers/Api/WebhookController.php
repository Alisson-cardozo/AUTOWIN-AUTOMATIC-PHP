<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Database;
use App\Models\ConfigRepository;
use App\Models\UserRepository;

final class WebhookController
{
    public function payment(): void
    {
        $body = request_json();
        if (!$body) {
            $body = $_POST;
        }
        $engine = ConfigRepository::get('PAYMENT_ENGINE', 'mercadopago') ?: 'mercadopago';

        try {
            if ($engine === 'mercadopago') {
                $this->handleMercadoPago($body);
            } elseif ($engine === 'hotmart') {
                $this->handleHotmart($body);
            } elseif ($engine === 'kiwify') {
                $this->handleKiwify($body);
            }
        } catch (\Throwable $e) {
            log_msg('[webhook] ' . $e->getMessage(), 'payments');
        }

        json_response(['received' => true]);
    }

    private function handleMercadoPago(array $body): void
    {
        if (($body['type'] ?? '') !== 'payment') {
            // alguns webhooks enviam action=payment.updated
            if (!isset($body['data']['id']) && !isset($body['id'])) {
                return;
            }
        }
        $paymentId = $body['data']['id'] ?? $body['id'] ?? null;
        if (!$paymentId) {
            return;
        }
        $user = Database::fetch('SELECT * FROM users WHERE paymentId = ? LIMIT 1', [$paymentId]);
        if (!$user) {
            return;
        }
        $days = (int) ($user['paymentExpireIn'] ?: 30);
        UserRepository::update((int) $user['id'], [
            'paymentStatus' => 'PAID',
            'expireIn' => date('Y-m-d H:i:s', strtotime("+{$days} days")),
            'features' => $user['pendingFeatures'],
            'pendingFeatures' => null,
            'isTesting' => 0,
        ]);
    }

    private function handleHotmart(array $body): void
    {
        if (($body['event'] ?? '') !== 'PURCHASE_APPROVED') {
            return;
        }
        $email = $body['data']['buyer']['email'] ?? null;
        if (!$email) {
            return;
        }
        $user = UserRepository::findByEmail((string) $email);
        if (!$user) {
            return;
        }
        UserRepository::update((int) $user['id'], [
            'paymentStatus' => 'PAID',
            'expireIn' => date('Y-m-d H:i:s', strtotime('+30 days')),
        ]);
    }

    private function handleKiwify(array $body): void
    {
        if (($body['order_status'] ?? '') !== 'paid') {
            return;
        }
        $email = $body['Customer']['email'] ?? null;
        if (!$email) {
            return;
        }
        $user = UserRepository::findByEmail((string) $email);
        if (!$user) {
            return;
        }
        UserRepository::update((int) $user['id'], [
            'paymentStatus' => 'PAID',
            'expireIn' => date('Y-m-d H:i:s', strtotime('+30 days')),
        ]);
    }

    /** Cor dos números vermelhos da roleta europeia — igual ao webhook Next.js. */
    private const ROULETTE_RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

    public function bacbo(): void
    {
        $body = request_json();
        // Suporta tanto o payload cru do "bacbo.playerState" (args.game) quanto um envio simplificado
        $game = $body['args']['game'] ?? $body;

        $dice = is_array($game['dice'] ?? null) ? $game['dice'] : [];
        if (empty($game['id']) || count($dice) < 4) {
            json_response(['error' => 'Dados inválidos do Bac Bo'], 400);
        }

        // Só processa no estágio de Confirmação (resultado final) quando vier o payload cru
        if (isset($body['args']['game']) && ($game['stage'] ?? null) !== 'Confirmation') {
            json_response(['success' => true, 'message' => 'Ignorado (estágio não é Confirmação)']);
        }

        $diceValue = static function (array $dice, int $id): int {
            foreach ($dice as $d) {
                if ((int) ($d['id'] ?? 0) === $id) {
                    return (int) ($d['value'] ?? 0);
                }
            }
            return 0;
        };
        $d1 = $diceValue($dice, 1);
        $d2 = $diceValue($dice, 2);
        $d3 = $diceValue($dice, 3);
        $d4 = $diceValue($dice, 4);

        $playerTotal = $d1 + $d2;
        $bankerTotal = $d3 + $d4;
        $pScore = $playerTotal % 10;
        $bScore = $bankerTotal % 10;
        $winner = $pScore > $bScore ? 'PlayerWon' : ($bScore > $pScore ? 'BankerWon' : 'Tie');

        $externalId = (string) $game['id'];
        $existing = Database::fetch('SELECT id FROM bacbo_results WHERE externalId = ?', [$externalId]);
        if ($existing) {
            json_response(['ok' => true, 'duplicate' => true]);
        }
        Database::insert('bacbo_results', [
            'externalId' => $externalId,
            'winner' => $winner,
            'playerTotal' => $playerTotal,
            'bankerTotal' => $bankerTotal,
            'player1' => $d1,
            'player2' => $d2,
            'banker1' => $d3,
            'banker2' => $d4,
            'createdAt' => now(),
        ]);
        json_response(['ok' => true]);
    }

    public function roleta(): void
    {
        $body = request_json();
        $evoId = (string) ($body['evoId'] ?? $body['gameId'] ?? '');
        if ($evoId === '' || !isset($body['result'])) {
            json_response(['error' => 'Parâmetros inválidos'], 400);
        }
        $existing = Database::fetch('SELECT id FROM roulette_results WHERE evoId = ?', [$evoId]);
        if ($existing) {
            json_response(['ok' => true, 'duplicate' => true]);
        }

        $num = (int) $body['result'];
        $color = $num === 0 ? 'Green' : (in_array($num, self::ROULETTE_RED_NUMBERS, true) ? 'Red' : 'Black');

        Database::insert('roulette_results', [
            'evoId' => $evoId,
            'result' => $num,
            'color' => $color,
            'lightningMultiplier' => !empty($body['lightningMultiplier']) ? (int) $body['lightningMultiplier'] : null,
            'createdAt' => now(),
        ]);
        json_response(['ok' => true]);
    }
}
