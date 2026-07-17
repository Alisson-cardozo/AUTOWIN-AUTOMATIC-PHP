"""Test live IQ balances for connected user on VPS."""
import os
import sys
from pathlib import Path

import paramiko

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[1]
PASS = (ROOT / "scripts" / "_vps_pass.tmp").read_text(encoding="utf-8", errors="replace").strip()
HOST = "187.77.33.118"

php = r'''<?php
$envFile="/var/www/autowin/.env";
if (is_file($envFile)) {
  foreach (file($envFile, FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES) as $line) {
    $line=trim($line);
    if ($line===""||($line[0]??"")==="#"||!str_contains($line,"=")) continue;
    [$k,$v]=explode("=",$line,2);
    $k=trim($k); $v=trim($v, " \t\"'");
    if ($k!=="" && getenv($k)===false) { putenv("$k=$v"); $_ENV[$k]=$v; }
  }
}
require "/var/www/autowin/vendor/autoload.php";
if (!function_exists("env")) require "/var/www/autowin/src/helpers.php";
$u = \App\Database::fetch("SELECT id, iqEmail, iqAccountType, iqBalanceId, LENGTH(iqSsid) ssidLen, iqSsid FROM users WHERE iqSsid IS NOT NULL AND iqSsid!='' ORDER BY id DESC LIMIT 1");
if (!$u) { echo "no_connected_user\n"; exit(0); }
echo "user=".json_encode(["id"=>$u["id"],"email"=>$u["iqEmail"],"type"=>$u["iqAccountType"],"balId"=>$u["iqBalanceId"],"ssidLen"=>$u["ssidLen"]], JSON_UNESCAPED_UNICODE)."\n";
$vars=\App\Database::fetch("SELECT balance, firstBalance FROM daytrade_variables WHERE ownerId=?", [(int)$u["id"]]);
echo "vars=".json_encode($vars)."\n";
$t0=microtime(true);
$res=\App\Services\IqOptionBridge::balances((string)$u["iqSsid"], true);
$ms=(int)((microtime(true)-$t0)*1000);
echo "elapsed_ms=$ms\n";
$out=[
  "ok"=>$res["ok"]??null,
  "error"=>$res["error"]??null,
  "source"=>$res["source"]??null,
  "n"=>isset($res["balances"])&&is_array($res["balances"])?count($res["balances"]):0,
  "balances"=>$res["balances"]??[],
];
echo "result=".json_encode($out, JSON_UNESCAPED_UNICODE)."\n";
if (!empty($res["balances"])) {
  $pick=\App\Controllers\Api\DayTradeController::pickBalance($res["balances"], (string)$u["iqAccountType"], false);
  echo "picked=".json_encode($pick, JSON_UNESCAPED_UNICODE)."\n";
}
echo "log_tail:\n";
$log="/var/www/autowin/storage/logs/iqoption-bridge.log";
if (is_file($log)) {
  $lines=file($log);
  echo implode("", array_slice($lines, -20));
}
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)
sftp = c.open_sftp()
with sftp.file("/tmp/diag_iq_bal.php", "w") as f:
    f.write(php)
sftp.close()
stdin, stdout, stderr = c.exec_command("php /tmp/diag_iq_bal.php", timeout=90)
print(stdout.read().decode("utf-8", "replace"))
err = stderr.read().decode("utf-8", "replace")
if err.strip():
    print("STDERR:", err[-2000:])
c.close()
