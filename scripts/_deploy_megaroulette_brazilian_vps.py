"""Deploy feed Brazilian Mega Roulette + reinicia processo."""
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
# hash capturado pelo user (pode estar expirado — ainda assim tentamos; fallback Blaze)
GC_WS = os.environ.get(
    "MEGAROULETTE_GC_WS_URL",
    "wss://squid-app-67gkf.ondigitalocean.app/ws?hash=0638b7a825d3798540e4eb917cda32dad5425cc22108edb46d721a0f17f48b10",
)

FILES = [
    "bot/megaroulette-ws-feed.cjs",
    "src/Services/MegaRouletteWsFeed.php",
    "src/Bot/Games/MegaRouletteEngine.php",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)
s = c.open_sftp()
for rel in FILES:
    local = ROOT / rel.replace("/", os.sep)
    s.put(str(local), f"/var/www/autowin/{rel}")
    print("OK", rel)
s.close()

# escape GC url for remote shell via python
cmd = r"""
python3 - <<'PY'
import os, signal, subprocess, time, json

# kill old feed
target = "megaroulette-ws-feed.cjs"
for pid in os.listdir("/proc"):
    if not pid.isdigit():
        continue
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            cmd = f.read().replace(b"\x00", b" ").decode("utf-8", "replace")
    except Exception:
        continue
    if target in cmd and "python" not in cmd.lower():
        try:
            os.kill(int(pid), signal.SIGTERM)
            print("killed", pid)
        except Exception as e:
            print("kill fail", pid, e)
time.sleep(1)

# set GC url + source in system_config via php
gc = """ + repr(GC_WS) + r"""
php = f'''
$envFile="/var/www/autowin/.env";
if (is_file($envFile)) {{
  foreach (file($envFile, FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $line) {{
    $line=trim($line);
    if ($line===""||($line[0]??"")==="#"||!str_contains($line,"=")) continue;
    [$k,$v]=explode("=",$line,2);
    $k=trim($k); $v=trim($v," \\t\\"\'");
    if ($k!=="" && getenv($k)===false) {{ putenv("$k=$v"); $_ENV[$k]=$v; }}
  }}
}}
require "/var/www/autowin/vendor/autoload.php";
if (!function_exists("env")) require "/var/www/autowin/src/helpers.php";
\\App\\Models\\ConfigRepository::set("MEGAROULETTE_GC_WS_URL", {json.dumps(GC_WS if False else gc)!r});
\\App\\Models\\ConfigRepository::set("MEGAROULETTE_FEED_SOURCE", "auto");
\\App\\Models\\ConfigRepository::set("MEGAROULETTE_GAME_SLUG", "mega-roulette---brazilian-287-287");
echo "config ok\\n";
// resolve token still present?
$t=\\App\\Services\\MegaRouletteWsFeed::resolveFeedToken();
echo "token_len=".strlen($t)."\\n";
@unlink("/var/www/autowin/storage/megaroulette-ws/feed.pid");
@unlink("/var/www/autowin/storage/megaroulette-ws/spawn.lock");
\\App\\Services\\MegaRouletteWsFeed::ensureRunning();
usleep(900000);
echo "running=".(\\App\\Services\\MegaRouletteWsFeed::isRunning()?"1":"0")."\\n";
'''
# fix the botched f-string - write php file instead
open("/tmp/mr_cfg.php","w").write(r'''<?php
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
$gc = getenv("GC_WS") ?: "";
if ($gc !== "") {
  \App\Models\ConfigRepository::set("MEGAROULETTE_GC_WS_URL", $gc);
}
\App\Models\ConfigRepository::set("MEGAROULETTE_FEED_SOURCE", "auto");
\App\Models\ConfigRepository::set("MEGAROULETTE_GAME_SLUG", "mega-roulette---brazilian-287-287");
echo "gc_set=" . ($gc !== "" ? "1" : "0") . "\n";
$t=\App\Services\MegaRouletteWsFeed::resolveFeedToken();
echo "token_len=".strlen($t)."\n";
@unlink("/var/www/autowin/storage/megaroulette-ws/feed.pid");
@unlink("/var/www/autowin/storage/megaroulette-ws/spawn.lock");
\App\Services\MegaRouletteWsFeed::ensureRunning();
usleep(900000);
echo "running=".(\App\Services\MegaRouletteWsFeed::isRunning()?"1":"0")."\n";
''')
env = os.environ.copy()
env["GC_WS"] = gc
r = subprocess.run(["php", "/tmp/mr_cfg.php"], env=env, capture_output=True, text=True)
print(r.stdout)
print(r.stderr)
time.sleep(3)
print("=== status ===")
p="/var/www/autowin/storage/megaroulette-ws/status.json"
if os.path.isfile(p):
    print(open(p).read())
print("=== log ===")
log="/var/www/autowin/storage/logs/megaroulette-ws-feed.log"
if os.path.isfile(log):
    lines=open(log, errors="replace").read().splitlines()
    print("\n".join(lines[-20:]))
print("=== proc ===")
subprocess.run("ps -eo pid,args | grep megaroulette-ws-feed | grep -v grep || echo none", shell=True)
PY
"""

_i, o, e = c.exec_command(cmd, timeout=90)
print(o.read().decode("utf-8", "replace"))
err = e.read().decode("utf-8", "replace")
if err.strip():
    print("STDERR", err[:800])
c.close()
