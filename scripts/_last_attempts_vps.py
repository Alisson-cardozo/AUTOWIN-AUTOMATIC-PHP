"""Últimas tentativas Bac Bo com hops/trace legíveis."""
import json
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
_i, o, e = c.exec_command(
    "tail -n 40 /var/www/autowin/storage/bacbo-evo/attempts.log; echo '---BET---'; "
    "tail -n 30 /var/www/autowin/storage/logs/bacbo-bet.log",
    timeout=30,
)
raw = o.read().decode("utf-8", "replace")
parts = raw.split("---BET---")
att = parts[0] if parts else ""
bet = parts[1] if len(parts) > 1 else ""

print("=== attempts (pretty) ===")
for line in att.strip().splitlines():
    line = line.strip()
    if not line:
        continue
    try:
        j = json.loads(line)
    except Exception:
        print(line[:200])
        continue
    action = j.get("action") or "?"
    msg = j.get("message") or ""
    if action == "trace":
        extra = {k: v for k, v in j.items() if k not in ("at", "action", "message", "proxyConfigured", "proxyHint")}
        print(f"{j.get('at')} TRACE {msg} | {json.dumps(extra, ensure_ascii=False)[:280]}")
    else:
        hops = j.get("hops")
        hop_s = ""
        if isinstance(hops, list):
            hop_s = " hops=" + " · ".join(
                f"{h.get('step','?')}={h.get('status', h.get('error','?'))}" for h in hops if isinstance(h, dict)
            )
        print(
            f"{j.get('at')} {action} ok={j.get('ok')} code={j.get('code')} "
            f"slug={j.get('preferredSlug')} exitIp={j.get('exitIp')} "
            f"proxy={j.get('proxyHint')} ms={j.get('ms')} "
            f"err={(j.get('error') or '')[:100]}{hop_s}"
        )

print("\n=== bacbo-bet.log ===")
print(bet[-4000:] if len(bet) > 4000 else bet)
c.close()
