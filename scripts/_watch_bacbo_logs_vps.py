"""Snapshot + tail Bac Bo REAL logs on VPS."""
import os
import sys
import time

import paramiko

# Windows console (cp1252) não imprime setas/emoji dos logs
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PASS = os.environ.get("VPS_PASS", "")
if not PASS:
    print("Set VPS_PASS")
    sys.exit(1)

MODE = sys.argv[1] if len(sys.argv) > 1 else "snap"
TAIL_N = int(sys.argv[2]) if len(sys.argv) > 2 else 50


def connect():
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
    return c


def run(c, cmd, timeout=60):
    _i, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    return out, err


SNAP = r"""
echo '=== HOST / TIME ==='
hostname; date -Is
echo '=== PROXY ENV ==='
grep -E 'BACBO_PROXY|BACBO_BRIDGE' /var/www/autowin/.env 2>/dev/null || echo '(no .env keys)'
echo '=== DB PROXY (php) ==='
cd /var/www/autowin && php -r '
require "vendor/autoload.php";
if (file_exists("bootstrap.php")) require "bootstrap.php";
try {
  $p = \App\Services\EvolutionBacBo::resolveProxyUrl();
  $hint = $p !== "" ? preg_replace("/:[^:@\\/]+@/", ":***@", $p) : "(vazio)";
  echo "resolveProxyUrl=$hint\n";
} catch (Throwable $e) {
  echo "php-err: ".$e->getMessage()."\n";
}
' 2>&1 | tail -n 20
echo '=== TUNNEL/LISTEN 1080 ==='
ss -lntp 2>/dev/null | grep -E '1080|1081' || echo 'no-1080/1081'
echo '=== WORKER ==='
pgrep -af 'bot/worker.php' | head -5 || echo 'no-worker'
echo '=== BRIDGE CODE MARKERS ==='
grep -n 'probeExitIp\|followToEvo FIM\|place-bet exit-ip\|mirrorBridgeStderr' \
  /var/www/autowin/bot/bacbo-evo-bridge.cjs \
  /var/www/autowin/src/Services/EvolutionBacBo.php 2>/dev/null | head -20
echo '=== bacbo-bet.log (last 40) ==='
tail -n 40 /var/www/autowin/storage/logs/bacbo-bet.log 2>/dev/null || echo 'no bacbo-bet.log'
echo '=== attempts.log (last 12) ==='
tail -n 12 /var/www/autowin/storage/bacbo-evo/attempts.log 2>/dev/null || echo 'no attempts.log'
echo '=== app log bacbo recent ==='
grep -iE 'bacbo|akamai|evolution|placeBet|REAL' /var/www/autowin/storage/logs/app.log 2>/dev/null | tail -n 15 || true
"""

TAIL = r"""
echo '--- bacbo-bet ---'
tail -n {n} /var/www/autowin/storage/logs/bacbo-bet.log 2>/dev/null
echo '--- attempts (last {n} lines) ---'
tail -n {n} /var/www/autowin/storage/bacbo-evo/attempts.log 2>/dev/null
"""


def main():
    c = connect()
    try:
        if MODE == "snap":
            out, err = run(c, SNAP)
            print(out)
            if err.strip():
                print("STDERR:", err[:500])
        elif MODE == "watch":
            print("Watching bacbo-bet + attempts (Ctrl+C to stop)...", flush=True)
            last_bet = ""
            last_att = ""
            while True:
                out_b, _ = run(
                    c,
                    "wc -c /var/www/autowin/storage/logs/bacbo-bet.log 2>/dev/null; "
                    "tail -n 8 /var/www/autowin/storage/logs/bacbo-bet.log 2>/dev/null",
                )
                out_a, _ = run(
                    c,
                    "wc -c /var/www/autowin/storage/bacbo-evo/attempts.log 2>/dev/null; "
                    "tail -n 5 /var/www/autowin/storage/bacbo-evo/attempts.log 2>/dev/null",
                )
                if out_b != last_bet:
                    print("\n=== bacbo-bet @", time.strftime("%H:%M:%S"), "===")
                    print(out_b)
                    last_bet = out_b
                if out_a != last_att:
                    print("\n=== attempts @", time.strftime("%H:%M:%S"), "===")
                    print(out_a)
                    last_att = out_a
                time.sleep(8)
        else:
            out, err = run(c, TAIL.format(n=TAIL_N))
            print(out)
            if err.strip():
                print("STDERR:", err[:300])
    finally:
        c.close()


if __name__ == "__main__":
    main()
