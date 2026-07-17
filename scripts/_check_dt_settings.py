import paramiko
from pathlib import Path

ROOT = Path(r"c:/Users/Aliss/Desktop/autowin-php-cp")
PASS = (ROOT / "scripts" / "_vps_pass.tmp").read_text().strip()
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)

cmds = [
    "cd /var/www/autowin && php -r \"require 'vendor/autoload.php'; require 'src/Bootstrap.php';\" 2>&1 | head -5",
    "grep -n 'DB_\\|database' /var/www/autowin/.env 2>/dev/null | head -10 || true",
    "ls /var/www/autowin/storage/logs/ 2>/dev/null",
    "tail -n 30 /var/www/autowin/storage/logs/daytrade.log 2>/dev/null || echo no-daytrade-log",
    "tail -n 50 /var/www/autowin/storage/logs/php-error.log 2>/dev/null || tail -n 30 /var/log/php*.log 2>/dev/null || echo no-php-log",
    # find db credentials and query
    "php -r '\n"
    "$e=file(\"/var/www/autowin/.env\"); $c=[]; foreach($e as $l){ if(str_contains($l,\"=\")){[$k,$v]=explode(\"=\",trim($l),2); $c[$k]=trim($v,\"\\\"\\'\");}}\n"
    "$pdo=new PDO(\"mysql:host=\".($c[\"DB_HOST\"]??\"localhost\").\";dbname=\".($c[\"DB_DATABASE\"]??$c[\"DB_NAME\"]??\"autowin\"), $c[\"DB_USERNAME\"]??$c[\"DB_USER\"]??\"root\", $c[\"DB_PASSWORD\"]??$c[\"DB_PASS\"]??\"\");\n"
    "foreach($pdo->query(\"DESCRIBE daytrade_settings\") as $r) echo implode(\"\\t\",$r).\"\\n\";\n"
    "echo \"---\\n\";\n"
    "foreach($pdo->query(\"SELECT id,ownerId,strategyType,enterValue,enterType,martingale,martingaleMultiplier,stopType,stopGain,stopLoss,skipFirstEntry,skipEntryAfterLoss,quantityCycles,expirationMinutes FROM daytrade_settings ORDER BY id DESC LIMIT 8\") as $r) echo json_encode($r).\"\\n\";\n"
    "'",
]

for cmd in cmds:
    print("====", cmd[:80], "====")
    stdin, stdout, stderr = c.exec_command(cmd, timeout=30)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    if out:
        print(out)
    if err:
        print("ERR:", err[:500])

c.close()
