<!DOCTYPE html>
<html lang="pt-BR" class="h-full overflow-x-hidden">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title><?= e($title ?? 'Painel') ?> | AUTOWIN</title>
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
<script>
  tailwind.config = { theme: { extend: { spacing: { '4.5': '1.125rem' } } } }
</script>
</head>
<body class="h-full overflow-x-hidden bg-black text-white antialiased font-sans">
<?php
// Espelha o array `links` de components/user/UserSidebar.tsx — mesma
// ordem, mesmos hrefs/labels/ícones/platform/feature. Não adicionar itens
// que não existem no componente original (estratégias, config-bot, bacbo,
// roletas e futebol são acessados de dentro de outras telas, não por aqui).
$navLinks = [
    ['href' => '/inicio', 'label' => 'Início', 'icon' => '🏠', 'platform' => null, 'feature' => null],
    ['href' => '/conta', 'label' => 'Conta Blaze', 'icon' => '🔑', 'platform' => 'blaze', 'feature' => 'conta_blaze'],
    ['href' => '/jonbet', 'label' => 'Conta Jonbet', 'icon' => '🔑', 'platform' => 'jonbet', 'feature' => 'conta_jonbet'],
    ['href' => '/premium', 'label' => 'Premium Blaze', 'icon' => '💎', 'platform' => 'blaze', 'feature' => 'premium_blaze'],
    ['href' => '/premium-jonbet', 'label' => 'Premium Jonbet', 'icon' => '💎', 'platform' => 'jonbet', 'feature' => 'premium_jonbet'],
    ['href' => '/jogos-premium', 'label' => 'Jogos Ao Vivo', 'icon' => '💎', 'platform' => 'blaze', 'feature' => 'premium_bacbo'],
    ['href' => '/calculadora', 'label' => 'Calculadora Premium', 'icon' => '🧮', 'platform' => null, 'feature' => null],
    ['href' => '/notificacoes', 'label' => 'Notificações', 'icon' => '🔔', 'platform' => null, 'feature' => null],
    ['href' => '/aviso', 'label' => 'Aviso Importante', 'icon' => '📢', 'platform' => null, 'feature' => null],
    ['href' => '/licenca', 'label' => 'Licença', 'icon' => '💳', 'platform' => null, 'feature' => null],
];
$currentPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
// Conta admin (isAdminAccount) ou sessão admin ativa → botão voltar ao /dashboard
$showAdminBack = !empty($user['isAdminAccount'])
    || (class_exists(\App\Auth\Auth::class) && (bool) \App\Auth\Auth::adminId());

// Abas ocultas pelo admin (Configurações de Abas) — aplica no HTML inicial e no JS
$hiddenTabsRaw = class_exists(\App\Models\ConfigRepository::class)
    ? (string) (\App\Models\ConfigRepository::get('HIDDEN_TABS', '') ?? '')
    : '';
$hiddenTabsList = array_values(array_filter(array_map('trim', explode(',', $hiddenTabsRaw))));

