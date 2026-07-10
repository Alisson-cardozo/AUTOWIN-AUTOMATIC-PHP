<!DOCTYPE html>
<html lang="pt-BR" class="h-full overflow-x-hidden">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title><?= e($title ?? 'Admin') ?> | AUTOWIN</title>
<link rel="icon" href="/logo.jpg?v=2" type="image/jpeg" sizes="any">
<link rel="icon" href="/favicon.ico?v=2" sizes="32x32">
<link rel="icon" href="/icon.svg?v=2" type="image/svg+xml">
<link rel="apple-touch-icon" href="/logo.jpg?v=2">
<link rel="shortcut icon" href="/logo.jpg?v=2">
<link rel="stylesheet" href="/assets/aw-effects.css">
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = { theme: { extend: { spacing: { '4.5': '1.125rem' } } } }
</script>
</head>
<body class="h-full overflow-x-hidden bg-black text-white antialiased font-sans">
<?php
// Espelha components/dashboard/Sidebar.tsx
$adminLinks = [
    ['href' => '/dashboard', 'label' => 'Dashboard', 'icon' => '📊', 'nav' => 'dashboard'],
    ['href' => '/users', 'label' => 'Usuários', 'icon' => '👥', 'nav' => 'users'],
    ['href' => '/padroes', 'label' => 'Configurações de Abas', 'icon' => '🎯', 'nav' => 'padroes'],
    ['href' => '/financeiro', 'label' => 'Planos e Gateway', 'icon' => '💳', 'nav' => 'financeiro'],
    ['href' => '/comunicacao', 'label' => 'Comunicação', 'icon' => '📢', 'nav' => 'comunicacao'],
    ['href' => '/sistema', 'label' => 'Sistema', 'icon' => '🛠️', 'nav' => 'sistema'],
    ['href' => '/configuracoes', 'label' => 'Configurações', 'icon' => '⚙️', 'nav' => 'config'],
];
$clientLinks = [
    ['href' => '/inicio', 'label' => 'Início', 'icon' => '🏠'],
    ['href' => '/conta', 'label' => 'Conta Blaze', 'icon' => '🔑'],
    ['href' => '/jonbet', 'label' => 'Conta Jonbet', 'icon' => '🔑'],
    ['href' => '/premium', 'label' => 'Premium Blaze', 'icon' => '💎'],
    ['href' => '/premium-jonbet', 'label' => 'Premium Jonbet', 'icon' => '💎'],
    ['href' => '/jogos-premium', 'label' => 'Jogos Ao Vivo', 'icon' => '💎'],
    ['href' => '/calculadora', 'label' => 'Calculadora Premium', 'icon' => '🧮'],
    ['href' => '/notificacoes', 'label' => 'Notificações', 'icon' => '🔔'],
];
$currentNav = $nav ?? '';
$adminEmail = '';
try {
    $adm = \App\Auth\Auth::admin();
    $adminEmail = $adm['email'] ?? ($adm['username'] ?? '');
} catch (\Throwable $e) {
}
?>
<div class="flex h-screen bg-black overflow-hidden">

  <!-- Sidebar desktop -->
  <aside class="aw-sidebar hidden md:flex w-60 flex-col shrink-0">
    <div class="aw-sidebar-header p-5">
      <div class="flex items-center gap-3">
        <img src="/logo.jpg?v=2" alt="AUTOWIN" class="w-10 h-10 rounded-xl object-cover shrink-0 border border-green-500/30 shadow-[0_0_12px_rgba(57,255,20,0.25)]">
        <div>
          <p class="aw-logo-text text-sm tracking-widest">AUTOWIN</p>
          <p class="text-xs font-semibold" style="color:#FFE600;text-shadow:0 0 6px #FFE600">Admin Panel</p>
        </div>
      </div>
    </div>

    <nav class="flex-1 p-3 space-y-1 overflow-y-auto">
      <?php foreach ($adminLinks as $link):
        $active = $currentNav === $link['nav'] || (parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) === $link['href']);
      ?>
        <a href="<?= e($link['href']) ?>"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all <?= $active ? 'aw-nav-active' : 'text-gray-500 hover:text-white hover:bg-white/5' ?>">
          <span><?= $link['icon'] ?></span><?= e($link['label']) ?>
        </a>
      <?php endforeach; ?>

      <p class="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-widest text-gray-600">Área do Cliente</p>
      <?php foreach ($clientLinks as $link): ?>
        <a href="<?= e($link['href']) ?>"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-gray-500 hover:text-white hover:bg-white/5">
          <span><?= $link['icon'] ?></span><?= e($link['label']) ?>
        </a>
      <?php endforeach; ?>
    </nav>

    <div class="p-3" style="border-top:1px solid rgba(57,255,20,0.15)">
      <div class="px-3 py-2 text-xs font-mono" style="color:rgba(57,255,20,0.4)">v1.0.0 · AUTOWIN</div>
    </div>
  </aside>

  <!-- Drawer mobile -->
  <div id="aw-admin-drawer" class="hidden fixed inset-0 z-50 md:hidden">
    <div id="aw-admin-drawer-bg" class="absolute inset-0 bg-black/70 backdrop-blur-sm"></div>
    <aside class="aw-sidebar absolute left-0 top-0 h-full w-72 flex flex-col overflow-hidden">
      <div class="aw-sidebar-header p-4 flex items-center justify-between shrink-0">
        <div class="flex items-center gap-3">
          <img src="/logo.jpg?v=2" alt="AUTOWIN" class="w-9 h-9 rounded-xl object-cover shrink-0 border border-green-500/30 shadow-[0_0_12px_rgba(57,255,20,0.25)]">
          <div>
            <p class="aw-logo-text text-sm tracking-widest">AUTOWIN</p>
            <p class="text-xs font-semibold" style="color:#FFE600;text-shadow:0 0 6px #FFE600">Admin Panel</p>
          </div>
        </div>
        <button id="aw-admin-drawer-close" class="text-gray-400 hover:text-white">✕</button>
      </div>
      <nav class="flex-1 p-3 space-y-1 overflow-y-auto">
        <?php foreach ($adminLinks as $link):
          $active = $currentNav === $link['nav'];
        ?>
          <a href="<?= e($link['href']) ?>" class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all <?= $active ? 'aw-nav-active' : 'text-gray-500 hover:text-white hover:bg-white/5' ?>">
            <span><?= $link['icon'] ?></span><?= e($link['label']) ?>
          </a>
        <?php endforeach; ?>
        <p class="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-widest text-gray-600">Área do Cliente</p>
        <?php foreach ($clientLinks as $link): ?>
          <a href="<?= e($link['href']) ?>" class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:text-white hover:bg-white/5">
            <span><?= $link['icon'] ?></span><?= e($link['label']) ?>
          </a>
        <?php endforeach; ?>
      </nav>
    </aside>
  </div>

  <div class="flex flex-col flex-1 overflow-hidden min-w-0">
    <!-- Header -->
    <header class="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4 md:px-6 shrink-0">
      <button id="aw-admin-menu" class="md:hidden text-gray-400 hover:text-white p-1 -ml-1" aria-label="Abrir menu">
        <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
      </button>
      <div class="flex items-center gap-4 ml-auto">
        <span class="text-sm text-gray-400 truncate max-w-[40vw] md:max-w-none"><?= e($adminEmail) ?></span>
        <button id="aw-admin-logout" class="text-sm text-gray-400 hover:text-white transition-colors shrink-0">Sair</button>
      </div>
    </header>

    <main class="flex-1 overflow-y-auto p-6 bg-black">
      <?= $content ?>
    </main>
  </div>
</div>

<script>
(function () {
  var drawer = document.getElementById('aw-admin-drawer');
  document.getElementById('aw-admin-menu')?.addEventListener('click', function () {
    drawer.classList.remove('hidden');
  });
  document.getElementById('aw-admin-drawer-bg')?.addEventListener('click', function () {
    drawer.classList.add('hidden');
  });
  document.getElementById('aw-admin-drawer-close')?.addEventListener('click', function () {
    drawer.classList.add('hidden');
  });
  document.getElementById('aw-admin-logout')?.addEventListener('click', function () {
    fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .finally(function () { location.href = '/login'; });
  });
})();
</script>
</body>
</html>
