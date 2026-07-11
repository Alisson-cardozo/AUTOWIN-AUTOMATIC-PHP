/**
 * Testa ensure-session via HTTP+redirect (sem Chrome).
 * Uso:
 *   node scripts/test-evo-http-session.cjs <BLAZE_TOKEN> [userId]
 *   node scripts/test-evo-http-session.cjs --from-session 2
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const bridge = path.join(ROOT, "bot", "bacbo-evo-bridge.cjs");

function runBridge(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [bridge], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", () => {
      try {
        resolve({ json: JSON.parse(out.trim() || "{}"), raw: out, err });
      } catch (e) {
        resolve({ json: null, raw: out, err, parseError: e.message });
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

(async () => {
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];

  if (arg1 === "--from-session") {
    const uid = arg2 || "2";
    const p = path.join(ROOT, "storage", "bacbo-evo", `${uid}.json`);
    if (!fs.existsSync(p)) {
      console.error("sem sessão", p);
      process.exit(1);
    }
    const s = JSON.parse(fs.readFileSync(p, "utf8"));
    console.log("clear + re-ensure com launchUrl salvo...");
    await runBridge({ action: "clear-session", userId: Number(uid) });
    // sem token: só com launchUrl
    const r = await runBridge({
      action: "ensure-session",
      userId: Number(uid),
      blazeToken: "test-with-launch-only",
      launchUrl: s.launchUrl,
    });
    console.log(JSON.stringify(r.json, null, 2));
    if (r.err) console.error("stderr", r.err.slice(0, 300));
    process.exit(r.json && r.json.ok ? 0 : 1);
  }

  const token = arg1 || process.env.BLAZE_TOKEN;
  const userId = Number(arg2 || 2);
  if (!token) {
    console.error("Uso: node scripts/test-evo-http-session.cjs <BLAZE_TOKEN> [userId]");
    console.error("  ou: node scripts/test-evo-http-session.cjs --from-session [userId]");
    process.exit(1);
  }

  console.log("1) clear-session user", userId);
  console.log(await runBridge({ action: "clear-session", userId }));

  console.log("2) ensure-session (HTTP multi-user, sem Chrome)...");
  const r = await runBridge({
    action: "ensure-session",
    userId,
    blazeToken: token,
  });
  console.log(JSON.stringify(r.json, null, 2));
  if (r.err) console.error("stderr", r.err.slice(0, 400));

  const sessPath = path.join(ROOT, "storage", "bacbo-evo", `${userId}.json`);
  if (fs.existsSync(sessPath)) {
    const s = JSON.parse(fs.readFileSync(sessPath, "utf8"));
    console.log("session source=", s.source, "evoLen=", (s.evoSessionId || "").length, "table=", s.tableId);
  }

  process.exit(r.json && r.json.ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
