<div class="min-h-screen flex items-center justify-center bg-gray-950">
  <div class="w-full max-w-md">
    <div class="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center w-16 h-16 bg-green-500/10 rounded-2xl mb-4">
          <span class="text-3xl">🔧</span>
        </div>
        <h1 class="text-2xl font-bold text-white">Configuração Inicial</h1>
        <p class="text-gray-400 text-sm mt-1">Crie o administrador do sistema</p>
      </div>

      <form id="setup-form" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1.5">Usuário</label>
          <input type="text" name="username" required class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition" placeholder="admin">
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
          <input type="email" name="email" required class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition" placeholder="admin@email.com">
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1.5">Senha</label>
          <input type="password" name="password" required minlength="6" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition" placeholder="••••••••">
        </div>

        <div id="setup-error" class="hidden bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm"></div>

        <button type="submit" id="setup-submit" class="w-full bg-green-500 hover:bg-green-400 disabled:bg-green-500/50 text-black font-semibold py-2.5 rounded-lg transition-colors">Criar Administrador</button>
      </form>
    </div>
  </div>
</div>

<script>
document.getElementById('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const errorBox = document.getElementById('setup-error');
  const submitBtn = document.getElementById('setup-submit');
  errorBox.classList.add('hidden');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Criando...';

  try {
    const res = await fetch('/api/admin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: fd.get('username'), email: fd.get('email'), password: fd.get('password') }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorBox.textContent = data.error || 'Erro ao criar administrador.';
      errorBox.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Criar Administrador';
      return;
    }
    location.href = '/login';
  } catch (err) {
    errorBox.textContent = 'Erro de conexão.';
    errorBox.classList.remove('hidden');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Criar Administrador';
  }
});
</script>
