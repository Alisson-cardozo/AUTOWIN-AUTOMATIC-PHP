/**
 * gc-hash-renovar.cjs
 * Roda no PC de casa (IP residencial) — captura o hash do GamblingCounting
 * e atualiza automaticamente o .env da VPS via SSH.
 *
 * Como usar:
 *   node bot/gc-hash-renovar.cjs
 *
 * Requisitos:
 *   - Google Chrome instalado no PC
 *   - npm install (puppeteer-core e ssh2 já estão em package.json)
 *   - VPS acessível em 187.77.33.118
 */

"use strict";

const fs   = require("fs");
const path = require("path");

// ── Configuração ─────────────────────────────────────────────
const VPS_HOST    = "187.77.33.118";
const VPS_USER    = "root";
const VPS_PASS    = process.env.VPS_PASS || "Alissonp32@@";
const VPS_ENV     = "/var/www/autowin/.env";
const VPS_PID_CMD = "pkill -9 -f 'megaroulette-ws-feed.cjs' 2>/dev/null; sleep 1; " +
                    "rm -f /var/www/autowin/storage/megaroulette-ws/feed.pid " +
                    "/var/www/autowin/storage/megaroulette-ws/spawn.lock && echo ok";
const VPS_START   = "cd /var/www/autowin && AUTOWIN_ROOT=/var/www/autowin " +
                    "node bot/megaroulette-ws-feed.cjs >> " +
                    "storage/logs/megaroulette-ws-feed.log 2>&1 & echo started";

const GC_PAGE = "https://gamblingcounting.com/pt-BR/pragmatic-auto-mega-roulette";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

// ── Detecta Chrome no Windows ─────────────────────────────────
function findChrome() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    (process.env.LOCALAPPDATA || "") + "\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch { }
  }
  return null;
}