function aw_render_nav_links(array $links, string $currentPath, bool $mobile = false, array $hiddenTabs = []): void
{
    foreach ($links as $link) {
        $active = $currentPath === $link['href'];
        $key = ltrim($link['href'], '/');
        $isHidden = in_array($key, $hiddenTabs, true);
        $collapsedClass = $mobile ? 'gap-3 px-3 py-2.5' : 'aw-nav-collapsible gap-3 px-3 py-2.5';
        ?>
        <a
          href="<?= e($link['href']) ?>"
          data-nav-key="<?= e($key) ?>"
          data-platform="<?= e($link['platform'] ?? '') ?>"
          data-feature="<?= e($link['feature'] ?? '') ?>"
          data-label="<?= e($link['label']) ?>"
          class="aw-nav-link flex items-center rounded-lg text-sm font-medium transition-all <?= $collapsedClass ?> <?= $active ? 'aw-nav-active' : 'text-gray-500 hover:text-white hover:bg-white/5' ?><?= $isHidden ? ' hidden' : '' ?>"
        >
          <span class="text-lg shrink-0 relative aw-nav-icon">
            <?= $link['icon'] ?>
            <?php if ($link['href'] === '/aviso'): ?><span class="aw-aviso-dot-icon hidden absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 animate-pulse"></span><?php endif; ?>
          </span>
          <span class="truncate flex items-center gap-1.5 aw-nav-label">
            <?= e($link['label']) ?>
            <?php if ($link['href'] === '/aviso'): ?><span class="aw-aviso-dot-label hidden w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span><?php endif; ?>
          </span>
        </a>
        <?php
    }
}
?>
<div class="flex h-screen bg-black overflow-hidden relative">

  <!-- Sidebar desktop -->
  <aside id="aw-sidebar-desktop" class="aw-sidebar hidden md:flex flex-col shrink-0 transition-all duration-300 w-60">
    <div class="aw-sidebar-header p-4 flex items-center justify-between">
      <div class="flex items-center gap-3 overflow-hidden">
        <img src="/logo.jpg?v=2" alt="AUTOWIN" class="w-9 h-9 rounded-xl object-cover shrink-0 border border-green-500/30 shadow-[0_0_12px_rgba(57,255,20,0.25)]">
        <p class="aw-logo-text text-sm tracking-widest text-white font-bold truncate aw-sidebar-title">AUTOWIN</p>
      </div>
    </div>

    <nav class="flex-1 p-3 space-y-1 overflow-y-auto" id="aw-nav-desktop">
      <?php aw_render_nav_links($navLinks, $currentPath, false, $hiddenTabsList); ?>
    </nav>

    <div class="p-3 space-y-2" style="border-top:1px solid rgba(57,255,20,0.15)">
      <?php if ($showAdminBack): ?>
      <a href="/dashboard" id="aw-admin-back-desktop" class="w-full flex items-center rounded-lg text-sm font-bold text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 transition-colors gap-3 px-3 py-2.5">
        <span class="text-lg shrink-0">🛠️</span><span class="aw-nav-label">Painel Admin</span>
      </a>
      <?php endif; ?>

      <button id="aw-install-btn-desktop" class="aw-download-btn w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-black font-black text-xs tracking-wide shadow-lg">
        <span>📲 BAIXAR APP</span><span>⚡</span>
      </button>

      <div id="aw-social-desktop" class="hidden items-center justify-center gap-2 py-1"></div>

      <button id="aw-logout-desktop" class="w-full flex items-center rounded-lg text-sm font-medium text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors gap-3 px-3 py-2.5">
        <span class="text-lg shrink-0">🚪</span><span>Sair</span>
      </button>

      <button id="aw-collapse-btn" class="w-full flex items-center justify-center py-2 text-xs text-gray-600 hover:text-gray-400 border border-gray-900 hover:border-gray-800 rounded-lg transition-all">
        ◀ Minimizar Menu
      </button>
    </div>
  </aside>

  <!-- Drawer mobile -->
  <div id="aw-mobile-drawer" class="hidden fixed inset-0 z-50 md:hidden">
    <div id="aw-mobile-drawer-backdrop" class="absolute inset-0 bg-black/70 backdrop-blur-sm"></div>
    <aside class="aw-sidebar absolute left-0 top-0 h-full w-72 flex flex-col overflow-hidden">
      <div class="aw-sidebar-header p-4 flex items-center justify-between shrink-0">
        <div class="flex items-center gap-3">
          <img src="/logo.jpg?v=2" alt="AUTOWIN" class="w-9 h-9 rounded-xl object-cover shrink-0 border border-green-500/30 shadow-[0_0_12px_rgba(57,255,20,0.25)]">
          <p class="aw-logo-text text-sm tracking-widest text-white font-bold">AUTOWIN</p>
        </div>
        <button id="aw-mobile-drawer-close" class="text-gray-400 hover:text-white focus:outline-none">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <nav class="flex-1 p-3 space-y-1 overflow-y-auto" id="aw-nav-mobile">
        <?php aw_render_nav_links($navLinks, $currentPath, true, $hiddenTabsList); ?>
      </nav>

      <div class="p-3 shrink-0 space-y-2" style="border-top:1px solid rgba(57,255,20,0.15)">
        <?php if ($showAdminBack): ?>
        <a href="/dashboard" class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-bold text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 transition-colors">
          <span class="text-lg shrink-0">🛠️</span><span>Painel Admin</span>
        </a>
        <?php endif; ?>

        <button id="aw-install-btn-mobile" class="aw-download-btn w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-black font-black text-xs tracking-wide shadow-lg">
          <span>📲 BAIXAR APP</span><span>⚡</span>
        </button>

        <div id="aw-social-mobile" class="hidden items-center justify-center gap-2 py-1"></div>

        <button id="aw-logout-mobile" class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
          <span class="text-lg shrink-0">🚪</span><span>Sair</span>
        </button>
      </div>
    </aside>
  </div>

  <!-- Main content -->
  <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
    <main class="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 pb-24 md:pb-8 bg-black">
      <?= $content ?>
    </main>
  </div>

  <!-- Bottom nav mobile -->
  <nav class="md:hidden fixed bottom-0 left-0 right-0 z-40 flex h-16 bg-black/95 backdrop-blur-xl border-t border-gray-900" id="aw-bottom-nav">
    <?php
    $bottomItems = [
        ['href' => '/inicio', 'label' => 'Início', 'icon' => '🏠', 'platform' => null],
        ['href' => '/conta', 'label' => 'Blaze', 'icon' => '🔑', 'platform' => 'blaze'],
        ['href' => '/jonbet', 'label' => 'Jonbet', 'icon' => '🔑', 'platform' => 'jonbet'],
        ['href' => '/licenca', 'label' => 'Licença', 'icon' => '💳', 'platform' => null],
    ];
    foreach ($bottomItems as $item):
        $active = $currentPath === $item['href'];
        $bKey = ltrim($item['href'], '/');
        $bHidden = in_array($bKey, $hiddenTabsList, true);
    ?>
      <a href="<?= e($item['href']) ?>" data-nav-key="<?= e($bKey) ?>" data-platform="<?= e($item['platform'] ?? '') ?>" data-label="<?= e($item['label']) ?>"
        class="aw-bottom-link flex flex-1 flex-col items-center justify-center gap-1 transition-colors <?= $active ? 'text-green-400' : 'text-gray-500 hover:text-gray-300' ?><?= $bHidden ? ' hidden' : '' ?>">
        <span class="text-lg leading-none"><?= $item['icon'] ?></span>
        <span class="text-[10px] font-medium"><?= e($item['label']) ?></span>
      </a>
    <?php endforeach; ?>
    <button id="aw-open-menu-btn" class="flex flex-1 flex-col items-center justify-center gap-1 text-gray-500 hover:text-gray-300 transition-colors">
      <span class="text-lg leading-none">☰</span>
      <span class="text-[10px] font-medium">Menu</span>
    </button>
  </nav>

  <!-- Modal instalação iOS -->
  <div id="aw-ios-modal" class="hidden fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] items-center justify-center p-4">
    <div class="bg-gray-950 border border-gray-900 rounded-3xl p-6 max-w-sm w-full relative space-y-4 shadow-2xl">
      <button id="aw-ios-modal-close-x" class="absolute top-4 right-4 text-gray-500 hover:text-white font-bold text-base">✕</button>
      <div class="text-center space-y-2">
        <span class="text-4xl">🍎</span>
        <h3 class="text-lg font-black text-white">Instalar no seu iPhone</h3>
        <p class="text-gray-400 text-xs leading-relaxed">O iOS exige a instalação de PWA através do navegador Safari oficial:</p>
      </div>
      <ol class="text-xs text-gray-300 space-y-2.5 bg-gray-900/50 p-4 rounded-2xl border border-gray-900 list-decimal pl-6">
        <li>Abra este site no navegador <strong>Safari</strong> do seu iPhone.</li>
        <li>Toque no botão de <strong>Compartilhar</strong> (ícone de um quadrado com seta para cima na barra inferior).</li>
        <li>Role a lista para baixo e selecione <strong>"Adicionar à Tela de Início"</strong>.</li>
        <li>Clique em <strong>"Adicionar"</strong> no canto superior direito.</li>
      </ol>
      <button id="aw-ios-modal-close" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl text-xs transition-colors">Entendido</button>
    </div>
  </div>

  <!-- Popup de Aviso Importante -->
  <div id="aw-announcement-modal" class="hidden fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] items-center justify-center p-4">
    <div class="bg-gray-950 border border-gray-900 rounded-3xl p-6 max-w-sm w-full relative space-y-4 shadow-2xl">
      <button id="aw-announcement-close-x" class="absolute top-4 right-4 text-gray-500 hover:text-white font-bold text-base">✕</button>
      <div class="text-center space-y-2">
        <span class="text-4xl">📢</span>
        <h3 class="text-lg font-black text-white">Aviso Importante</h3>
      </div>
      <p id="aw-announcement-message" class="text-gray-300 text-sm leading-relaxed bg-gray-900/50 p-4 rounded-2xl border border-gray-900 whitespace-pre-wrap"></p>
      <button id="aw-announcement-open" class="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-xl text-xs transition-colors">Ver detalhes</button>
    </div>
  </div>

  <!-- Card / modal de Teste Grátis (primeiro login, se ainda não usou) -->
  <div id="aw-trial-modal" class="hidden fixed inset-0 bg-black/85 backdrop-blur-sm z-[65] items-center justify-center p-4">
    <div class="bg-gray-950 border border-green-500/30 rounded-3xl p-6 max-w-md w-full relative space-y-5 shadow-2xl shadow-green-500/10">
      <button id="aw-trial-close-x" type="button" class="absolute top-4 right-4 text-gray-500 hover:text-white font-bold text-base">✕</button>
      <div class="text-center space-y-2">
        <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-green-500/15 border border-green-500/30 text-3xl">🎁</div>
        <h3 class="text-xl font-black text-white">Teste Grátis Disponível</h3>
        <p class="text-gray-400 text-sm leading-relaxed">
          Bem-vindo! Ative o teste grátis e use o bot completo por
          <span id="aw-trial-hours-label" class="text-green-400 font-semibold">1h</span>
          sem pagar. Disponível apenas uma vez por conta.
        </p>
      </div>
      <div class="bg-gray-900/70 border border-gray-800 rounded-2xl p-4 space-y-2">
        <p class="text-white text-sm font-semibold flex items-center gap-2"><span>⚡</span> Acesso completo ao bot</p>
        <p class="text-white text-sm font-semibold flex items-center gap-2"><span>🤖</span> Blaze + Jonbet liberados no período</p>
        <p class="text-white text-sm font-semibold flex items-center gap-2"><span>✅</span> Sem cartão · sem compromisso</p>
      </div>
      <p id="aw-trial-err" class="hidden text-red-400 text-xs text-center"></p>
      <button id="aw-trial-start-btn" type="button" class="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-black py-3.5 rounded-xl text-sm transition-colors shadow-[0_4px_20px_rgba(34,197,94,0.35)]">
        Começar Teste Grátis
      </button>
      <button id="aw-trial-plans-btn" type="button" class="w-full text-gray-400 hover:text-white text-xs py-2 transition-colors">
        Ver planos e assinar
      </button>
    </div>
  </div>
