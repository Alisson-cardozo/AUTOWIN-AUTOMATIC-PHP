import os, paramiko, time
from pathlib import Path
ROOT = Path(r"c:/Users/Aliss/Desktop/autowin-php-cp")
PASS = (ROOT / "scripts" / "_vps_pass.tmp").read_text().strip()
FILES = [
  "src/Controllers/Api/DayTradeController.php",
  "src/Bot/Games/DayTradeEngine.php",
  "src/Controllers/PageController.php",
  "routes/web.php",
  "views/layouts/user.php",
  "views/user/premium-day-trade.php",
  "public/assets/portal/premium-day-trade.js",
  "public/assets/portal/premium-day-trade.js.map",
  "public/assets/portal/day-trade.js",
  "public/assets/portal/admin-padroes.js",
  "portal-src/pages/premium-day-trade.tsx",
  "portal-src/entries/premium-day-trade.tsx",
]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)
s = c.open_sftp()
for rel in FILES:
    local = ROOT / rel.replace("/", os.sep)
    if not local.is_file():
        print("SKIP", rel)
        continue
    remote = f"/var/www/autowin/{rel}"
    rdir = "/".join(remote.split("/")[:-1])
    try:
        s.stat(rdir)
    except OSError:
        stdin, stdout, stderr = c.exec_command(f"mkdir -p {rdir}", timeout=10)
        stdout.read()
    s.put(str(local), remote)
    print("OK", rel, local.stat().st_size)
s.close()

def run(cmd):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=30)
    print(stdout.read().decode("utf-8", "replace"))
    e = stderr.read().decode("utf-8", "replace")
    if e.strip():
        print("ERR", e)

run("php -l /var/www/autowin/src/Controllers/Api/DayTradeController.php")
run("php -l /var/www/autowin/src/Bot/Games/DayTradeEngine.php")
run("test -f /var/www/autowin/public/assets/portal/premium-day-trade.js && echo bundle_ok")
# restart worker
run("ps -eo pid,cmd | grep 'bot/worker.php' | grep -v grep | awk '{print $1}' | xargs -r kill")
time.sleep(1)
run("cd /var/www/autowin && nohup php bot/worker.php >> storage/logs/worker.log 2>&1 & echo worker_started")
time.sleep(1)
run("ps -eo pid,cmd | grep 'bot/worker.php' | grep -v grep")
print("DONE")
c.close()
