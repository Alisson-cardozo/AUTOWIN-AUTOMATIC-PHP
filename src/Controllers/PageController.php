<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Auth\Auth;
use App\Database;
use App\Http\View;
use App\Models\ConfigRepository;

final class PageController
{
    public function home(): void
    {
        if (Auth::ensureAdminSession() || Auth::adminId()) {
            redirect('/dashboard');
        }
        if (Auth::userId()) {
            redirect('/inicio');
        }
        View::render('home', [], null);
    }

    public function login(): void
    {
        View::render('auth/login', ['title' => 'Entrar'], 'layouts/public');
    }

    public function setup(): void
    {
        $row = Database::fetch('SELECT COUNT(*) AS c FROM admin_users');
        if (((int) ($row['c'] ?? 0)) > 0) {
            redirect('/login');
        }
        View::render('auth/setup', ['title' => 'Setup inicial'], 'layouts/public');
    }

    public function primeiroAcesso(): void
    {
        View::render('auth/primeiro-acesso', ['title' => 'Primeiro acesso'], 'layouts/public');
    }

    // ─── Admin ───────────────────────────────────────────────
    private function requireAdminPage(): void
    {
        // Aceita cookie admin OU eleva conta isAdminAccount (portal → admin)
        if (!Auth::ensureAdminSession()) {
            redirect('/login');
        }
    }

    public function dashboard(): void
    {
        $this->requireAdminPage();
        $stats = [
            'users' => (int) (Database::fetch('SELECT COUNT(*) c FROM users')['c'] ?? 0),
            'active' => (int) (Database::fetch('SELECT COUNT(*) c FROM users WHERE isActive = 1 OR jonbetIsActive = 1')['c'] ?? 0),
            'paid' => (int) (Database::fetch("SELECT COUNT(*) c FROM users WHERE paymentStatus = 'PAID'")['c'] ?? 0),
            'emergency' => ConfigRepository::emergencyStop(),
        ];
        View::render('admin/dashboard', ['title' => 'Dashboard', 'stats' => $stats, 'nav' => 'dashboard'], 'layouts/admin');
    }

    public function usersPage(): void
    {
        $this->requireAdminPage();
        $users = Database::fetchAll('SELECT * FROM users ORDER BY id DESC LIMIT 200');
        View::render('admin/users', ['title' => 'Usuários', 'users' => $users, 'nav' => 'users'], 'layouts/admin');
    }

    public function financeiroPage(): void
    {
        $this->requireAdminPage();
        $raw = ConfigRepository::get('LICENSE_OPTIONS', '[]');
        $plans = json_decode((string) $raw, true) ?: [];
        View::render('admin/financeiro', ['title' => 'Financeiro', 'plans' => $plans, 'nav' => 'financeiro'], 'layouts/admin');
    }

    public function configuracoesAdmin(): void
    {
        $this->requireAdminPage();
        View::render('admin/configuracoes', [
            'title' => 'Configurações',
            'config' => ConfigRepository::all(),
            'nav' => 'config',
        ], 'layouts/admin');
    }

    public function comunicacao(): void
    {
        $this->requireAdminPage();
        View::render('admin/comunicacao', [
            'title' => 'Comunicação',
            'announcement' => ConfigRepository::get('ANNOUNCEMENT', '') ?? '',
            'nav' => 'comunicacao',
        ], 'layouts/admin');
    }

    public function padroes(): void
    {
        $this->requireAdminPage();
        $strategies = Database::fetchAll('SELECT * FROM admin_strategies ORDER BY id DESC');
        View::render('admin/padroes', ['title' => 'Padrões', 'strategies' => $strategies, 'nav' => 'padroes'], 'layouts/admin');
    }

    public function sistema(): void
    {
        $this->requireAdminPage();
        View::render('admin/sistema', [
            'title' => 'Sistema',
            'emergency' => ConfigRepository::emergencyStop(),
            'nav' => 'sistema',
        ], 'layouts/admin');
    }

    public function proxyAdmin(): void
    {
        $this->requireAdminPage();
        View::render('admin/proxy', [
            'title' => 'Proxy',
            'nav' => 'proxy',
        ], 'layouts/admin');
    }

    // ─── User portal ─────────────────────────────────────────
    private function requireUserPage(): array
    {
        $user = Auth::user();
        if (!$user) {
            redirect('/login');
        }
        return $user;
    }

    /** Bloqueia abas ocultas pelo admin (HIDDEN_TABS). */
    private function assertTabVisible(string $tabKey): void
    {
        $raw = (string) (ConfigRepository::get('HIDDEN_TABS', '') ?? '');
        $hidden = array_values(array_filter(array_map('trim', explode(',', $raw))));
        if ($tabKey !== '' && in_array($tabKey, $hidden, true)) {
            redirect('/inicio');
        }
    }

    /** Bloqueia jogos ocultos (HIDDEN_GAMES), ex.: BACBO. */
    private function assertGameVisible(string $gameKey): void
    {
        $raw = (string) (ConfigRepository::get('HIDDEN_GAMES', '') ?? '');
        $hidden = array_values(array_filter(array_map('trim', explode(',', $raw))));
        if ($gameKey !== '' && in_array($gameKey, $hidden, true)) {
            redirect('/inicio');
        }
    }

