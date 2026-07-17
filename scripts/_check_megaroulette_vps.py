"""Diagnóstico do feed Mega Roulette na VPS."""
import os
import sys

import paramiko

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PASS = os.environ.get("VPS_PASS", "")
if not PASS:
    print("Set VPS_PASS")
    sys.exit(1)

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

cmd = r"""
set -a
[ -f /var/www/autowin/.env ] && . /var/www/autowin/.env
set +a
echo '=== TIME ==='
date -Is
echo '=== PROCESS ==='
ps -eo pid,lstart,args | grep -E 'megaroulette|worker.php' | grep -v grep || echo none
echo '=== PID FILE ==='
cat /var/www/autowin/storage/megaroulette-ws/feed.pid 2>/dev/null || echo no-pid
echo '=== STATUS ==='
cat /var/www/autowin/storage/megaroulette-ws/status.json 2>/dev/null || echo no-status
echo
echo '=== HISTORY META ==='
if [ -f /var/www/autowin/storage/megaroulette-ws/history.json ]; then
  stat -c '%y %s bytes' /var/www/autowin/storage/megaroulette-ws/history.json
  python3 - <<'PY'
import json
p="/var/www/autowin/storage/megaroulette-ws/history.json"
with open(p) as f: d=json.load(f)
rs=d.get("results") or []
print("updatedAt=", d.get("updatedAt"))
print("source=", d.get("source"))
print("count=", len(rs))
if rs:
  print("newest=", rs[0])
  print("oldest=", rs[-1] if len(rs)>1 else rs[0])
PY
else
  echo no-history
fi
echo '=== ENV TOKEN ==='
grep -E 'MEGAROULETTE' /var/www/autowin/.env 2>/dev/null | sed -E 's/=(.{6}).*/=\1***/' || echo no-env-token
echo '=== DB TOKEN (masked) ==='
php -r '
$envFile="/var/www/autowin/.env";
if (is_file($envFile)) {
  foreach (file($envFile, FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $line) {
    $line=trim($line);
    if ($line===""||($line[0]??"")==="#"||!str_contains($line,"=")) continue;
    [$k,$v]=explode("=",$line,2);
    $k=trim($k); $v=trim($v," \t\"'\''");
    if ($k!=="" && getenv($k)===false) { putenv("$k=$v"); $_ENV[$k]=$v; }
  }
}
require "/var/www/autowin/vendor/autoload.php";
if (!function_exists("env")) require "/var/www/autowin/src/helpers.php";
try {
  $t = \App\Models\ConfigRepository::get("MEGAROULETTE_FEED_TOKEN", "") ?: (getenv("MEGAROULETTE_FEED_TOKEN")?:"");
  $t = trim((string)$t);
  echo $t==="" ? "token=EMPTY\n" : ("token=set len=".strlen($t)." head=".substr($t,0,8)."...\n");
} catch (Throwable $e) {
  echo "token-err: ".$e->getMessage()."\n";
}
' 2>&1 | tail -n 10
echo '=== FEED LOG tail ==='
tail -n 40 /var/www/autowin/storage/logs/megaroulette-ws-feed.log 2>/dev/null || echo no-feed-log
echo '=== BOT LOG megaroulette ==='
grep -iE 'megaroulette|ROLETA|roleta' /var/www/autowin/storage/logs/bot.log 2>/dev/null | tail -n 25 || true
echo '=== game_results ROLETA last ==='
php -r '
$envFile="/var/www/autowin/.env";
if (is_file($envFile)) {
  foreach (file($envFile, FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $line) {
    $line=trim($line);
    if ($line===""||($line[0]??"")==="#"||!str_contains($line,"=")) continue;
    [$k,$v]=explode("=",$line,2);
    $k=trim($k); $v=trim($v," \t\"'\''");
    if ($k!=="" && getenv($k)===false) { putenv("$k=$v"); $_ENV[$k]=$v; }
  }
}
$host=getenv("DB_HOST")?: "127.0.0.1";
$user=getenv("DB_USER")?: getenv("DB_USERNAME")?: "root";
$pass=getenv("DB_PASSWORD")?: getenv("DB_PASS")?: "";
$db=getenv("DB_DATABASE")?: getenv("DB_NAME")?: "";
try {
  $pdo=new PDO("mysql:host=$host;dbname=$db;charset=utf8mb4",$user,$pass,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
  $n=$pdo->query("SELECT COUNT(*) FROM game_results WHERE gameType=\"ROLETA\" AND platform=\"BLAZE\"")->fetchColumn();
  echo "count=$n\n";
  $st=$pdo->query("SELECT blazeId, color, roll, createdAt FROM game_results WHERE gameType=\"ROLETA\" AND platform=\"BLAZE\" ORDER BY id DESC LIMIT 5");
  foreach ($st as $r) echo implode(" | ", $r)."\n";
} catch (Throwable $e) {
  echo "db-err: ".$e->getMessage()."\n";
}
' 2>&1 | tail -n 15
"""

_i, o, e = c.exec_command(cmd, timeout=60)
print(o.read().decode("utf-8", "replace"))
err = e.read().decode("utf-8", "replace")
if err.strip():
    print("STDERR:", err[:1200])
c.close()
