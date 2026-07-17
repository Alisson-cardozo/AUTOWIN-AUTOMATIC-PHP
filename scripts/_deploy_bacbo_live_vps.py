# -*- coding: utf-8 -*-
"""Deploy Bac Bo Ao Vivo files + migrate tables + restart worker."""
import os
import sys
from pathlib import Path

import paramiko

PASS = os.environ.get("VPS_PASS", "")
REMOTE = "/var/www/autowin"
LOCAL = Path(__file__).resolve().parents[1]

FILES = [
    "src/Bot/Games/BacBoEngine.php",
    "src/Bot/Games/BacBoSource.php",
    "src/Bot/EngineManager.php",
    "src/Bot/Blaze/BlazeAPI.php",
    "src/Bot/PatternAccuracy.php",
    "src/Models/UserRepository.php",
    "src/Controllers/Api/UserController.php",
    "src/Controllers/Api/GameController.php",
    "src/Controllers/Api/AuthController.php",
    "routes/web.php",
    "database/schema.sql",
    "database/migrate_bacbo_live.sql",
    "public/imagem-jogos/blaze/bacbo_live.png",
    "public/assets/portal/conta.js",
    "public/assets/portal/conta.js.map",
    "api-dos-jogos.js",
]


def main() -> int:
    if not PASS:
        print("Set VPS_PASS")
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print("Connecting...")
    client.connect(
        "187.77.33.118",
        username="root",
        password=PASS,
        timeout=30,
        allow_agent=False,
        look_for_keys=False,
    )
    sftp = client.open_sftp()

    def ensure_dir(remote_dir: str) -> None:
        parts = [p for p in remote_dir.split("/") if p]
        cur = ""
        for p in parts:
            cur += "/" + p
            try:
                sftp.stat(cur)
            except OSError:
                try:
                    sftp.mkdir(cur)
                except OSError:
                    pass

    for rel in FILES:
        local = LOCAL.joinpath(*rel.split("/"))
        remote = REMOTE + "/" + rel
        if not local.is_file():
            print("SKIP missing", rel)
            continue
        ensure_dir(remote.rsplit("/", 1)[0])
        sftp.put(str(local), remote)
        print("OK", rel, local.stat().st_size)

    def run(cmd: str) -> str:
        print("\n$", cmd[:140])
        _i, o, e = client.exec_command(cmd, timeout=120)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        if out.strip():
            print(out.rstrip())
        if err.strip():
            print("ERR:", err.rstrip())
        return out

    # migrate via PHP (uses app .env)
    run(
        "cd /var/www/autowin && php -r '"
        "require \"vendor/autoload.php\"; "
        "App\\Bootstrap::init(); "
        "$sql = file_get_contents(\"database/migrate_bacbo_live.sql\"); "
        "if ($sql === false) { echo \"NO_SQL\\n\"; exit(1);} "
        "$pdo = App\\Database::pdo(); "
        "foreach (array_filter(array_map(\"trim\", explode(\";\", $sql))) as $stmt) { "
        "  if ($stmt === \"\" || str_starts_with($stmt, \"--\")) continue; "
        "  try { $pdo->exec($stmt); echo \"OK stmt\\n\"; } "
        "  catch (Throwable $e) { echo \"ERR \".$e->getMessage().\"\\n\"; } "
        "} "
        "$r = $pdo->query(\"SHOW TABLES LIKE \\\"bacbo_live_results\\\"\")->fetch(); "
        "echo $r ? \"TABLE_OK\\n\" : \"TABLE_MISSING\\n\";"
        "'"
    )

    run(
        "grep -n BACBO_LIVE /var/www/autowin/src/Bot/EngineManager.php | head -3; "
        "grep -c BACBO_LIVE /var/www/autowin/public/assets/portal/conta.js; "
        "ls -la /var/www/autowin/public/imagem-jogos/blaze/bacbo_live.png"
    )

    # restart worker
    run(
        "PIDS=$(ps -eo pid=,args= | awk '/php \\/var\\/www\\/autowin\\/bot\\/worker\\.php/ && !/awk/ {print $1}'); "
        "echo old=$PIDS; "
        "if [ -n \"$PIDS\" ]; then kill $PIDS; sleep 1; fi; "
        "cd /var/www/autowin && nohup /usr/bin/php /var/www/autowin/bot/worker.php "
        ">> /var/www/autowin/storage/logs/worker-out.log "
        "2>> /var/www/autowin/storage/logs/worker-err.log < /dev/null & "
        "sleep 2; "
        "ps -eo pid=,args= | awk '/php \\/var\\/www\\/autowin\\/bot\\/worker\\.php/ && !/awk/ {print}'"
    )

    run("systemctl reload php8.3-fpm 2>/dev/null || true")

    sftp.close()
    client.close()
    print("\nDONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
