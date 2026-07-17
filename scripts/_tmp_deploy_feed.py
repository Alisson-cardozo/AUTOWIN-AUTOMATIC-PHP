#!/usr/bin/env python3
from pathlib import Path
import paramiko

HOST = "187.77.33.118"
ROOT = Path(__file__).resolve().parents[1]
pw = Path(__file__).with_name("_vps_pass.tmp").read_text(encoding="utf-8").strip()
local = ROOT / "bot" / "megaroulette-ws-feed.cjs"
remote = "/var/www/autowin/bot/megaroulette-ws-feed.cjs"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", password=pw, timeout=25, allow_agent=False, look_for_keys=False)
s = c.open_sftp()
s.put(str(local), remote)
s.close()
print("PUT", local.stat().st_size)

cmd = r"""
node --check /var/www/autowin/bot/megaroulette-ws-feed.cjs && echo NODE_OK
pkill -f megaroulette-ws-feed.cjs 2>/dev/null || true
sleep 1
rm -f /var/www/autowin/storage/megaroulette-ws/spawn.lock /var/www/autowin/storage/megaroulette-ws/feed.pid
# Prefer blaze while GC hash is dead
cd /var/www/autowin
export MEGAROULETTE_FEED_SOURCE=blaze
export AUTOWIN_ROOT=/var/www/autowin
# load token from .env if present
set -a
[ -f .env ] && . ./.env
set +a
nohup /usr/bin/node bot/megaroulette-ws-feed.cjs >> storage/logs/megaroulette-ws-feed.log 2>&1 &
echo $! > storage/megaroulette-ws/feed.pid
sleep 3
ps aux | grep megaroulette-ws-feed | grep -v grep
echo '--- status ---'
cat storage/megaroulette-ws/status.json
echo
echo '--- top rolls ---'
python3 - <<'PY'
import json
d=json.load(open('/var/www/autowin/storage/megaroulette-ws/history.json'))
print('n', len(d.get('results') or []), 'src', d.get('source'), 'upd', d.get('updatedAt'))
print('ROLLS', ' '.join(str(r.get('roll')) for r in (d.get('results') or [])[:15]))
PY
echo '--- log ---'
tail -n 15 storage/logs/megaroulette-ws-feed.log
"""
_, o, e = c.exec_command(cmd, timeout=60)
print(o.read().decode(errors="replace"))
err = e.read().decode(errors="replace")
if err.strip():
    print("STDERR", err[:1500])
c.close()
