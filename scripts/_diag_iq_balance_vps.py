"""Diagnose IQ Option balance on VPS for connected users."""
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

HOST = "187.77.33.118"
REMOTE = "/var/www/autowin"

cmd = r"""
set -e
cd /var/www/autowin
echo '=== logs ==='
for f in storage/logs/iqoption-bridge.log storage/logs/iqoption.log storage/logs/daytrade.log; do
  if [ -f "$f" ]; then echo "--- $f ---"; tail -n 50 "$f"; else echo "missing $f"; fi
done
echo '=== db users with iq ==='
php <<'PHP'
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
$rows = \App\Database::fetchAll(
  "SELECT id, iqEmail, iqAccountType, iqBalanceId, LENGTH(iqSsid) AS ssidLen,
          daytradeConnectPending, LEFT(COALESCE(daytradeConnectError,''),160) AS err
   FROM users
   WHERE iqSsid IS NOT NULL AND iqSsid != ''
   ORDER BY id DESC LIMIT 5"
);
echo "connected_users=".count($rows)."\n";
foreach ($rows as $r) {
  echo json_encode($r, JSON_UNESCAPED_UNICODE)."\n";
}
$vars = \App\Database::fetchAll("SELECT ownerId, balance, firstBalance, profit FROM daytrade_variables ORDER BY id DESC LIMIT 5");
foreach ($vars as $v) echo "vars ".json_encode($v)."\n";

// live balance call for first user with ssid
if ($rows) {
  $u = \App\Database::fetch("SELECT id, iqSsid, iqAccountType FROM users WHERE id=?", [(int)$rows[0]['id']]);
  $ssid = (string)($u['iqSsid'] ?? '');
  $type = (string)($u['iqAccountType'] ?? 'DEMO');
  echo "testing_balance user=".$u['id']." type=$type ssid_len=".strlen($ssid)."\n";
  $t0 = microtime(true);
  $res = \App\Services\IqOptionBridge::balances($ssid);
  $ms = (int)((microtime(true)-$t0)*1000);
  echo "elapsed_ms=$ms\n";
  echo "result=".json_encode([
    'ok' => $res['ok'] ?? null,
    'error' => $res['error'] ?? null,
    'balances' => $res['balances'] ?? null,
    'keys' => array_keys($res),
  ], JSON_UNESCAPED_UNICODE)."\n";
}
PHP
"""

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)
stdin, stdout, stderr = c.exec_command(cmd, timeout=120)
print(stdout.read().decode("utf-8", "replace"))
err = stderr.read().decode("utf-8", "replace")
if err.strip():
    print("STDERR:", err[-3000:])
c.close()
print("diag_done")
