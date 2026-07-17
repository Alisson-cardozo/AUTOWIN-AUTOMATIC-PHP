"""Lê proxy Bac Bo resolvido no VPS via PHP CLI do app."""
import os
import sys

import paramiko

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PASS = os.environ.get("VPS_PASS", "")
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

# PHP one-shot que carrega o app como o worker
php = r'''
cd /var/www/autowin || exit 1
php -d display_errors=1 -r '
// env
$envFile = ".env";
if (is_file($envFile)) {
  foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
    $line = trim($line);
    if ($line === "" || ($line[0] ?? "") === "#" || !str_contains($line, "=")) continue;
    [$k, $v] = explode("=", $line, 2);
    $k = trim($k); $v = trim($v, " \t\"'\''");
    if ($k !== "" && getenv($k) === false) { putenv("$k=$v"); $_ENV[$k] = $v; }
  }
}
// autoload + helpers once
require "vendor/autoload.php";
if (!function_exists("env")) {
  require "src/helpers.php";
}
// DB bootstrap if needed
if (class_exists("App\\Database") && method_exists("App\\Database", "init")) {
  try { \App\Database::init(); } catch (Throwable $e) {}
}
try {
  $p = \App\Services\EvolutionBacBo::resolveProxyUrl();
  $hint = $p !== "" ? preg_replace("/:[^:@\\/]+@/", ":***@", $p) : "(vazio)";
  echo "resolveProxyUrl=$hint\n";
  echo "raw_scheme=" . (preg_match("#^([a-z0-9+.-]+)://#i", $p, $m) ? $m[1] : "none") . "\n";
  echo "isSocks=" . (str_starts_with(strtolower($p), "socks") ? "1" : "0") . "\n";
  echo "isLocal=" . (str_contains($p, "127.0.0.1") || str_contains($p, "localhost") ? "1" : "0") . "\n";
  echo "len=" . strlen($p) . "\n";
} catch (Throwable $e) {
  echo "ERR: " . $e->getMessage() . "\n";
  echo $e->getFile() . ":" . $e->getLine() . "\n";
}
// also dump system_config row directly
try {
  $host = getenv("DB_HOST") ?: "127.0.0.1";
  $user = getenv("DB_USER") ?: getenv("DB_USERNAME") ?: "root";
  $pass = getenv("DB_PASSWORD") ?: getenv("DB_PASS") ?: "";
  $db   = getenv("DB_DATABASE") ?: getenv("DB_NAME") ?: "";
  $pdo = new PDO("mysql:host=$host;dbname=$db;charset=utf8mb4", $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
  $st = $pdo->query("SELECT `key`, LEFT(value, 160) AS v FROM system_config WHERE `key` LIKE \"%PROXY%\" OR `key` LIKE \"%BACBO%\" OR `key` LIKE \"%proxy%\"");
  foreach ($st as $row) {
    $v = preg_replace("/:[^:@\\/]+@/", ":***@", (string)$row["v"]);
    echo "cfg:{$row["key"]}=$v\n";
  }
} catch (Throwable $e) {
  echo "DB: " . $e->getMessage() . "\n";
}
'
'''

_i, o, e = c.exec_command(php, timeout=40)
print(o.read().decode("utf-8", "replace"))
err = e.read().decode("utf-8", "replace")
if err.strip():
    print("STDERR:", err[:1200])

# tunnel + recent logs
cmd2 = r"""
echo '=== TUNNEL ==='
ss -lntp 2>/dev/null | grep -E '1080|1081' || echo 'no-1080/1081'
echo '=== curl via local socks if up ==='
if ss -lntp 2>/dev/null | grep -q ':1080'; then
  curl -sS --max-time 8 --socks5-hostname 127.0.0.1:1080 https://api.ipify.org || echo 'curl-socks-1080-fail'
  echo
elif ss -lntp 2>/dev/null | grep -q ':1081'; then
  curl -sS --max-time 8 --socks5-hostname 127.0.0.1:1081 https://api.ipify.org || echo 'curl-socks-1081-fail'
  echo
else
  echo 'skip-curl-no-tunnel'
fi
echo '=== last bacbo-bet ==='
tail -n 25 /var/www/autowin/storage/logs/bacbo-bet.log 2>/dev/null
echo '=== last attempts compact ==='
tail -n 10 /var/www/autowin/storage/bacbo-evo/attempts.log 2>/dev/null | python3 -c '
import sys,json
for line in sys.stdin:
  line=line.strip()
  if not line: continue
  try: j=json.loads(line)
  except Exception: print(line[:180]); continue
  print(j.get("at"), j.get("action"), "ok="+str(j.get("ok")), "code="+str(j.get("code")),
        "slug="+str(j.get("preferredSlug")), "proxy="+str(j.get("proxyHint") or j.get("proxyConfigured")),
        "exitIp="+str(j.get("exitIp")), "ms="+str(j.get("ms")),
        "msg="+str(j.get("message") or "")[:60],
        "err="+str(j.get("error") or "")[:80])
'
"""
_i, o, e = c.exec_command(cmd2, timeout=40)
print(o.read().decode("utf-8", "replace"))
err = e.read().decode("utf-8", "replace")
if err.strip():
    print("STDERR2:", err[:500])
c.close()
