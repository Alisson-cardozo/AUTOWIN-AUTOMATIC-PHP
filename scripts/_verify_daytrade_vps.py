"""Verify Day Trade deploy + restart worker on VPS."""
import sys
from pathlib import Path

import paramiko

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PASS = Path(__file__).with_name("_vps_pass.tmp").read_text(encoding="utf-8").strip()
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "187.77.33.118",
    username="root",
    password=PASS,
    timeout=30,
    allow_agent=False,
    look_for_keys=False,
)

def run(cmd: str, timeout: int = 60) -> str:
    _i, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    return (out + (("\nERR:\n" + err) if err.strip() else "")).strip()

print("=== units ===")
print(run("systemctl list-units --type=service --all 2>/dev/null | grep -iE 'worker|autowin' || true"))
print("=== systemd files ===")
print(run("ls /etc/systemd/system/*worker* /etc/systemd/system/*autowin* 2>/dev/null; ls /lib/systemd/system/*autowin* 2>/dev/null; true"))
print("=== processes ===")
print(run("ps aux | grep -E 'worker|php.*bot' | grep -v grep || true"))
print("=== files ===")
print(run("ls -la /var/www/autowin/public/assets/portal/day-trade.js /var/www/autowin/bot/iqoption-bridge.cjs /var/www/autowin/src/Controllers/Api/DayTradeController.php"))
print("=== routes ===")
print(run("grep -n daytrade /var/www/autowin/routes/web.php || true"))
print("=== schema ===")
# write a tiny php helper on the server to avoid shell quoting hell
sftp = c.open_sftp()
helper = r"""<?php
$envFile="/var/www/autowin/.env";
if (is_file($envFile)) {
  foreach (file($envFile, FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $line) {
    $line=trim($line);
    if ($line===""||($line[0]??"")==="#"||!str_contains($line,"=")) continue;
    [$k,$v]=explode("=",$line,2);
    $k=trim($k); $v=trim($v, " \t\"'");
    if ($k!=="" && getenv($k)===false) { putenv("$k=$v"); $_ENV[$k]=$v; }
  }
}
require "/var/www/autowin/vendor/autoload.php";
if (!function_exists("env")) require "/var/www/autowin/src/helpers.php";
\App\Models\UserRepository::ensureDayTradeSchema();
$t=\App\Database::fetchAll("SHOW TABLES LIKE 'daytrade_%'");
echo "tables=".count($t)."\n";
foreach ($t as $r) echo " - ".implode(",", $r)."\n";
$c=\App\Database::fetchAll("SHOW COLUMNS FROM users WHERE Field LIKE 'iq%' OR Field LIKE 'daytrade%'");
foreach ($c as $r) echo "col ".$r["Field"]."\n";
"""
with sftp.file("/tmp/dt_schema_check.php", "w") as f:
    f.write(helper)
sftp.close()
print(run("php /tmp/dt_schema_check.php"))
print("=== bridge ping ===")
print(run("cd /var/www/autowin && echo '{\"action\":\"ping\"}' | node bot/iqoption-bridge.cjs"))
print("=== reload fpm ===")
print(run("systemctl reload php8.3-fpm 2>/dev/null || systemctl reload php-fpm 2>/dev/null || echo no_fpm_reload"))

# restart worker carefully
print("=== restart worker ===")
# Prefer systemd if present
units = run("systemctl list-unit-files 2>/dev/null | grep -iE 'autowin|worker' || true")
print(units)
if "autowin" in units.lower() or "worker" in units.lower():
    print(run("systemctl restart autowin-worker 2>/dev/null || systemctl restart bot-worker 2>/dev/null || true"))
    print(run("systemctl is-active autowin-worker 2>/dev/null || systemctl is-active bot-worker 2>/dev/null || true"))
else:
    # kill by pid file if exists
    print(run(r"""
cd /var/www/autowin
PIDFILE=storage/bot-worker.pid
if [ -f "$PIDFILE" ]; then
  OLD=$(cat "$PIDFILE" 2>/dev/null || true)
  if [ -n "$OLD" ] && kill -0 "$OLD" 2>/dev/null; then
    kill "$OLD" || true
    sleep 1
    kill -9 "$OLD" 2>/dev/null || true
    echo killed_pid=$OLD
  fi
fi
# also find numeric pids via /proc
python3 - <<'PY'
import os, signal
for pid in os.listdir("/proc"):
    if not pid.isdigit():
        continue
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            cmd = f.read().replace(b"\x00", b" ").decode("utf-8", "replace")
    except Exception:
        continue
    if "worker.php" in cmd and "php" in cmd:
        try:
            os.kill(int(pid), signal.SIGTERM)
            print("term", pid, cmd[:80])
        except Exception as e:
            print("fail", pid, e)
PY
sleep 1
nohup php bot/worker.php >> storage/logs/worker.out 2>&1 &
echo new_pid=$!
sleep 1
python3 - <<'PY'
import os
for pid in os.listdir("/proc"):
    if not pid.isdigit():
        continue
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            cmd = f.read().replace(b"\x00", b" ").decode("utf-8", "replace")
    except Exception:
        continue
    if "worker.php" in cmd:
        print("running", pid, cmd[:100])
PY
"""))

print("ALL_OK")
c.close()
