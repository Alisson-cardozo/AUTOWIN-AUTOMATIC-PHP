#!/usr/bin/env python3
from pathlib import Path
import paramiko
import time

pw = Path(__file__).with_name("_vps_pass.tmp").read_text(encoding="utf-8").strip()
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=pw, timeout=25, allow_agent=False, look_for_keys=False)

def run(cmd, t=60):
    _, o, e = c.exec_command(cmd, timeout=t)
    out = o.read().decode(errors="replace")
    err = e.read().decode(errors="replace")
    print(out)
    if err.strip():
        print("ERR:", err[:1500])
    return out

# kill by pid file / pgrep carefully
run(
    "pid=$(pgrep -f 'node.*megaroulette-ws-feed' || true); "
    "echo pids=$pid; "
    "if [ -n \"$pid\" ]; then kill $pid 2>/dev/null || true; sleep 1; kill -9 $pid 2>/dev/null || true; fi; "
    "rm -f /var/www/autowin/storage/megaroulette-ws/spawn.lock /var/www/autowin/storage/megaroulette-ws/feed.pid; "
    "echo killed"
)

# env preference
run(
    "cd /var/www/autowin; "
    "if grep -q '^MEGAROULETTE_FEED_SOURCE=' .env 2>/dev/null; then "
    "  sed -i 's/^MEGAROULETTE_FEED_SOURCE=.*/MEGAROULETTE_FEED_SOURCE=blaze/' .env; "
    "else echo 'MEGAROULETTE_FEED_SOURCE=blaze' >> .env; fi; "
    "grep MEGAROULETTE_FEED_SOURCE .env || true"
)

# start feed
run(
    "cd /var/www/autowin; "
    "export AUTOWIN_ROOT=/var/www/autowin; "
    "export MEGAROULETTE_FEED_SOURCE=blaze; "
    # load token lines without breaking
    "if [ -f .env ]; then set -a; . ./.env; set +a; fi; "
    "export MEGAROULETTE_FEED_SOURCE=blaze; "
    "nohup /usr/bin/node bot/megaroulette-ws-feed.cjs >> storage/logs/megaroulette-ws-feed.log 2>&1 & "
    "echo $! > storage/megaroulette-ws/feed.pid; "
    "echo started_pid=$(cat storage/megaroulette-ws/feed.pid)"
)

time.sleep(4)
run(
    "pgrep -af megaroulette || echo NONE; "
    "echo '---status---'; "
    "cat /var/www/autowin/storage/megaroulette-ws/status.json; echo; "
    "echo '---rolls---'; "
    "python3 -c \"import json;d=json.load(open('/var/www/autowin/storage/megaroulette-ws/history.json'));"
    "print('n',len(d.get('results')or[]),d.get('source'),d.get('updatedAt'));"
    "print(' '.join(str(r.get('roll')) for r in (d.get('results')or[])[:20]))\"; "
    "echo '---log---'; "
    "tail -n 18 /var/www/autowin/storage/logs/megaroulette-ws-feed.log"
)
c.close()
print("DONE")
