"""Status proxy + preferredSlug + logs no VPS."""
import os
import sys

import paramiko

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PASS = os.environ.get("VPS_PASS", "")
if not PASS:
    print("Set VPS_PASS")
    sys.exit(1)

CMD = r"""
set -a
[ -f /var/www/autowin/.env ] && . /var/www/autowin/.env
set +a
echo '=== TIME ==='
date -Is
echo '=== ENV BACBO (masked) ==='
grep -E 'BACBO|PROXY' /var/www/autowin/.env 2>/dev/null | sed -E 's/:[^:@/]+@/:***@/g; s/(PASSWORD|SECRET|TOKEN)=.*/\1=***/' || true
echo '=== DB system_config proxy ==='
mysql -h"${DB_HOST:-127.0.0.1}" -u"${DB_USER}" -p"${DB_PASSWORD}" "${DB_DATABASE}" -N -e \
  "SELECT CONCAT(\`key\`,'=',LEFT(value,120)) FROM system_config WHERE \`key\` LIKE '%PROXY%' OR \`key\` LIKE '%BACBO%';" \
  2>&1 | sed -E 's/:[^:@/]+@/:***@/g' || echo 'mysql-fail'
echo '=== preferredSlug on VPS ==='
grep -n preferredSlug /var/www/autowin/bot/server.cjs /var/www/autowin/bot/bacbo-evo-bridge.cjs /var/www/autowin/src/Services/EvolutionBacBo.php 2>/dev/null | head -25
echo '=== blazePlaySlug engine ==='
grep -n 'blazePlaySlug\|BACBO_LIVE\|bac-bo-ao-vivo' /var/www/autowin/src/Bot/Games/BacBoEngine.php | head -20
echo '=== tunnel ==='
ss -lntp 2>/dev/null | grep -E '1080|1081' || echo 'no tunnel ports'
echo '=== log mtimes ==='
stat -c '%y %s %n' /var/www/autowin/storage/logs/bacbo-bet.log /var/www/autowin/storage/bacbo-evo/attempts.log 2>/dev/null
echo '=== last 8 attempts compact ==='
tail -n 8 /var/www/autowin/storage/bacbo-evo/attempts.log 2>/dev/null | python3 -c '
import sys,json
for line in sys.stdin:
  line=line.strip()
  if not line: continue
  try:
    j=json.loads(line)
  except Exception:
    print(line[:200]); continue
  print(j.get("at"), j.get("action"), "ok="+str(j.get("ok")), "code="+str(j.get("code")),
        "slug="+str(j.get("preferredSlug")), "proxy="+str(j.get("proxyHint") or j.get("proxyConfigured")),
        "exitIp="+str(j.get("exitIp")), "ms="+str(j.get("ms")),
        "err="+str(j.get("error") or "")[:90])
'
"""

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
_i, o, e = c.exec_command(CMD, timeout=45)
print(o.read().decode("utf-8", "replace"))
err = e.read().decode("utf-8", "replace")
if err.strip():
    print("STDERR:", err[:800])
c.close()
