#!/usr/bin/env python3
from pathlib import Path
import time
import paramiko

pw = Path(__file__).with_name("_vps_pass.tmp").read_text(encoding="utf-8").strip()
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=pw, timeout=25, allow_agent=False, look_for_keys=False)

def run(cmd, t=90):
    _, o, e = c.exec_command(cmd, timeout=t)
    out = o.read().decode(errors="replace")
    err = e.read().decode(errors="replace")
    print(out)
    if err.strip():
        print("ERR:", err[:2000])
    return out

# kill node feed only
run(
    "for p in $(pgrep -f 'node /var/www/autowin/bot/megaroulette-ws-feed' || true); do kill $p 2>/dev/null; done; "
    "sleep 1; "
    "for p in $(pgrep -f 'node /var/www/autowin/bot/megaroulette-ws-feed' || true); do kill -9 $p 2>/dev/null; done; "
    "rm -f /var/www/autowin/storage/megaroulette-ws/spawn.lock /var/www/autowin/storage/megaroulette-ws/feed.pid; "
    "echo cleared"
)

# ensure source blaze in system_config if table exists + start via PHP
run(
    r"""
cd /var/www/autowin && php <<'PHP'
<?php
require 'vendor/autoload.php';
App\Bootstrap::init();
try {
    App\Models\ConfigRepository::set('MEGAROULETTE_FEED_SOURCE', 'blaze');
    echo "config source=blaze\n";
} catch (Throwable $e) {
    echo "config set skip: ".$e->getMessage()."\n";
}
$token = App\Services\MegaRouletteWsFeed::resolveFeedToken();
echo "token_len=".strlen($token)."\n";
@unlink(storage_path('megaroulette-ws/spawn.lock'));
@unlink(storage_path('megaroulette-ws/feed.pid'));
App\Services\MegaRouletteWsFeed::ensureRunning();
usleep(2_500_000);
echo "running=".(App\Services\MegaRouletteWsFeed::isRunning() ? '1' : '0')."\n";
echo "stale=".(App\Services\MegaRouletteWsFeed::isStale() ? '1' : '0')."\n";
$r = App\Services\MegaRouletteWsFeed::readResults();
echo "results=".(is_array($r)?count($r):0)."\n";
if (is_array($r)) {
  echo "rolls=".implode(' ', array_map(fn($x)=>(string)($x['roll']??'?'), array_slice($r,0,15)))."\n";
}
PHP
"""
)

time.sleep(2)
run(
    "pgrep -af 'node /var/www/autowin/bot/megaroulette' || echo NONE; "
    "cat /var/www/autowin/storage/megaroulette-ws/status.json; echo; "
    "tail -n 15 /var/www/autowin/storage/logs/megaroulette-ws-feed.log"
)
c.close()
print("DONE")
