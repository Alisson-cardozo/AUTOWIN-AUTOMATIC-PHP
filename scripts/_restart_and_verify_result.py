"""Verify result fix deployed and restart worker."""
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
PASS = (ROOT / "scripts" / "_vps_pass.tmp").read_text(encoding="utf-8").strip()

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)

cmd = r"""
set -e
cd /var/www/autowin
echo "=== verify engine ==="
grep -c pendingOpenPrice src/Bot/Games/DayTradeEngine.php || true
grep -c parseResultFromPosition bot/iqoption-bridge.cjs || true
php -l src/Bot/Games/DayTradeEngine.php
node -c bot/iqoption-bridge.cjs
echo "=== worker before ==="
pgrep -af 'bot/worker.php' || true
# kill old worker so new code loads
pkill -f 'bot/worker.php' || true
sleep 1
# start worker
nohup php bot/worker.php >> storage/logs/worker.log 2>&1 &
sleep 2
echo "=== worker after ==="
pgrep -af 'bot/worker.php' || true
tail -n 5 storage/logs/worker.log 2>/dev/null || true
echo done
"""
stdin, stdout, stderr = c.exec_command(cmd, timeout=40)
sys.stdout.buffer.write(stdout.read())
sys.stderr.buffer.write(stderr.read())
c.close()
