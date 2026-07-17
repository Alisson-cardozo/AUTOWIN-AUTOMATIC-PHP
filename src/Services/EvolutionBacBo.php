<?php

declare(strict_types=1);

namespace App\Services;

use App\Bot\HttpClient;
use App\Models\ConfigRepository;

/**
 * Bridge multi-usuário para Bac Bo (Evolution) — HTTP + WebSocket (sem Chrome).
 * Cada userId: Blaze token → /play → entry redirect → EVOSESSIONID → WS aposta.
 * Sessão em storage/bacbo-evo/{userId}.json (isolada por usuário).
 *
 * Duas formas de falar com o bridge Node (bot/bacbo-evo-bridge.cjs):
 *   - HTTP (BACBO_BRIDGE_URL configurado): bridge roda como processo Node
 *     persistente (bot/server.cjs), necessário em hospedagens onde
 *     exec()/proc_open() do PHP estão desabilitados (ex.: shared hosting).
 *   - proc_open (padrão/local): spawna o script por chamada, como antes.
 */
final class EvolutionBacBo
{
    private const ROUTES = [
        'ensure-session' => '/bacbo/ensure-session',
        'place-bet' => '/bacbo/place-bet',
        'clear-session' => '/bacbo/clear-session',
        'get-entry-url' => '/bacbo/get-entry-url',
    ];

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public static function call(array $payload): array
    {
        // Proxy do Admin (system_config) sempre no payload — o bridge Node
        // recarrega o agent em runtime (HTTP e proc_open). Sem isso, modo
        // BACBO_BRIDGE_URL nunca via proxy configurado pelo painel.
        if (!array_key_exists('proxyUrl', $payload)) {
            $payload['proxyUrl'] = self::resolveProxyUrl();
        }
        $bridgeUrl = (string) env('BACBO_BRIDGE_URL', '');
        if ($bridgeUrl !== '') {
            return self::callHttp($bridgeUrl, $payload);
        }
        return self::callProcess($payload);
    }

