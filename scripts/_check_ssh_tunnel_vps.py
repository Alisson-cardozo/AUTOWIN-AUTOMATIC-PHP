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
cmds = [
    "ss -lntp | grep -E '1080|1081|sshd' | head -20",
    "grep -E 'AllowTcpForwarding|GatewayPorts|PermitRootLogin|PasswordAuthentication' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/* 2>/dev/null | grep -v '^#'",
    "whoami; hostname",
]
for cmd in cmds:
    print("$", cmd)
    _i, o, e = c.exec_command(cmd, timeout=20)
    print(o.read().decode("utf-8", "replace"))
    err = e.read().decode("utf-8", "replace")
    if err.strip():
        print("ERR", err)
c.close()
