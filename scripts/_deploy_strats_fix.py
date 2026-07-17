"""Deploy strategy load + IQ balance fixes."""
import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
PASS = os.environ.get("VPS_PASS", "").strip()
if not PASS:
    p = ROOT / "scripts" / "_vps_pass.tmp"
    if p.is_file():
        PASS = p.read_text(encoding="utf-8", errors="replace").strip()

# ensure build is current
import subprocess
subprocess.check_call(["node", "scripts/build-portal.mjs"], cwd=str(ROOT))

FILES = [
    "src/Controllers/Api/UserController.php",
    "src/Controllers/Api/DayTradeController.php",
    "public/assets/portal/day-trade.js",
    "public/assets/portal/day-trade.js.map",
    "public/assets/portal/inicio.js",
    "public/assets/portal/inicio.js.map",
    "portal-src/pages/day-trade.tsx",
    "portal-src/pages/inicio.tsx",
]

HOST = "187.77.33.118"
REMOTE = "/var/www/autowin"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)
s = c.open_sftp()
for rel in FILES:
    local = ROOT / rel.replace("/", os.sep)
    if not local.is_file():
        print("SKIP", rel)
        continue
    s.put(str(local), f"{REMOTE}/{rel}")
    print("OK", rel, local.stat().st_size)
s.close()

# lint + opcache clear
cmd = r"""
php -l /var/www/autowin/src/Controllers/Api/DayTradeController.php
php -l /var/www/autowin/src/Controllers/Api/UserController.php
# clear php-fpm opcache if possible
systemctl reload php8.2-fpm 2>/dev/null || systemctl reload php8.1-fpm 2>/dev/null || systemctl reload php-fpm 2>/dev/null || true
# verify built JS has setStrategies path marker
grep -o 'setStrategies\|daytradeBank\|Cadastradas' /var/www/autowin/public/assets/portal/day-trade.js | head -5
grep -o 'daytradeBank\|Banca IQ' /var/www/autowin/public/assets/portal/inicio.js | head -5
echo done
"""
stdin, stdout, stderr = c.exec_command(cmd, timeout=40)
sys.stdout.write(stdout.read().decode("utf-8", "replace"))
sys.stderr.write(stderr.read().decode("utf-8", "replace"))
c.close()
print("deploy complete")
