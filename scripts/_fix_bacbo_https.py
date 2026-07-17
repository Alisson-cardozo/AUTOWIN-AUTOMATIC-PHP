import paramiko
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(r"c:/Users/Aliss/Desktop/autowin-php-cp")
PASS = (ROOT / "scripts" / "_vps_pass.tmp").read_text().strip()
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

php = r"""<?php
$pdo = new PDO('mysql:host=127.0.0.1;dbname=autowin', 'autowin', 'ALxHsqHF6hjyxSHJKyYF');
$st = $pdo->prepare('INSERT INTO system_config (`key`,`value`) VALUES (?,?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)');
$st->execute(['BACBO_USE_BROWSER_WS', '0']);
echo "SET BACBO_USE_BROWSER_WS=0\n";
foreach ($pdo->query("SELECT `key`,`value` FROM system_config WHERE `key` LIKE '%BACBO%'") as $r) {
    echo $r['key'] . '=' . $r['value'] . "\n";
}
"""
sftp = c.open_sftp()
with sftp.file("/tmp/fix_bacbo_https.php", "w") as f:
    f.write(php)
sftp.close()

stdin, stdout, stderr = c.exec_command("php /tmp/fix_bacbo_https.php", timeout=20)
print(stdout.read().decode("utf-8", "replace"))
print(stderr.read().decode("utf-8", "replace"))

stdin, stdout, stderr = c.exec_command(
    "ps -eo pid,cmd | grep -E 'server.cjs|bacbo|node ' | grep -v grep | head -25; echo ---; pm2 list 2>/dev/null | head -25 || echo no-pm2; echo ---; ls -la /var/www/autowin/storage/bot-worker.pid 2>/dev/null; cat /var/www/autowin/storage/bot-worker.pid 2>/dev/null",
    timeout=20,
)
print(stdout.read().decode("utf-8", "replace"))
print(stderr.read().decode("utf-8", "replace")[:300])
c.close()
