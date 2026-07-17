import os, sys, paramiko
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=os.environ["VPS_PASS"], timeout=30, allow_agent=False, look_for_keys=False)
cmd = r"""
python3 - <<'PY'
import os, signal, time, subprocess
for target in ["megaroulette-ws-feed.cjs", "bot/worker.php"]:
    for pid in os.listdir("/proc"):
        if not pid.isdigit(): continue
        try:
            cmd=open(f"/proc/{pid}/cmdline","rb").read().replace(b"\x00",b" ").decode()
        except Exception:
            continue
        if target in cmd and "python" not in cmd.lower():
            try:
                os.kill(int(pid), signal.SIGTERM)
                print("killed", pid, target)
            except Exception as e:
                print("fail", pid, e)
time.sleep(1.5)
# clear locks
for p in [
    "/var/www/autowin/storage/megaroulette-ws/feed.pid",
    "/var/www/autowin/storage/megaroulette-ws/spawn.lock",
]:
    try: os.unlink(p)
    except FileNotFoundError: pass
# start worker (feed sobe no ensureRunning)
subprocess.Popen(
    ["php", "/var/www/autowin/bot/worker.php"],
    cwd="/var/www/autowin",
    stdout=open("/var/www/autowin/storage/logs/worker-stdout.log","a"),
    stderr=subprocess.STDOUT,
    start_new_session=True,
)
time.sleep(2)
# force feed start
subprocess.run(["php","-r", r'''
$envFile="/var/www/autowin/.env";
if (is_file($envFile)) {
  foreach (file($envFile, FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $line) {
    $line=trim($line);
    if ($line===""||($line[0]??"")==="#"||!str_contains($line,"=")) continue;
    [$k,$v]=explode("=",$line,2);
    $k=trim($k); $v=trim($v," \t\"'");
    if ($k!=="" && getenv($k)===false) { putenv("$k=$v"); $_ENV[$k]=$v; }
  }
}
require "/var/www/autowin/vendor/autoload.php";
if (!function_exists("env")) require "/var/www/autowin/src/helpers.php";
\App\Services\MegaRouletteWsFeed::ensureRunning();
echo "feed_running=" . (\App\Services\MegaRouletteWsFeed::isRunning()?"1":"0") . "\n";
'''], check=False)
time.sleep(1)
subprocess.run("ps -eo pid,args | grep -E 'megaroulette-ws-feed|worker.php' | grep -v grep", shell=True)
print("--- log ---")
subprocess.run("tail -n 8 /var/www/autowin/storage/logs/megaroulette-ws-feed.log", shell=True)
PY
"""
_i,o,e=c.exec_command(cmd,timeout=45)
print(o.read().decode("utf-8","replace"))
err=e.read().decode("utf-8","replace")
if err.strip():
    print("ERR", err[:400])
c.close()