    /**
     * Admin (system_config) tem prioridade sobre .env.
     */
    public static function resolveProxyUrl(): string
    {
        $fromDb = trim((string) ConfigRepository::get('BACBO_PROXY_URL', ''));
        if ($fromDb !== '') {
            return $fromDb;
        }
        return trim((string) env('BACBO_PROXY_URL', ''));
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private static function callHttp(string $bridgeUrl, array $payload): array
    {
        $action = (string) ($payload['action'] ?? '');
        $path = self::ROUTES[$action] ?? null;
        if ($path === null) {
            return ['ok' => false, 'error' => 'Ação inválida: ' . $action];
        }

        $timeoutMs = (int) ($payload['timeoutMs'] ?? 20000);
        $timeoutSec = (int) ceil($timeoutMs / 1000) + 10;
        $uid = (int) ($payload['userId'] ?? 0);
        log_msg(
            "[bacbo-evo] callHttp action={$action} user={$uid} path={$path} timeout={$timeoutSec}s",
            'bacbo-bet'
        );

        try {
            $client = new HttpClient($bridgeUrl, $timeoutSec);
            $secret = (string) env('BACBO_BRIDGE_SECRET', '');
            $headers = $secret !== '' ? ['x-bridge-secret' => $secret] : [];
            $t0 = microtime(true);
            $result = $client->post($path, $payload, $headers);
            $ms = (int) round((microtime(true) - $t0) * 1000);
            if (!is_array($result)) {
                log_msg("[bacbo-evo] callHttp FALHA user={$uid} ms={$ms} resposta não-array", 'bacbo-bet');
                return ['ok' => false, 'error' => 'Resposta inválida do bridge Bac Bo (HTTP).'];
            }
            log_msg(
                "[bacbo-evo] callHttp FIM action={$action} user={$uid} ms={$ms} ok="
                . (!empty($result['ok']) ? '1' : '0')
                . ' code=' . ($result['code'] ?? ''),
                'bacbo-bet'
            );
            return $result;
        } catch (\Throwable $e) {
            log_msg("[bacbo-evo] callHttp EXCEÇÃO action={$action} user={$uid}: " . $e->getMessage(), 'bacbo-bet');
            return ['ok' => false, 'error' => 'Bridge Bac Bo (HTTP) falhou: ' . $e->getMessage()];
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

        $env = self::buildChildEnv();

        $cmd = [$node, $script];
        $proc = @proc_open(
            $cmd,
            $descriptors,
            $pipes,
            base_path(),
            $env,
            ['bypass_shell' => true]
        );

        if (!is_resource($proc)) {
            $cmdStr = escapeshellarg($node) . ' ' . escapeshellarg($script);
            $proc = @proc_open($cmdStr, $descriptors, $pipes, base_path(), $env);
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

        // Espelha traces do Node (logBridge → stderr) no canal bacbo-bet
        // para um único lugar legível no painel/SSH.
        self::mirrorBridgeStderr($stderr, (string) ($payload['action'] ?? 'bridge'));

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
     * Copia linhas úteis do stderr do bridge Node para storage/logs/bacbo-bet.log.
     */
    private static function mirrorBridgeStderr(string $stderr, string $action): void
    {
        $stderr = trim($stderr);
        if ($stderr === '') {
            return;
        }
        $lines = preg_split('/\r\n|\n|\r/', $stderr) ?: [];
        $kept = 0;
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            // só traces do bridge / erros relevantes (evita ruído de depreciação)
            if (
                !str_contains($line, 'bacbo-evo-bridge')
                && !str_contains($line, 'AKAMAI')
                && !str_contains($line, 'place-bet')
                && !str_contains($line, 'ensure-session')
                && !str_contains($line, 'followToEvo')
                && !str_contains($line, 'connectAndBet')
                && !str_contains($line, 'blazePlay')
                && !str_contains($line, 'exit-ip')
                && !str_contains($line, 'proxy atualizado')
            ) {
                continue;
            }
            // remove prefixo repetido pra ficar legível
            $clean = preg_replace('/^\[bacbo-evo-bridge[^\]]*\]\s*/', '', $line) ?? $line;
            log_msg('[bridge:' . $action . '] ' . mb_substr($clean, 0, 420), 'bacbo-bet');
            $kept++;
            if ($kept >= 40) {
                log_msg('[bridge:' . $action . '] … (stderr truncado, ver storage/bacbo-evo/attempts.log)', 'bacbo-bet');
                break;
            }
        }
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
     * Coloca aposta REAL na mesa.
     * Espera a PRÓXIMA janela AcceptingBets (não a rodada que a API já adiantou).
     * Timeout maior: TipMiner costuma sair antes da mesa Evolution.
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
        ?string $launchUrl = null,
        ?string $preferredSlug = null
    ): array {
        $proxy = self::resolveProxyUrl();
        $proxyHint = $proxy !== ''
            ? (string) preg_replace('/:[^:@\/]+@/', ':***@', $proxy)
            : '(sem proxy)';
        log_msg(
            "[bacbo-evo] placeBet user={$userId} spot=" . strtoupper($spot)
            . " amount={$amount} slug=" . ($preferredSlug ?: 'default')
            . " proxy={$proxyHint} launch=" . ($launchUrl ? 'sim' : 'nao'),
            'bacbo-bet'
        );
        $t0 = microtime(true);
        $res = self::call([
            'action' => 'place-bet',
            'userId' => $userId,
            'blazeToken' => $blazeToken,
            'launchUrl' => $launchUrl,
            'spot' => strtoupper($spot),
            'amount' => $amount,
            'protectionAmount' => $protectionAmount,
            // TipMiner adiantar resultado → espera fechar rodada + abrir AcceptingBets
            'timeoutMs' => 90000,
            'preferredSlug' => $preferredSlug,
        ]);
        $ms = (int) round((microtime(true) - $t0) * 1000);
        $ok = !empty($res['ok']);
        $code = (string) ($res['code'] ?? '');
        $err = (string) ($res['error'] ?? '');
        $exitIp = (string) ($res['exitIp'] ?? '');
        $hopSummary = '';
        if (!empty($res['hops']) && is_array($res['hops'])) {
            $parts = [];
            foreach ($res['hops'] as $h) {
                if (!is_array($h)) {
                    continue;
                }
                $parts[] = ($h['step'] ?? '?') . '=' . ($h['status'] ?? $h['error'] ?? '?');
            }
            if ($parts) {
                $hopSummary = ' hops=' . implode('·', array_slice($parts, 0, 6));
            }
        }
        log_msg(
            "[bacbo-evo] placeBet FIM user={$userId} ok=" . ($ok ? '1' : '0')
            . " ms={$ms} code={$code} table=" . ($res['tableId'] ?? '?')
            . " betSent=" . (!empty($res['betSent']) ? '1' : '0')
            . " conf=" . (!empty($res['confirmed']) ? '1' : '0')
            . ($exitIp !== '' ? " exitIp={$exitIp}" : '')
            . $hopSummary
            . ($err !== '' ? ' err=' . mb_substr($err, 0, 180) : ''),
            'bacbo-bet'
        );
        return $res;
    }

    /**
     * URL de entrada da Evolution (login Blaze + montagem do /entry), sem
     * seguir os redirects — pro bridge de dispositivo (celular do cliente)
     * navegar de verdade a partir daí, do IP real dele.
     *
     * @return array<string, mixed>
     */
    public static function getEntryUrl(int $userId, string $blazeToken, ?string $preferredSlug = null): array
    {
        $res = self::call([
            'action' => 'get-entry-url',
            'userId' => $userId,
            'blazeToken' => $blazeToken,
            'preferredSlug' => $preferredSlug,
        ]);
        log_msg(
            "[bacbo-evo] getEntryUrl user={$userId} ok=" . (!empty($res['ok']) ? '1' : '0')
            . ' source=' . ($res['source'] ?? '?')
            . (!empty($res['error']) ? ' err=' . mb_substr((string) $res['error'], 0, 180) : ''),
            'bacbo-bet'
        );
        return $res;
    }

    public static function clearSession(int $userId): void
    {
        self::call([
            'action' => 'clear-session',
            'userId' => $userId,
        ]);
    }

    /**
     * BACBO_PROXY_URL (Admin ou .env) injetado no processo Node — proc_open()
     * com env customizado precisa da lista completa de variáveis.
     *
     * @return array<string, string>|null
     */
    private static function buildChildEnv(): ?array
    {
        $proxyUrl = self::resolveProxyUrl();
        // Sempre propaga (mesmo vazio) se admin limpou o proxy no painel
        $env = getenv();
        if (!is_array($env)) {
            $env = [];
        }
        $env['BACBO_PROXY_URL'] = $proxyUrl;
        return $env;
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
