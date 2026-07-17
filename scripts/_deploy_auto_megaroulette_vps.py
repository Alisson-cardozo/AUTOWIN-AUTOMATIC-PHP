"""
Deploy Auto Mega Roulette (GamblingCounting 8-210) na VPS.
Sobe os arquivos e reconfigura via comandos simples.
"""
import os, sys, getpass
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

try:
    import paramiko
except ImportError:
    print("ERRO: pip install paramiko")
    sys.exit(1)

VPS_HOST = "187.77.33.118"
VPS_USER = "root"
VPS_PATH = "/var/www/autowin"
ROOT = Path(__file__).resolve().parents[1]

FILES = [
    "bot/megaroulette-ws-feed.cjs",
    "src/Services/MegaRouletteWsFeed.php",
    "src/Bot/Games/MegaRouletteEngine.php",
    "src/Bot/Games/MegaRouletteSource.php",
]

PASS = os.environ.get("VPS_PASS", "") or getpass.getpass(f"Senha root da VPS ({VPS_HOST}): ")

def ssh_run(c, cmd, timeout=60):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    if out.strip(): print(out)
    if err.strip(): print("ERR:", err[:500])
    return out

print(f"\n[deploy] Conectando em {VPS_USER}@{VPS_HOST}...")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    c.connect(VPS_HOST, username=VPS_USER, password=PASS, timeout=30, allow_agent=False, look_for_keys=False)
except Exception as e:
    print(f"ERRO: {e}"); sys.exit(1)
print("[deploy] Conectado!\n")

# 1) Sobe arquivos
s = c.open_sftp()
for rel in FILES:
    local = ROOT / rel.replace("/", os.sep)
    if not local.exists():
        print(f"AVISO: {local} nao encontrado"); continue
    try:
        s.put(str(local), f"{VPS_PATH}/{rel}")
        print(f"  OK  {rel}")
    except Exception as e:
        print(f"  ERR {rel}: {e}")
s.close()

# 2) Mata processo antigo do feed
print("\n[deploy] Encerrando feed antigo...")
ssh_run(c, "pkill -f 'megaroulette-ws-feed.cjs' || true; sleep 2")

# 3) Atualiza .env na VPS usando sed
print("[deploy] Atualizando .env na VPS...")
env = f"{VPS_PATH}/.env"
cmds = [
    # Remove linhas existentes dessas 3 chaves
    f"sed -i '/^MEGAROULETTE_GC_GAME_KEY=/d' {env}",
    f"sed -i '/^MEGAROULETTE_FEED_SOURCE=/d' {env}",
    f"sed -i '/^MEGAROULETTE_GC_WS_URL=/d' {env}",
    # Adiciona ao final
    f"echo 'MEGAROULETTE_GC_GAME_KEY=8-210' >> {env}",
    f"echo 'MEGAROULETTE_FEED_SOURCE=gc' >> {env}",
    f"echo 'MEGAROULETTE_GC_WS_URL=' >> {env}",
]
for cmd in cmds:
    ssh_run(c, cmd)
print("  .env atualizado")

# 4) Remove locks e reinicia feed via PHP
print("\n[deploy] Reiniciando feed...")
php = r"""php -r "
define('AUTOWIN_ROOT', '/var/www/autowin');
foreach (file('/var/www/autowin/.env', FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as \$line) {
    \$line = trim(\$line);
    if (\$line===''||(\$line[0]??'')==='#'||!str_contains(\$line,'=')) continue;
    [\$k,\$v] = explode('=',\$line,2);
    \$k=trim(\$k); \$v=trim(\$v);
    if (\$k!==''&&getenv(\$k)===false){putenv(\"\$k=\$v\");\$_ENV[\$k]=\$v;}
}
require '/var/www/autowin/vendor/autoload.php';
@unlink('/var/www/autowin/storage/megaroulette-ws/feed.pid');
@unlink('/var/www/autowin/storage/megaroulette-ws/spawn.lock');
\App\Services\MegaRouletteWsFeed::ensureRunning();
usleep(2000000);
echo 'feed_running='.(\App\Services\MegaRouletteWsFeed::isRunning()?'1':'0').PHP_EOL;
"
"""
ssh_run(c, php, timeout=30)

# 5) Status
print("\n[deploy] Status do feed:")
ssh_run(c, f"cat {VPS_PATH}/storage/megaroulette-ws/status.json 2>/dev/null || echo '(sem status ainda)'")
ssh_run(c, f"tail -20 {VPS_PATH}/storage/logs/megaroulette-ws-feed.log 2>/dev/null || echo '(sem log ainda)'")
ssh_run(c, "ps -eo pid,args | grep megaroulette-ws-feed | grep -v grep || echo 'nenhum processo'")

# 6) Verifica se Chrome está instalado
print("\n[deploy] Verificando Chrome na VPS...")
ssh_run(c, "which google-chrome google-chrome-stable chromium chromium-browser 2>/dev/null | head -1 || echo 'Chrome NAO instalado'")

c.close()
print("\n[deploy] Concluido!")