// ── Captura o hash via Puppeteer (IP residencial do PC) ────────
async function captureWsUrl() {
  let puppeteer;
  try { puppeteer = require("puppeteer-core"); }
  catch { throw new Error("puppeteer-core não instalado. Rode: npm install"); }

  const chromePath = process.env.CHROME_PATH || findChrome();
  if (!chromePath) throw new Error("Chrome não encontrado. Instale o Google Chrome.");

  console.log("[gc-hash] Abrindo Chrome em", chromePath);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false, // abre visível para passar Cloudflare normalmente
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
    defaultViewport: null,
  });

  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8" });

  let capturedUrl = null;

  // Escuta WebSockets de alto nível
  page.on("websocket", (ws) => {
    const url = ws.url();
    if (url && url.startsWith("wss://") && url.includes("hash=")) {
      capturedUrl = url;
      console.log("[gc-hash] ✅ WS capturado:", url.replace(/hash=[^&]+/, "hash=***"));
    }
  });

  // Também via CDP (Puppeteer v25)
  try {
    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    cdp.on("Network.webSocketCreated", ({ url }) => {
      if (url && url.startsWith("wss://") && url.includes("hash=") && !capturedUrl) {
        capturedUrl = url;
        console.log("[gc-hash] ✅ CDP WS capturado:", url.replace(/hash=[^&]+/, "hash=***"));
      }
    });
  } catch { }

  // Intercepta /handshake
  try {
    await page.setRequestInterception(true);
    page.on("request", (req) => { try { req.continue(); } catch { } });
    page.on("response", async (res) => {
      try {
        if (res.url().includes("/handshake")) {
          const text = await res.text().catch(() => "");
          const json = JSON.parse(text);
          const wsUrl = json.url || json.wsUrl || json.ws || json.socket || json.wsURL || null;
          if (wsUrl && wsUrl.startsWith("wss://") && !capturedUrl) {
            capturedUrl = wsUrl;
            console.log("[gc-hash] ✅ Hash via /handshake");
          } else if (json.hash && !capturedUrl) {
            capturedUrl = `wss://squid-app-67gkf.ondigitalocean.app/ws?hash=${json.hash}`;
            console.log("[gc-hash] ✅ Hash extraído de /handshake.hash");
          }
        }
      } catch { }
    });
  } catch { }

  console.log("[gc-hash] Navegando para", GC_PAGE);
  console.log("[gc-hash] Se aparecer desafio Cloudflare, resolva e aguarde...");

  try {
    await page.goto(GC_PAGE, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (e) {
    console.log("[gc-hash] goto aviso:", e.message.slice(0, 80));
  }

  // Aguarda até 40s pelo WS
  for (let i = 0; i < 80; i++) {
    if (capturedUrl) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  await browser.close();

  if (!capturedUrl) throw new Error("Não conseguiu capturar URL do WS. Tente abrir gamblingcounting.com manualmente primeiro para garantir o cookie Cloudflare.");
  return capturedUrl;
}

// ── Envia URL para a VPS via SSH ───────────────────────────────
async function deployToVps(wsUrl) {
  let Client;
  try { Client = require("ssh2").Client; }
  catch {
    throw new Error("ssh2 não instalado. Rode: npm install ssh2");
  }

  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on("ready", () => {
      console.log("[gc-hash] Conectado na VPS");

      // Atualiza .env remoto via sed
      const escaped = wsUrl.replace(/&/g, "\\&").replace(/[[\]{}()*+?.,\\^$|#]/g, "\\$&");
      const cmds = [
        `sed -i '/^MEGAROULETTE_GC_WS_URL=/d' ${VPS_ENV}`,
        `echo 'MEGAROULETTE_GC_WS_URL=${wsUrl}' >> ${VPS_ENV}`,
        VPS_PID_CMD,
        VPS_START,
        `sleep 3 && tail -8 /var/www/autowin/storage/logs/megaroulette-ws-feed.log 2>/dev/null || echo sem-log`,
      ];

      let i = 0;
      const runNext = () => {
        if (i >= cmds.length) { conn.end(); resolve(); return; }
        const cmd = cmds[i++];
        conn.exec(cmd, (err, stream) => {
          if (err) { conn.end(); reject(err); return; }
          stream.on("data", (d) => process.stdout.write(d.toString()));
          stream.stderr.on("data", (d) => process.stderr.write(d.toString()));
          stream.on("close", runNext);
        });
      };
      runNext();
    });

    conn.on("error", reject);
    conn.connect({
      host: VPS_HOST, port: 22, username: VPS_USER,
      password: VPS_PASS,
      readyTimeout: 20000,
      algorithms: { serverHostKey: ["ssh-rsa", "ecdsa-sha2-nistp256", "ssh-ed25519"] },
    });
  });
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  console.log("==============================================");
  console.log("  GC Hash Renovar — Auto Mega Roulette");
  console.log("  Captura hash do GamblingCounting (PC local)");
  console.log("  e envia para a VPS automaticamente.");
  console.log("==============================================\n");

  let wsUrl;
  try {
    wsUrl = await captureWsUrl();
    console.log("\n[gc-hash] URL capturada:", wsUrl.replace(/hash=[^&]+/, "hash=***"));
  } catch (e) {
    console.error("[gc-hash] ❌ Erro ao capturar:", e.message);
    process.exit(1);
  }

  console.log("\n[gc-hash] Enviando para a VPS...");
  try {
    await deployToVps(wsUrl);
    console.log("\n[gc-hash] ✅ Concluído! Feed reiniciado na VPS com novo hash.");
    console.log("[gc-hash] Rode este script novamente quando o feed parar (hash expirou).");
  } catch (e) {
    console.error("[gc-hash] ❌ Erro ao enviar para VPS:", e.message);
    console.log("\n[gc-hash] URL capturada (adicione manualmente ao .env da VPS):");
    console.log("  MEGAROULETTE_GC_WS_URL=" + wsUrl);
    process.exit(1);
  }
}

main();
