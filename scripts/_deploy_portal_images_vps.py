"""Deploy portal bundles + imagens de jogos para VPS."""
import os
import sys
from pathlib import Path

import paramiko

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PASS = os.environ.get("VPS_PASS", "")
ROOT = Path(__file__).resolve().parents[1]

FILES = [
    "public/assets/portal/conta.js",
    "public/assets/portal/jogos-premium.js",
    "public/assets/portal/premium-roletas.js",
    "public/imagem-jogos/blaze/bac_bo_ao_vivo.png",
    "public/imagem-jogos/blaze/bacbo.png",
    "public/imagem-jogos/blaze/bacbo_live.png",
    "public/imagem-jogos/blaze/mega_roleta.png",
    "public/imagem-jogos/blaze/double.png",
    "public/imagem-jogos/blaze/fortune.png",
    "src/Bot/Games/MegaRouletteEngine.php",
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
sftp = c.open_sftp()

def ensure_remote_dir(path: str):
    parts = path.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except OSError:
            try:
                sftp.mkdir(cur)
            except OSError:
                pass

for rel in FILES:
    local = ROOT / rel.replace("/", os.sep)
    if not local.is_file():
        print("SKIP missing", rel)
        continue
    remote = f"/var/www/autowin/{rel}"
    ensure_remote_dir(str(Path(remote).parent).replace("\\", "/"))
    sftp.put(str(local), remote)
    print("OK", rel, local.stat().st_size)

sftp.close()
_i, o, e = c.exec_command(
    "ls -la /var/www/autowin/public/imagem-jogos/blaze/; "
    "grep -o 'mega_roleta\\|bac_bo_ao_vivo\\|Mega Roleta Brazilian' /var/www/autowin/public/assets/portal/conta.js | sort | uniq -c; "
    "systemctl reload php8.3-fpm 2>/dev/null || true",
    timeout=30,
)
print(o.read().decode("utf-8", "replace"))
err = e.read().decode("utf-8", "replace")
if err.strip():
    print("ERR", err[:300])
c.close()
print("done")
