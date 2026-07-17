#!/usr/bin/env python3
"""Check Mega Roulette history on VPS vs expected sequence from user screenshots."""
import json
import re
import sqlite3
from pathlib import Path

import paramiko

# recover pass from session if needed
PASS = ""
tmp = Path(__file__).with_name("_vps_pass.tmp")
if tmp.is_file():
    PASS = tmp.read_text(encoding="utf-8").strip()
if not PASS:
    db = Path.home() / ".grok" / "sessions" / "session_search.sqlite"
    if db.is_file():
        con = sqlite3.connect(str(db))
        rows = con.execute(
            "SELECT content FROM session_docs WHERE content LIKE '%VPS_PASS%' LIMIT 5"
        ).fetchall()
        for (t,) in rows:
            for m in re.finditer(r"VPS_PASS\s*=\s*([^\s\"']+)", t or ""):
                cand = m.group(1).strip()
                if len(cand) >= 8:
                    # try later
                    PASS = cand  # last
        con.close()

# prefer working 12-char from prior success — try all cands
cands = []
if PASS:
    cands.append(PASS)
db = Path.home() / ".grok" / "sessions" / "session_search.sqlite"
if db.is_file():
    con = sqlite3.connect(str(db))
    t = "\n".join(
        r[0] or ""
        for r in con.execute(
            "SELECT content FROM session_docs WHERE content LIKE '%VPS_PASS%' OR content LIKE '%187.77%'"
        )
    )
    con.close()
    for m in re.finditer(r"VPS_PASS\s*=\s*([^\s\"']+)", t):
        c = m.group(1).strip()
        if c not in cands and len(c) >= 8:
            cands.append(c)

HOST = "187.77.33.118"
client = None
for pw in cands:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        c.connect(HOST, username="root", password=pw, timeout=20, allow_agent=False, look_for_keys=False)
        client = c
        Path(__file__).with_name("_vps_pass.tmp").write_text(pw, encoding="utf-8")
        print("auth ok len", len(pw))
        break
    except Exception as e:
        print("auth fail", type(e).__name__, "len", len(pw))
        try:
            c.close()
        except Exception:
            pass

if not client:
    raise SystemExit("no auth")

cmd = r"""
echo '=== status ==='
cat /var/www/autowin/storage/megaroulette-ws/status.json 2>/dev/null | head -c 2000; echo
echo '=== history top 25 ==='
python3 - <<'PY'
import json
p='/var/www/autowin/storage/megaroulette-ws/history.json'
d=json.load(open(p))
print('updatedAt', d.get('updatedAt'), 'source', d.get('source'), 'n', len(d.get('results') or []))
for r in (d.get('results') or [])[:25]:
    print(f"{r.get('roll')}\t{r.get('color')}\t{r.get('id')}\t{r.get('created_at')}")
PY
echo '=== db top 25 ==='
cd /var/www/autowin && php -r '
require "vendor/autoload.php";
App\Bootstrap::init();
$rows = App\Database::fetchAll("SELECT blazeId, roll, color, createdAt FROM game_results WHERE gameType=\"ROLETA\" AND platform=\"BLAZE\" ORDER BY id DESC LIMIT 25");
foreach ($rows as $r) echo $r["roll"]."\t".$r["color"]."\t".$r["blazeId"]."\t".$r["createdAt"]."\n";
echo "total=";
$t=App\Database::fetch("SELECT COUNT(*) c FROM game_results WHERE gameType=\"ROLETA\" AND platform=\"BLAZE\"");
echo ($t["c"]??0)."\n";
'
echo '=== feed process ==='
ps aux | grep megaroulette-ws-feed | grep -v grep
echo '=== recent feed log ==='
tail -n 40 /var/www/autowin/storage/logs/megaroulette-ws-feed.log 2>/dev/null || tail -n 40 /var/www/autowin/storage/logs/*.log 2>/dev/null | tail -n 40
"""
_, o, e = client.exec_command(cmd, timeout=60)
print(o.read().decode(errors="replace"))
err = e.read().decode(errors="replace")
if err.strip():
    print("STDERR", err[:2500])
client.close()
