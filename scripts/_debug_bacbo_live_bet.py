import os
import sys
import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PASS = os.environ.get("VPS_PASS", "")
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

cmds = [
    # users
    """cd /var/www/autowin && php -r 'require "vendor/autoload.php"; App\\Bootstrap::init(); $rows=App\\Database::fetchAll("SELECT id,gameType,accountType,isActive,isBetting FROM users ORDER BY id DESC LIMIT 15"); foreach($rows as $r){echo $r["id"]." ".$r["gameType"]." ".$r["accountType"]." active=".$r["isActive"]." bet=".$r["isBetting"]."\\n";}'""",
    # messages last
    """cd /var/www/autowin && php -r 'require "vendor/autoload.php"; App\\Bootstrap::init(); $rows=App\\Database::fetchAll("SELECT id,userId,LEFT(message,160) m,createdAt FROM bot_messages ORDER BY id DESC LIMIT 25"); foreach($rows as $r){echo $r["id"]." u".$r["userId"]." ".$r["createdAt"]." ".str_replace("\\n"," ",$r["m"])."\\n";}'""",
    # logs
    "tail -n 120 /var/www/autowin/storage/logs/bot.log 2>/dev/null | tail -50",
    "ls /var/www/autowin/storage/logs/",
    "ls -la /var/www/autowin/storage/bacbo-evo/ 2>/dev/null",
    "tail -n 15 /var/www/autowin/storage/bacbo-evo/attempts.log 2>/dev/null",
    # API
    "curl -sS 'https://icy-frog-9f91.alissonprojetostaco.workers.dev/?game=bacbo-live&limit=2' | cut -c1-600",
    # source fetch
    """cd /var/www/autowin && php -r 'require "vendor/autoload.php"; App\\Bootstrap::init(); $r=App\\Bot\\Games\\BacBoSource::fetchSource("bacbo-live"); echo "live source=".App\\Bot\\Games\\BacBoSource::$lastSource." n=".(is_array($r)?count($r):0)."\\n"; $r2=App\\Bot\\Games\\BacBoSource::fetchSource("bacbo"); echo "normal source=".App\\Bot\\Games\\BacBoSource::$lastSource." n=".(is_array($r2)?count($r2):0)."\\n"; $a=App\\Database::fetch("SELECT COUNT(*) c FROM bacbo_live_results"); $b=App\\Database::fetch("SELECT COUNT(*) c FROM bacbo_results"); echo "db live=".$a["c"]." normal=".$b["c"]."\\n";'""",
    # engine room code
    "grep -n 'blazePlaySlug\\|bac-bo-ao-vivo\\|BACBO_LIVE\\|gameTypeCode' /var/www/autowin/src/Bot/Games/BacBoEngine.php | head -25",
    "grep -n 'bac-bo-ao-vivo' /var/www/autowin/src/Bot/Blaze/BlazeAPI.php | head -10",
    # strategies for live
    """cd /var/www/autowin && php -r 'require "vendor/autoload.php"; App\\Bootstrap::init(); foreach(["bacbo_strategies","bacbo_live_strategies","bacbo_settings","bacbo_live_settings"] as $t){ $c=App\\Database::fetch("SELECT COUNT(*) c FROM $t"); echo "$t=".$c["c"]."\\n"; } $s=App\\Database::fetchAll("SELECT id,ownerId,strategyType,LEFT(sequence,40) seq,color FROM bacbo_live_strategies LIMIT 10"); foreach($s as $r) echo json_encode($r)."\\n"; $s2=App\\Database::fetchAll("SELECT ownerId,enterValue,martingale,strategyType FROM bacbo_live_settings LIMIT 5"); foreach($s2 as $r) echo json_encode($r)."\\n";'""",
    # worker log
    "tail -n 40 /var/www/autowin/storage/logs/worker-out.log 2>/dev/null",
    "tail -n 40 /var/www/autowin/storage/logs/worker-err.log 2>/dev/null",
]

for cmd in cmds:
    print("\n---")
    print(cmd[:100])
    _i, o, e = c.exec_command(cmd, timeout=90)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    if out.strip():
        print(out[:4000])
    if err.strip() and "session_" not in err.lower() and "Warning" not in err:
        print("ERR:", err[:500])

c.close()
