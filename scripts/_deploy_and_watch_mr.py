import os, sys, paramiko, time
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
PASS = os.environ["VPS_PASS"]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)

def run(cmd, timeout=60):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    if out.strip(): print(out)
    if err.strip(): print("ERR:", err[:600])
    return out

# Sobe arquivo
s = c.open_sftp()
s.put("bot/megaroulette-ws-feed.cjs", "/var/www/autowin/bot/megaroulette-ws-feed.cjs")
s.close()
print("Arquivo enviado.")

# Verifica se o novo código está no arquivo remoto
print("=== Verifica codigo novo no remoto ===")
run("grep -c 'Chrome aberto com sucesso' /var/www/autowin/bot/megaroulette-ws-feed.cjs || echo 0-ocorrencias")
run("grep -c 'page.createCDPSession' /var/www/autowin/bot/megaroulette-ws-feed.cjs || echo 0-ocorrencias")

# Mata processo antigo
run("pkill -9 -f megaroulette-ws-feed 2>/dev/null; sleep 1; echo ok")
run("rm -f /var/www/autowin/storage/megaroulette-ws/feed.pid /var/www/autowin/storage/megaroulette-ws/spawn.lock")

# Limpa log antigo para ver só saída nova
run("echo '' > /var/www/autowin/storage/logs/megaroulette-ws-feed.log 2>/dev/null; echo ok")

# Inicia
run("cd /var/www/autowin && AUTOWIN_ROOT=/var/www/autowin node bot/megaroulette-ws-feed.cjs >> storage/logs/megaroulette-ws-feed.log 2>&1 & echo started")

print("Aguardando 20s para Chrome abrir e navegar...")
time.sleep(20)

print("=== Log completo ===")
run("cat /var/www/autowin/storage/logs/megaroulette-ws-feed.log 2>/dev/null || echo sem-log")

print("=== Status ===")
run("cat /var/www/autowin/storage/megaroulette-ws/status.json 2>/dev/null || echo sem-status")

print("=== Processo ===")
run("ps -eo pid,args | grep megaroulette-ws-feed | grep -v grep || echo nenhum")

c.close()
print("Pronto!")
