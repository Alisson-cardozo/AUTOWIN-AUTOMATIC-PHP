import os, sys, paramiko, time

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PASS = os.environ.get("VPS_PASS", "")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)

def run(cmd, timeout=30):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    if out.strip(): print(out)
    if err.strip(): print("ERR:", err[:400])
    return out

print("=== Matando feed antigo ===")
run("kill -9 404716 2>/dev/null; pkill -9 -f megaroulette-ws-feed 2>/dev/null; sleep 2; echo ok")

print("=== Removendo locks ===")
run("rm -f /var/www/autowin/storage/megaroulette-ws/feed.pid /var/www/autowin/storage/megaroulette-ws/spawn.lock && echo ok")

print("=== .env (vars MEGAROULETTE) ===")
run("grep MEGAROULETTE /var/www/autowin/.env")

print("=== Iniciando feed com novo .env ===")
run("cd /var/www/autowin && AUTOWIN_ROOT=/var/www/autowin node bot/megaroulette-ws-feed.cjs >> storage/logs/megaroulette-ws-feed.log 2>&1 & echo started")

print("aguardando 5s...")
time.sleep(5)

print("=== Status ===")
run("cat /var/www/autowin/storage/megaroulette-ws/status.json 2>/dev/null || echo sem-status")

print("=== Log (ultimas 20 linhas) ===")
run("tail -20 /var/www/autowin/storage/logs/megaroulette-ws-feed.log 2>/dev/null || echo sem-log")

print("=== Processo ===")
run("ps -eo pid,args | grep megaroulette-ws-feed | grep -v grep || echo nenhum")

c.close()
print("\nPronto!")
