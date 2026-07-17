import os, sys, time, paramiko
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
time.sleep(50)
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=os.environ["VPS_PASS"], timeout=30, allow_agent=False, look_for_keys=False)
cmd = r"""
echo STATUS
cat /var/www/autowin/storage/megaroulette-ws/status.json; echo
echo HISTORY
python3 - <<'PY'
import json
d=json.load(open('/var/www/autowin/storage/megaroulette-ws/history.json'))
print('updatedAt', d.get('updatedAt'))
rs=d.get('results') or []
print('count', len(rs))
print('newest', rs[0] if rs else None)
PY
echo LOG
tail -n 12 /var/www/autowin/storage/logs/megaroulette-ws-feed.log
echo PROC
ps -eo pid,args | grep megaroulette-ws-feed | grep -v grep || echo dead
"""
_i,o,e=c.exec_command(cmd, timeout=30)
print(o.read().decode("utf-8","replace"))
err=e.read().decode("utf-8","replace")
if err.strip():
    print("ERR", err[:400])
c.close()
