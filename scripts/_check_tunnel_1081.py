import os, sys, paramiko
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "187.77.33.118",
    username="root",
    password=os.environ["VPS_PASS"],
    timeout=30,
    allow_agent=False,
    look_for_keys=False,
)
cmd = r"""
ss -lntp 2>/dev/null | grep -E '1080|1081' || echo 'NO_LISTEN_1080_1081'
echo '--- SOCKS via 1081 ---'
curl -sS --max-time 12 --socks5-hostname 127.0.0.1:1081 https://api.ipify.org || echo FAIL_SOCKS
echo
echo '--- VPS direct ---'
curl -sS --max-time 8 https://api.ipify.org || echo FAIL_DIRECT
echo
"""
_i, o, e = c.exec_command(cmd, timeout=35)
print(o.read().decode("utf-8", "replace"))
err = e.read().decode("utf-8", "replace")
if err.strip():
    print("STDERR:", err[:400])
c.close()
