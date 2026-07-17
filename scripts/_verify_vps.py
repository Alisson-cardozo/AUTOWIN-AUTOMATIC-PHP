import os
import paramiko

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
cmd = r"""
ps -eo pid=,lstart=,args= | grep 'bot/worker.php' | grep -v grep
echo ---
cat /var/www/autowin/storage/bot-worker.pid 2>/dev/null || echo no-pidfile
echo ---
grep -c resolveProxyUrl /var/www/autowin/src/Services/EvolutionBacBo.php
grep -c setProxyUrl /var/www/autowin/bot/bacbo-evo-bridge.cjs
grep -c AKAMAI_BLOCKED /var/www/autowin/bot/bacbo-evo-bridge.cjs
"""
_i, o, e = c.exec_command(cmd, timeout=30)
print(o.read().decode("utf-8", "replace"))
err = e.read().decode("utf-8", "replace")
if err:
    print("ERR", err)
c.close()
