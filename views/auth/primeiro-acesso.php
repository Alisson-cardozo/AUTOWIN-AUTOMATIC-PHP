<div class="aw-login-bg min-h-screen flex flex-col items-center justify-center py-8">
  <div class="w-full max-w-md px-4 mb-4">
    <a href="/" class="inline-flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-green-400 transition-colors group">
      <span class="text-sm transition-transform group-hover:-translate-x-1">←</span> Voltar para a página inicial
    </a>
  </div>
  <div class="w-full max-w-md px-4">
    <div class="aw-login-card rounded-2xl p-8">
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style="background:rgba(57,255,20,0.06); border:1px solid rgba(57,255,20,0.3); box-shadow:0 0 15px rgba(57,255,20,0.1)">
          <span class="text-3xl" style="filter:drop-shadow(0 0 6px #39FF14)">⚡</span>
        </div>
        <h1 class="aw-logo-text text-2xl mb-1" style="letter-spacing:0.2em">AUTOWIN</h1>
        <p class="text-xs font-semibold" style="color:#FFE600; text-shadow:0 0 6px #FFE600">CRIAR CONTA</p>
      </div>

      <form id="pa-form" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1.5">Nome</label>
          <input type="text" name="name" required class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition" placeholder="Seu nome">
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
          <input type="email" name="email" required class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition" placeholder="seu@email.com">
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1.5">Senha</label>
          <input type="password" name="password" required minlength="6" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition" placeholder="••••••••">
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1.5">Confirmar Senha</label>
          <input type="password" name="confirm" required minlength="6" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition" placeholder="••••••••">
        </div>

        <div id="pa-error" class="hidden bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm"></div>

        <button type="submit" id="pa-submit" class="w-full bg-green-500 hover:bg-green-400 disabled:bg-green-500/50 text-black font-semibold py-2.5 rounded-lg transition-colors">Criar Conta</button>
      </form>

      <p class="text-center text-gray-400 text-sm mt-6">
        Já tem conta?
        <a href="/entrar" class="text-green-400 hover:text-green-300">Entrar</a>
      </p>
    </div>
  </div>
</div>

<script>
document.getElementById('pa-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const errorBox = document.getElementById('pa-error');
  const submitBtn = document.getElementById('pa-submit');
  errorBox.classList.add('hidden');

  if (fd.get('password') !== fd.get('confirm')) {
    errorBox.textContent = 'As senhas não coincidem.';
    errorBox.classList.remove('hidden');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Criando conta...';

  try {
    const res = await fetch('/api/user/primeiro-acesso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fd.get('name'), email: fd.get('email'), password: fd.get('password') }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorBox.textContent = data.error || 'Erro ao criar conta.';
      errorBox.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Criar Conta';
      return;
    }
    location.href = '/entrar';
  } catch (err) {
    errorBox.textContent = 'Erro de conexão.';
    errorBox.classList.remove('hidden');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Criar Conta';
  }
});
</script>
