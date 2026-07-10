<!DOCTYPE html>
<html lang="pt-BR" class="h-full overflow-x-hidden">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title><?= e($title ?? 'AutoWin') ?> | AUTOWIN</title>
<link rel="icon" href="/logo.jpg?v=2" type="image/jpeg" sizes="any">
<link rel="icon" href="/favicon.ico?v=2" sizes="32x32">
<link rel="icon" href="/icon.svg?v=2" type="image/svg+xml">
<link rel="apple-touch-icon" href="/logo.jpg?v=2">
<link rel="shortcut icon" href="/logo.jpg?v=2">
<link rel="manifest" href="/manifest.json">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="stylesheet" href="/assets/aw-effects.css">
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="h-full overflow-x-hidden bg-black text-white antialiased font-sans">
<?= $content ?>
</body>
</html>
