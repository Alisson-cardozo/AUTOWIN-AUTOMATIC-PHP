import os
import sys
from pathlib import Path

import paramiko

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PASS = os.environ["VPS_PASS"]
ROOT = Path(__file__).resolve().parents[1]
FILES = [
    "bot/megaroulette-bet-bridge.cjs",
    "src/Services/MegaRouletteBet.php",
    "src/Bot/Games/MegaRouletteEngine.php",
    "src/Controllers/Api/UserController.php",
    "public/assets/portal/conta.js",
    "database/migrate_strategies_color_len.sql",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)
s = c.open_sftp()
for rel in FILES:
    local = ROOT / rel.replace("/", os.sep)
    s.put(str(local), f"/var/www/autowin/{rel}")
    print("OK", rel, local.stat().st_size)
s.close()

cmd = r"""
cd /var/www/autowin
# migrate color column
set -a; [ -f .env ] && . ./.env; set +a
php -r '
$envFile=".env";
if (is_file($envFile)) {
  foreach (file($envFile, FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $line) {
    $line=trim($line);
    if ($line===""||($line[0]??"")==="#"||!str_contains($line,"=")) continue;
    [$k,$v]=explode("=",$line,2);
    $k=trim($k); $v=trim($v," \t\"'\''");
    if ($k!=="" && getenv($k)===false) { putenv("$k=$v"); $_ENV[$k]=$v; }
  }
}
$host=getenv("DB_HOST")?:"127.0.0.1";
$user=getenv("DB_USER")?:getenv("DB_USERNAME")?:"root";
$pass=getenv("DB_PASSWORD")?:getenv("DB_PASS")?:"";
$db=getenv("DB_DATABASE")?:getenv("DB_NAME")?:"";
try {
  $pdo=new PDO("mysql:host=$host;dbname=$db;charset=utf8mb4",$user,$pass,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
  $pdo->exec("ALTER TABLE strategies MODIFY COLUMN color VARCHAR(500) NOT NULL");
  echo "migrate_ok\n";
} catch (Throwable $e) {
  echo "migrate_err: ".$e->getMessage()."\n";
}
'
# restart worker
python3 - <<'PY'
import os, signal, time, subprocess
target="bot/worker.php"
for pid in os.listdir("/proc"):
    if not pid.isdigit(): continue
    try:
        cmd=open(f"/proc/{pid}/cmdline","rb").read().replace(b"\x00",b" ").decode()
    except Exception:
        continue
    if target in cmd and "python" not in cmd.lower():
        try: os.kill(int(pid), signal.SIGTERM); print("killed",pid)
        except Exception as e: print(e)
time.sleep(1.2)
subprocess.Popen(["php","/var/www/autowin/bot/worker.php"], cwd="/var/www/autowin",
    stdout=open("/var/www/autowin/storage/logs/worker-stdout.log","a"),
    stderr=subprocess.STDOUT, start_new_session=True)
time.sleep(1)
subprocess.run("ps -eo pid,args | grep worker.php | grep -v grep || echo no-worker", shell=True)
PY
systemctl reload php8.3-fpm 2>/dev/null || true
php -l src/Bot/Games/MegaRouletteEngine.php
php -l src/Services/MegaRouletteBet.php
grep -c 'SEQUÊNCIA E VIZINHOS' public/assets/portal/conta.js
"""
_i, o, e = c.exec_command(cmd, timeout=60)
print(o.read().decode("utf-8", "replace"))
err = e.read().decode("utf-8", "replace")
if err.strip():
    print("ERR", err[:500])
c.close()
