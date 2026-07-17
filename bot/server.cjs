/**
 * Servidor HTTP persistente dos bridges Node (Bac Bo Evolution + Telegram)
 * e do feed WS de resultados — para hospedagens onde exec()/proc_open()
 * do PHP estão desabilitados (ex.: hospedagem compartilhada Hostinger).
 *
 * Em vez do PHP dar spawn num processo Node por requisição, este servidor
 * roda contínuo (deploy via "Aplicação Node.js" do hPanel) e o PHP fala
 * com ele via HTTP (curl). Configure no .env do PHP:
 *   BACBO_BRIDGE_URL=http://127.0.0.1:8791
 *   BACBO_BRIDGE_SECRET=<mesmo valor de BRIDGE_SECRET aqui embaixo>
 *
 * Uso: BRIDGE_PORT=8791 BRIDGE_SECRET=xxxx node bot/server.cjs
 */
const fs = require("fs");
const path = require("path");
const http = require("http");

// Fallback pra quando não dá pra configurar env vars pelo painel de hospedagem
// (ex.: deploy por API) — bridge.config.json fica junto deste arquivo, fora do git.
// Precisa ser lido ANTES de requerer bacbo-evo-bridge.cjs, que lê
// process.env.BACBO_PROXY_URL uma única vez no carregamento do módulo.
let fileConfig = {};
try {
  fileConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "bridge.config.json"), "utf8"));
} catch {
  /* arquivo opcional */
}
if (fileConfig.proxyUrl && !process.env.BACBO_PROXY_URL) {
  process.env.BACBO_PROXY_URL = fileConfig.proxyUrl;
}

const bacbo = require("./bacbo-evo-bridge.cjs");
const telegram = require("./telegram-bridge.cjs");

// Mantém o feed de resultados Bac Bo rodando no mesmo processo (grava em
// storage/bacbo-ws/history.json — lido pelo PHP normalmente, sem mudanças).
require("./bacbo-ws-feed.cjs")
  .main()
  .catch((e) => {
    console.error("[server] feed WS encerrou:", e && e.message ? e.message : e);
  });

// process.env.PORT: muitos hosts Node.js (incl. Hostinger) injetam a porta real
// nessa variável e esperam que a app escute nela — tem prioridade.
const PORT = Number(process.env.PORT || process.env.BRIDGE_PORT || fileConfig.port || 8791);
const SECRET = process.env.BRIDGE_SECRET || fileConfig.secret || "";

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

/** Aplica proxy do payload (PHP/Admin) em cada request — sem reiniciar o Node. */
function applyProxyFromInput(input) {
  if (input && input.proxyUrl !== undefined && input.proxyUrl !== null && typeof bacbo.setProxyUrl === "function") {
    bacbo.setProxyUrl(String(input.proxyUrl));
  }
}

const routes = {
  "/bacbo/ensure-session": (input) => {
    applyProxyFromInput(input);
    return bacbo.ensureSession(Number(input.userId || 0), input.blazeToken, input.launchUrl || null, {
      force: !!input.force,
      forBet: !!input.forBet,
      proxyUrl: input.proxyUrl,
      preferredSlug: input.preferredSlug || null,
    });
  },
  "/bacbo/place-bet": (input) => {
    applyProxyFromInput(input);
    return bacbo.placeBet(
      Number(input.userId || 0),
      input.blazeToken,
      input.spot || "PLAYER",
      Number(input.amount || 0),
      Number(input.protectionAmount || 0),
      input.launchUrl || null,
      Number(input.timeoutMs || 45000),
      { proxyUrl: input.proxyUrl, preferredSlug: input.preferredSlug || null }
    );
  },
  "/bacbo/clear-session": (input) => {
    bacbo.clearSession(Number(input.userId || 0));
    return { ok: true, cleared: true };
  },
  "/bacbo/get-entry-url": (input) => {
    applyProxyFromInput(input);
    return bacbo.getEntryUrl(input.blazeToken, input.preferredSlug || null);
  },
  "/telegram": async (input) => ({ ok: true, ...(await telegram.handle(input.action, input)) }),
};

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    send(res, 200, { ok: true, pid: process.pid });
    return;
  }
  if (SECRET && req.headers["x-bridge-secret"] !== SECRET) {
    send(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  const handler = req.method === "POST" ? routes[req.url] : null;
  if (!handler) {
    send(res, 404, { ok: false, error: "not found" });
    return;
  }
  try {
    const raw = await readBody(req);
    const input = raw ? JSON.parse(raw) : {};
    const result = await handler(input);
    send(res, 200, result && typeof result === "object" ? result : { ok: true, result });
  } catch (e) {
    // Falha de negócio (ex.: sessão expirada) — 200 com ok:false, igual ao bridge por stdin.
    send(res, 200, { ok: false, error: e && e.message ? e.message : String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`[server] bridge HTTP ouvindo em 127.0.0.1:${PORT} (pid=${process.pid})`);
});
