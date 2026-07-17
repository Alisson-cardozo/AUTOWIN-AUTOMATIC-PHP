#!/usr/bin/env python3
from pathlib import Path
import paramiko

pw = Path(__file__).with_name("_vps_pass.tmp").read_text(encoding="utf-8").strip()
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=pw, timeout=25, allow_agent=False, look_for_keys=False)

# upload again to be sure
s = c.open_sftp()
local = Path(__file__).resolve().parents[1] / "bot" / "megaroulette-ws-feed.cjs"
s.put(str(local), "/var/www/autowin/bot/megaroulette-ws-feed.cjs")
s.close()
print("uploaded", local.stat().st_size)

cmd = r"""
set -x
node --check /var/www/autowin/bot/megaroulette-ws-feed.cjs
pkill -f '/var/www/autowin/bot/megaroulette-ws-feed.cjs' || true
pkill -f 'megaroulette-ws-feed.cjs' || true
sleep 2
rm -f /var/www/autowin/storage/megaroulette-ws/spawn.lock /var/www/autowin/storage/megaroulette-ws/feed.pid
cd /var/www/autowin
# Prefer blaze: patch .env if key exists, else append
if grep -q '^MEGAROULETTE_FEED_SOURCE=' .env 2>/dev/null; then
  sed -i 's/^MEGAROULETTE_FEED_SOURCE=.*/MEGAROULETTE_FEED_SOURCE=blaze/' .env
else
  echo 'MEGAROULETTE_FEED_SOURCE=blaze' >> .env
fi
# spawn via nohup with env
export $(grep -E '^(MEGAROULETTE_|AUTOWIN_)' .env | xargs -d '\n' 2>/dev/null)
export MEGAROULETTE_FEED_SOURCE=blaze
export AUTOWIN_ROOT=/var/www/autowin
nohup /usr/bin/node bot/megaroulette-ws-feed.cjs >> storage/logs/megaroulette-ws-feed.log 2>&1 &
echo $! > storage/megaroulette-ws/feed.pid
sleep 4
echo '=== PROC ==='
ps aux | grep megaroulette-ws-feed | grep -v grep || echo NONE
echo '=== STATUS ==='
cat storage/megaroulette-ws/status.json; echo
echo '=== ROLLS ==='
python3 -c "import json;d=json.load(open('storage/megaroulette-ws/history.json'));print('n',len(d.get('results')or[]),d.get('source'),d.get('updatedAt'));print(' '.join(str(r.get('roll')) for r in (d.get('results')or[])[:20]))"
echo '=== LOG ==='
tail -n 20 storage/logs/megaroulette-ws-feed.log
"""
_, o, e = c.exec_command(cmd, timeout=90)
print(o.read().decode(errors="replace"))
err = e.read().decode(errors="replace")
if err.strip():
    print("STDERR:", err[:3000])
c.close()
