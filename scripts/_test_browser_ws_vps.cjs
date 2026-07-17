/**
 * Fase 1 (validação, não aposta de verdade): confere se abrir o WebSocket da
 * Evolution DE DENTRO de um Chrome headless real (depois de navegar o /entry
 * até o fim, deixando o JS de sensor da Akamai rodar) passa pelo bloqueio 403
 * que o cliente ws puro em Node sempre leva.
 *
 * Roda na VPS via SSH. Reaproveita a sessão (evoSessionId/tableId/vtId) que o
 * worker.php já deixou em storage/bacbo-evo/1.json — não manda aposta, só
 * abre o WS e escuta.
 *
 * Uso: node scripts/_test_browser_ws_vps.cjs
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
  if (!fs.existsSync(SESSION_FILE)) {
    console.error("FAIL: sessão não encontrada em", SESSION_FILE);
    process.exit(1);
  }
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  const { evoSessionId, tableId, vtId, launchUrl } = session;
  if (!evoSessionId || !launchUrl) {
    console.error("FAIL: sessão incompleta", { hasEvo: !!evoSessionId, hasLaunch: !!launchUrl });
    process.exit(1);
  }
  console.log("session tableId=%s vtId=%s evoLen=%d", tableId, vtId, evoSessionId.length);
  console.log("launchUrl", launchUrl.slice(0, 100));

  const proxyUrl = process.env.BACBO_PROXY_URL || "";
  const proxy = parseProxy(proxyUrl);
  console.log("proxy", proxy ? proxy.hostport : "(nenhum)");

  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
  ];
  if (proxy) launchArgs.push(`--proxy-server=${proxy.scheme === "http" ? "http" : proxy.scheme}://${proxy.hostport}`);

  console.log("subindo Chrome...");
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: launchArgs,
  });

  let result = { ok: false };
  try {
    const page = await browser.newPage();
    if (proxy) await page.authenticate({ username: proxy.user, password: proxy.pass });
    await page.setUserAgent(UA);
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    console.log("navegando entry ate o fim (networkidle2)...");
    const t0 = Date.now();
    await page
      .goto(launchUrl, { waitUntil: "networkidle2", timeout: 45000 })
      .catch((e) => console.log("goto warn:", e.message));
    console.log("navegacao terminou em %dms, url final:", Date.now() - t0, page.url().slice(0, 140));

    const cookies = await page.cookies();
    const akamaiCookies = cookies.filter((c) => /^(bm_|_abck|ak_bmsc)/.test(c.name)).map((c) => c.name);
    console.log("cookies akamai presentes:", akamaiCookies.join(", ") || "(nenhum)");

    const instance =
      "brw" + Math.random().toString(36).slice(2, 5) + "-" + evoSessionId.slice(0, 16) + "-" + (vtId || "");
    const wsUrl =
      `wss://${EVO_HOST}/public/bacbo/player/game/${tableId}/socket` +
      `?messageFormat=json&tableConfig=${encodeURIComponent(vtId)}` +
      `&EVOSESSIONID=${encodeURIComponent(evoSessionId)}` +
      `&instance=${encodeURIComponent(instance)}` +
      `&client_version=${CLIENT_VERSION}`;

    console.log("abrindo WS de dentro da pagina...");
    result = await page.evaluate(
      (wsUrl) =>
        new Promise((resolve) => {
          const events = [];
          const timer = setTimeout(() => {
            resolve({ ok: false, error: "timeout esperando mensagens do WS", events });
          }, 15000);
          let ws;
          try {
            ws = new WebSocket(wsUrl);
          } catch (e) {
            clearTimeout(timer);
            resolve({ ok: false, error: "erro ao construir WebSocket: " + e.message, events });
            return;
          }
          ws.onopen = () => {
            events.push("open");
            try {
              ws.send(
                JSON.stringify({
                  log: {
                    type: "CLIENT_SOCKET_CONNECTION_ESTABLISHED",
                    value: {
                      reconnectionCount: 0,
                      channel: "PCMac",
                      orientation: "landscape",
                      gameDimensions: { width: 1070, height: 601.875 },
                      gameId: "",
                    },
                  },
                })
              );
            } catch (e) {
              events.push("send-establish-error:" + e.message);
            }
          };
          let firstMsgs = 0;
          ws.onmessage = (ev) => {
            firstMsgs++;
            if (firstMsgs <= 3) {
              events.push("message:" + String(ev.data).slice(0, 200));
            }
            if (firstMsgs === 1) {
              clearTimeout(timer);
              setTimeout(() => {
                try {
                  ws.close();
                } catch {
                  /* */
                }
                resolve({ ok: true, events });
              }, 800);
            }
          };
          ws.onerror = (ev) => {
            events.push("error");
            clearTimeout(timer);
            resolve({ ok: false, error: "WS error (provavel 403/Akamai)", events });
          };
          ws.onclose = (ev) => {
            events.push("close code=" + ev.code + " reason=" + ev.reason);
            clearTimeout(timer);
            resolve({ ok: false, error: "WS fechou sem mensagem, code=" + ev.code, events });
          };
        }),
      wsUrl
    );
  } finally {
    try {
      await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 8000))]);
    } catch {
      /* */
    }
    try {
      browser.process() && browser.process().kill("SIGKILL");
    } catch {
      /* */
    }
  }

  console.log("RESULTADO:", JSON.stringify(result));
  process.exit(result.ok ? 0 : 2);
}

main().catch((e) => {
  console.error("FAIL", e.stack || e.message);
  process.exit(1);
});
