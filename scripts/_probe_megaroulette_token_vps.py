"""Testa MEGAROULETTE_FEED_TOKEN na VPS (sem vazar token)."""
import os
import sys

import paramiko

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

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

cmd = r'''
cd /var/www/autowin
php -r '
$envFile=".env";
if (is_file($envFile)) {
  foreach (file($envFile, FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $line) {
    $line=trim($line);
    if ($line===""||($line[0]??"")==="#"||!str_contains($line,"=")) continue;
    [$k,$v]=explode("=",$line,2);
    $k=trim($k); $v=trim($v," \t\"'\''");
    if ($k!=="" && getenv($k)===false) { putenv("$k=$v"); $_ENV[$k]=$v; }
  }
}
require "vendor/autoload.php";
if (!function_exists("env")) require "src/helpers.php";
$token = trim((string)(\App\Models\ConfigRepository::get("MEGAROULETTE_FEED_TOKEN","") ?: env("MEGAROULETTE_FEED_TOKEN","")));
echo "token_len=".strlen($token)."\n";
if ($token==="") { echo "EMPTY\n"; exit; }
$ch=curl_init("https://blaze.bet.br/api/wallets");
curl_setopt_array($ch,[
  CURLOPT_RETURNTRANSFER=>true,
  CURLOPT_HTTPHEADER=>["Authorization: Bearer ".$token,"User-Agent: Mozilla/5.0","Accept: application/json"],
  CURLOPT_TIMEOUT=>20,
]);
$body=curl_exec($ch);
$code=curl_getinfo($ch,CURLINFO_HTTP_CODE);
$err=curl_error($ch);
curl_close($ch);
echo "wallets_http=$code\n";
if ($err) echo "curl_err=$err\n";
$j=json_decode((string)$body,true);
if (is_array($j)) {
  if (isset($j[0]) && is_array($j[0])) {
    echo "wallets_count=".count($j)."\n";
    $w=$j[0];
    echo "wallet0_keys=".implode(",",array_keys($w))."\n";
    echo "has_id=".((isset($w["id"])||isset($w["wallet_id"]))?"1":"0")."\n";
  } else {
    echo "json_keys=".implode(",",array_keys($j))."\n";
    echo "body_sample=".substr(preg_replace("/\\s+/"," ",(string)$body),0,220)."\n";
  }
} else {
  echo "body_sample=".substr(preg_replace("/\\s+/"," ",(string)$body),0,220)."\n";
}
'
'''
_i, o, e = c.exec_command(cmd, timeout=40)
print(o.read().decode("utf-8", "replace"))
err = e.read().decode("utf-8", "replace")
if err.strip():
    print("STDERR:", err[:500])
c.close()
