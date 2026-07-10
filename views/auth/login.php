<div class="aw-login-bg min-h-screen flex flex-col items-center justify-center py-8">
  <div class="w-full max-w-md px-4 mb-4">
    <a href="/" class="inline-flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-green-400 transition-colors group">
      <span class="text-sm transition-transform group-hover:-translate-x-1">←</span> Voltar para a página inicial
    </a>
  </div>
  <div class="w-full max-w-md px-4">

    <div class="text-center mb-8">
      <div class="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-5 overflow-hidden" style="border:1px solid rgba(57,255,20,0.3); box-shadow:0 0 20px rgba(57,255,20,0.15)">
        <img src="/logo.jpg" alt="Logo" class="w-full h-full object-cover">
      </div>
      <h1 class="aw-logo-text text-4xl mb-1" style="letter-spacing:0.25em">AUTOWIN</h1>
    </div>

    <div class="aw-login-card rounded-2xl p-8">
      <form id="login-form" class="space-y-5">
        <div>
          <label class="block text-xs font-semibold text-gray-400 mb-2 tracking-wider uppercase">Email</label>
          <input type="email" name="email" required autocomplete="username" class="aw-input w-full rounded-lg px-4 py-3 text-sm" placeholder="seu@email.com">
        </div>

        <div>
          <label class="block text-xs font-semibold text-gray-400 mb-2 tracking-wider uppercase">Senha</label>
          <input type="password" name="password" required autocomplete="current-password" class="aw-input w-full rounded-lg px-4 py-3 text-sm" placeholder="••••••••">
        </div>

        <div id="login-error" class="hidden rounded-lg px-4 py-3 text-sm" style="background:rgba(255,50,50,0.08); border:1px solid rgba(255,50,50,0.3); color:#ff6b6b"></div>

        <button type="submit" id="login-submit" class="aw-btn-green w-full rounded-lg py-3 text-sm tracking-wider">ENTRAR</button>
      </form>

      <p class="text-center text-gray-600 text-xs mt-6">
        Não tem conta?
        <a href="/primeiro-acesso" class="font-semibold transition-colors" style="color:#39FF14">Criar conta</a>
      </p>
    </div>
  </div>
</div>

<script>
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const errorBox = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');
  errorBox.classList.add('hidden');
  submitBtn.disabled = true;
  submitBtn.textContent = 'ENTRANDO...';

  try {
    const res = await fetch('/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorBox.textContent = data.error || 'Erro ao entrar.';
      errorBox.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'ENTRAR';
      return;
    }
    location.href = data.isAdmin ? '/dashboard' : '/inicio';
  } catch (err) {
    errorBox.textContent = 'Erro de conexão.';
    errorBox.classList.remove('hidden');
    submitBtn.disabled = false;
    submitBtn.textContent = 'ENTRAR';
  }
});
</script>
