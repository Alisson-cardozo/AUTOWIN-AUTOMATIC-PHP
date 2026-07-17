<?php

declare(strict_types=1);

namespace App\Services;

use App\Bot\HttpClient;

/**
 * Chama o bridge Node/GramJS (bot/telegram-bridge.cjs),
 * espelhando o fluxo do auto-autowin telegram-userbot/route.ts.
 *
 * HTTP (BACBO_BRIDGE_URL configurado) fala com bot/server.cjs, necessário em
 * hospedagens onde exec()/proc_open() do PHP estão desabilitados. Sem isso,
 * cai no proc_open por chamada de sempre (local/VPS com exec liberado).
 */
final class TelegramBridge
{
    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public static function call(array $payload): array
    {
        $bridgeUrl = (string) env('BACBO_BRIDGE_URL', '');
        if ($bridgeUrl !== '') {
            return self::callHttp($bridgeUrl, $payload);
        }
        return self::callProcess($payload);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private static function callHttp(string $bridgeUrl, array $payload): array
    {
        try {
            $client = new HttpClient($bridgeUrl, 30);
            $secret = (string) env('BACBO_BRIDGE_SECRET', '');
            $headers = $secret !== '' ? ['x-bridge-secret' => $secret] : [];
            $result = $client->post('/telegram', $payload, $headers);
            return is_array($result) ? $result : ['ok' => false, 'error' => 'Resposta inválida do bridge Telegram (HTTP).'];
        } catch (\Throwable $e) {
            return ['ok' => false, 'error' => 'Bridge Telegram (HTTP) falhou: ' . $e->getMessage()];
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private static function callProcess(array $payload): array
    {
        if (!function_exists('proc_open')) {
            return [
                'ok' => false,
                'error' => 'proc_open() está desabilitado nesta hospedagem. Configure BACBO_BRIDGE_URL '
                    . 'apontando para um "node bot/server.cjs" rodando à parte (veja bot/server.cjs).',
            ];
        }

        $script = base_path('bot/telegram-bridge.cjs');
        if (!is_file($script)) {
            // fallback legado
            $script = base_path('bot/telegram-bridge.mjs');
        }
        if (!is_file($script)) {
            return ['ok' => false, 'error' => 'Bridge Telegram não encontrado (bot/telegram-bridge.cjs).'];
        }

        $nodeModules = base_path('node_modules/telegram');
        if (!is_dir($nodeModules)) {
            return [
                'ok' => false,
                'error' => 'Pacote "telegram" (GramJS) não instalado. Rode: npm install telegram',
            ];
        }

        $node = self::findNode();
        if ($node === null) {
            return ['ok' => false, 'error' => 'Node.js não encontrado no PATH. Instale Node para conectar o Telegram.'];
        }

        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            return ['ok' => false, 'error' => 'Falha ao serializar payload Telegram.'];
        }

        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];

        $cmd = [$node, $script];
        $proc = @proc_open(
            $cmd,
            $descriptors,
            $pipes,
            base_path(),
            null,
            ['bypass_shell' => true]
        );

        if (!is_resource($proc)) {
            // Fallback Windows: string command
            $cmdStr = escapeshellarg($node) . ' ' . escapeshellarg($script);
            $proc = @proc_open($cmdStr, $descriptors, $pipes, base_path());
        }

        if (!is_resource($proc)) {
            return ['ok' => false, 'error' => 'Não foi possível iniciar o bridge Telegram (Node).'];
        }

        fwrite($pipes[0], $json);
        fclose($pipes[0]);

        $stdout = stream_get_contents($pipes[1]) ?: '';
        $stderr = stream_get_contents($pipes[2]) ?: '';
        fclose($pipes[1]);
        fclose($pipes[2]);
        $code = proc_close($proc);

        $stdout = trim($stdout);
        if ($stdout === '') {
            $err = trim($stderr);
            return [
                'ok' => false,
                'error' => $err !== ''
                    ? ('Bridge Telegram falhou: ' . mb_substr($err, 0, 400))
                    : ('Bridge Telegram sem resposta (exit ' . $code . ').'),
            ];
        }

        // Pode haver logs no stderr; stdout deve ser JSON puro
        $data = json_decode($stdout, true);
        if (!is_array($data)) {
            // tenta pegar última linha JSON
            $lines = preg_split('/\r\n|\n|\r/', $stdout) ?: [];
            $last = trim((string) end($lines));
            $data = json_decode($last, true);
        }

        if (!is_array($data)) {
            return [
                'ok' => false,
                'error' => 'Resposta inválida do bridge Telegram: ' . mb_substr($stdout, 0, 300),
            ];
        }

        return $data;
    }

    private static function findNode(): ?string
    {
        $candidates = [
            'node',
            'C:\\Program Files\\nodejs\\node.exe',
            'C:\\Program Files (x86)\\nodejs\\node.exe',
        ];
        foreach ($candidates as $c) {
            if ($c === 'node') {
                // confia no PATH via proc_open
                return 'node';
            }
            if (is_file($c)) {
                return $c;
            }
        }
        return 'node';
    }
}
