import os
import paramiko
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(r"c:/Users/Aliss/Desktop/autowin-php-cp")
PASS = (ROOT / "scripts" / "_vps_pass.tmp").read_text().strip()
FILES = [
    "bot/bacbo-evo-bridge.cjs",
    "src/Services/EvolutionBacBo.php",
]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "187.77.33.118",
    username="root",
    password=PASS,
    timeout=30,
    allow_agent=False,
    look_for_keys=False,
)
s = c.open_sftp()
for rel in FILES:
    local = ROOT / rel.replace("/", os.sep)
    s.put(str(local), f"/var/www/autowin/{rel}")
    print("OK", rel, local.stat().st_size)
s.close()
stdin, stdout, stderr = c.exec_command(
    "node --check /var/www/autowin/bot/bacbo-evo-bridge.cjs && echo SYNTAX_OK; "
    "grep -n 'connectAndBetViaBrowser\\|puppeteer\\|CHROME_PATH\\|useBrowserWs' "
    "/var/www/autowin/bot/bacbo-evo-bridge.cjs | head -10 || true; "
    "pm2 restart autowin-worker; sleep 1; pm2 list | head -12",
    timeout=40,
)
print(stdout.read().decode("utf-8", "replace"))
err = stderr.read().decode("utf-8", "replace")
if err.strip():
    print("ERR:", err[:400])
c.close()
print("DONE")
