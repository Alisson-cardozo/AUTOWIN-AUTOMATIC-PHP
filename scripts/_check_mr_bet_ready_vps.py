import os, sys, paramiko
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=os.environ["VPS_PASS"], timeout=30, allow_agent=False, look_for_keys=False)
cmd = r"""
echo === FILES ===
ls -la /var/www/autowin/bot/megaroulette-bet-bridge.cjs /var/www/autowin/src/Services/MegaRouletteBet.php 2>&1
echo === WORKER ===
ps -eo pid,args | grep 'bot/worker.php' | grep -v grep || echo no-worker
echo === FEED STATUS ===
cat /var/www/autowin/storage/megaroulette-ws/status.json 2>/dev/null; echo
echo === ENGINE WIRED ===
grep -n 'MegaRouletteBet\|lpbet\|REAL' /var/www/autowin/src/Bot/Games/MegaRouletteEngine.php | head -12
echo === BRIDGE BC ===
grep -n 'VERMELHO\|PRETO\|BRANCO\|lpbet' /var/www/autowin/bot/megaroulette-bet-bridge.cjs | head -15
echo === LAST BET LOG ===
tail -n 8 /var/www/autowin/storage/logs/megaroulette-bet.log 2>/dev/null || echo no-bet-log-yet
"""
_i,o,e=c.exec_command(cmd,timeout=30)
print(o.read().decode("utf-8","replace"))
err=e.read().decode("utf-8","replace")
if err.strip():
    print("ERR", err[:400])
c.close()
