/**
 * Diagnóstico: conecta no WS (SEM apostar) e captura:
 *  - saldo real atual (balanceUpdated)
 *  - estrutura completa de receivedBets/validBets num bacbo.playerState
 *    (pra confirmar se é só da nossa sessão ou agregado da mesa toda)
 *
 * Uso: node scripts/_check_balance_and_confirm_vps.cjs
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SESSION_FILE = path.join(ROOT, "storage", "bacbo-evo", "1.json");
const EVO_HOST = "a8-latam.evo-games.com";
const CLIENT_VERSION = "6.20260710.73542.63265-ab3d820afb-r2";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";

function parseProxy(url) {
  if (!url) return null;
  const m = String(url).match(/^(https?|socks5?):\/\/([^:]+):([^@]+)@(.+)$/);
  if (!m) return null;
  const [, scheme, user, pass, hostport] = m;
  return { scheme, user, pass, hostport };
}

async function main() {
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  const { evoSessionId, tableId, vtId, launchUrl } = session;
  console.log("evoSessionId age check - session file mtime:", fs.statSync(SESSION_FILE).mtime.toISOString());

  const proxyUrl = process.env.BACBO_PROXY_URL || "";
  const proxy = parseProxy(proxyUrl);

  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
  ];
  if (proxy) launchArgs.push(`--proxy-server=${proxy.scheme}://${proxy.hostport}`);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: launchArgs });
  try {
    const page = await browser.newPage();
    if (proxy) await page.authenticate({ username: proxy.user, password: proxy.pass });
    await page.setUserAgent(UA);
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    await page.goto(launchUrl, { waitUntil: "networkidle2", timeout: 45000 }).catch((e) => console.log("goto warn", e.message));

    const instance = "chk" + Math.random().toString(36).slice(2, 5) + "-" + evoSessionId.slice(0, 16) + "-" + vtId;
    const wsUrl =
      `wss://${EVO_HOST}/public/bacbo/player/game/${tableId}/socket` +
      `?messageFormat=json&tableConfig=${encodeURIComponent(vtId)}` +
      `&EVOSESSIONID=${encodeURIComponent(evoSessionId)}` +
      `&instance=${encodeURIComponent(instance)}` +
      `&client_version=${CLIENT_VERSION}`;

    const result = await page.evaluate(
      (wsUrl) =>
        new Promise((resolve) => {
          const balances = [];
          let playerStateSample = null;
          let stagesSeen = [];
          const timer = setTimeout(() => {
            try {
              ws.close();
            } catch {}
            resolve({ balances, playerStateSample, stagesSeen });
          }, 20000);
          const ws = new WebSocket(wsUrl);
          ws.onopen = () => {
            ws.send(JSON.stringify({ log: { type: "CLIENT_SOCKET_CONNECTION_ESTABLISHED", value: { reconnectionCount: 0, channel: "PCMac", orientation: "landscape", gameDimensions: { width: 1070, height: 601.875 }, gameId: "" } } }));
          };
          ws.onmessage = (ev) => {
            let data;
            try {
              data = JSON.parse(ev.data);
            } catch {
              return;
            }
            if (data.type === "balanceUpdated") {
              balances.push(data.args);
            }
            if (data.type === "bacbo.playerState") {
              const game = (data.args && data.args.game) || {};
              if (game.stage && !stagesSeen.includes(game.stage)) stagesSeen.push(game.stage);
              if (!playerStateSample || (game.receivedBets && game.receivedBets.validBets && game.receivedBets.validBets.length > 0)) {
                playerStateSample = {
                  stage: game.stage,
                  gameId: game.gameId,
                  receivedBets: game.receivedBets,
                  lastGameBets: game.lastGameBets,
                  keys: Object.keys(game),
                };
              }
            }
          };
          ws.onerror = () => {
            clearTimeout(timer);
            resolve({ balances, playerStateSample, stagesSeen, wsError: true });
          };
        }),
      wsUrl
    );

    console.log("RESULTADO:", JSON.stringify(result, null, 2));
  } finally {
    try {
      await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 8000))]);
    } catch {}
    try {
      browser.process() && browser.process().kill("SIGKILL");
    } catch {}
  }
}

main().catch((e) => {
  console.error("FAIL", e.stack || e.message);
  process.exit(1);
});
