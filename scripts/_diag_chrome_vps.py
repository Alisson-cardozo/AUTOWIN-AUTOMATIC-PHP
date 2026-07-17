import os, sys, paramiko
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
PASS = os.environ["VPS_PASS"]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("187.77.33.118", username="root", password=PASS, timeout=30, allow_agent=False, look_for_keys=False)

def run(cmd, timeout=20):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    if out.strip(): print(out)
    if err.strip(): print("ERR:", err[:600])

print("=== Chrome version ===")
run("google-chrome --version 2>&1 || echo nao-encontrado")

print("=== Teste Chrome headless simples ===")
run("timeout 10 google-chrome --no-sandbox --headless=new --disable-gpu --dump-dom about:blank 2>&1 | head -10 || echo falhou")

print("=== Dependencias faltando ===")
run("ldd $(which google-chrome) 2>&1 | grep 'not found' | head -10 || echo nenhuma-faltando")

print("=== Memoria disponivel ===")
run("free -m | head -2")

print("=== Node version ===")
run("node --version")

print("=== Puppeteer-core exists ===")
run("ls /var/www/autowin/node_modules/puppeteer-core/package.json 2>/dev/null && cat /var/www/autowin/node_modules/puppeteer-core/package.json | grep '\"version\"' | head -1 || echo nao-instalado")

print("=== Teste Puppeteer launch ===")
run("cd /var/www/autowin && timeout 15 node -e \"const p=require('puppeteer-core');p.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--disable-dev-shm-usage']}).then(b=>{console.log('OK launched');return b.close();}).then(()=>console.log('OK closed')).catch(e=>console.error('ERRO:',e.message));\" 2>&1 || echo timeout")

c.close()
