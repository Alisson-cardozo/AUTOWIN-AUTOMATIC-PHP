import sys
from pathlib import Path
import paramiko

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PASS = Path(__file__).with_name("_vps_pass.tmp").read_text(encoding="utf-8").strip()
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)

def run(cmd):
    _i, o, e = c.exec_command(cmd, timeout=40)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    print(">>>", cmd[:100])
    if out:
        print(out.rstrip())
    if err.strip():
        print("ERR:", err[:500].rstrip())
    print()

run("ls /etc/nginx/sites-enabled/ 2>/dev/null; ls /etc/nginx/conf.d/ 2>/dev/null")
run("grep -R server_name /etc/nginx/ 2>/dev/null | head -30")
run("grep -R root /etc/nginx/sites-enabled/ 2>/dev/null | head -20")
run("ps aux | grep 'worker.php' | grep -v grep")
run("test -f /var/www/autowin/routes/web.php && grep day-trade /var/www/autowin/routes/web.php")
run("curl -sk -o /tmp/dt_body.txt -w 'code=%{http_code}\\n' -H 'Host: localhost' http://127.0.0.1/day-trade; head -c 200 /tmp/dt_body.txt; echo")
# try php built-in route via index
run("cd /var/www/autowin && php -r \"\$_SERVER['REQUEST_METHOD']='GET'; \$_SERVER['REQUEST_URI']='/day-trade'; echo 'skip\\n';\"")
# check domain from .env
run("grep -E 'APP_URL|DOMAIN|BASE' /var/www/autowin/.env 2>/dev/null | head -10")
c.close()
