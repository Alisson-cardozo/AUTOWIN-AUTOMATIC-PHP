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

php = r'''
<?php
require "/var/www/autowin/vendor/autoload.php";
App\Bootstrap::init();
$proxy = App\Services\EvolutionBacBo::resolveProxyUrl();
echo "proxy=" . ($proxy !== "" ? preg_replace('/:[^:@\\/]+@/', ':***@', $proxy) : "(vazio)") . "\n";
// ip via proxy
$ch = curl_init("https://ipinfo.io/json");
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 20,
  CURLOPT_PROXY => parse_url($proxy, PHP_URL_HOST) . ":" . parse_url($proxy, PHP_URL_PORT),
  CURLOPT_PROXYTYPE => CURLPROXY_HTTP,
  CURLOPT_PROXYUSERPWD => (parse_url($proxy, PHP_URL_USER) ?? "") . ":" . (parse_url($proxy, PHP_URL_PASS) ?? ""),
  CURLOPT_HTTPPROXYTUNNEL => true,
]);
$body = curl_exec($ch);
$err = curl_error($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
echo "ipinfo http=$code err=$err body=" . substr((string)$body, 0, 200) . "\n";
// evo entry
$ch = curl_init("https://a8-latam.evo-games.com/entry");
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 20,
  CURLOPT_PROXY => parse_url($proxy, PHP_URL_HOST) . ":" . parse_url($proxy, PHP_URL_PORT),
  CURLOPT_PROXYTYPE => CURLPROXY_HTTP,
  CURLOPT_PROXYUSERPWD => (parse_url($proxy, PHP_URL_USER) ?? "") . ":" . (parse_url($proxy, PHP_URL_PASS) ?? ""),
  CURLOPT_HTTPPROXYTUNNEL => true,
  CURLOPT_HTTPHEADER => ["User-Agent: Mozilla/5.0", "Referer: https://blaze.bet.br/"],
]);
$body = curl_exec($ch);
$err = curl_error($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
echo "evo entry http=$code err=$err body=" . substr(strip_tags((string)$body), 0, 180) . "\n";
// bacbo-bet log
'''

sftp = c.open_sftp()
with sftp.file("/tmp/test_proxy.php", "w") as f:
    f.write(php)
sftp.close()
_i, o, e = c.exec_command("php /tmp/test_proxy.php; echo ---; tail -n 8 /var/www/autowin/storage/logs/bacbo-bet.log 2>/dev/null", timeout=60)
print(o.read().decode("utf-8", "replace"))
print(e.read().decode("utf-8", "replace")[:400])
c.close()
