"""Restart bot worker cleanly on VPS."""
import signal
import sys
import time
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

# Upload a remote restart helper so we don't fight with local pkill filters
script = r"""#!/usr/bin/env python3
import os, signal, time, subprocess

def find_workers():
    found = []
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                cmd = f.read().replace(b"\x00", b" ").decode("utf-8", "replace")
        except Exception:
            continue
        if "bot/worker.php" in cmd or cmd.strip().endswith("worker.php"):
            if "php" in cmd:
                found.append((int(pid), cmd))
    return found

for pid, cmd in find_workers():
    try:
        os.kill(pid, signal.SIGTERM)
        print("SIGTERM", pid)
    except Exception as e:
        print("fail", pid, e)
time.sleep(1.5)
for pid, cmd in find_workers():
    try:
        os.kill(pid, signal.SIGKILL)
        print("SIGKILL", pid)
    except Exception:
        pass
time.sleep(0.5)
os.chdir("/var/www/autowin")
# use BotWorker ensure if available, else spawn
proc = subprocess.Popen(
    ["php", "bot/worker.php"],
    stdout=open("storage/logs/worker.out", "a"),
    stderr=subprocess.STDOUT,
    start_new_session=True,
)
print("spawned", proc.pid)
time.sleep(1.2)
for pid, cmd in find_workers():
    print("running", pid, cmd[:120])
if not find_workers():
    print("ERROR no worker")
    raise SystemExit(1)
print("OK")
"""

s = c.open_sftp()
with s.file("/tmp/restart_autowin_worker.py", "w") as f:
    f.write(script)
s.close()

_i, o, e = c.exec_command("python3 /tmp/restart_autowin_worker.py", timeout=40)
print(o.read().decode("utf-8", "replace"))
err = e.read().decode("utf-8", "replace")
if err.strip():
    print("ERR", err)

_i, o, e = c.exec_command(
    "systemctl reload php8.3-fpm 2>/dev/null; ls -la /var/www/autowin/public/assets/portal/day-trade.js; "
    "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/day-trade || curl -s -o /dev/null -w '%{http_code}' https://127.0.0.1/day-trade || true; echo; "
    "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/api/daytrade/status || true; echo",
    timeout=30,
)
print(o.read().decode("utf-8", "replace"))
print(e.read().decode("utf-8", "replace"))
c.close()
