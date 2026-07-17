import os
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
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
cmds = [
    "ps -fp 681802 2>/dev/null; ss -lntp | grep 1080",
    "curl -sS --max-time 15 -x socks5h://127.0.0.1:1080 https://ipinfo.io/json || echo FAIL",
    "curl -sS --max-time 15 -x socks5h://127.0.0.1:1080 -o /dev/null -w 'evo_home %{http_code}\\n' https://a8-latam.evo-games.com/ || echo FAIL2",
    "curl -sS --max-time 15 -x socks5h://127.0.0.1:1080 -o /tmp/evo_entry.html -w 'evo_entry %{http_code}\\n' https://a8-latam.evo-games.com/entry ; head -c 200 /tmp/evo_entry.html 2>/dev/null; echo",
]
for cmd in cmds:
    print("$", cmd)
    _i, o, e = c.exec_command(cmd, timeout=30)
    print(o.read().decode("utf-8", "replace"))
    err = e.read().decode("utf-8", "replace")
    if err.strip():
        print("ERR", err[:300])
c.close()
