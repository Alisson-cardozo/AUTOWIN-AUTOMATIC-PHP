import os, paramiko, subprocess
from pathlib import Path
ROOT = Path(r"c:/Users/Aliss/Desktop/autowin-php-cp")
PASS = (ROOT / "scripts" / "_vps_pass.tmp").read_text().strip()
FILES = [
  "src/Controllers/Api/UserController.php",
  "public/assets/portal/inicio.js",
  "public/assets/portal/inicio.js.map",
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
stdin, stdout, stderr = c.exec_command("php -l /var/www/autowin/src/Controllers/Api/UserController.php", timeout=15)
print(stdout.read().decode())
print("DONE")
c.close()
