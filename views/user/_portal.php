<?php
/** @var string $portalPage nome do bundle em /assets/portal/{name}.js */
$portalPage = $portalPage ?? 'inicio';
$safe = preg_replace('/[^a-z0-9\-]/i', '', $portalPage) ?: 'inicio';
$bundlePath = public_path('assets/portal/' . $safe . '.js');
$bundleUrl = '/assets/portal/' . $safe . '.js';
$v = is_file($bundlePath) ? (int) filemtime($bundlePath) : time();
$exists = is_file($bundlePath);
?>
<div id="portal-root" class="min-h-[50vh]">
  <?php if (!$exists): ?>
    <div class="p-6 text-red-400 text-sm space-y-2">
      <p class="font-bold">Bundle da aba não encontrado: <code><?= e($safe) ?>.js</code></p>
      <p class="text-gray-400">Rode no projeto: <code class="text-green-400">npm run build:portal</code></p>
    </div>
  <?php else: ?>
    <div class="flex flex-col items-center justify-center h-64 gap-3 text-gray-500 text-sm">
      <div class="w-8 h-8 rounded-full border-2 border-gray-700 border-t-green-500 animate-spin"></div>
      <span>Carregando interface…</span>
    </div>
  <?php endif; ?>
</div>
<?php if ($exists): ?>
<!-- React 18 UMD (createRoot em ReactDOM) -->
<script crossorigin src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
<script>
  // Compat: alguns builds esperam ReactJSX no global
  window.ReactJSX = window.ReactJSX || {
    Fragment: React.Fragment,
    jsx: function (type, props, key) {
      var rest = Object.assign({}, props || {});
      var children = rest.children;
      delete rest.children;
      if (key !== undefined && key !== null) rest.key = key;
      var kids = children === undefined ? [] : (Array.isArray(children) ? children : [children]);
      return React.createElement.apply(React, [type, rest].concat(kids));
    },
    jsxs: function (type, props, key) {
      return window.ReactJSX.jsx(type, props, key);
    }
  };
</script>
<script src="<?= e($bundleUrl) ?>?v=<?= $v ?>"
  onerror="document.getElementById('portal-root').innerHTML='<div class=\'p-6 text-red-400 text-sm\'><p class=\'font-bold\'>Falha ao carregar JS da aba.</p><p class=\'text-gray-400 mt-1\'>Tente abrir: <a class=\'text-green-400 underline\' href=\'<?= e($bundleUrl) ?>\' target=\'_blank\'><?= e($bundleUrl) ?></a></p><p class=\'text-gray-500 mt-2\'>Se der 404, rode <code>npm run build:portal</code> e reinicie o servidor PHP.</p></div>'"></script>
<?php endif; ?>
