"""Diagnose daytrade strategies + balance on VPS."""
import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
PASS = os.environ.get("VPS_PASS", "").strip()
if not PASS:
    p = ROOT / "scripts" / "_vps_pass.tmp"
    if p.is_file():
        PASS = p.read_text(encoding="utf-8", errors="replace").strip()

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)

cmd = r"""
set -e
# find db credentials
cd /var/www/autowin
php -r '
require "vendor/autoload.php";
$env = file_exists(".env") ? file(".env") : [];
$db=[];
foreach ($env as $l) {
  $l=trim($l);
  if ($l===""||$l[0]==="#") continue;
  if (!str_contains($l,"=")) continue;
  [$k,$v]=explode("=",$l,2);
  $db[trim($k)]=trim($v," \t\"'\''");
}
$host=$db["DB_HOST"]??"127.0.0.1";
$name=$db["DB_DATABASE"]??$db["DB_NAME"]??"autowin";
$user=$db["DB_USERNAME"]??$db["DB_USER"]??"root";
$pass=$db["DB_PASSWORD"]??"";
$pdo=new PDO("mysql:host=$host;dbname=$name;charset=utf8mb4",$user,$pass);
echo "DB=$name\n";
$cols=$pdo->query("SHOW COLUMNS FROM daytrade_strategies LIKE \"asset\"")->fetch(PDO::FETCH_ASSOC);
echo "asset_col=".json_encode($cols)."\n";
$u=$pdo->query("SELECT id,iqEmail,iqAccountType,iqBalanceId FROM users WHERE iqEmail LIKE \"%alisson%\" OR iqEmail LIKE \"%projetostaco%\" LIMIT 5")->fetchAll(PDO::FETCH_ASSOC);
echo "users=".json_encode($u,JSON_UNESCAPED_UNICODE)."\n";
foreach ($u as $row) {
  $id=(int)$row["id"];
  $s=$pdo->query("SELECT id,strategyType,sequence,LEFT(asset,80) asset,expirationMinutes FROM daytrade_strategies WHERE ownerId=$id")->fetchAll(PDO::FETCH_ASSOC);
  echo "strats_$id=".json_encode($s,JSON_UNESCAPED_UNICODE)."\n";
  $v=$pdo->query("SELECT balance,firstBalance,profit,firstBalanceMode,countWin,countLoss FROM daytrade_variables WHERE ownerId=$id")->fetch(PDO::FETCH_ASSOC);
  echo "vars_$id=".json_encode($v)."\n";
}
// count all strategies
$n=$pdo->query("SELECT COUNT(*) c FROM daytrade_strategies")->fetch(PDO::FETCH_ASSOC);
echo "total_strats=".$n["c"]."\n";
'
"""

stdin, stdout, stderr = c.exec_command(cmd, timeout=45)
sys.stdout.write(stdout.read().decode("utf-8", "replace"))
sys.stderr.write(stderr.read().decode("utf-8", "replace"))
c.close()
