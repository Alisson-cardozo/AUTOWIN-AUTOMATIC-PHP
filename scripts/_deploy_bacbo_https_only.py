import os
import paramiko
from pathlib import Path

ROOT = Path(r"c:/Users/Aliss/Desktop/autowin-php-cp")
PASS = (ROOT / "scripts" / "_vps_pass.tmp").read_text().strip()

FILES = [
    "src/Services/EvolutionBacBo.php",
    "src/Bot/Games/BacBoEngine.php",
    "bot/bacbo-evo-bridge.cjs",
]

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
s = c.open_sftp()
for rel in FILES:
    local = ROOT / rel.replace("/", os.sep)
    s.put(str(local), f"/var/www/autowin/{rel}")
    print("OK", rel, local.stat().st_size)
s.close()

# 1) flag no DB
# 2) listar como o node do bacbo está rodando
# 3) reiniciar só o processo certo se for óbvio
remote = r"""
php -r '
$pdo=new PDO("mysql:host=127.0.0.1;dbname=autowin","autowin","ALxHsqHF6hjyxSHJKyYF");
$st=$pdo->prepare("INSERT INTO system_config (`key`,`value`) VALUES (?,?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)");
$st->execute(["BACBO_USE_BROWSER_WS","0"]);
echo "DB_SET BACBO_USE_BROWSER_WS=0\n";
foreach($pdo->query("SELECT `key`,`value` FROM system_config WHERE `key` LIKE \"%BACBO%\"") as $r) {
  echo "CFG ".$r["key"]."=".$r["value"]."\n";
}
'
echo "---PROCS---"
ps aux | grep -E 'server\.cjs|bacbo|node' | grep -v grep | head -30
echo "---PM2---"
pm2 list 2>/dev/null || echo no-pm2
echo "---SYSTEMD---"
systemctl list-units --type=service --all 2>/dev/null | grep -iE 'autowin|bacbo|node|bot' || true
"""
stdin, stdout, stderr = c.exec_command(remote, timeout=40)
print(stdout.read().decode("utf-8", "replace"))
err = stderr.read().decode("utf-8", "replace")
if err.strip():
    print("ERR:", err[:800])
c.close()
print("DONE")
