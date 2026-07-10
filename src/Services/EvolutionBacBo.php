<?php

declare(strict_types=1);

namespace App\Services;

/**
 * Bridge multi-usuário para Bac Bo (Evolution).
 * Cada chamada é isolada por userId — sessão em storage/bacbo-evo/{userId}.json
 * e processo Node sem estado compartilhado entre usuários.
 */
final class EvolutionBacBo
{
    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public static function call(array $payload): array
    {
        $script = base_path('bot/bacbo-evo-bridge.cjs');
        if (!is_file($script)) {
            return ['ok' => false, 'error' => 'Bridge Bac Bo não encontrado (bot/bacbo-evo-bridge.cjs).'];
        }

        $nodeModules = base_path('node_modules/ws');
        if (!is_dir($nodeModules)) {
            return [
                'ok' => false,
                'error' => 'Pacote "ws" não instalado. Rode: npm install ws',
            ];
        }

        $node = self::findNode();
        if ($node === null) {
            return ['ok' => false, 'error' => 'Node.js não encontrado no PATH.'];
        }

        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            return ['ok' => false, 'error' => 'Falha ao serializar payload Bac Bo.'];
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
            $cmdStr = escapeshellarg($node) . ' ' . escapeshellarg($script);
            $proc = @proc_open($cmdStr, $descriptors, $pipes, base_path());
        }

        if (!is_resource($proc)) {
            return ['ok' => false, 'error' => 'Não foi possível iniciar o bridge Bac Bo (Node).'];
        }

        fwrite($pipes[0], $json);
        fclose($pipes[0]);

        $stdout = stream_get_contents($pipes[1]) ?: '';
        $stderr = stream_get_contents($pipes[2]) ?: '';
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($proc);

        $stdout = trim($stdout);
        if ($stdout === '') {
            return [
                'ok' => false,
                'error' => 'Bridge Bac Bo sem resposta.' . ($stderr !== '' ? ' ' . substr($stderr, 0, 300) : ''),
            ];
        }

        // Última linha JSON (ignora logs acidentais)
        $lines = preg_split('/\r\n|\n|\r/', $stdout) ?: [];
        $last = '';
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line !== '' && str_starts_with($line, '{')) {
                $last = $line;
            }
        }
        if ($last === '') {
            $last = $stdout;
        }

        $decoded = json_decode($last, true);
        if (!is_array($decoded)) {
            return [
                'ok' => false,
                'error' => 'Resposta inválida do bridge Bac Bo.',
                'raw' => substr($stdout, 0, 400),
                'stderr' => substr($stderr, 0, 200),
            ];
        }

        return $decoded;
    }

    /**
     * Abre/renova sessão Evolution para o usuário (isolado).
     *
     * @return array<string, mixed>
     */
    public static function ensureSession(int $userId, string $blazeToken, ?string $launchUrl = null): array
    {
        return self::call([
            'action' => 'ensure-session',
            'userId' => $userId,
            'blazeToken' => $blazeToken,
            'launchUrl' => $launchUrl,
        ]);
    }

    /**
     * Coloca aposta REAL na mesa (espera AcceptingBets se necessário).
     *
     * @param  'PLAYER'|'BANKER'|'EMPATE'  $spot
     * @return array<string, mixed>
     */
    public static function placeBet(
        int $userId,
        string $blazeToken,
        string $spot,
        float $amount,
        float $protectionAmount = 0.0,
        ?string $launchUrl = null
    ): array {
        return self::call([
            'action' => 'place-bet',
            'userId' => $userId,
            'blazeToken' => $blazeToken,
            'launchUrl' => $launchUrl,
            'spot' => strtoupper($spot),
            'amount' => $amount,
            'protectionAmount' => $protectionAmount,
            'timeoutMs' => 45000,
        ]);
    }

    public static function clearSession(int $userId): void
    {
        self::call([
            'action' => 'clear-session',
            'userId' => $userId,
        ]);
    }

    private static function findNode(): ?string
    {
        $candidates = ['node', 'node.exe'];
        if (PHP_OS_FAMILY === 'Windows') {
            $candidates[] = 'C:\\Program Files\\nodejs\\node.exe';
            $candidates[] = 'C:\\Program Files (x86)\\nodejs\\node.exe';
        }
        foreach ($candidates as $c) {
            if ($c === 'node' || $c === 'node.exe') {
                $which = PHP_OS_FAMILY === 'Windows' ? 'where' : 'which';
                $out = [];
                @exec($which . ' ' . escapeshellarg($c) . ' 2>nul', $out);
                if (!empty($out[0]) && is_file(trim($out[0]))) {
                    return trim($out[0]);
                }
                // tenta direto no PATH via proc
                return $c;
            }
            if (is_file($c)) {
                return $c;
            }
        }
        return 'node';
    }
}
