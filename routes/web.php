<?php

declare(strict_types=1);

use App\Controllers\Api\AdminController;
use App\Controllers\Api\AuthController;
use App\Controllers\Api\GameController;
use App\Controllers\Api\UserController;
use App\Controllers\Api\WebhookController;
use App\Controllers\PageController;
use App\Router;

/** @var Router $router */
$router = new Router();

// Pages
$router->get('/', [PageController::class, 'home']);
$router->get('/login', [PageController::class, 'login']);
$router->get('/entrar', [PageController::class, 'login']);
$router->get('/setup', [PageController::class, 'setup']);
$router->get('/primeiro-acesso', [PageController::class, 'primeiroAcesso']);

// Admin pages
$router->get('/dashboard', [PageController::class, 'dashboard']);
$router->get('/users', [PageController::class, 'usersPage']);
$router->get('/financeiro', [PageController::class, 'financeiroPage']);
$router->get('/configuracoes', [PageController::class, 'configuracoesAdmin']);
$router->get('/comunicacao', [PageController::class, 'comunicacao']);
$router->get('/padroes', [PageController::class, 'padroes']);
$router->get('/sistema', [PageController::class, 'sistema']);

// User pages
$router->get('/inicio', [PageController::class, 'inicio']);
$router->get('/conta', [PageController::class, 'conta']);
$router->get('/jonbet', [PageController::class, 'jonbet']);
$router->get('/estrategias', [PageController::class, 'estrategias']);
$router->get('/calculadora', [PageController::class, 'calculadora']);
$router->get('/licenca', [PageController::class, 'licenca']);
$router->get('/notificacoes', [PageController::class, 'notificacoes']);
$router->get('/aviso', [PageController::class, 'aviso']);
$router->get('/premium', [PageController::class, 'premium']);
$router->get('/premium-jonbet', [PageController::class, 'premiumJonbet']);
$router->get('/jogos-premium', [PageController::class, 'jogosPremium']);
$router->get('/premium-bacbo', [PageController::class, 'premiumBacbo']);
$router->get('/premium-roletas', [PageController::class, 'premiumRoletas']);
$router->get('/premium-futebol', [PageController::class, 'premiumFutebol']);
$router->get('/minha-conta/configuracoes', [PageController::class, 'minhaContaConfig']);

// Auth API
$router->post('/api/user/login', [AuthController::class, 'login']);
$router->post('/api/auth/logout', [AuthController::class, 'logout']);
$router->get('/api/user/me', [AuthController::class, 'me']);
$router->delete('/api/user/me', [AuthController::class, 'logout']);

// Admin API
$router->get('/api/admin/setup', [AdminController::class, 'setupStatus']);
$router->post('/api/admin/setup', [AdminController::class, 'setup']);
$router->post('/api/admin/login', [AdminController::class, 'login']);
$router->any('/api/admin/profile', [AdminController::class, 'profile']);
$router->any('/api/users', [AdminController::class, 'users']);
$router->any('/api/admin/config', [AdminController::class, 'config']);
$router->any('/api/admin/emergency-stop', [AdminController::class, 'emergencyStop']);
$router->any('/api/admin/announcement', [AdminController::class, 'announcement']);
$router->any('/api/admin/strategies', [AdminController::class, 'strategies']);
$router->get('/api/admin/dashboard-stats', [AdminController::class, 'dashboardStats']);
$router->any('/api/licenses', [AdminController::class, 'licenses']);

