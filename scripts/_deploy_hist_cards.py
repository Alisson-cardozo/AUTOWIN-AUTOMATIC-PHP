import os, paramiko, subprocess, time
from pathlib import Path
ROOT = Path(r"c:/Users/Aliss/Desktop/autowin-php-cp")
PASS = (ROOT / "scripts" / "_vps_pass.tmp").read_text().strip()
subprocess.check_call(["node", "scripts/build-portal.mjs"], cwd=str(ROOT))
FILES = [
  "bot/iqoption-bridge.cjs",
  "src/Services/IqOptionBridge.php",
  "src/Bot/Games/DayTradeEngine.php",
  "src/Controllers/Api/DayTradeController.php",
  "public/assets/portal/day-trade.js",
  "public/assets/portal/day-trade.js.map",
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

def run(cmd):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=30)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    print(out)
    if err.strip():
        print("ERR", err)

run("php -l /var/www/autowin/src/Controllers/Api/DayTradeController.php")
run("php -l /var/www/autowin/src/Bot/Games/DayTradeEngine.php")
run("node -c /var/www/autowin/bot/iqoption-bridge.cjs")
# get pids via php
run("ps -eo pid,cmd | grep worker.php | grep -v grep")
# kill using killall php carefully - better: use systemctl or restart script
run("killall -q php 2>/dev/null; true")
time.sleep(1)
run("cd /var/www/autowin && nohup php bot/worker.php >> storage/logs/worker.log 2>&1 & echo started")
time.sleep(2)
run("ps -eo pid,cmd | grep worker.php | grep -v grep")
run("grep -c buildDayTradeHistory /var/www/autowin/src/Controllers/Api/DayTradeController.php")
print("DONE")
c.close()
