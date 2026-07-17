import os, paramiko, time
from pathlib import Path
ROOT = Path(r"c:/Users/Aliss/Desktop/autowin-php-cp")
PASS = (ROOT / "scripts" / "_vps_pass.tmp").read_text().strip()
FILES = [
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
# restart worker
def run(cmd):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=20)
    print(stdout.read().decode("utf-8", "replace"))
run("ps -eo pid,cmd | grep 'bot/worker.php' | grep -v grep | awk '{print $1}' | xargs -r kill")
time.sleep(1)
run("cd /var/www/autowin && nohup php bot/worker.php >> storage/logs/worker.log 2>&1 & echo worker_ok")
time.sleep(1)
run("ps -eo pid,cmd | grep 'bot/worker.php' | grep -v grep")
print("DONE")
c.close()
