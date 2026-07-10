# AutoWin PHP

Port completo do sistema AutoWin (Next.js/Node) para **PHP 8.2+** e **MySQL**.

## O que está incluído

- Painel **admin** (usuários, financeiro/planos, padrões, comunicação, emergency stop, configs)
- Portal do **cliente** (início, Blaze, Jonbet, config bot, estratégias, premium, bacbo, roletas, licença, etc.)
- APIs REST equivalentes (`/api/user/*`, `/api/admin/*`, `/api/game/*`, webhooks)
- Schema MySQL idêntico ao Prisma original (+ tabelas IPC `bot_commands` / `bot_messages`)
- **Worker de bots** em processo longo (`php bot/worker.php`)
  - Double (gale, proteção branco, skip first entry, entrada após loss, horário, stop win/loss, DEMO/REAL)
  - Crash, Fortune, Bac Bo (demo)
  - Blaze + Jonbet (plataforma)

## Requisitos

- PHP 8.2+ com extensões: `pdo_mysql`, `curl`, `json`, `mbstring`, `openssl`
- MySQL 5.7+ / 8.x
- Composer

## Instalação

```bash
cd autowin-php
composer install
npm install
npm run build:portal   # compila abas do portal (React idêntico ao auto-autowin)
cp .env.example .env
# edite DB_* e APP_SECRET no .env

composer migrate
# ou: php database/migrate.php
```

### Portal do cliente (UI idêntica ao original)

As telas do portal (`/inicio`, `/conta`, `/jonbet`, `/premium`, etc.) são as
mesmas páginas React do `auto-autowin`, compiladas com esbuild para
`public/assets/portal/*.js`.

Sempre que o original em `../auto-autowin` for atualizado:

```bash
npm run build:portal
```

## Rodar

**Terminal 1 — web**

```bash
composer serve
# http://localhost:8080
```

**Terminal 2 — bots (obrigatório para automação)**

```bash
composer bot
# ou: php bot/worker.php
```

## Primeiro uso

1. Abra `/setup` e crie o admin  
2. Entre em `/login`  
3. Em **Configurações**: token Mercado Pago, Anti-Captcha (para login Blaze real)  
4. Em **Financeiro**: planos JSON  
5. No portal do cliente: configure bot, padrões, inicie em DEMO  

## Produção (Apache/Nginx)

Document root = pasta `public/`.

Exemplo Nginx:

```nginx
root /var/www/autowin-php/public;
index index.php;
location / {
  try_files $uri $uri/ /index.php?$query_string;
}
location ~ \.php$ {
  include fastcgi_params;
  fastcgi_pass unix:/run/php/php8.3-fpm.sock;
  fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
}
```

Rode o worker com systemd/supervisor:

```ini
[program:autowin-bot]
command=php /var/www/autowin-php/bot/worker.php
autostart=true
autorestart=true
user=www-data
```

## Webhooks

- Pagamentos: `POST /api/webhooks/payment`
- Bac Bo: `POST /api/webhooks/bacbo`
- Roleta: `POST /api/webhooks/roleta`

## Notas de paridade

| Recurso | Status |
|--------|--------|
| Auth admin + usuário (cookies HMAC) | ✅ |
| CRUD usuários / planos / PIX MP | ✅ |
| Engines Double/Crash/Fortune/BacBo | ✅ |
| WebSocket nativo Blaze | 🔁 Polling REST (igual fallback Node) |
| Telegram userbot (GramJS) | ⚠️ Dados salvos; precisa MadelineProto para MTProto |
| Web Push VAPID | ⚠️ Preferências salvas; envio opcional a expandir |
| UI React pixel-perfect | 🔁 UI PHP responsiva com mesmas rotas/funções |

## Estrutura

```
autowin-php/
  public/           # front controller + assets
  src/              # App PHP (controllers, models, bot engines)
  views/            # templates
  routes/web.php
  database/schema.sql
  bot/worker.php
```
