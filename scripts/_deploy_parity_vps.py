import os
from pathlib import Path
import paramiko

PASS = os.environ.get("VPS_PASS", "")
LOCAL = Path(__file__).resolve().parents[1]
REMOTE = "/var/www/autowin"
FILES = [
    "routes/web.php",
    "src/Controllers/PageController.php",
    "src/Controllers/Api/UserController.php",
    "src/Controllers/Api/AdminController.php",
    "views/user/premium-bacbo-live.php",
    "public/assets/portal/premium-bacbo.js",
    "public/assets/portal/premium-bacbo-live.js",
    "public/assets/portal/jogos-premium.js",
    "public/assets/portal/inicio.js",
    "public/assets/portal/calculadora.js",
    "public/assets/portal/admin-padroes.js",
    "public/assets/portal/conta.js",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)
s = c.open_sftp()


def ensure(remote_dir: str) -> None:
    cur = ""
    for p in remote_dir.split("/"):
        if not p:
            continue
        cur += "/" + p
        try:
            s.stat(cur)
        except OSError:
            try:
                s.mkdir(cur)
            except OSError:
                pass


for rel in FILES:
    loc = LOCAL.joinpath(*rel.split("/"))
    rem = REMOTE + "/" + rel
    if not loc.is_file():
        print("MISS", rel)
        continue
    ensure(rem.rsplit("/", 1)[0])
    s.put(str(loc), rem)
    print("OK", rel, loc.stat().st_size)

s.close()
_i, o, e = c.exec_command(
    "systemctl reload php8.3-fpm 2>/dev/null; "
    "ls -la /var/www/autowin/public/assets/portal/premium-bacbo-live.js "
    "/var/www/autowin/views/user/premium-bacbo-live.php; "
    "grep -c BACBO_LIVE /var/www/autowin/public/assets/portal/inicio.js",
    timeout=30,
)
print(o.read().decode())
print(e.read().decode())
c.close()
print("DONE")
