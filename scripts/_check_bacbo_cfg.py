import paramiko
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(r"c:/Users/Aliss/Desktop/autowin-php-cp")
PASS = (ROOT / "scripts" / "_vps_pass.tmp").read_text().strip()
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)

script = r"""
<?php
$env = @file_get_contents('/var/www/autowin/.env') ?: '';
foreach (preg_split('/\r?\n/', $env) as $l) {
  if (stripos($l, 'BACBO') !== false || stripos($l, 'BROWSER') !== false) echo "ENV $l\n";
}
$pdo = new PDO('mysql:host=127.0.0.1;dbname=autowin', 'autowin', 'ALxHsqHF6hjyxSHJKyYF');
foreach ($pdo->query("SELECT `key`, `value` FROM system_config WHERE `key` LIKE '%BACBO%' OR `key` LIKE '%BROWSER%'") as $r) {
  echo "DB {$r['key']}={$r['value']}\n";
}
// try alternate column names
try {
  foreach ($pdo->query("SHOW COLUMNS FROM system_config") as $c) echo "COL {$c['Field']}\n";
} catch (Throwable $e) { echo $e->getMessage(),"\n"; }
"""
sftp = c.open_sftp()
with sftp.file("/tmp/chk_bacbo.php", "w") as f:
    f.write(script)
sftp.close()
stdin, stdout, stderr = c.exec_command("php /tmp/chk_bacbo.php", timeout=20)
print(stdout.read().decode("utf-8", "replace"))
print(stderr.read().decode("utf-8", "replace"))
c.close()
