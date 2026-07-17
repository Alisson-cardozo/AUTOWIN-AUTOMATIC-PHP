#!/usr/bin/env python3
"""One-shot deploy of Bac Bo proxy fix to VPS. Password via VPS_PASS env only."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

HOST = "187.77.33.118"
USER = "root"
PASS = os.environ.get("VPS_PASS", "")
REMOTE_ROOT = "/var/www/autowin"
LOCAL_ROOT = Path(__file__).resolve().parents[1]

FILES = [
    "bot/bacbo-evo-bridge.cjs",
    "bot/server.cjs",
    "src/Services/EvolutionBacBo.php",
    "src/Bot/Games/BacBoEngine.php",
]


def ensure_remote_dir(sftp: paramiko.SFTPClient, remote_dir: str) -> None:
    parts = [p for p in remote_dir.split("/") if p]
    cur = ""
    for p in parts:
        cur = cur + "/" + p
        try:
            sftp.stat(cur)
        except OSError:
            try:
                sftp.mkdir(cur)
            except OSError:
                pass


def main() -> int:
    if not PASS:
        print("Set VPS_PASS env var")
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting {USER}@{HOST} ...")
    client.connect(
        HOST,
        username=USER,
        password=PASS,
        timeout=30,
        allow_agent=False,
        look_for_keys=False,
    )
    sftp = client.open_sftp()

    for rel in FILES:
        local = LOCAL_ROOT.joinpath(*rel.split("/"))
        remote = REMOTE_ROOT + "/" + rel
        if not local.is_file():
            print("MISSING local:", rel)
            continue
        parent = remote.rsplit("/", 1)[0]
        ensure_remote_dir(sftp, parent)
        sftp.put(str(local), remote)
        print("OK ", rel, local.stat().st_size, "bytes ->", remote)

    def run(cmd: str) -> str:
        print("\n$", cmd)
        _i, stdout, stderr = client.exec_command(cmd, timeout=90)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        if out:
            print(out.rstrip())
        if err:
            print("STDERR:", err.rstrip())
        return out

    run(
        "ls -la "
        + REMOTE_ROOT
        + "/bot/bacbo-evo-bridge.cjs "
        + REMOTE_ROOT
        + "/bot/server.cjs "
        + REMOTE_ROOT
        + "/src/Services/EvolutionBacBo.php "
        + REMOTE_ROOT
        + "/src/Bot/Games/BacBoEngine.php"
    )
    run(
        "grep -nE 'setProxyUrl|AKAMAI_BLOCKED|resolveProxyUrl|probeSkipped' "
        + REMOTE_ROOT
        + "/bot/bacbo-evo-bridge.cjs "
        + REMOTE_ROOT
        + "/src/Services/EvolutionBacBo.php "
        + REMOTE_ROOT
        + "/src/Bot/Games/BacBoEngine.php | head -50"
    )
    run("ps aux | grep -E 'node|worker.php|server.cjs|bacbo' | grep -v grep || true")
    run(
        "test -f "
        + REMOTE_ROOT
        + "/bot/bridge.config.json && cat "
        + REMOTE_ROOT
        + "/bot/bridge.config.json || echo no-bridge-config"
    )
    run("grep -E '^BACBO_' " + REMOTE_ROOT + "/.env 2>/dev/null || echo no-env-bacbo")
    run(
        "pgrep -af 'node.*server.cjs|node.*bacbo' || true; "
        "if pgrep -f 'node .*server.cjs' >/dev/null 2>&1; then "
        "  echo RESTARTING server.cjs; "
        "  pkill -f 'node .*server.cjs' || true; "
        "  sleep 1; "
        "  cd "
        + REMOTE_ROOT
        + " && nohup node bot/server.cjs >> storage/logs/bridge-server.log 2>&1 & "
        "  sleep 1; "
        "  pgrep -af 'node .*server.cjs' || echo failed-to-restart; "
        "else "
        "  echo 'no persistent server.cjs (PHP may use proc_open per call)'; "
        "fi"
    )
    run(
        "(systemctl reload php8.3-fpm 2>/dev/null || "
        "systemctl reload php8.2-fpm 2>/dev/null || "
        "systemctl reload php-fpm 2>/dev/null || "
        "echo php-fpm-reload-skipped)"
    )

    sftp.close()
    client.close()
    print("\nDONE deploy")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
