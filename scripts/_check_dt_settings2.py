import paramiko
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(r"c:/Users/Aliss/Desktop/autowin-php-cp")
PASS = (ROOT / "scripts" / "_vps_pass.tmp").read_text().strip()
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)

php = r'''
$pdo = new PDO("mysql:host=127.0.0.1;dbname=autowin", "autowin", "ALxHsqHF6hjyxSHJKyYF");
echo "COLS\n";
foreach ($pdo->query("DESCRIBE daytrade_settings") as $r) {
    echo $r["Field"]."\t".$r["Type"]."\t".$r["Default"]."\n";
}
echo "ROWS\n";
foreach ($pdo->query("SELECT id,ownerId,strategyType,enterValue,enterType,martingale,martingaleMultiplier,stopType,stopGain,stopLoss,skipFirstEntry,skipEntryAfterLoss,quantityCycles,expirationMinutes,minPayout FROM daytrade_settings ORDER BY id DESC LIMIT 10") as $r) {
    echo json_encode($r, JSON_UNESCAPED_UNICODE)."\n";
}
'''

# write temp php on server
sftp = c.open_sftp()
with sftp.file("/tmp/check_dt.php", "w") as f:
    f.write("<?php\n" + php)
sftp.close()

stdin, stdout, stderr = c.exec_command("php /tmp/check_dt.php", timeout=30)
out = stdout.read().decode("utf-8", errors="replace")
err = stderr.read().decode("utf-8", errors="replace")
print(out)
if err:
    print("ERR:", err)

stdin, stdout, stderr = c.exec_command("tail -n 20 /var/www/autowin/storage/logs/daytrade.log | tr -cd '\\11\\12\\15\\40-\\176'", timeout=20)
print("LOG:", stdout.read().decode("ascii", errors="replace"))

# test update API logic with a dry-run simulation
php2 = r'''
$pdo = new PDO("mysql:host=127.0.0.1;dbname=autowin", "autowin", "ALxHsqHF6hjyxSHJKyYF");
// pick first owner
$row = $pdo->query("SELECT ownerId, enterValue, martingaleMultiplier FROM daytrade_settings LIMIT 1")->fetch(PDO::FETCH_ASSOC);
echo "sample=".json_encode($row)."\n";
'''
with c.open_sftp().file("/tmp/check_dt2.php", "w") as f:
    f.write("<?php\n" + php2)
stdin, stdout, stderr = c.exec_command("php /tmp/check_dt2.php", timeout=20)
print(stdout.read().decode("utf-8", errors="replace"))
print(stderr.read().decode("utf-8", errors="replace"))

c.close()
