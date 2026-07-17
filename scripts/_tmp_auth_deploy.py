#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import paramiko

HOST = "187.77.33.118"
ROOT = Path(__file__).resolve().parents[1]
CANDS = Path(__file__).with_name("_vps_cands.txt")
OUT = Path(__file__).with_name("_auth_out.txt")
PASS_TMP = Path(__file__).with_name("_vps_pass.tmp")


def log(msg: str) -> None:
    with OUT.open("a", encoding="utf-8") as f:
        f.write(msg + "\n")
    print(msg, flush=True)


def try_auth() -> str:
    cands = [x.strip() for x in CANDS.read_text(encoding="utf-8").splitlines() if x.strip()]
    # try known working sha first if present: 6aa201cc3fa4
    def key(pw: str):
        h = hashlib.sha256(pw.encode()).hexdigest()[:12]
        return (0 if h == "6aa201cc3fa4" else 1, len(pw), pw)

    cands = sorted(set(cands), key=key)
    for pw in cands:
        h = hashlib.sha256(pw.encode()).hexdigest()[:12]
        c = paramiko.SSHClient()
        c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            c.connect(
                HOST,
                username="root",
                password=pw,
                timeout=15,
                allow_agent=False,
                look_for_keys=False,
            )
            log(f"OK {h} len={len(pw)}")
            PASS_TMP.write_text(pw, encoding="utf-8")
            c.close()
            return pw
        except Exception as e:
            log(f"fail {h} len={len(pw)} {type(e).__name__}")
            try:
                c.close()
            except Exception:
                pass
    raise SystemExit("no auth")


def run(pw: str) -> None:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=pw, timeout=25, allow_agent=False, look_for_keys=False)
    cmd = r"""
set -e
echo '=== status ==='
cat /var/www/autowin/storage/megaroulette-ws/status.json 2>/dev/null; echo
echo '=== history top 20 ==='
python3 - <<'PY'
import json
p='/var/www/autowin/storage/megaroulette-ws/history.json'
d=json.load(open(p))
print('updatedAt', d.get('updatedAt'), 'source', d.get('source'), 'n', len(d.get('results') or []))
for r in (d.get('results') or [])[:20]:
    print(f"{r.get('roll')}\t{r.get('color')}\t{str(r.get('id'))[:40]}\t{r.get('created_at')}")
# show rolls only for compare
rolls=[str(r.get('roll')) for r in (d.get('results') or [])[:30]]
print('ROLLS', ' '.join(rolls))
PY
echo '=== db top 20 ==='
cd /var/www/autowin && php -r '
require "vendor/autoload.php";
App\Bootstrap::init();
$rows = App\Database::fetchAll("SELECT blazeId, roll, color, createdAt FROM game_results WHERE gameType=\"ROLETA\" AND platform=\"BLAZE\" ORDER BY id DESC LIMIT 20");
$rolls=[];
foreach ($rows as $r) { echo $r["roll"]."\t".$r["color"]."\t".$r["blazeId"]."\t".$r["createdAt"]."\n"; $rolls[]=(string)$r["roll"]; }
echo "DB_ROLLS ".implode(" ", $rolls)."\n";
'
echo '=== feed ==='
ps aux | grep megaroulette-ws-feed | grep -v grep || echo NO_FEED
echo '=== log tail ==='
tail -n 30 /var/www/autowin/storage/logs/megaroulette-ws-feed.log 2>/dev/null || true
"""
    _, o, e = c.exec_command(cmd, timeout=90)
    out = o.read().decode(errors="replace")
    err = e.read().decode(errors="replace")
    Path(__file__).with_name("_hist_out.txt").write_text(out + "\nSTDERR\n" + err, encoding="utf-8")
    print(out)
    if err.strip():
        print("STDERR", err[:2000])
    c.close()


if __name__ == "__main__":
    OUT.write_text("", encoding="utf-8")
    pw = try_auth()
    run(pw)
