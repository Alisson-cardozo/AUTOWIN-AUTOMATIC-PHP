import os, sys, paramiko, time
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
PASS = os.environ["VPS_PASS"]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)

def run(cmd, timeout=30):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    if out.strip(): print(out)
    if err.strip(): print("ERR:", err[:400])
    return out

# Escreve o script PHP no servidor
php_code = """<?php
define('AUTOWIN_ROOT', '/var/www/autowin');
$envFile = '/var/www/autowin/.env';
if (is_file($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || ($line[0] ?? '') === '#' || !str_contains($line, '=')) continue;
        [$k, $v] = explode('=', $line, 2);
        $k = trim($k); $v = trim($v);
        if ($k !== '' && getenv($k) === false) { putenv("$k=$v"); $_ENV[$k] = $v; }
    }
}
require '/var/www/autowin/vendor/autoload.php';

// Mostra qual token esta configurado
$token = \\App\\Services\\MegaRouletteWsFeed::resolveFeedToken();
echo "token_len=" . strlen($token) . "\\n";

// Inicia o feed (o PHP injeta o token do banco)
@unlink('/var/www/autowin/storage/megaroulette-ws/feed.pid');
@unlink('/var/www/autowin/storage/megaroulette-ws/spawn.lock');
\\App\\Services\\MegaRouletteWsFeed::ensureRunning();
usleep(2500000);
$running = \\App\\Services\\MegaRouletteWsFeed::isRunning();
echo "feed_running=" . ($running ? "1" : "0") . "\\n";
"""

# Mata processo antigo
run("pkill -9 -f megaroulette-ws-feed 2>/dev/null; sleep 1; echo killed")

# Envia o PHP via SFTP
sftp = c.open_sftp()
with sftp.open("/tmp/start_mr.php", "w") as f:
    f.write(php_code)
sftp.close()
print("PHP enviado.")

# Executa
print("=== Iniciando feed via PHP ===")
run("php /tmp/start_mr.php", timeout=15)

time.sleep(3)
print("=== Log (ultimas 12 linhas) ===")
run("tail -12 /var/www/autowin/storage/logs/megaroulette-ws-feed.log 2>/dev/null || echo sem-log")

print("=== Status ===")
run("cat /var/www/autowin/storage/megaroulette-ws/status.json 2>/dev/null || echo sem-status")

print("=== Processo ===")
run("ps -eo pid,args | grep megaroulette-ws-feed | grep -v grep || echo nenhum")

c.close()
print("\nPronto!")
