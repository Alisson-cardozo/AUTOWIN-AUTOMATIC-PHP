"""Check daytrade entries + iqoption logs on VPS."""
import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
PASS = (ROOT / "scripts" / "_vps_pass.tmp").read_text(encoding="utf-8").strip()

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)

cmd = r"""
cd /var/www/autowin
php -r '
$env=file(".env"); $db=[];
foreach($env as $l){$l=trim($l); if($l===""||$l[0]==="#"||!str_contains($l,"="))continue; [$k,$v]=explode("=",$l,2); $db[trim($k)]=trim($v," \t\"'\''");}
$pdo=new PDO("mysql:host=".($db["DB_HOST"]??"127.0.0.1").";dbname=".($db["DB_DATABASE"]??"autowin").";charset=utf8mb4", $db["DB_USERNAME"]??"root", $db["DB_PASSWORD"]??"");
$rows=$pdo->query("SELECT id,type,asset,direction,amount,result,profit,externalId,expiration,createdAt FROM daytrade_entries WHERE ownerId=1 ORDER BY id DESC LIMIT 10")->fetchAll(PDO::FETCH_ASSOC);
echo "ENTRIES=".json_encode($rows, JSON_UNESCAPED_UNICODE)."\n";
'
echo "=== bridge log ==="
tail -n 60 storage/logs/iqoption-bridge.log 2>/dev/null || echo no-bridge-log
echo "=== daytrade log ==="
tail -n 40 storage/logs/daytrade.log 2>/dev/null || echo no-daytrade-log
echo "=== iqoption log ==="
tail -n 40 storage/logs/iqoption.log 2>/dev/null || echo no-iqoption-log
"""

stdin, stdout, stderr = c.exec_command(cmd, timeout=40)
out = stdout.read().decode("utf-8", "replace")
err = stderr.read().decode("utf-8", "replace")
(ROOT / "scripts" / "_diag_out.txt").write_text(out + "\nERR\n" + err, encoding="utf-8")
print("ok bytes", len(out))
c.close()