// User API
$router->any('/api/user/bot', [UserController::class, 'bot']);
$router->any('/api/user/jonbet', [UserController::class, 'jonbetBot']);
$router->any('/api/user/configuracoes', [UserController::class, 'configuracoes']);
$router->any('/api/user/jonbet/configuracoes', [UserController::class, 'jonbetConfiguracoes']);
$router->any('/api/user/bacbo/configuracoes', [UserController::class, 'bacboConfiguracoes']);
$router->any('/api/user/estrategias', [UserController::class, 'estrategias']);
$router->any('/api/user/bacbo/estrategias', [UserController::class, 'bacboEstrategias']);
$router->any('/api/user/conta', [UserController::class, 'conta']);
$router->any('/api/user/jonbet/conta', [UserController::class, 'jonbetConta']);
$router->get('/api/user/balance', [UserController::class, 'balance']);
$router->get('/api/user/jonbet/balance', [UserController::class, 'jonbetBalance']);
$router->get('/api/user/dashboard-summary', [UserController::class, 'dashboardSummary']);
$router->get('/api/user/bot-entries', [UserController::class, 'botEntries']);
$router->get('/api/user/announcement', [UserController::class, 'announcement']);
$router->get('/api/user/public-config', [UserController::class, 'publicConfig']);
$router->get('/api/plans', [UserController::class, 'plans']);
$router->post('/api/payment/create', [UserController::class, 'paymentCreate']);
$router->post('/api/trial/start', [UserController::class, 'trialStart']);
$router->post('/api/user/primeiro-acesso', [UserController::class, 'primeiroAcesso']);
$router->any('/api/user/notifications', [UserController::class, 'notifications']);
$router->post('/api/user/notifications/test', [UserController::class, 'notificationsTest']);
$router->get('/api/vapid-public-key', [UserController::class, 'vapidPublicKey']);
$router->any('/api/user/push-subscribe', [UserController::class, 'pushSubscribe']);
$router->any('/api/user/telegram-userbot', [UserController::class, 'telegramUserbot']);

// Games
$router->get('/api/game/double/recent', [GameController::class, 'doubleRecent']);
$router->get('/api/game/double', [GameController::class, 'doubleCurrent']);
$router->get('/api/game/crash/recent', [GameController::class, 'crashRecent']);
$router->get('/api/game/crash', [GameController::class, 'crashCurrent']);
$router->get('/api/game/fortune/recent', [GameController::class, 'fortuneRecent']);
$router->get('/api/game/bacbo/recent', [GameController::class, 'bacboRecent']);
$router->get('/api/game/roletas/recent', [GameController::class, 'roletasRecent']);
$router->get('/api/game/futebol/recent', [GameController::class, 'futebolRecent']);
$router->get('/api/jonbet/double/recent', [GameController::class, 'jonbetDoubleRecent']);
$router->get('/api/jonbet/crash/recent', [GameController::class, 'jonbetCrashRecent']);
$router->get('/api/jonbet/fortune/recent', [GameController::class, 'jonbetFortuneRecent']);
$router->get('/api/premium/history', [GameController::class, 'premiumHistory']);
$router->get('/api/premium/crash-history', [GameController::class, 'premiumHistory']);
$router->get('/api/premium/fortune-history', [GameController::class, 'premiumHistory']);
$router->get('/api/premium/crash-aggregate', [GameController::class, 'premiumAggregate']);
$router->get('/api/premium/double-aggregate', [GameController::class, 'premiumAggregate']);
$router->get('/api/premium/fortune-aggregate', [GameController::class, 'premiumAggregate']);
$router->get('/api/jonbet/premium/history', [GameController::class, 'premiumHistory']);
$router->get('/api/jonbet/premium/crash-history', [GameController::class, 'premiumHistory']);
$router->get('/api/jonbet/premium/fortune-history', [GameController::class, 'premiumHistory']);
$router->get('/api/jonbet/premium/crash-aggregate', [GameController::class, 'premiumAggregate']);
$router->get('/api/jonbet/premium/double-aggregate', [GameController::class, 'premiumAggregate']);
$router->get('/api/jonbet/premium/fortune-aggregate', [GameController::class, 'premiumAggregate']);

// Webhooks
$router->post('/api/webhooks/payment', [WebhookController::class, 'payment']);
$router->post('/api/webhooks/bacbo', [WebhookController::class, 'bacbo']);
$router->post('/api/webhooks/roleta', [WebhookController::class, 'roleta']);

return $router;
