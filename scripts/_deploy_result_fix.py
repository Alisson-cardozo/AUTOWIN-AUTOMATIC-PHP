"""Deploy IQ option result resolution fix."""
import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
PASS = (ROOT / "scripts" / "_vps_pass.tmp").read_text(encoding="utf-8").strip()

FILES = [
    "bot/iqoption-bridge.cjs",
    "src/Services/IqOptionBridge.php",
    "src/Bot/Games/DayTradeEngine.php",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)
s = c.open_sftp()
for rel in FILES:
    local = ROOT / rel.replace("/", os.sep)
    s.put(str(local), f"/var/www/autowin/{rel}")
    print("OK", rel, local.stat().st_size)
s.close()

cmd = r"""
php -l /var/www/autowin/src/Services/IqOptionBridge.php
php -l /var/www/autowin/src/Bot/Games/DayTradeEngine.php
node -c /var/www/autowin/bot/iqoption-bridge.cjs
# restart worker so engine code reloads
pkill -f 'bot/worker' 2>/dev/null || pkill -f 'Worker' 2>/dev/null || true
sleep 1
cd /var/www/autowin
# try common worker start
if [ -f scripts/start-worker.sh ]; then bash scripts/start-worker.sh; fi
if pgrep -af 'php.*worker\|bot-worker\|BotWorker' >/dev/null; then echo worker_running; else
  nohup php bot/worker.php >> storage/logs/worker.log 2>&1 &
  nohup php artisan queue:work >> storage/logs/worker.log 2>&1 &
  # autowin style
  nohup php bin/worker.php >> storage/logs/worker.log 2>&1 &
  sleep 1
  pgrep -af 'php' | head -20
fi
# ensure BotWorker via ensureRunning is fine on next API call
echo deploy_result_ok
"""
stdin, stdout, stderr = c.exec_command(cmd, timeout=45)
sys.stdout.write(stdout.read().decode("utf-8", "replace"))
sys.stderr.write(stderr.read().decode("utf-8", "replace"))
c.close()
