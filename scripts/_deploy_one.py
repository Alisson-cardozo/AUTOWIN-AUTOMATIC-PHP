import os
import sys
from pathlib import Path

import paramiko

PASS = os.environ.get("VPS_PASS", "")
rel = sys.argv[1] if len(sys.argv) > 1 else ""
if not rel or not PASS:
    print("usage: VPS_PASS=... python _deploy_one.py path/relative")
    sys.exit(1)

local = Path(__file__).resolve().parents[1].joinpath(*rel.split("/"))
remote = "/var/www/autowin/" + rel
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "187.77.33.118",
    username="root",
    password=PASS,
    timeout=25,
    allow_agent=False,
    look_for_keys=False,
)
s = c.open_sftp()
s.put(str(local), remote)
s.close()
print("OK", local.stat().st_size, "->", remote)
_i, o, e = c.exec_command(
    f"php -l {remote}; systemctl reload php8.3-fpm 2>/dev/null || true",
    timeout=30,
)
print(o.read().decode())
print(e.read().decode())
c.close()
