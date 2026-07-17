import os
import paramiko

PASS = os.environ.get("VPS_PASS", "")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "187.77.33.118",
    username="root",
    password=PASS,
    timeout=25,
    allow_agent=False,
    look_for_keys=False,
)

cmds = [
    "grep -n BACBO_LIVE /var/www/autowin/src/Bot/EngineManager.php | head -5 || echo MISSING_ENGINE",
    "grep -n bacbo-live /var/www/autowin/routes/web.php | head -5 || echo MISSING_ROUTES",
    "grep -n 'bacbo-live' /var/www/autowin/src/Bot/Games/BacBoSource.php | head -8 || echo MISSING_SOURCE",
    "ls -la /var/www/autowin/database/migrate_bacbo_live.sql /var/www/autowin/public/imagem-jogos/blaze/bacbo_live.png 2>&1",
    "grep -c BACBO_LIVE /var/www/autowin/public/assets/portal/conta.js || echo NO_CONTA_JS",
    "php -l /var/www/autowin/src/Bot/Games/BacBoEngine.php",
    "pgrep -af 'bot/worker.php' || echo NO_WORKER",
    # tables?
    "cd /var/www/autowin && php -r \"require 'vendor/autoload.php'; App\\\\Bootstrap::init(); "
    "$r=App\\\\Database::fetch(\\\"SHOW TABLES LIKE 'bacbo_live_results'\\\"); "
    "echo $r ? 'TABLE_OK' : 'TABLE_MISSING';\"",
]

for cmd in cmds:
    print("$", cmd[:120])
    _i, o, e = c.exec_command(cmd, timeout=45)
    out = o.read().decode("utf-8", "replace").strip()
    err = e.read().decode("utf-8", "replace").strip()
    if out:
        print(out)
    if err:
        print("ERR:", err)
    print()

c.close()
