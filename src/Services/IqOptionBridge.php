<?php

declare(strict_types=1);

namespace App\Services;

/**
 * Spawna bot/iqoption-bridge.cjs (login / balances / place-option).
 * Timeout rígido no processo para não travar PHP-FPM.
 */
final class IqOptionBridge
{
    /** Cache curto de balances por ssid (evita rajada de WS no front). */
    private static array $balanceCache = [];

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public static function call(array $payload, int $timeoutSec = 18): array
    {
        if (!function_exists('proc_open')) {
            return ['ok' => false, 'error' => 'proc_open() desabilitado'];
        }
        $script = base_path('bot/iqoption-bridge.cjs');
        if (!is_file($script)) {
            return ['ok' => false, 'error' => 'Bridge IQ Option não encontrado'];
        }
        $node = self::findNode();
        if ($node === null) {
            return ['ok' => false, 'error' => 'Node.js não encontrado'];
        }

        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            return ['ok' => false, 'error' => 'Falha ao serializar payload'];
        }

        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];
        $env = self::buildEnv();
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
            return ['ok' => false, 'error' => 'Não iniciou o bridge IQ Option'];
        }

        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);

        fwrite($pipes[0], $json);
        fclose($pipes[0]);

        $stdout = '';
        $stderr = '';
        $deadline = microtime(true) + max(5, $timeoutSec);
        $timedOut = false;

        while (true) {
            $status = proc_get_status($proc);
            $stdout .= (string) stream_get_contents($pipes[1]);
            $stderr .= (string) stream_get_contents($pipes[2]);

            if (!$status['running']) {
                break;
            }
            if (microtime(true) >= $deadline) {
                $timedOut = true;
                break;
            }
            usleep(40000);
        }

        if ($timedOut) {
            // mata processo e filhos se possível
            $st = proc_get_status($proc);
            if (!empty($st['pid'])) {
                if (PHP_OS_FAMILY === 'Windows') {
                    @exec('taskkill /F /T /PID ' . (int) $st['pid'] . ' 2>nul');
                } else {
                    @exec('kill -9 ' . (int) $st['pid'] . ' 2>/dev/null');
                }
            }
            @proc_terminate($proc, 9);
        }

        // drena resto
        $stdout .= (string) stream_get_contents($pipes[1]);
        $stderr .= (string) stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($proc);

        if (trim($stderr) !== '') {
            foreach (preg_split('/\r\n|\n|\r/', trim($stderr)) ?: [] as $i => $line) {
                if ($i > 20) {
                    break;
                }
                $line = trim($line);
                if ($line !== '') {
                    log_msg('[iq-bridge] ' . mb_substr($line, 0, 300), 'iqoption');
                }
            }
        }

        if ($timedOut && trim($stdout) === '') {
            return ['ok' => false, 'error' => 'Bridge timeout (' . $timeoutSec . 's)'];
        }

        $stdout = trim($stdout);
        if ($stdout === '') {
            return ['ok' => false, 'error' => 'Bridge sem resposta'];
        }
        $last = '';
        foreach (preg_split('/\r\n|\n|\r/', $stdout) ?: [] as $line) {
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
            return ['ok' => false, 'error' => 'Resposta inválida do bridge', 'raw' => substr($stdout, 0, 200)];
        }
        return $decoded;
    }

    /** @return array{ok:bool,ssid?:string,balances?:list<array>,error?:string} */
    public static function login(string $email, string $password): array
    {
        return self::call([
            'action' => 'login',
            'email' => $email,
            'password' => $password,
        ], 35);
    }

    /** @return array{ok:bool,balances?:list<array>,error?:string} */
    public static function balances(string $ssid, bool $force = false): array
    {
        $key = substr(hash('sha256', $ssid), 0, 24);
        $now = time();
        if (!$force && isset(self::$balanceCache[$key])) {
            $hit = self::$balanceCache[$key];
            if (($hit['exp'] ?? 0) > $now) {
                return $hit['data'];
            }
        }
        $res = self::call(['action' => 'get-balances', 'ssid' => $ssid], 16);
        if (!empty($res['ok']) && !empty($res['balances'])) {
            self::$balanceCache[$key] = ['exp' => $now + 20, 'data' => $res];
        }
        return $res;
    }

    /**
     * @param  array{ssid:string,balanceId:int|string,asset?:string,direction?:string,amount?:float,expirationMinutes?:int,activeId?:int}  $opts
     * @return array<string, mixed>
     */
    public static function placeOption(array $opts): array
    {
        return self::call(array_merge(['action' => 'place-option'], $opts), 25);
    }

    /**
     * @return array{ok:bool,result?:string,profit?:float|null,error?:string,pending?:bool}
     */
    public static function optionResult(string $ssid, string|int $optionId, int|string|null $balanceId = null): array
    {
        $payload = [
            'action' => 'get-option-result',
            'ssid' => $ssid,
            'optionId' => $optionId,
        ];
        if ($balanceId !== null && $balanceId !== '' && (int) $balanceId > 0) {
            $payload['balanceId'] = (int) $balanceId;
        }
        // timeout maior: history + várias instrument types
        return self::call($payload, 28);
    }

    /**
     * @return array{ok:bool,candles?:list<array{open:float,high:float,low:float,close:float,from?:int}>,error?:string}
     */
    public static function candles(string $ssid, string $asset, int $sizeSec = 60, int $count = 100): array
    {
        return self::call([
            'action' => 'get-candles',
            'ssid' => $ssid,
            'asset' => $asset,
            'size' => $sizeSec,
            'count' => $count,
        ], 20);
    }

    /** @return array<string, string>|null */
    private static function buildEnv(): ?array
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
        $env['AUTOWIN_ROOT'] = base_path();
        return $env ?: null;
    }

    private static function findNode(): ?string
    {
        foreach ([
            'C:\\Program Files\\nodejs\\node.exe',
            'C:\\Program Files (x86)\\nodejs\\node.exe',
            'node',
        ] as $c) {
            if ($c !== 'node' && is_file($c)) {
                return $c;
            }
            if ($c === 'node') {
                $which = PHP_OS_FAMILY === 'Windows' ? 'where' : 'which';
                $out = [];
                @exec($which . ' node 2>nul', $out);
                return !empty($out[0]) ? trim($out[0]) : 'node';
            }
        }
        return null;
    }
}
