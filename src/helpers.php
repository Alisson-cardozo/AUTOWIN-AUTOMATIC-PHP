<?php

declare(strict_types=1);

function env(string $key, mixed $default = null): mixed
{
    $v = $_ENV[$key] ?? $_SERVER[$key] ?? getenv($key);
    if ($v === false || $v === null || $v === '') {
        return $default;
    }
    return match (strtolower((string) $v)) {
        'true', '(true)' => true,
        'false', '(false)' => false,
        'null', '(null)' => null,
        default => $v,
    };
}

function base_path(string $path = ''): string
{
    return dirname(__DIR__) . ($path ? DIRECTORY_SEPARATOR . ltrim($path, '/\\') : '');
}

function public_path(string $path = ''): string
{
    return base_path('public' . ($path ? '/' . ltrim($path, '/') : ''));
}

function storage_path(string $path = ''): string
{
    return base_path('storage' . ($path ? '/' . ltrim($path, '/') : ''));
}

function view_path(string $path = ''): string
{
    return base_path('views' . ($path ? '/' . ltrim($path, '/') : ''));
}

function json_response(mixed $data, int $status = 200, array $headers = []): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    foreach ($headers as $k => $v) {
        header("$k: $v", false);
    }
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * URL pública do painel (APP_URL no .env ou host da request).
 * Usada pelo browser bridge (script no domínio da Evolution/Blaze).
 */
function public_base_url(): string
{
    $fromEnv = trim((string) env('APP_URL', ''));
    if ($fromEnv !== '') {
        return rtrim($fromEnv, '/');
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
    $host = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
    return ($https ? 'https' : 'http') . '://' . $host;
}

/**
 * Headers CORS pras rotas do Bac Bo bridge — o script roda no domínio do jogo
 * (Evolution/Blaze) e chama a API do Autowin com Authorization: Bearer.
 *
 * @return array<string, string>
 */
function cors_bridge_headers(): array
{
    $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '*');
    if ($origin === '') {
        $origin = '*';
    }
    return [
        'Access-Control-Allow-Origin' => $origin,
        'Access-Control-Allow-Methods' => 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers' => 'Authorization, Content-Type',
        'Access-Control-Max-Age' => '86400',
        'Vary' => 'Origin',
    ];
}

/** Responde preflight OPTIONS do browser bridge e encerra. */
function cors_bridge_preflight(): never
{
    json_response(['ok' => true], 200, cors_bridge_headers());
}

/**
 * Envia JSON e libera a conexão HTTP, permitindo continuar o PHP
 * (ex.: login Blaze com captcha demorado sem o front ficar esperando).
 */
function json_response_and_continue(mixed $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Connection: close');
    $body = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}';
    header('Content-Length: ' . (string) strlen($body));
    echo $body;
    while (ob_get_level() > 0) {
        ob_end_flush();
    }
    flush();
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    }
    ignore_user_abort(true);
    @set_time_limit(180);
}

function redirect(string $url, int $status = 302): never
{
    http_response_code($status);
    header("Location: $url");
    exit;
}

function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function now(): string
{
    return (new DateTimeImmutable('now'))->format('Y-m-d H:i:s');
}

function today_date(): string
{
    return (new DateTimeImmutable('now'))->format('Y-m-d');
}

function b64url_encode(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function b64url_decode(string $data): string|false
{
    $remainder = strlen($data) % 4;
    if ($remainder) {
        $data .= str_repeat('=', 4 - $remainder);
    }
    return base64_decode(strtr($data, '-_', '+/'), true);
}

function request_json(): array
{
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }
    $raw = file_get_contents('php://input') ?: '';
    $data = json_decode($raw, true);
    $cached = is_array($data) ? $data : [];
    return $cached;
}

function request_method(): string
{
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

function is_post(): bool
{
    return request_method() === 'POST';
}

function input(string $key, mixed $default = null): mixed
{
    $json = request_json();
    if (array_key_exists($key, $json)) {
        return $json[$key];
    }
    if (array_key_exists($key, $_POST)) {
        return $_POST[$key];
    }
    if (array_key_exists($key, $_GET)) {
        return $_GET[$key];
    }
    return $default;
}

function cookie(string $name, ?string $default = null): ?string
{
    return isset($_COOKIE[$name]) ? (string) $_COOKIE[$name] : $default;
}

function set_cookie(string $name, string $value, int $maxAgeSeconds): void
{
    $secure = (env('APP_ENV') === 'production');
    setcookie($name, $value, [
        'expires' => time() + $maxAgeSeconds,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => $secure,
    ]);
}

function clear_cookie(string $name): void
{
    setcookie($name, '', [
        'expires' => time() - 3600,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function log_msg(string $message, string $channel = 'app'): void
{
    $dir = storage_path('logs');
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $line = '[' . date('Y-m-d H:i:s') . "] $message\n";
    file_put_contents($dir . "/$channel.log", $line, FILE_APPEND);
}

function feature_list(?string $json): ?array
{
    if ($json === null || $json === '') {
        return null;
    }
    $decoded = json_decode($json, true);
    return is_array($decoded) ? $decoded : null;
}