</div>

<script>
(function () {
  var deferredPrompt = null;
  var hiddenTabs = <?= json_encode($hiddenTabsList, JSON_UNESCAPED_UNICODE) ?> || [];
  var activePlatform = null;
  var planInfo = { isTesting: false, features: null, isAdminAccount: false };
  var licenseActive = true;
  var trialOfferChecked = false;

  // ── Instalação PWA ──────────────────────────────────────────────
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
  var iosModal = document.getElementById('aw-ios-modal');
  function showIosModal() { iosModal.classList.remove('hidden'); iosModal.classList.add('flex'); }
  function hideIosModal() { iosModal.classList.add('hidden'); iosModal.classList.remove('flex'); }
  document.getElementById('aw-ios-modal-close').addEventListener('click', hideIosModal);
  document.getElementById('aw-ios-modal-close-x').addEventListener('click', hideIosModal);
  function handleInstallClick() {
    var isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIos) { showIosModal(); return; }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (c) { if (c.outcome === 'accepted') deferredPrompt = null; });
    }
  }
  document.getElementById('aw-install-btn-desktop').addEventListener('click', handleInstallClick);
  document.getElementById('aw-install-btn-mobile').addEventListener('click', handleInstallClick);

  // ── Colapsar sidebar desktop ────────────────────────────────────
  var collapsed = false;
  var sidebarDesktop = document.getElementById('aw-sidebar-desktop');
  var collapseBtn = document.getElementById('aw-collapse-btn');
  collapseBtn.addEventListener('click', function () {
    collapsed = !collapsed;
    sidebarDesktop.classList.toggle('w-60', !collapsed);
    sidebarDesktop.classList.toggle('w-16', collapsed);
    sidebarDesktop.querySelectorAll('.aw-sidebar-title, .aw-nav-label').forEach(function (el) { el.classList.toggle('hidden', collapsed); });
    document.querySelectorAll('#aw-nav-desktop .aw-nav-link').forEach(function (el) {
      el.classList.toggle('justify-center', collapsed);
      el.classList.toggle('p-2.5', collapsed);
      el.classList.toggle('gap-3', !collapsed);
      el.classList.toggle('px-3', !collapsed);
      el.classList.toggle('py-2.5', !collapsed);
    });
    document.getElementById('aw-social-desktop').classList.toggle('hidden', collapsed || !document.getElementById('aw-social-desktop').dataset.hasLinks);
    collapseBtn.textContent = collapsed ? '▶' : '◀ Minimizar Menu';
  });

  // ── Drawer mobile ────────────────────────────────────────────────
  var drawer = document.getElementById('aw-mobile-drawer');
  document.getElementById('aw-open-menu-btn').addEventListener('click', function () { drawer.classList.remove('hidden'); });
  document.getElementById('aw-mobile-drawer-backdrop').addEventListener('click', function () { drawer.classList.add('hidden'); });
  document.getElementById('aw-mobile-drawer-close').addEventListener('click', function () { drawer.classList.add('hidden'); });
  document.querySelectorAll('#aw-nav-mobile .aw-nav-link').forEach(function (a) {
    a.addEventListener('click', function () { drawer.classList.add('hidden'); });
  });

  // ── Logout ───────────────────────────────────────────────────────
  function logout() {
    fetch('/api/user/me', { method: 'DELETE' }).finally(function () { location.href = '/'; });
  }
  document.getElementById('aw-logout-desktop').addEventListener('click', logout);
  document.getElementById('aw-logout-mobile').addEventListener('click', logout);

  // ── Redes sociais (rodapé da sidebar) ──────────────────────────
  function socialLinkHtml(href, svg) {
    return '<a href="' + href + '" target="_blank" rel="noopener noreferrer" class="w-8 h-8 rounded-full bg-gray-900 border border-gray-800 flex items-center justify-center text-gray-500 hover:border-gray-700 hover:bg-gray-800 hover:text-white transition-all">' + svg + '</a>';
  }
  var ICON_INSTAGRAM = '<svg viewBox="0 0 24 24" fill="currentColor" class="w-3.5 h-3.5"><path d="M12 0C8.74 0 8.333.014 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.132 5.775.072 7.053.014 8.333 0 8.74 0 12s.014 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.014 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913C23.988 15.667 24 15.259 24 12s-.014-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.014 15.259 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z"/></svg>';
  var ICON_TELEGRAM = '<svg viewBox="0 0 24 24" fill="currentColor" class="w-3.5 h-3.5"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>';
  var ICON_GITHUB = '<svg viewBox="0 0 24 24" fill="currentColor" class="w-3.5 h-3.5"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>';

  function renderSocial(social) {
    var html = '';
    if (social.instagram) html += socialLinkHtml(social.instagram, ICON_INSTAGRAM);
    if (social.telegram) html += socialLinkHtml(social.telegram, ICON_TELEGRAM);
    if (social.github) html += socialLinkHtml(social.github, ICON_GITHUB);
    ['aw-social-desktop', 'aw-social-mobile'].forEach(function (id) {
      var el = document.getElementById(id);
      el.innerHTML = html;
      var has = html !== '';
      el.dataset.hasLinks = has ? '1' : '';
      el.classList.toggle('hidden', !has || (id === 'aw-social-desktop' && collapsed));
      el.classList.toggle('flex', has);
    });
  }

  fetch('/api/plans').then(function (r) { return r.json(); }).then(function (data) {
    renderSocial(data.social || {});
  }).catch(function () {});

  // ── Estado do usuário (plataforma ativa / licença / features / abas ocultas) ──
  function hasFeature(key) {
    if (planInfo.isAdminAccount) return true;
    if (planInfo.isTesting) return true;
    if (!planInfo.features) return true;
    try {
      var arr = JSON.parse(planInfo.features);
      return arr.indexOf(key) !== -1;
    } catch (e) { return true; }
  }

  function applyLinkLockState(link, platform, feature) {
    var platformLocked = !!activePlatform && !!platform && platform !== activePlatform;
    var licenseLocked = !!feature && !licenseActive;
    var featureLocked = !!feature && licenseActive && !hasFeature(feature);
    var locked = platformLocked || licenseLocked || featureLocked;
    var reason = platformLocked
      ? ('Pare o bot da ' + (activePlatform === 'blaze' ? 'Blaze' : 'Jonbet') + ' para acessar')
      : licenseLocked ? 'Licença expirada — renove em Licença'
      : featureLocked ? 'Não incluído no seu plano — veja Licença' : '';
    var iconEl = link.querySelector('.aw-nav-icon');
    if (locked) {
      link.classList.add('opacity-40', 'cursor-not-allowed', 'pointer-events-none');
      link.title = reason;
      if (iconEl && !iconEl.dataset.origIcon) {
        iconEl.dataset.origIcon = iconEl.innerHTML;
        iconEl.textContent = '🔒';
      }
    } else {
      link.classList.remove('opacity-40', 'cursor-not-allowed', 'pointer-events-none');
      link.removeAttribute('title');
      if (iconEl && iconEl.dataset.origIcon) {
        iconEl.innerHTML = iconEl.dataset.origIcon;
        delete iconEl.dataset.origIcon;
      }
    }
  }

  function applyHiddenTabs() {
    // Esconde o próprio link (não o parent <nav>!) — bug antigo deixava abas sempre visíveis
    document.querySelectorAll('.aw-nav-link, #aw-bottom-nav .aw-bottom-link').forEach(function (link) {
      var key = link.dataset.navKey || (link.getAttribute('href') || '').replace(/^\//, '');
      if (!key) return;
      var hide = hiddenTabs.indexOf(key) !== -1;
      link.classList.toggle('hidden', hide);
    });
  }

  function hideTrialModal() {
    var m = document.getElementById('aw-trial-modal');
    if (!m) return;
    m.classList.add('hidden');
    m.classList.remove('flex');
  }

  function showTrialModal(hours) {
    var m = document.getElementById('aw-trial-modal');
    if (!m) return;
    var label = document.getElementById('aw-trial-hours-label');
    if (label) {
      var h = Number(hours) || 1;
      label.textContent = h === 1 ? '1 hora' : (h + ' horas');
    }
    m.classList.remove('hidden');
    m.classList.add('flex');
  }

  function maybeShowTrialOffer(userData) {
    if (trialOfferChecked) return;
    trialOfferChecked = true;
    window.__awTrialUserId = userData.id;
    // Já usou trial ou tem licença ativa → não mostra
    if (userData.alreadyTested) return;
    if (userData.isAdminAccount) return;
    var hasValidExpiry = !!userData.expireIn && new Date(userData.expireIn) > new Date();
    var active = hasValidExpiry && (userData.paymentStatus === 'PAID' || userData.isTesting);
    if (active) return;

    // Evita reabrir na mesma sessão se o usuário fechou
    var dismissKey = 'trial_offer_dismissed_' + String(userData.id || '');
    try {
      if (sessionStorage.getItem(dismissKey) === '1') return;
    } catch (e) {}

    fetch('/api/plans', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (plansData) {
        var hours = plansData && plansData.trialHours != null ? Number(plansData.trialHours) : 0;
        if (!(hours > 0)) return;
        showTrialModal(hours);
      })
      .catch(function () {});
  }

  function dismissTrialOffer() {
    hideTrialModal();
    try {
      var uid = window.__awTrialUserId;
      if (uid != null) sessionStorage.setItem('trial_offer_dismissed_' + String(uid), '1');
    } catch (e) {}
  }

  function refreshState() {
    fetch('/api/user/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
      if (!data) return;
      activePlatform = data.isActive ? 'blaze' : (data.jonbetIsActive ? 'jonbet' : null);
      planInfo = { isTesting: !!data.isTesting, features: data.features || null, isAdminAccount: !!data.isAdminAccount };
      // Aceita string "a,b" ou array (defensivo)
      if (Array.isArray(data.hiddenTabs)) {
        hiddenTabs = data.hiddenTabs.map(function (x) { return String(x).trim(); }).filter(Boolean);
      } else if (typeof data.hiddenTabs === 'string' && data.hiddenTabs) {
        hiddenTabs = data.hiddenTabs.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      } else {
        hiddenTabs = [];
      }

      var hasValidExpiry = !!data.expireIn && new Date(data.expireIn) > new Date();
      licenseActive = !!data.isAdminAccount || (hasValidExpiry && (data.paymentStatus === 'PAID' || data.isTesting));

      document.querySelectorAll('.aw-nav-link').forEach(function (link) {
        applyLinkLockState(link, link.dataset.platform, link.dataset.feature);
      });
      document.querySelectorAll('#aw-bottom-nav .aw-bottom-link').forEach(function (link) {
        var platform = link.dataset.platform;
        var locked = !!activePlatform && !!platform && platform !== activePlatform;
        link.classList.toggle('opacity-40', locked);
        link.classList.toggle('pointer-events-none', locked);
        link.title = locked ? ('Pare o bot da ' + (activePlatform === 'blaze' ? 'Blaze' : 'Jonbet') + ' para acessar') : '';
      });
      applyHiddenTabs();
      maybeShowTrialOffer(data);
    }).catch(function () {});
  }
  applyHiddenTabs(); // aplica estado inicial vindo do PHP
  refreshState();
  setInterval(refreshState, 3000);

  // ── Trial modal handlers ─────────────────────────────────────
  (function bindTrialModal() {
    var closeX = document.getElementById('aw-trial-close-x');
    var startBtn = document.getElementById('aw-trial-start-btn');
    var plansBtn = document.getElementById('aw-trial-plans-btn');
    var errEl = document.getElementById('aw-trial-err');

    if (closeX) closeX.addEventListener('click', dismissTrialOffer);
    if (plansBtn) {
      plansBtn.addEventListener('click', function () {
        dismissTrialOffer();
        location.href = '/licenca';
      });
    }
    if (startBtn) {
      startBtn.addEventListener('click', function () {
        startBtn.disabled = true;
        startBtn.textContent = 'Ativando...';
        if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; }
        fetch('/api/trial/start', { method: 'POST' })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
          .then(function (res) {
            if (!res.ok) {
              if (errEl) {
                errEl.textContent = (res.data && res.data.error) ? res.data.error : 'Erro ao ativar trial';
                errEl.classList.remove('hidden');
              }
              startBtn.disabled = false;
              startBtn.textContent = 'Começar Teste Grátis';
              return;
            }
            dismissTrialOffer();
            location.reload();
          })
          .catch(function () {
            if (errEl) {
              errEl.textContent = 'Erro ao conectar';
              errEl.classList.remove('hidden');
            }
            startBtn.disabled = false;
            startBtn.textContent = 'Começar Teste Grátis';
          });
      });
    }
  })();

  // ── Aviso importante (popup) ────────────────────────────────────
  var SEEN_KEY = 'aviso_seen_id';
  var announcementModal = document.getElementById('aw-announcement-modal');
  function showAnnouncementModal(msg) {
    document.getElementById('aw-announcement-message').textContent = msg;
    announcementModal.classList.remove('hidden'); announcementModal.classList.add('flex');
  }
  function hideAnnouncementModal() { announcementModal.classList.add('hidden'); announcementModal.classList.remove('flex'); }
  document.getElementById('aw-announcement-close-x').addEventListener('click', function () {
    dismissAnnouncement();
  });
  document.getElementById('aw-announcement-open').addEventListener('click', function () {
    hideAnnouncementModal();
    location.href = '/aviso';
  });
  var currentAnnouncement = null;
  function dismissAnnouncement() {
    if (currentAnnouncement) {
      try { localStorage.setItem(SEEN_KEY, String(currentAnnouncement.id)); } catch (e) {}
    }
    setUnseen(false);
    hideAnnouncementModal();
  }
  function setUnseen(unseen) {
    document.querySelectorAll('.aw-aviso-dot-icon, .aw-aviso-dot-label').forEach(function (el) {
      el.classList.toggle('hidden', !unseen);
    });
  }
  window.addEventListener('aviso-seen', function () { setUnseen(false); });

  function fetchAnnouncement() {
    fetch('/api/user/announcement').then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
      if (!data || !data.announcement) return;
      currentAnnouncement = data.announcement;
      var seenId = null;
      try { seenId = localStorage.getItem(SEEN_KEY); } catch (e) {}
      var isUnseen = seenId !== String(data.announcement.id);
      setUnseen(isUnseen);
      if (isUnseen) showAnnouncementModal(data.announcement.message);
    }).catch(function () {});
  }
  fetchAnnouncement();
  setInterval(fetchAnnouncement, 20000);
})();
</script>
</body>
</html>
