import paramiko, sys
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
PASS = Path(r"c:/Users/Aliss/Desktop/autowin-php-cp/scripts/_vps_pass.tmp").read_text().strip()
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)
cmd = """
pgrep -af bot/worker.php || true
if ! pgrep -f bot/worker.php >/dev/null; then
  cd /var/www/autowin
  nohup php bot/worker.php >> storage/logs/worker.log 2>&1 &
  sleep 2
fi
pgrep -af bot/worker.php || echo NO_WORKER
node -c /var/www/autowin/bot/iqoption-bridge.cjs && echo node_ok
grep -n pendingOpenPrice /var/www/autowin/src/Bot/Games/DayTradeEngine.php | head -3
"""
stdin, stdout, stderr = c.exec_command(cmd, timeout=25)
print(stdout.read().decode())
print(stderr.read().decode())
c.close()
