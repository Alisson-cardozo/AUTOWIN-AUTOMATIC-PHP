"""Deploy + tenta renovar token e reiniciar feed Mega Roulette."""
import os
import sys
from pathlib import Path

import paramiko

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PASS = os.environ.get("VPS_PASS", "")
ROOT = Path(__file__).resolve().parents[1]
HOST = "187.77.33.118"

FILES = [
    "bot/megaroulette-ws-feed.cjs",
    "src/Services/MegaRouletteWsFeed.php",
    "src/Bot/Games/MegaRouletteSource.php",
]


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)
    return c


def run(c, cmd, timeout=60):
    _i, o, e = c.exec_command(cmd, timeout=timeout)
    return o.read().decode("utf-8", "replace"), e.read().decode("utf-8", "replace")


c = connect()
sftp = c.open_sftp()
for rel in FILES:
    local = ROOT / rel.replace("/", os.sep)
    remote = f"/var/www/autowin/{rel}"
    sftp.put(str(local), remote)
    print("OK", rel, local.stat().st_size)
sftp.close()

out, err = run(
    c,
    r"""
# kill old feed processes safely via python
python3 - <<'PY'
import os, signal
target = "megaroulette-ws-feed.cjs"
killed=[]
for pid in os.listdir("/proc"):
    if not pid.isdigit():
        continue
    try:
        with open(f"/proc/{pid}/cmdline","rb") as f:
            cmd=f.read().replace(b"\x00", b" ").decode("utf-8","replace")
    except Exception:
        continue
    if target in cmd and "python" not in cmd.lower():
        try:
            os.kill(int(pid), signal.SIGTERM)
            killed.append(pid)
        except Exception as ex:
            print("kill fail", pid, ex)
print("killed_feeds", killed)
PY
rm -f /var/www/autowin/storage/megaroulette-ws/feed.pid /var/www/autowin/storage/megaroulette-ws/spawn.lock
# try refresh MEGAROULETTE token from first user with blazeEmail+password
cd /var/www/autowin
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
require "vendor/autoload.php";
if (!function_exists("env")) require "src/helpers.php";

// 1) test current config token
$cfg = trim((string)(\App\Models\ConfigRepository::get("MEGAROULETTE_FEED_TOKEN","") ?: env("MEGAROULETTE_FEED_TOKEN","")));
echo "cfg_token_len=".strlen($cfg)."\n";

// 2) find user tokens
try {
  $users = \App\Database::fetchAll("SELECT id, blazeEmail, token, password IS NOT NULL AS has_pass FROM users WHERE (token IS NOT NULL AND token != \"\") OR (blazeEmail IS NOT NULL AND blazeEmail != \"\") ORDER BY isActive DESC, id ASC LIMIT 10");
  echo "users_candidates=".count($users)."\n";
  foreach ($users as $u) {
    echo "user#{$u["id"]} email=".($u["blazeEmail"]??"")." token_len=".strlen((string)($u["token"]??""))." has_pass={$u["has_pass"]}\n";
  }
  // pick first non-empty user token and test wallets
  $picked = null;
  foreach ($users as $u) {
    $t = trim((string)($u["token"] ?? ""));
    if ($t === "") continue;
    $ch=curl_init("https://blaze.bet.br/api/wallets");
    curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_HTTPHEADER=>["Authorization: Bearer ".$t,"Accept: application/json"],CURLOPT_TIMEOUT=>15]);
    $body=curl_exec($ch); $code=curl_getinfo($ch,CURLINFO_HTTP_CODE); curl_close($ch);
    echo "user#{$u["id"]} wallets_http=$code\n";
    if ($code>=200 && $code<300) { $picked=$t; echo "picked_user={$u["id"]}\n"; break; }
  }
  // try login with blaze credentials if no token works
  if ($picked === null) {
    foreach ($users as $u) {
      $email = trim((string)($u["blazeEmail"] ?? ""));
      // password may be app password not blaze - skip unsafe auto-login unless we have dedicated fields
    }
  }
  if ($picked !== null) {
    \App\Models\ConfigRepository::set("MEGAROULETTE_FEED_TOKEN", $picked);
    echo "updated_MEGAROULETTE_FEED_TOKEN_from_user=1\n";
  } else {
    echo "no_valid_user_token\n";
  }
} catch (Throwable $e) {
  echo "err=".$e->getMessage()."\n";
}

// 3) spawn feed via ensureRunning
try {
  \App\Services\MegaRouletteWsFeed::ensureRunning();
  usleep(800000);
  echo "running=".( \App\Services\MegaRouletteWsFeed::isRunning() ? "1":"0")."\n";
  echo "stale=".( \App\Services\MegaRouletteWsFeed::isStale() ? "1":"0")."\n";
} catch (Throwable $e) {
  echo "spawn_err=".$e->getMessage()."\n";
}
' 2>&1
sleep 2
echo '=== status ==='
cat /var/www/autowin/storage/megaroulette-ws/status.json 2>/dev/null; echo
echo '=== process ==='
ps -eo pid,args | grep megaroulette-ws-feed | grep -v grep || echo no-feed-proc
echo '=== log tail ==='
tail -n 15 /var/www/autowin/storage/logs/megaroulette-ws-feed.log 2>/dev/null || true
""",
    timeout=90,
)
print(out)
if err.strip():
    print("STDERR:", err[:800])
c.close()
