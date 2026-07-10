<?php

declare(strict_types=1);

// Serve arquivos estáticos se existirem em /public (assets, imagens, sw, etc.)
// Necessário quando o front controller recebe todas as requisições.
$reqPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$reqPath = rawurldecode($reqPath);
if ($reqPath !== '/' && !str_contains($reqPath, '..')) {
    $static = __DIR__ . $reqPath;
    if (is_file($static)) {
        $ext = strtolower(pathinfo($static, PATHINFO_EXTENSION));
        $types = [
            'js' => 'application/javascript; charset=utf-8',
            'mjs' => 'application/javascript; charset=utf-8',
            'css' => 'text/css; charset=utf-8',
            'map' => 'application/json; charset=utf-8',
            'json' => 'application/json; charset=utf-8',
            'png' => 'image/png',
            'jpg' => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'gif' => 'image/gif',
            'webp' => 'image/webp',
            'svg' => 'image/svg+xml',
            'ico' => 'image/x-icon',
            'woff' => 'font/woff',
            'woff2' => 'font/woff2',
            'ttf' => 'font/ttf',
            'webmanifest' => 'application/manifest+json',
            'txt' => 'text/plain; charset=utf-8',
        ];
        if (isset($types[$ext])) {
            header('Content-Type: ' . $types[$ext]);
            header('Content-Length: ' . (string) filesize($static));
            // cache curto para assets versionados por ?v=
            if (in_array($ext, ['js', 'css', 'map'], true)) {
                header('Cache-Control: public, max-age=60');
            }
            readfile($static);
            exit;
        }
    }
}

require dirname(__DIR__) . '/vendor/autoload.php';

use App\Bootstrap;

Bootstrap::init();

/** @var \App\Router $router */
$router = require dirname(__DIR__) . '/routes/web.php';
$router->dispatch(
    $_SERVER['REQUEST_METHOD'] ?? 'GET',
    $_SERVER['REQUEST_URI'] ?? '/'
);
