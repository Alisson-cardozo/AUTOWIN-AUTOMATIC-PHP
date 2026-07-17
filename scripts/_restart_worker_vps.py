"""Reinicia bot/worker.php na VPS sem matar o próprio script."""
import os
import sys
import time

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


def run(cmd, timeout=40):
    _i, o, e = c.exec_command(cmd, timeout=timeout)
    return o.read().decode("utf-8", "replace"), e.read().decode("utf-8", "replace")


print("=== before ===")
out, err = run("ps -eo pid,args | grep 'bot/worker.php' | grep -v grep || true")
print(out or "(none)")

# discover systemd unit if any
out, _ = run(
    "systemctl list-units --type=service --all --no-pager 2>/dev/null | "
    "grep -iE 'autowin|worker|bacbo' || true; "
    "ls /etc/systemd/system/*autowin* /etc/systemd/system/*worker* 2>/dev/null || true"
)
print("units:\n", out)

# kill only by exact path match via python on remote (safer)
kill_cmd = r"""
python3 - <<'PY'
import os, signal, time
target = "bot/worker.php"
killed = []
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
            killed.append((pid, cmd[:120]))
        except Exception as e:
            print("kill fail", pid, e)
print("killed", killed)
time.sleep(1.5)
# force
for pid, _ in killed:
    try:
        os.kill(int(pid), 0)
        os.kill(int(pid), signal.SIGKILL)
        print("sigkill", pid)
    except ProcessLookupError:
        pass
    except Exception as e:
        print("force fail", pid, e)
PY
"""
out, err = run(kill_cmd)
print(out)
if err.strip():
    print("kill err", err[:300])

# start worker
start = r"""
cd /var/www/autowin
mkdir -p storage/logs
nohup php bot/worker.php >> storage/logs/worker-stdout.log 2>&1 &
sleep 1.2
ps -eo pid,lstart,args | grep 'bot/worker.php' | grep -v grep || echo NO_WORKER
tail -n 5 storage/logs/worker-stdout.log 2>/dev/null || true
"""
out, err = run(start)
print("=== after ===")
print(out)
if err.strip():
    print("start err", err[:300])

# also reload php-fpm for web paths
run("systemctl reload php8.3-fpm 2>/dev/null || systemctl reload php-fpm 2>/dev/null || true")
print("php-fpm reloaded (best effort)")
c.close()