    public function inicio(): void
    {
        $user = $this->requireUserPage();
        View::render('user/inicio', ['title' => 'Início', 'user' => $user, 'nav' => 'inicio'], 'layouts/user');
    }

    public function conta(): void
    {
        $user = $this->requireUserPage();
        $this->assertTabVisible('conta');
        View::render('user/conta', ['title' => 'Conta Blaze', 'user' => $user, 'nav' => 'conta'], 'layouts/user');
    }

    public function jonbet(): void
    {
        $user = $this->requireUserPage();
        $this->assertTabVisible('jonbet');
        View::render('user/jonbet', ['title' => 'Jonbet', 'user' => $user, 'nav' => 'jonbet'], 'layouts/user');
    }

    public function dayTrade(): void
    {
        $user = $this->requireUserPage();
        $this->assertTabVisible('day-trade');
        View::render('user/day-trade', ['title' => 'Day Trade', 'user' => $user, 'nav' => 'day-trade'], 'layouts/user');
    }

    public function premiumDayTrade(): void
    {
        $user = $this->requireUserPage();
        $this->assertTabVisible('premium-day-trade');
        View::render('user/premium-day-trade', [
            'title' => 'Premium Day Trade',
            'user' => $user,
            'nav' => 'premium-day-trade',
        ], 'layouts/user');
    }

    public function estrategias(): void
    {
        $user = $this->requireUserPage();
        View::render('user/estrategias', ['title' => 'Estratégias', 'user' => $user, 'nav' => 'estrategias'], 'layouts/user');
    }

    public function calculadora(): void
    {
        $user = $this->requireUserPage();
        $this->assertTabVisible('calculadora');
        View::render('user/calculadora', ['title' => 'Calculadora', 'user' => $user, 'nav' => 'calculadora'], 'layouts/user');
    }

    public function licenca(): void
    {
        $user = $this->requireUserPage();
        View::render('user/licenca', ['title' => 'Licença', 'user' => $user, 'nav' => 'licenca'], 'layouts/user');
    }

    public function notificacoes(): void
    {
        $user = $this->requireUserPage();
        $this->assertTabVisible('notificacoes');
        View::render('user/notificacoes', ['title' => 'Notificações', 'user' => $user, 'nav' => 'notificacoes'], 'layouts/user');
    }

    public function aviso(): void
    {
        $user = $this->requireUserPage();
        View::render('user/aviso', [
            'title' => 'Aviso',
            'user' => $user,
            'nav' => 'aviso',
        ], 'layouts/user');
    }

    public function premium(): void
    {
        $user = $this->requireUserPage();
        $this->assertTabVisible('premium');
        View::render('user/premium', ['title' => 'Premium Blaze', 'user' => $user, 'nav' => 'premium', 'platform' => 'BLAZE'], 'layouts/user');
    }

    public function premiumJonbet(): void
    {
        $user = $this->requireUserPage();
        $this->assertTabVisible('premium-jonbet');
        View::render('user/premium', ['title' => 'Premium Jonbet', 'user' => $user, 'nav' => 'premium-jonbet', 'platform' => 'JONBET'], 'layouts/user');
    }

    public function jogosPremium(): void
    {
        $user = $this->requireUserPage();
        $this->assertTabVisible('jogos-premium');
        View::render('user/jogos-premium', ['title' => 'Jogos Premium', 'user' => $user, 'nav' => 'jogos-premium'], 'layouts/user');
    }

    public function premiumBacbo(): void
    {
        $user = $this->requireUserPage();
        $this->assertTabVisible('jogos-premium');
        $this->assertGameVisible('BACBO');
        View::render('user/premium-bacbo', ['title' => 'Bac Bo', 'user' => $user, 'nav' => 'bacbo'], 'layouts/user');
    }

    public function premiumBacboLive(): void
    {
        $user = $this->requireUserPage();
        $this->assertTabVisible('jogos-premium');
        // Ocultar se admin escondeu na Conta Blaze (BACBO_LIVE) ou no hub live (bacbo-live)
        $hiddenConta = array_values(array_filter(array_map(
            'trim',
            explode(',', (string) (ConfigRepository::get('HIDDEN_GAMES_CONTA_BLAZE', '') ?? ''))
        )));
        $hiddenLive = array_values(array_filter(array_map(
            'trim',
            explode(',', (string) (ConfigRepository::get('HIDDEN_LIVE_GAMES', '') ?? ''))
        )));
        if (in_array('BACBO_LIVE', $hiddenConta, true) || in_array('bacbo-live', $hiddenLive, true)) {
            redirect('/inicio');
        }
        View::render('user/premium-bacbo-live', [
            'title' => 'Bac Bo Ao Vivo',
            'user' => $user,
            'nav' => 'bacbo-live',
        ], 'layouts/user');
    }

    public function premiumRoletas(): void
    {
        $user = $this->requireUserPage();
        View::render('user/premium-roletas', ['title' => 'Roletas', 'user' => $user, 'nav' => 'roletas'], 'layouts/user');
    }

    public function premiumFutebol(): void
    {
        $user = $this->requireUserPage();
        View::render('user/premium-futebol', ['title' => 'Futebol', 'user' => $user, 'nav' => 'futebol'], 'layouts/user');
    }

    public function minhaContaConfig(): void
    {
        $this->requireUserPage();
        // No original, config fica dentro de /conta (aba Config. Bot)
        redirect('/conta');
    }
}
