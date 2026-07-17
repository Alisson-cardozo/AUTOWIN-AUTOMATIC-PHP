import os, sys, paramiko, time
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PASS = os.environ.get("VPS_PASS", "Alissonp32@@")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)

# 1) Envia o arquivo do bot
s = c.open_sftp()
s.put("bot/megaroulette-ws-feed.cjs", "/var/www/autowin/bot/megaroulette-ws-feed.cjs")

# 2) Atualiza o .env remoto via leitura/escrita de arquivo SFTP (livre de escapes de shell)
env_path = "/var/www/autowin/.env"
env_data = ""
try:
    with s.open(env_path, "r") as f:
        env_data = f.read().decode("utf-8", "replace")
except Exception:
    pass

lines = env_data.splitlines()
new_lines = []
for line in lines:
    if line.startswith("MEGAROULETTE_PRAGMATIC_WS_URL="):
        continue
    new_lines.append(line)

PRAGMATIC_URL = "wss://gs21.pragmaticplaylive.net/game?JSESSIONID=T1m96bawtmkXL1dxFnn7drYsglG7odko3XYmBOCrBcvpC50q3sVe%21514001511-8f79d51f&tableId=mrbras531mrbr532&type=json&version=3&pageRefresh=true"
new_lines.append(f"MEGAROULETTE_PRAGMATIC_WS_URL={PRAGMATIC_URL}")

with s.open(env_path, "w") as f:
    f.write(("\n".join(new_lines) + "\n").encode("utf-8"))


s.close()
print("✅ Arquivo enviado e .env atualizado com sucesso via SFTP (sem perigo de perder caracteres especiais).")

def run(cmd, timeout=30, wait=True):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    if not wait:
        return ""
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    if out.strip(): print(out)
    if err.strip(): print("ERR:", err[:400])
    return out


# 3) Encerra feed antigo e inicia o novo
print("=== Reiniciando o feed... ===")
run("pkill -9 -f megaroulette-ws-feed 2>/dev/null; sleep 1; echo killed")
run("rm -f /var/www/autowin/storage/megaroulette-ws/feed.pid /var/www/autowin/storage/megaroulette-ws/spawn.lock")
run("echo '' > /var/www/autowin/storage/logs/megaroulette-ws-feed.log")

# Inicia com as variáveis exportadas explicitamente na linha de execução usando nohup sem travar a conexão SSH (wait=False)
run(f'cd /var/www/autowin && nohup node bot/megaroulette-ws-feed.cjs > storage/logs/megaroulette-ws-feed.log 2>&1 </dev/null &', wait=False)




print("Aguardando 5 segundos...")
time.sleep(5)

print("=== Log (últimas 20 linhas) ===")
run("tail -20 /var/www/autowin/storage/logs/megaroulette-ws-feed.log")

print("=== Status ===")
run("cat /var/www/autowin/storage/megaroulette-ws/status.json 2>/dev/null || echo sem-status")

c.close()
print("Finalizado!")
