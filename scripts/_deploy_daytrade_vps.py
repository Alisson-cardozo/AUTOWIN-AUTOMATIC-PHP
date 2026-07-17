"""Deploy Day Trade / IQ Option stack + schema ensure + worker restart."""
import os
import sys
from pathlib import Path

import paramiko

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[1]
PASS = os.environ.get("VPS_PASS", "").strip()
if not PASS:
    pfile = ROOT / "scripts" / "_vps_pass.tmp"
    if pfile.is_file():
        PASS = pfile.read_text(encoding="utf-8", errors="replace").strip()
if not PASS:
    print("VPS_PASS missing")
    sys.exit(1)

FILES = [
    "bot/iqoption-bridge.cjs",
    "bot/iqoption-assets.cjs",
    "database/migrate_daytrade.sql",
    "src/Services/IqOptionBridge.php",
    "src/Bot/Games/DayTradeEngine.php",
    "src/Bot/Games/DayTradeSignals.php",
    "src/Bot/EngineManager.php",
    "src/Bot/EngineRegistry.php",
    "src/Models/UserRepository.php",
    "src/Controllers/Api/DayTradeController.php",
    "src/Controllers/PageController.php",
    "routes/web.php",
    "views/user/day-trade.php",
    "views/layouts/user.php",
    "public/assets/portal/day-trade.js",
    "public/assets/portal/day-trade.js.map",
    "portal-src/pages/day-trade.tsx",
    "portal-src/entries/day-trade.tsx",
]

REMOTE = "/var/www/autowin"
HOST = "187.77.33.118"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)
s = c.open_sftp()

for rel in FILES:
    local = ROOT / rel.replace("/", os.sep)
    if not local.is_file():
        print("SKIP missing", rel)
        continue
    remote = f"{REMOTE}/{rel}"
    # ensure parent
    rdir = "/".join(remote.split("/")[:-1])
    try:
        s.stat(rdir)
    except OSError:
        stdin, stdout, stderr = c.exec_command(f"mkdir -p {rdir}", timeout=15)
        stdout.read()
    s.put(str(local), remote)
    print("OK", rel, local.stat().st_size)

s.close()

remote_cmd = r"""
set -e
cd /var/www/autowin
php -l bot/iqoption-bridge.cjs 2>/dev/null || true
php -l src/Services/IqOptionBridge.php
php -l src/Bot/Games/DayTradeEngine.php
php -l src/Bot/EngineManager.php
php -l src/Controllers/Api/DayTradeController.php
php -l src/Models/UserRepository.php
node -c bot/iqoption-bridge.cjs

# ensure schema via PHP (uses ensureDayTradeSchema)
php -r '
$envFile="/var/www/autowin/.env";
if (is_file($envFile)) {
  foreach (file($envFile, FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $line) {
    $line=trim($line);
    if ($line===""||($line[0]??"")==="#"||!str_contains($line,"=")) continue;
    [$k,$v]=explode("=",$line,2);
    $k=trim($k); $v=trim($v, " \t\"'\''");
    if ($k!=="" && getenv($k)===false) { putenv("$k=$v"); $_ENV[$k]=$v; }
  }
}
require "/var/www/autowin/vendor/autoload.php";
if (!function_exists("env")) require "/var/www/autowin/src/helpers.php";
\App\Models\UserRepository::ensureDayTradeSchema();
echo "schema_ok\n";
$rows = \App\Database::fetchAll("SHOW TABLES LIKE '\''daytrade_%'\''");
echo "tables=".count($rows)."\n";
$cols = \App\Database::fetchAll("SHOW COLUMNS FROM users LIKE '\''iq%'\''");
echo "iq_cols=".count($cols)."\n";
'

# ping bridge
echo '{"action":"ping"}' | node bot/iqoption-bridge.cjs; echo

# reload php + restart worker
systemctl reload php8.3-fpm 2>/dev/null || systemctl reload php-fpm 2>/dev/null || true
if systemctl list-units --type=service 2>/dev/null | grep -qi autowin-worker; then
  systemctl restart autowin-worker || true
  echo "worker_restarted_systemd"
else
  # fallback: kill php worker.php and let ensureRunning pick up
  pkill -f 'bot/worker.php' 2>/dev/null || true
  sleep 1
  cd /var/www/autowin
  nohup php bot/worker.php >> storage/logs/worker.out 2>&1 &
  echo "worker_spawned_pid=$!"
fi
ls -la public/assets/portal/day-trade.js bot/iqoption-bridge.cjs
echo DEPLOY_DAYTRADE_OK
"""

stdin, stdout, stderr = c.exec_command(remote_cmd, timeout=90)
out = stdout.read().decode("utf-8", "replace")
err = stderr.read().decode("utf-8", "replace")
print(out)
if err.strip():
    print("STDERR:", err)
c.close()
print("done")
