import os, sys, paramiko
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
PASS = os.environ.get("VPS_PASS", "")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)
cmd = r"""
ps -eo pid,lstart,args | grep worker.php | grep -v grep || echo NO_WORKER
echo ---
cat /var/www/autowin/storage/bot-worker.pid 2>/dev/null || echo no-pidfile
echo
tail -n 25 /var/www/autowin/storage/logs/worker-stdout.log 2>/dev/null || true
"""
_i, o, e = c.exec_command(cmd, timeout=20)
print(o.read().decode("utf-8", "replace"))
err = e.read().decode("utf-8", "replace")
if err.strip():
    print("ERR", err)
c.close()
