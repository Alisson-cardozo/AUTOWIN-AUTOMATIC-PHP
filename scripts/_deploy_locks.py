import os, paramiko
from pathlib import Path
ROOT = Path(r"c:/Users/Aliss/Desktop/autowin-php-cp")
PASS = (ROOT / "scripts" / "_vps_pass.tmp").read_text().strip()
FILES = [
  "src/Controllers/Api/AuthController.php",
  "views/layouts/user.php",
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
print("DONE")
c.close()
