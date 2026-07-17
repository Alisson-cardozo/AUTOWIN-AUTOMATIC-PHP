<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Auth\Auth;
use App\Database;
use App\Models\ConfigRepository;
use App\Models\UserRepository;
use App\Services\BotCommandService;

final class AdminController
{
    public function setupStatus(): void
    {
        $row = Database::fetch('SELECT COUNT(*) AS c FROM admin_users');
        json_response(['hasAdmin' => ((int) ($row['c'] ?? 0)) > 0]);
    }

    public function setup(): void
    {
        $row = Database::fetch('SELECT COUNT(*) AS c FROM admin_users');
        if (((int) ($row['c'] ?? 0)) > 0) {
            json_response(['error' => 'Admin já existe.'], 403);
        }
        $username = trim((string) input('username', ''));
        $email = trim((string) input('email', ''));
        $password = (string) input('password', '');
        if ($username === '' || $email === '' || $password === '') {
            json_response(['error' => 'Preencha todos os campos.'], 400);
        }
        Database::insert('admin_users', [
            'username' => $username,
            'email' => $email,
            'password' => password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]),
            'createdAt' => now(),
        ]);
        json_response(['success' => true]);
    }

    public function login(): void
    {
        $email = trim((string) input('email', ''));
        $password = (string) input('password', '');
        $admin = Database::fetch('SELECT * FROM admin_users WHERE email = ? LIMIT 1', [$email]);
        if (!$admin || !password_verify($password, $admin['password'])) {
            json_response(['error' => 'Credenciais inválidas'], 401);
        }
        Auth::loginAdmin((int) $admin['id']);
        // espelha cookie de usuário
        $adminAccount = UserRepository::findAdminAccount();
        if ($adminAccount) {
            Auth::loginUser((int) $adminAccount['id']);
        }
        json_response(['success' => true, 'username' => $admin['username']]);
    }

    public function profile(): void
    {
        $admin = Auth::requireAdmin();
        if (request_method() === 'GET') {
            json_response([
                'id' => (int) $admin['id'],
                'username' => $admin['username'],
                'email' => $admin['email'],
            ]);
        }
        $data = [];
        if (input('username')) {
            $data['username'] = trim((string) input('username'));
        }
        if (input('email')) {
            $data['email'] = trim((string) input('email'));
        }
        $newPassword = (string) input('newPassword', '');
        if ($newPassword !== '') {
            $currentPassword = (string) input('currentPassword', '');
            if ($currentPassword === '' || !password_verify($currentPassword, $admin['password'])) {
                json_response(['error' => 'Senha atual incorreta.'], 400);
            }
            $data['password'] = password_hash($newPassword, PASSWORD_BCRYPT, ['cost' => 12]);
        }
        if ($data) {
            Database::update('admin_users', $data, 'id = :id', ['id' => $admin['id']]);
        }
        json_response(['success' => true]);
    }

    public function users(): void
    {
        Auth::requireAdmin();
        $method = request_method();

        if ($method === 'GET') {
            $users = Database::fetchAll(
                'SELECT u.*, v.profit, v.balance, v.countWin, v.countLoss, s.enterValue, s.strategyType
                 FROM users u
                 LEFT JOIN variables v ON v.ownerId = u.id
                 LEFT JOIN settings s ON s.ownerId = u.id
                 ORDER BY u.id DESC LIMIT 500'
            );
            // Normaliza tipos pro React (UsersTable)
            $users = array_map(static function (array $u): array {
                foreach (['isActive', 'isTesting', 'isAdminAccount', 'isBetting', 'jonbetIsActive', 'alreadyTested'] as $b) {
                    if (array_key_exists($b, $u)) {
                        $u[$b] = (bool) (int) $u[$b];
                    }
                }
                $u['id'] = (int) $u['id'];
                return $u;
            }, $users);
            json_response($users);
        }

        if ($method === 'DELETE') {
            $id = (int) ($_GET['id'] ?? input('id', 0));
            if (!$id) {
                json_response(['error' => 'ID inválido'], 400);
            }
            Database::delete('users', 'id = ?', [$id]);
            json_response(['success' => true]);
        }

        if ($method === 'PATCH') {
            $id = (int) input('id', 0);
            if (!$id) {
                json_response(['error' => 'ID inválido'], 400);
            }
            $body = request_json();
            unset($body['id']);
            $allowed = [
                'name', 'email', 'paymentStatus', 'expireIn', 'isTesting', 'isActive',
                'features', 'accountType', 'gameType', 'webPassword',
            ];
            $data = [];
            foreach ($allowed as $k) {
                if (array_key_exists($k, $body)) {
                    $data[$k] = $body[$k];
                    if ($k === 'webPassword' && $body[$k]) {
                        $data[$k] = password_hash((string) $body[$k], PASSWORD_BCRYPT);
                    }
                    if (in_array($k, ['isTesting', 'isActive'], true)) {
                        $data[$k] = $body[$k] ? 1 : 0;
                    }
                }
            }
            if ($data) {
                UserRepository::update($id, $data);
            }
            json_response(UserRepository::find($id));
        }

        if ($method === 'POST') {
            $action = (string) input('action', '');
            $id = (int) input('id', 0);
            if ($action === 'stop-bot' && $id) {
                BotCommandService::enqueue($id, 'stop', 'BLAZE');
                BotCommandService::enqueue($id, 'stop', 'JONBET');
                UserRepository::update($id, [
                    'isActive' => 0,
                    'isBetting' => 0,
                    'jonbetIsActive' => 0,
                    'jonbetIsBetting' => 0,
                ]);
                json_response(['success' => true, 'stoppedAny' => true]);
            }
            // Reseta só a banca (balance/firstBalance) com o saldo REAL atual —
            // mantém intacto o histórico de WIN/LOSS e os contadores do mês.
            if ($action === 'reset-balance' && $id) {
                $target = UserRepository::find($id);
                if (!$target) {
                    json_response(['error' => 'Usuário não encontrado'], 404);
                }

                $blazeBalance = null;
                if (!empty($target['token'])) {
                    try {
                        $api = new \App\Bot\Blaze\BlazeAPI();
                        $api->setToken((string) $target['token']);
                        $blazeBalance = $api->extractBalance($api->getWallet());
                    } catch (\Throwable) {
                        $blazeBalance = null;
                    }
                }

                $jonbetBalance = null;
                if (!empty($target['jonbetToken'])) {
                    try {
                        $api = new \App\Bot\Jonbet\JonbetAPI();
                        $api->setToken((string) $target['jonbetToken']);
                        $jonbetBalance = $api->extractBalance($api->getWallet());
                    } catch (\Throwable) {
                        $jonbetBalance = null;
                    }
                }

                $resetBalanceOnly = static function (string $table, ?float $realBalance) use ($id): void {
                    $bal = $realBalance ?? 0;
                    Database::update($table, [
                        'balance' => $bal,
                        'firstBalance' => $bal,
                        'firstBalanceDate' => now(),
                    ], 'ownerId = :oid', ['oid' => $id]);
                };
                try {
                    $resetBalanceOnly('variables', $blazeBalance);
                } catch (\Throwable) {
                }
                try {
                    $resetBalanceOnly('bacbo_variables', $blazeBalance);
                } catch (\Throwable) {
                }
                try {
                    $resetBalanceOnly('bacbo_live_variables', $blazeBalance);
                } catch (\Throwable) {
                }
                try {
                    $resetBalanceOnly('jonbet_variables', $jonbetBalance);
                } catch (\Throwable) {
                }

                json_response([
                    'success' => true,
                    'blazeBalance' => $blazeBalance,
                    'jonbetBalance' => $jonbetBalance,
                ]);
            }
            if ($action === 'create') {
                $email = trim((string) input('email', ''));
                $name = trim((string) input('name', $email));
                $pass = (string) input('password', '123456');
                $days = (int) input('days', 30);
                $id = UserRepository::create([
                    'name' => $name,
                    'email' => $email,
                    'webPassword' => password_hash($pass, PASSWORD_BCRYPT),
                    'paymentStatus' => 'PAID',
                    'expireIn' => date('Y-m-d H:i:s', strtotime("+{$days} days")),
                    'features' => input('features') ? json_encode(input('features')) : null,
                    'createdAt' => now(),
                ]);
                json_response(['success' => true, 'id' => $id]);
            }
            json_response(['error' => 'Ação inválida'], 400);
        }

        json_response(['error' => 'Método não suportado'], 405);
    }

    public function config(): void
    {
        Auth::requireAdmin();
        if (request_method() === 'GET') {
            json_response(ConfigRepository::all());
        }
        $body = request_json();
        foreach ($body as $k => $v) {
            if (is_string($k)) {
                ConfigRepository::set($k, is_string($v) ? $v : json_encode($v, JSON_UNESCAPED_UNICODE));
            }
        }
        json_response(['success' => true]);
    }

    /**
     * Testa se o proxy (BACBO_PROXY_URL, salvo ou informado no body) passa
     * pelo bloqueio Akamai da Evolution — usado pelo "mini terminal" da aba
     * Proxy no admin. Não precisa de sessão/token de usuário: o bloqueio da
     * Akamai acontece no /entry antes de validar parâmetros de sessão.
     */
    public function bacboProxyTest(): void
    {
        Auth::requireAdmin();
        $body = request_json();
        $proxyUrl = trim((string) ($body['url'] ?? ConfigRepository::get('BACBO_PROXY_URL', '') ?? ''));

        $log = [];
        if ($proxyUrl === '') {
            json_response([
                'ok' => false,
                'blocked' => null,
                'message' => 'Nenhum proxy configurado.',
                'log' => ['$ nenhum BACBO_PROXY_URL configurado ou informado'],
            ]);
        }

        $log[] = "$ testando proxy...";

        $ipInfo = self::curlThroughProxy('https://ipinfo.io/json', $proxyUrl);
        if ($ipInfo === null || $ipInfo['status'] !== 200) {
            $log[] = '✗ não foi possível conectar ao proxy (' . ($ipInfo['error'] ?? ('HTTP ' . ($ipInfo['status'] ?? '?'))) . ')';
            json_response([
                'ok' => false,
                'blocked' => null,
                'message' => 'Proxy não respondeu. Verifique host/porta/usuário/senha.',
                'log' => $log,
            ]);
        }
        $ipData = json_decode($ipInfo['body'], true) ?: [];
        $ip = $ipData['ip'] ?? '?';
        $org = $ipData['org'] ?? '?';
        $city = $ipData['city'] ?? '?';
        $log[] = "✓ proxy conectou — saindo pelo IP {$ip} ({$city}) — {$org}";

        // Dois probes: homepage (TLS/IP) + /entry (onde a Akamai costuma atuar).
        // curl sem cookie/JSESSIONID no /entry pode tomar 403 mesmo em IP bom —
        // por isso o veredito considera org do IP + corpo da resposta.
        $log[] = '$ testando https://a8-latam.evo-games.com/ (homepage)...';
        $home = self::curlThroughProxy('https://a8-latam.evo-games.com/', $proxyUrl, true);
        $homeStatus = (int) ($home['status'] ?? 0);
        $homeBody = (string) ($home['body'] ?? '');
        $homeAkamai = self::bodyLooksLikeAkamai($homeBody, $homeStatus);
        if (!empty($home['error'])) {
            $log[] = '✗ homepage: ' . $home['error'];
        } else {
            $log[] = $homeAkamai
                ? "✗ homepage HTTP {$homeStatus} — página Akamai Access Denied"
                : "✓ homepage HTTP {$homeStatus}";
        }

        $log[] = '$ testando https://a8-latam.evo-games.com/entry (Evolution)...';
        $evo = self::curlThroughProxy('https://a8-latam.evo-games.com/entry', $proxyUrl, true);
        if ($evo === null) {
            $log[] = '✗ falha na conexão com a Evolution através do proxy';
            json_response(['ok' => false, 'blocked' => null, 'message' => 'Falha ao alcançar a Evolution.', 'log' => $log]);
        }

        $status = (int) ($evo['status'] ?? 0);
        $body = (string) ($evo['body'] ?? '');
        $entryAkamai = self::bodyLooksLikeAkamai($body, $status);
        $hostingIp = self::ipOrgLooksLikeHosting($org);

        if (!empty($evo['error'])) {
            $log[] = '✗ entry: ' . $evo['error'];
            $blocked = true;
            $message = 'Não conectou na Evolution via proxy: ' . $evo['error'];
        } elseif ($entryAkamai || $homeAkamai) {
            $log[] = "✗ HTTP {$status} — resposta parece bloqueio Akamai (Access Denied / Reference #)";
            $blocked = true;
            if ($hostingIp) {
                $message = 'Bloqueado pela Evolution (Akamai). Org do IP parece datacenter/hosting — use proxy residencial ou 4G de verdade.';
            } else {
                $message = 'Akamai recusou o probe (curl no /entry). Seu IP NÃO parece datacenter ('
                    . $org . '). O túnel/proxy pode estar ok — teste uma aposta REAL no bot com o túnel aberto; '
                    . 'o fluxo completo (Blaze /play + cookies) é diferente deste probe. Se o bot também falhar, use 4G ou proxy mobile.';
                // Não marcar como "datacenter" definitivo quando o ASN parece residencial/ISP
                $blocked = $homeAkamai; // homepage barrada = IP realmente ruim; só entry = incerto
            }
        } elseif ($status >= 500) {
            $log[] = "△ HTTP {$status} — erro no servidor da Evolution, tente de novo";
            $blocked = null;
            $message = 'Evolution respondeu com erro de servidor, tente novamente em instantes.';
        } else {
            $log[] = "✓ HTTP {$status} — não foi bloqueado no probe (sem params de sessão reais)";
            $blocked = false;
            $message = 'Probe OK. Inicie um bot REAL para confirmar o fluxo completo.';
        }

        $log[] = '$ dica: com túnel SSH, deixe o CMD do Windows aberto (ssh -N -R 1080) durante o bot REAL';

        json_response([
            'ok' => true,
            'blocked' => $blocked,
            'ip' => $ip,
            'org' => $org,
            'evolutionStatus' => $status,
            'homeStatus' => $homeStatus,
            'message' => $message,
            'log' => $log,
        ]);
    }

    private static function bodyLooksLikeAkamai(string $body, int $status): bool
    {
        if ($status !== 403 && $status !== 401) {
            return false;
        }
        return (bool) preg_match('/Access Denied|Reference\s*#|errors\.edgesuite\.net|AkamaiGHost|Permission Denied/i', $body);
    }

    private static function ipOrgLooksLikeHosting(string $org): bool
    {
        return (bool) preg_match(
            '/hostinger|digitalocean|ovh|hetzner|linode|vultr|aws|amazon|google cloud|azure|contabo|m247|datacamp|choopa|leaseweb|cloudflare/i',
            $org
        );
    }

    /**
     * @return array{status:int, body:string, error?:string}|null
     */
    private static function curlThroughProxy(string $url, string $proxyUrl, bool $browserHeaders = false): ?array
    {
        $ch = curl_init($url);
        if ($ch === false) {
            return null;
        }

        // Parse scheme://[user:pass@]host:port — CURL precisa de PROXYTYPE explícito
        // p/ SOCKS5; senão em alguns PHP o proxy é ignorado e o IP da VPS “passa”
        // no teste (falso positivo) e a Evolution continua em 403.
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 12,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_HTTPHEADER => $browserHeaders ? [
                'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                'Upgrade-Insecure-Requests: 1',
                'Sec-Fetch-Dest: document',
                'Sec-Fetch-Mode: navigate',
                'Sec-Fetch-Site: cross-site',
                'sec-ch-ua: "Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                'sec-ch-ua-mobile: ?0',
                'sec-ch-ua-platform: "Windows"',
                'Referer: https://blaze.bet.br/',
                'Origin: https://blaze.bet.br',
            ] : [],
        ];

        $parsed = self::parseProxyUrl($proxyUrl);
        if ($parsed === null) {
            curl_close($ch);
            return ['status' => 0, 'body' => '', 'error' => 'URL de proxy inválida'];
        }

        $opts[CURLOPT_PROXY] = $parsed['host'] . ':' . $parsed['port'];
        $opts[CURLOPT_PROXYTYPE] = $parsed['type'];
        // HTTPS via proxy HTTP precisa de túnel CONNECT
        if ($parsed['type'] === CURLPROXY_HTTP) {
            $opts[CURLOPT_HTTPPROXYTUNNEL] = true;
        }
        if ($parsed['user'] !== '') {
            // user:pass cru — libcurl monta Proxy-Authorization
            $opts[CURLOPT_PROXYUSERPWD] = $parsed['user'] . ':' . $parsed['pass'];
            $opts[CURLOPT_PROXYAUTH] = CURLAUTH_BASIC;
        }

        curl_setopt_array($ch, $opts);
        $body = curl_exec($ch);
        if ($body === false) {
            $error = curl_error($ch);
            curl_close($ch);
            // 407 = user/senha ou whitelist; mensagem mais clara no Admin
            if (str_contains($error, '407')) {
                $error .= ' — confira usuário/senha (copie do Decodo) e se o IP da VPS está na allowlist';
            }
            return ['status' => 0, 'body' => '', 'error' => $error];
        }
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return ['status' => $status, 'body' => (string) $body];
    }

    /**
     * @return array{type:int, host:string, port:int, user:string, pass:string}|null
     */
    private static function parseProxyUrl(string $proxyUrl): ?array
    {
        $proxyUrl = trim($proxyUrl);
        if ($proxyUrl === '') {
            return null;
        }
        // aceita host:port sem scheme (assume HTTP)
        if (!preg_match('#^[a-z][a-z0-9+.-]*://#i', $proxyUrl)) {
            $proxyUrl = 'http://' . $proxyUrl;
        }

        // parse_url quebra senha com caracteres especiais; extrai userinfo manualmente
        $scheme = 'http';
        $rest = $proxyUrl;
        if (preg_match('#^([a-z][a-z0-9+.-]*)://(.*)$#i', $proxyUrl, $m)) {
            $scheme = strtolower($m[1]);
            $rest = $m[2];
        }
        $user = '';
        $pass = '';
        if (preg_match('#^([^@/]+)@(.*)$#', $rest, $m)) {
            $userinfo = $m[1];
            $rest = $m[2];
            $colon = strpos($userinfo, ':');
            if ($colon === false) {
                $user = rawurldecode($userinfo);
            } else {
                $user = rawurldecode(substr($userinfo, 0, $colon));
                $pass = rawurldecode(substr($userinfo, $colon + 1));
            }
        }
        // host:port/path
        $hostPort = $rest;
        if (str_contains($hostPort, '/')) {
            $hostPort = explode('/', $hostPort, 2)[0];
        }
        $host = $hostPort;
        $port = 0;
        if (preg_match('#^\[([^\]]+)\]:(\d+)$#', $hostPort, $m)) {
            $host = $m[1];
            $port = (int) $m[2];
        } elseif (preg_match('#^([^:]+):(\d+)$#', $hostPort, $m)) {
            $host = $m[1];
            $port = (int) $m[2];
        }
        if ($host === '') {
            return null;
        }

        $type = CURLPROXY_HTTP;
        if ($scheme === 'socks5' || $scheme === 'socks5h') {
            $type = defined('CURLPROXY_SOCKS5_HOSTNAME')
                ? CURLPROXY_SOCKS5_HOSTNAME
                : CURLPROXY_SOCKS5;
            if ($port <= 0) {
                $port = 1080;
            }
        } elseif ($scheme === 'socks4' || $scheme === 'socks4a') {
            $type = CURLPROXY_SOCKS4;
            if ($port <= 0) {
                $port = 1080;
            }
        } else {
            if ($port <= 0) {
                $port = 8080;
            }
        }
        return [
            'type' => $type,
            'host' => $host,
            'port' => $port,
            'user' => $user,
            'pass' => $pass,
        ];
    }

    public function emergencyStop(): void
    {
        Auth::requireAdmin();
        // Contrato do front original: { active, pendingCount }
        if (request_method() === 'GET') {
            $active = ConfigRepository::emergencyStop();
            json_response([
                'active' => $active,
                'pendingCount' => 0, // worker PHP não expõe pendingStop em memória cross-process
            ]);
        }
        $body = request_json();
        $active = (bool) ($body['active'] ?? input('active', input('enabled', false)));
        ConfigRepository::set('EMERGENCY_STOP', $active ? 'true' : 'false');
        $stoppedImmediately = 0;
        $pendingStop = 0;
        if ($active) {
            $activeUsers = Database::fetchAll('SELECT id FROM users WHERE isActive = 1 OR jonbetIsActive = 1');
            foreach ($activeUsers as $u) {
                BotCommandService::enqueue((int) $u['id'], 'stop', 'BLAZE');
                BotCommandService::enqueue((int) $u['id'], 'stop', 'JONBET');
                $stoppedImmediately++;
            }
            Database::query('UPDATE users SET isActive = 0, isBetting = 0, jonbetIsActive = 0, jonbetIsBetting = 0');
        }
        json_response([
            'success' => true,
            'active' => $active,
            'stoppedImmediately' => $stoppedImmediately,
            'pendingStop' => $pendingStop,
        ]);
    }

    public function announcement(): void
    {
        Auth::requireAdmin();
        $method = request_method();
        if ($method === 'GET') {
            $raw = ConfigRepository::get('ANNOUNCEMENT', '') ?? '';
            $announcement = null;
            if ($raw !== '') {
                $decoded = json_decode($raw, true);
                if (is_array($decoded) && isset($decoded['message'])) {
                    $announcement = $decoded;
                } elseif (is_string($raw) && $raw !== '' && $raw[0] !== '{') {
                    // legado: texto puro
                    $announcement = [
                        'id' => time(),
                        'message' => $raw,
                        'createdAt' => date('c'),
                    ];
                }
            }
            json_response(['announcement' => $announcement]);
        }
        if ($method === 'DELETE') {
            Database::delete('system_config', '`key` = ?', ['ANNOUNCEMENT']);
            json_response(['success' => true]);
        }
        // POST — { message }
        $message = trim((string) (input('message', '') ?: input('text', '')));
        if ($message === '') {
            json_response(['error' => 'Mensagem vazia'], 400);
        }
        $announcement = [
            'id' => (int) (microtime(true) * 1000),
            'message' => $message,
            'createdAt' => date('c'),
        ];
        ConfigRepository::set('ANNOUNCEMENT', json_encode($announcement, JSON_UNESCAPED_UNICODE));
        json_response(['success' => true, 'announcement' => $announcement]);
    }

    /** Métricas do dashboard admin (port de app/(dashboard)/dashboard/page.tsx). */
    public function dashboardStats(): void
    {
        Auth::requireAdmin();
        $now = new \DateTimeImmutable('now');
        $startThisMonth = $now->modify('first day of this month')->setTime(0, 0);
        $startLastMonth = $now->modify('first day of last month')->setTime(0, 0);

        $totalUsers = (int) (Database::fetch('SELECT COUNT(*) c FROM users')['c'] ?? 0);
        $paidUsers = (int) (Database::fetch("SELECT COUNT(*) c FROM users WHERE paymentStatus = 'PAID'")['c'] ?? 0);
        $newUsersThisMonth = (int) (Database::fetch(
            'SELECT COUNT(*) c FROM users WHERE createdAt >= ?',
            [$startThisMonth->format('Y-m-d H:i:s')]
        )['c'] ?? 0);
        $newUsersLastMonth = (int) (Database::fetch(
            'SELECT COUNT(*) c FROM users WHERE createdAt >= ? AND createdAt < ?',
            [$startLastMonth->format('Y-m-d H:i:s'), $startThisMonth->format('Y-m-d H:i:s')]
        )['c'] ?? 0);
        $trialCount = (int) (Database::fetch('SELECT COUNT(*) c FROM users WHERE isTesting = 1')['c'] ?? 0);
        $activeBots = (int) (Database::fetch(
            'SELECT COUNT(*) c FROM users WHERE isActive = 1 OR jonbetIsActive = 1'
        )['c'] ?? 0);
        $doubleCount = (int) (Database::fetch("SELECT COUNT(*) c FROM users WHERE gameType = 'DOUBLE'")['c'] ?? 0);
        $crashCount = (int) (Database::fetch("SELECT COUNT(*) c FROM users WHERE gameType = 'CRASH'")['c'] ?? 0);
        $fortuneCount = (int) (Database::fetch("SELECT COUNT(*) c FROM users WHERE gameType = 'FORTUNE'")['c'] ?? 0);

        $plans = [];
        try {
            $plans = json_decode((string) (ConfigRepository::get('LICENSE_OPTIONS', '[]') ?? '[]'), true) ?: [];
        } catch (\Throwable $e) {
            $plans = [];
        }

        $paidList = Database::fetchAll(
            "SELECT paymentExpireIn, expireIn FROM users WHERE paymentStatus = 'PAID' AND paymentExpireIn IS NOT NULL AND expireIn IS NOT NULL"
        );
        // "Resetar Faturamento" no admin grava esse corte — pagamentos antes
        // dele somem do faturamento exibido, sem tirar o acesso PAID de ninguém.
        $revenueResetAtRaw = (string) (ConfigRepository::get('REVENUE_RESET_AT', '') ?? '');
        $revenueResetAt = $revenueResetAtRaw !== '' ? new \DateTimeImmutable($revenueResetAtRaw) : null;
        $valueThisMonth = 0.0;
        $valueLastMonth = 0.0;
        $payingThisMonth = 0;
        $payingLastMonth = 0;
        $monthsRevenue = [];
        for ($i = 5; $i >= 0; $i--) {
            $d = $now->modify("-{$i} months");
            $monthsRevenue[] = [
                'monthLabel' => str_replace('.', '', $d->format('M')),
                'monthYear' => ((int) $d->format('n') - 1) . '-' . $d->format('Y'),
                'value' => 0.0,
            ];
        }

        foreach ($paidList as $u) {
            $days = (int) ($u['paymentExpireIn'] ?? 0);
            $plan = null;
            foreach ($plans as $p) {
                if ((int) ($p['days'] ?? 0) === $days) {
                    $plan = $p;
                    break;
                }
            }
            if (!$plan || empty($u['expireIn'])) {
                continue;
            }
            $expire = new \DateTimeImmutable((string) $u['expireIn']);
            $paymentDate = $expire->modify("-{$days} days");
            if ($revenueResetAt && $paymentDate < $revenueResetAt) {
                continue;
            }
            $amount = (float) ($plan['amount'] ?? 0);
            if ($paymentDate >= $startThisMonth) {
                $valueThisMonth += $amount;
                $payingThisMonth++;
            } elseif ($paymentDate >= $startLastMonth) {
                $valueLastMonth += $amount;
                $payingLastMonth++;
            }
            $key = ((int) $paymentDate->format('n') - 1) . '-' . $paymentDate->format('Y');
            foreach ($monthsRevenue as &$m) {
                if ($m['monthYear'] === $key) {
                    $m['value'] += $amount;
                }
            }
            unset($m);
        }

        $last7 = [];
        for ($i = 6; $i >= 0; $i--) {
            $d = $now->modify("-{$i} days");
            $last7[] = [
                'dateStr' => $d->format('D'),
                'dateKey' => $d->format('Y-m-d'),
                'count' => 0,
            ];
        }
        $weekAgo = $now->modify('-7 days')->format('Y-m-d H:i:s');
        $recent = Database::fetchAll('SELECT createdAt FROM users WHERE createdAt >= ?', [$weekAgo]);
        foreach ($recent as $u) {
            $key = date('Y-m-d', strtotime((string) $u['createdAt']));
            foreach ($last7 as &$day) {
                if ($day['dateKey'] === $key) {
                    $day['count']++;
                }
            }
            unset($day);
        }

        json_response([
            'totalUsers' => $totalUsers,
            'paidUsers' => $paidUsers,
            'newUsersThisMonth' => $newUsersThisMonth,
            'newUsersLastMonth' => $newUsersLastMonth,
            'activeBots' => $activeBots,
            'revenue' => [
                'valueThisMonth' => $valueThisMonth,
                'valueLastMonth' => $valueLastMonth,
                'payingThisMonth' => $payingThisMonth,
                'payingLastMonth' => $payingLastMonth,
                'monthsRevenue' => $monthsRevenue,
            ],
            'games' => [
                'double' => $doubleCount,
                'crash' => $crashCount,
                'fortune' => $fortuneCount,
            ],
            'plansDist' => [
                'paid' => $paidUsers,
                'trial' => $trialCount,
                'other' => max(0, $totalUsers - $paidUsers - $trialCount),
            ],
            'last7DaysRegs' => $last7,
        ]);
    }

    public function strategies(): void
    {
        Auth::requireAdmin();
        $method = request_method();
        if ($method === 'GET') {
            json_response(Database::fetchAll('SELECT * FROM admin_strategies ORDER BY id DESC'));
        }
        if ($method === 'POST') {
            $id = Database::insert('admin_strategies', [
                'sequence' => (string) input('sequence', ''),
                'color' => (string) input('color', ''),
                'gameType' => (string) input('gameType', 'DOUBLE'),
                'strategyType' => (string) input('strategyType', 'SEQUÊNCIA'),
                'platform' => (string) input('platform', 'BLAZE'),
            ]);
            json_response(['success' => true, 'id' => $id]);
        }
        if ($method === 'DELETE') {
            $id = (int) ($_GET['id'] ?? input('id', 0));
            Database::delete('admin_strategies', 'id = ?', [$id]);
            json_response(['success' => true]);
        }
        json_response(['error' => 'Método inválido'], 405);
    }

    public function licenses(): void
    {
        Auth::requireAdmin();
        $method = request_method();

        // GET: lista de planos (compat)
        if ($method === 'GET') {
            $raw = ConfigRepository::get('LICENSE_OPTIONS', '[]');
            json_response(json_decode((string) $raw, true) ?: []);
        }

        // POST: liberar dias pra um user  { userId, days }
        if ($method === 'POST') {
            $userId = (int) input('userId', 0);
            $days = (int) input('days', 0);
            // legado: body é array de planos
            if (!$userId && is_array(request_json()) && array_is_list(request_json())) {
                ConfigRepository::set('LICENSE_OPTIONS', json_encode(request_json(), JSON_UNESCAPED_UNICODE));
                json_response(['success' => true]);
            }
            if (!$userId || $days < 1) {
                json_response(['error' => 'Dados inválidos'], 400);
            }
            $user = UserRepository::find($userId);
            if (!$user) {
                json_response(['error' => 'Usuário não encontrado'], 404);
            }
            $current = !empty($user['expireIn']) && strtotime((string) $user['expireIn']) > time()
                ? strtotime((string) $user['expireIn'])
                : time();
            $newExpire = date('Y-m-d H:i:s', $current + ($days * 86400));
            UserRepository::update($userId, [
                'expireIn' => $newExpire,
                'paymentStatus' => 'PAID',
                'paymentExpireIn' => $days,
                'isTesting' => 0,
            ]);
            json_response(['success' => true, 'expireIn' => $newExpire]);
        }

        // DELETE: revogar  { userId }
        if ($method === 'DELETE') {
            $userId = (int) (input('userId', 0) ?: ($_GET['userId'] ?? 0));
            if (!$userId) {
                json_response(['error' => 'ID inválido'], 400);
            }
            UserRepository::update($userId, [
                'paymentStatus' => 'PENDING',
                'expireIn' => null,
            ]);
            json_response(['success' => true]);
        }

        json_response(['error' => 'Método inválido'], 405);
    }
}
