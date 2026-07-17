<?php

declare(strict_types=1);

namespace App\Services;

/**
 * Bridge de aposta REAL Mega Roulette Brazilian (Pragmatic Play).
 * Spawna bot/megaroulette-bet-bridge.cjs com o token Blaze do usuário.
 *
 * Protocolo (captura browser):
 *   <command channel="table-{tableId}">
 *     <lpbet gm="roulette_desktop" gId="..." uId="ppc..." ck="...">
 *       <bet amt="..." bc="48|49|0" ck="..."/>
 *     </lpbet>
 *   </command>
 */
final class MegaRouletteBet
{
    /**
     * @param  'VERMELHO'|'PRETO'|'BRANCO'|string  $spot
     * @return array<string, mixed>
     */
    public static function placeBet(
        int $userId,
        string $blazeToken,
        string $spot,
        float $amount,
        int $timeoutMs = 90000,
        float $protectionAmount = 0.0
    ): array {
        $spotRaw = trim($spot);
        // Expande VIZ:/TERM:/NUM: → lista de bc (números) para o bridge
        $targets = \App\Bot\Games\MegaRouletteEngine::expandEntryTargets($spotRaw);
        $spotForBridge = $spotRaw;
        if (($targets['mode'] ?? '') === 'numbers' && !empty($targets['numbers'])) {
            $spotForBridge = 'NUM:' . implode(',', $targets['numbers']);
        } elseif (($targets['mode'] ?? '') === 'color' && !empty($targets['color'])) {
            $spotForBridge = 'COR:' . $targets['color'];
        }
        // Se a entrada já cobre o 0, não manda proteção duplicada
        $includesZero = \App\Bot\Games\MegaRouletteEngine::entryIncludesZero($spotRaw);
        $prot = (!$includesZero && $protectionAmount > 0) ? $protectionAmount : 0.0;
        log_msg(
            "[megaroulette-bet] placeBet user={$userId} entry={$spotRaw} → {$spotForBridge}"
            . " amount={$amount} prot0={$prot}",
            'megaroulette-bet'
        );
        $t0 = microtime(true);
        $res = self::call([
            'action' => 'place-bet',
            'userId' => $userId,
            'blazeToken' => $blazeToken,
            'spot' => $spotForBridge,
            'amount' => $amount,
            'protectionAmount' => $prot,
            'timeoutMs' => $timeoutMs,
            'betCodes' => $targets['numbers'] ?? [],
        ]);
        $ms = (int) round((microtime(true) - $t0) * 1000);
        $ok = !empty($res['ok']);
        log_msg(
            "[megaroulette-bet] placeBet FIM user={$userId} ok=" . ($ok ? '1' : '0')
            . " ms={$ms} table=" . ($res['tableId'] ?? '?')
            . " gameId=" . ($res['gameId'] ?? '?')
            . " bc=" . (is_array($res['bc'] ?? null) ? implode(',', $res['bc']) : ($res['bc'] ?? '?'))
            . " conf=" . (!empty($res['confirmed']) ? '1' : '0')
            . (!empty($res['error']) ? ' err=' . mb_substr((string) $res['error'], 0, 160) : ''),
            'megaroulette-bet'
        );
        return $res;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private static function call(array $payload): array
    {
        if (!function_exists('proc_open')) {
            return ['ok' => false, 'error' => 'proc_open() desabilitado — bridge Mega Roleta indisponível.'];
        }

        $script = base_path('bot/megaroulette-bet-bridge.cjs');
        if (!is_file($script)) {
            return ['ok' => false, 'error' => 'Bridge não encontrado (bot/megaroulette-bet-bridge.cjs).'];
        }
        if (!is_dir(base_path('node_modules/ws'))) {
            return ['ok' => false, 'error' => 'Pacote "ws" ausente. Rode: npm install ws'];
        }

        $node = self::findNode();
        if ($node === null) {
            return ['ok' => false, 'error' => 'Node.js não encontrado no PATH.'];
        }

        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            return ['ok' => false, 'error' => 'Falha ao serializar payload.'];
        }

        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];

        $env = self::buildChildEnv();
        $cmd = [$node, $script];
        $proc = @proc_open($cmd, $descriptors, $pipes, base_path(), $env, ['bypass_shell' => true]);
        if (!is_resource($proc)) {
            $proc = @proc_open(
                escapeshellarg($node) . ' ' . escapeshellarg($script),
                $descriptors,
                $pipes,
                base_path(),
                $env
            );
        }
        if (!is_resource($proc)) {
            return ['ok' => false, 'error' => 'Não foi possível iniciar o bridge Mega Roleta.'];
        }

        fwrite($pipes[0], $json);
        fclose($pipes[0]);
        $stdout = stream_get_contents($pipes[1]) ?: '';
        $stderr = stream_get_contents($pipes[2]) ?: '';
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($proc);

        // espelha stderr útil
        if (trim($stderr) !== '') {
            foreach (preg_split('/\r\n|\n|\r/', trim($stderr)) ?: [] as $i => $line) {
                $line = trim($line);
                if ($line === '' || $i > 30) {
                    continue;
                }
                if (str_contains($line, 'megaroulette-bet') || str_contains($line, 'lpbet') || str_contains($line, 'error')) {
                    log_msg('[bridge] ' . mb_substr($line, 0, 400), 'megaroulette-bet');
                }
            }
        }

        $stdout = trim($stdout);
        if ($stdout === '') {
            return [
                'ok' => false,
                'error' => 'Bridge sem resposta.' . ($stderr !== '' ? ' ' . substr($stderr, 0, 250) : ''),
            ];
        }

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
                'error' => 'Resposta inválida do bridge.',
                'raw' => substr($stdout, 0, 300),
            ];
        }
        return $decoded;
    }

    /** @return array<string, string>|null */
    private static function buildChildEnv(): ?array
    {
        $env = [];
        foreach ($_ENV as $k => $v) {
            if (is_string($k) && (is_string($v) || is_numeric($v))) {
                $env[$k] = (string) $v;
            }
        }
        foreach (getenv() ?: [] as $k => $v) {
            if (is_string($k) && is_string($v) && !array_key_exists($k, $env)) {
                $env[$k] = $v;
            }
        }
        $env['MEGAROULETTE_GAME_SLUG'] = (string) env(
            'MEGAROULETTE_GAME_SLUG',
            'mega-roulette---brazilian-287-287'
        );
        $env['AUTOWIN_ROOT'] = base_path();
        return $env ?: null;
    }

    private static function findNode(): ?string
    {
        $candidates = [
            'C:\\Program Files\\nodejs\\node.exe',
            'C:\\Program Files (x86)\\nodejs\\node.exe',
            'node',
        ];
        foreach ($candidates as $c) {
            if ($c !== 'node' && is_file($c)) {
                return $c;
            }
            if ($c === 'node') {
                $which = PHP_OS_FAMILY === 'Windows' ? 'where' : 'which';
                $out = [];
                @exec($which . ' node 2>nul', $out);
                if (!empty($out[0])) {
                    return trim($out[0]);
                }
                return 'node';
            }
        }
        return null;
    }
}
