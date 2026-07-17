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

# Sobe o feed revertido
s = c.open_sftp()
s.put("bot/megaroulette-ws-feed.cjs", "/var/www/autowin/bot/megaroulette-ws-feed.cjs")
s.close()
print("OK  bot/megaroulette-ws-feed.cjs (revertido)")

# Remove as variáveis GC que adicionamos do .env remoto
env = "/var/www/autowin/.env"
for key in ["MEGAROULETTE_GC_GAME_KEY", "MEGAROULETTE_FEED_SOURCE", "MEGAROULETTE_GC_WS_URL"]:
    run(f"sed -i '/^{key}=/d' {env}")
print(".env revertido (GC vars removidas)")

# Confirma o .env
print("=== .env (vars MEGAROULETTE) ===")
run("grep MEGAROULETTE /var/www/autowin/.env || echo nenhuma")

# Mata processo atual
run("pkill -9 -f megaroulette-ws-feed 2>/dev/null; sleep 2; echo ok")
run("rm -f /var/www/autowin/storage/megaroulette-ws/feed.pid /var/www/autowin/storage/megaroulette-ws/spawn.lock")
run("echo '' > /var/www/autowin/storage/logs/megaroulette-ws-feed.log")

# Reinicia via PHP (que usa o MEGAROULETTE_FEED_TOKEN do .env)
php = """php -r \"
define('AUTOWIN_ROOT','/var/www/autowin');
foreach(file('/var/www/autowin/.env',FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES)as \\\$l){
  \\\$l=trim(\\\$l);
  if(\\\$l===''||(\\\$l[0]??'')==='#'||!str_contains(\\\$l,'='))continue;
  [\\\$k,\\\$v]=explode('=',\\\$l,2);
  \\\$k=trim(\\\$k);\\\$v=trim(\\\$v);
  if(\\\$k!==''&&getenv(\\\$k)===false){putenv(\\\"\\\$k=\\\$v\\\");\\\$_ENV[\\\$k]=\\\$v;}
}
require '/var/www/autowin/vendor/autoload.php';
\\\App\\\Services\\\MegaRouletteWsFeed::ensureRunning();
usleep(2000000);
echo 'running='.(\\\App\\\Services\\\MegaRouletteWsFeed::isRunning()?'1':'0').PHP_EOL;
\""""
run(php, timeout=15)

time.sleep(3)
print("=== Log ===")
run("tail -15 /var/www/autowin/storage/logs/megaroulette-ws-feed.log 2>/dev/null || echo sem-log")
print("=== Status ===")
run("cat /var/www/autowin/storage/megaroulette-ws/status.json 2>/dev/null || echo sem-status")
print("=== Processo ===")
run("ps -eo pid,args | grep megaroulette-ws-feed | grep -v grep || echo nenhum")

c.close()
print("\nPronto! Feed revertido para Blaze/Pragmatic direto.")
