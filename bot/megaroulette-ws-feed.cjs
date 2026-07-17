/**
 * Feed de resultados — Mega Roulette BRAZILIAN (Blaze)
 *   https://blaze.bet.br/pt/games/mega-roulette---brazilian-287-287
 *
 * Fontes (nessa ordem, configurável):
 *   1) GamblingCounting WebSocket (game key 8-287) — SEM token Blaze
 *      wss://squid-app-67gkf.ondigitalocean.app/ws?hash=...
 *      Env: MEGAROULETTE_GC_WS_URL  (URL completa com hash)
 *   2) Blaze /play + Pragmatic WS (precisa MEGAROULETTE_FEED_TOKEN)
 *      Env: MEGAROULETTE_FEED_TOKEN
 *
 * Grava storage/megaroulette-ws/history.json no formato:
 *   { updatedAt, source, results: [{id, created_at, roll, color}] }
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

let WebSocket;
try {
  WebSocket = require("ws");
} catch {
  console.error('[megaroulette-ws-feed] pacote "ws" não instalado. npm install ws');
  process.exit(1);
}

const ROOT = process.env.AUTOWIN_ROOT || path.resolve(__dirname, "..");

// Carrega manual do arquivo .env para process.env
try {
  const envPath = path.join(ROOT, ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...parts] = trimmed.split("=");
      const val = parts.join("=").trim().replace(/^['"]|['"]$/g, ""); // remove aspas
      if (key.trim()) {
        process.env[key.trim()] = val;
      }
    }
  }
} catch (e) {
  console.error("[megaroulette-ws-feed] erro ao ler .env local:", e.message);
}

const OUT_DIR = path.join(ROOT, "storage", "megaroulette-ws");
const HISTORY_FILE = path.join(OUT_DIR, "history.json");
const STATUS_FILE = path.join(OUT_DIR, "status.json");
const PID_FILE = path.join(OUT_DIR, "feed.pid");

// Blaze Brazilian Mega Roulette (substitui a mesa 204-204 antiga)
const GAME_SLUG =
  process.env.MEGAROULETTE_GAME_SLUG || "mega-roulette---brazilian-287-287";
// GamblingCounting key para Brazilian Mega Roulette
const GC_GAME_KEY = process.env.MEGAROULETTE_GC_GAME_KEY || "8-287";
const GC_WS_URL = (process.env.MEGAROULETTE_GC_WS_URL || "").trim();
// URL direta do Pragmatic WS (sem precisar de token Blaze)
// Ex: wss://gs21.pragmaticplaylive.net/game?JSESSIONID=...&tableId=mrbras531mrbr532&...
const PRAGMATIC_WS_URL = (process.env.MEGAROULETTE_PRAGMATIC_WS_URL || "").trim();
// Preferência: blaze|pragmatic = mesa real (default) | gc | auto
const SOURCE_PREF = (process.env.MEGAROULETTE_FEED_SOURCE || "blaze").toLowerCase();

const MAX_RESULTS = 300;
// Reconecta bem rápido após 1006 — cada segundo offline = rodada perdida
const RECONNECT_MS = 500;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

/** Se GC hash falhar, não tenta de novo neste processo (vai pro Blaze/Pragmatic). */
let gcHashDead = false;

/**
 * Parseia uma URL WS do Pragmatic e retorna o session object para connectAndListen.
 * Ex: wss://gs21.pragmaticplaylive.net/game?JSESSIONID=...&tableId=mrbras531mrbr532&...
 */
function parsePragmaticUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const jsessionId = decodeURIComponent(u.searchParams.get("JSESSIONID") || "");
    const tableId = u.searchParams.get("tableId") || "";
    const socketServer = `${u.protocol}//${u.host}`;
    if (!jsessionId || !tableId) return null;
    return { jsessionId, tableId, socketServer };
  } catch {
    return null;
  }
}

/** Loop de reconexão para URL Pragmatic direta (sem token Blaze). */
async function runDirectLoop(rawUrl) {
  while (true) {
    const session = parsePragmaticUrl(rawUrl);
    if (!session) {
      console.error("[megaroulette-ws-feed] MEGAROULETTE_PRAGMATIC_WS_URL inválida:", rawUrl.slice(0, 80));
      process.exit(1);
    }
    const why = await connectAndListen(session);
    console.log(`[megaroulette-ws-feed] sessão encerrou (${why}) — reconectando em ${RECONNECT_MS}ms`);
    // Se JSESSIONID expirou (WS fecha rapidamente), aguarda mais
    if (why === "close" || why === "watchdog") {
      await new Promise((r) => setTimeout(r, RECONNECT_MS));
    } else {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

/**
 * Detecta o executável do Chrome/Chromium instalado no sistema.
 * Tenta caminhos comuns do Windows, Linux e Mac.
 */

function colorOf(roll) {
  if (roll <= 0) return "BRANCO";
  return RED_NUMBERS.has(roll) ? "VERMELHO" : "PRETO";
}

/** Ordena newest-first pelo id numérico (Pragmatic gameId monotônico). */
function sortNewestFirst(results) {
  return (results || []).slice().sort((a, b) => {
    const na = parseInt(String(a.id || "").replace(/\D/g, ""), 10) || 0;
    const nb = parseInt(String(b.id || "").replace(/\D/g, ""), 10) || 0;
    if (nb !== na) return nb - na;
    const ta = Date.parse(a.created_at || "") || 0;
    const tb = Date.parse(b.created_at || "") || 0;
    return tb - ta;
  });
}

/**
 * Extrai resultados reais da mesa Pragmatic.
 * NÃO faz deep-scan amplo (pegava lixo de stats/config e “travava” o histórico).
 * Aceita só:
 *   - gameresult / gameResult / args.gameresult
 *   - listas lastResults / history / results com itens {score|number, id|gameId}
 */
function rowFromObj(obj) {
  if (!obj || typeof obj !== "object") return null;
  const rollRaw =
    obj.score ?? obj.result ?? obj.number ?? obj.winningNumber ?? obj.winNumber;
  // id de jogo Pragmatic (numérico longo). Evita ids curtos de UI.
  const idRaw = obj.gameId ?? obj.gameid ?? obj.game_id ?? obj.id;
  if (rollRaw == null || idRaw == null || idRaw === "") return null;
  const roll = parseInt(rollRaw, 10);
  if (isNaN(roll) || roll < 0 || roll > 36) return null;
  const id = String(idRaw);
  // gameId da Pragmatic costuma ser 10+ dígitos; rejeita lixo curto
  if (id.length < 6 && !/^\d{8,}$/.test(id)) return null;
  const colorHint = String(obj.color || "").toUpperCase();
  return {
    id,
    created_at: new Date().toISOString(),
    roll,
    color:
      colorHint === "RED"
        ? "VERMELHO"
        : colorHint === "BLACK"
          ? "PRETO"
          : colorHint === "GREEN" || colorHint === "ZERO" || roll === 0
            ? "BRANCO"
            : colorOf(roll),
  };
}

function extractPragmaticRows(root) {
  const out = [];
  const seen = new Set();
  const add = (obj) => {
    const row = rowFromObj(obj);
    if (!row || seen.has(row.id)) return;
    seen.add(row.id);
    out.push(row);
  };
  if (!root || typeof root !== "object") return out;

  const gr =
    root.gameresult ||
    root.gameResult ||
    (root.args && (root.args.gameresult || root.args.gameResult)) ||
    null;
  if (gr) add(gr);

  // snapshot de histórico no connect (se existir)
  for (const key of ["lastResults", "history", "results", "gameResults"]) {
    const arr = root[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr.slice(0, 50)) add(item);
  }
  // args.history etc.
  if (root.args && typeof root.args === "object") {
    for (const key of ["lastResults", "history", "results"]) {
      const arr = root.args[key];
      if (!Array.isArray(arr)) continue;
      for (const item of arr.slice(0, 50)) add(item);
    }
  }
  return out;
}

function ensureDirs() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
}

function writeStatus(partial) {
  ensureDirs();
  let prev = {};
  try {
    if (fs.existsSync(STATUS_FILE)) prev = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
  } catch {
    prev = {};
  }
  const next = { ...prev, ...partial, pid: process.pid, updatedAt: new Date().toISOString() };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(next, null, 0), "utf8");
}

function loadHistory() {
  ensureDirs();
  if (!fs.existsSync(HISTORY_FILE)) return { updatedAt: null, source: "unknown", results: [] };
  try {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    if (!data || !Array.isArray(data.results)) return { updatedAt: null, source: "unknown", results: [] };
    return data;
  } catch {
    return { updatedAt: null, source: "unknown", results: [] };
  }
}

function saveHistory(results, source) {
  ensureDirs();
  const payload = {
    updatedAt: new Date().toISOString(),
    source: source || "unknown",
    results: sortNewestFirst(results).slice(0, MAX_RESULTS),
  };
  const tmp = HISTORY_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 0), "utf8");
  fs.renameSync(tmp, HISTORY_FILE);
}

function pushResult(row, source) {
  const hist = loadHistory();
  const results = hist.results || [];
  if (results.some((r) => r.id === row.id)) return false;
  results.unshift(row);
  saveHistory(results, source || hist.source || "unknown");
  return true;
}

/** Insere vários de uma vez (reconnect snapshot / multi gameresult). */
function pushMany(rows, source) {
  if (!rows || !rows.length) return 0;
  const hist = loadHistory();
  const byId = new Map();
  for (const r of hist.results || []) byId.set(String(r.id), r);
  let added = 0;
  for (const r of rows) {
    if (!r || r.id == null) continue;
    const id = String(r.id);
    if (byId.has(id)) continue;
    byId.set(id, r);
    added++;
  }
  if (added > 0) {
    saveHistory([...byId.values()], source || hist.source || "unknown");
  }
  return added;
}

/** Merge lista completa (newest first) sem apagar IDs já conhecidos. */
function mergeFullResults(rowsNewestFirst, source) {
  const hist = loadHistory();
  const byId = new Map();
  for (const r of hist.results || []) byId.set(String(r.id), r);
  for (const r of rowsNewestFirst) {
    if (!r || r.id == null) continue;
    const id = String(r.id);
    if (!byId.has(id)) byId.set(id, r);
  }
  saveHistory([...byId.values()], source);
  return byId.size;
}

function httpRequest(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const body = opts.body || null;
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method: opts.method || "GET",
        headers: {
          "User-Agent": UA,
          Accept: "application/json, text/plain, */*",
          ...(opts.headers || {}),
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () =>
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function followRedirect(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method: "GET",
        headers: { "User-Agent": UA, Referer: "https://blaze.bet.br/" },
      },
      (res) => {
        res.resume();
        resolve(res.headers.location || null);
      }
    );
    req.on("error", reject);
    req.end();
  });
}

// ───────────────────── GamblingCounting ─────────────────────

function parseGcResultPair(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  // roll=0 é válido (zero/branco) — NÃO usar falsy checks
  const roll = parseInt(pair[0], 10);
  if (isNaN(roll) || roll < 0 || roll > 36) return null;
  const shortId = String(pair[1] == null ? "" : pair[1]).trim();
  if (!shortId) return null;
  return {
    id: `gc-${GC_GAME_KEY}-${shortId}-${roll}`,
    created_at: new Date().toISOString(),
    roll,
    color: colorOf(roll),
  };
}

/**
 * Normaliza formatos GC:
 *   [[n,id],[n,id],...]  lista de pares
 *   [n, id]              um único par "flat"
 */
function normalizeGcPairs(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (Array.isArray(raw[0])) return raw;
  // [n, id] — único resultado (atenção: n pode ser 0)
  if (
    raw.length >= 2 &&
    (typeof raw[0] === "number" || typeof raw[0] === "string") &&
    (typeof raw[1] === "string" || typeof raw[1] === "number")
  ) {
    return [raw];
  }
  return [];
}

function extractGcResults(payload) {
  // liveGameFullData: data["8-287"].df.result = [[num,id], ...]
  if (!payload || typeof payload !== "object") return [];
  const data = payload.data || payload;
  const game = data[GC_GAME_KEY] || data[`game-${GC_GAME_KEY}`];
  if (!game) return [];
  const result = (game.df && game.df.result) || game.result || null;
  if (!Array.isArray(result)) return [];
  const rows = [];
  for (const pair of normalizeGcPairs(result)) {
    const row = parseGcResultPair(pair);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * Conecta no WS do GamblingCounting e grava resultados da mesa 8-287.
 * Hash expira → erro type 3; precisa colar URL nova no Admin.
 */
function connectGamblingCounting(wsUrl) {
  return new Promise((resolve) => {
    writeStatus({ state: "connecting-gc", source: "gamblingcounting", gameKey: GC_GAME_KEY });
    console.log("[megaroulette-ws-feed] GC conectando", wsUrl.replace(/hash=[^&]+/, "hash=***"));

    let closed = false;
    const ws = new WebSocket(wsUrl, {
      headers: {
        Origin: "https://gamblingcounting.com",
        "User-Agent": UA,
      },
      handshakeTimeout: 15000,
    });

    const done = (why) => {
      if (closed) return;
      closed = true;
      try {
        ws.close();
      } catch {
        /* */
      }
      resolve(why || "closed");
    };

    let watchdog = setTimeout(() => done("watchdog"), 120_000);
    const kick = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => done("watchdog"), 120_000);
    };

    ws.on("open", () => {
      writeStatus({ state: "connected-gc", lastOpenAt: new Date().toISOString() });
      console.log("[megaroulette-ws-feed] GC WS aberto — aguardando liveGame");
    });

    ws.on("message", (raw) => {
      kick();
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // auth / erros
      if (msg && msg.type === "common" && msg.event === "error") {
        const code = String(msg.data || "");
        const err =
          code === "3" || code.includes("3")
            ? "GC hash inválido/expirado (type 3). Abra gamblingcounting, copie o wss://.../ws?hash=... novo e salve em MEGAROULETTE_GC_WS_URL."
            : "GC error: " + code;
        console.error("[megaroulette-ws-feed]", err);
        if (code === "3" || code.includes("3")) {
          gcHashDead = true;
        }
        writeStatus({ state: "error", lastError: err, code: "GC_HASH_INVALID" });
        done("gc-auth-error");
        return;
      }

      const event = msg.event || msg.type || "";
      // snapshot completo — substitui histórico (fonte autoritativa, não mistura com Pragmatic)
      if (event === "liveGameFullData" || (msg.type === "liveGame" && event === "liveGameFullData")) {
        const rows = extractGcResults(msg);
        if (rows.length) {
          // GC manda newest-first em df.result — grava como lista canônica
          saveHistory(rows, "gamblingcounting");
          const newest = rows[0];
          console.log(
            `[megaroulette-ws-feed] GC fullData ${rows.length} resultados · newest=${newest.roll} ${newest.color}`
          );
          writeStatus({
            state: "connected-gc",
            lastResultAt: new Date().toISOString(),
            lastResult: newest,
            source: "gamblingcounting",
          });
        }
        return;
      }
      // type liveGame com outros events
      if (msg.type === "liveGame" && event !== "liveGameFullData") {
        const rows = extractGcResults(msg);
        if (rows.length) {
          mergeFullResults(rows, "gamblingcounting");
          const newest = rows[0];
          writeStatus({
            state: "connected-gc",
            lastResultAt: new Date().toISOString(),
            lastResult: newest,
            source: "gamblingcounting",
          });
        }
      }

      // updates parciais — tenta vários formatos
      if (
        event === "liveGameUpdate" ||
        event === "liveGamePartialData" ||
        event === "gameUpdate" ||
        event === "newResult" ||
        event === "liveGameResult"
      ) {
        // data pode ser { "8-287": { result: [n,id] } } ou { result: [...] }
        // n=0 (zero) é válido — normalizeGcPairs trata flat [0,id]
        let pairs = [];
        if (msg.data && msg.data[GC_GAME_KEY]) {
          const g = msg.data[GC_GAME_KEY];
          if (Array.isArray(g.result)) pairs = normalizeGcPairs(g.result);
          else if (g.df && Array.isArray(g.df.result)) pairs = normalizeGcPairs(g.df.result.slice(0, 5));
          else if (Array.isArray(g) && (typeof g[0] === "number" || g[0] === 0)) pairs = normalizeGcPairs(g);
        } else if (Array.isArray(msg.data)) {
          pairs = normalizeGcPairs(msg.data);
        } else if (msg.data && Array.isArray(msg.data.result)) {
          pairs = normalizeGcPairs(msg.data.result);
        }
        for (const pair of pairs) {
          const row = parseGcResultPair(pair);
          if (!row) continue;
          if (pushResult(row, "gamblingcounting")) {
            console.log(`[megaroulette-ws-feed] GC +1: ${row.roll} ${row.color} (${row.id})`);
            writeStatus({
              state: "connected-gc",
              lastResultAt: new Date().toISOString(),
              lastResult: row,
              source: "gamblingcounting",
            });
          }
        }
      }
    });

    ws.on("error", (err) => {
      console.error("[megaroulette-ws-feed] GC WS error:", err.message);
      writeStatus({ state: "error", lastError: err.message, source: "gamblingcounting" });
    });

    ws.on("close", (code, reason) => {
      clearTimeout(watchdog);
      console.log("[megaroulette-ws-feed] GC WS close", code, reason && reason.toString());
      writeStatus({ state: "disconnected-gc", lastCloseCode: code });
      done("close");
    });
  });
}

// ───────────────────── Blaze / Pragmatic ─────────────────────

async function openSession(token) {
  const walletRes = await httpRequest("https://blaze.bet.br/api/wallets", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (walletRes.status === 401 || walletRes.status === 403) {
    const err = new Error(
      `token Blaze inválido/expirado (wallets HTTP ${walletRes.status}). Atualize MEGAROULETTE_FEED_TOKEN.`
    );
    err.code = "TOKEN_INVALID";
    throw err;
  }
  let wallets;
  try {
    wallets = JSON.parse(walletRes.body);
  } catch {
    throw new Error("wallets não-JSON HTTP " + walletRes.status);
  }
  const list = Array.isArray(wallets)
    ? wallets
    : Array.isArray(wallets && wallets.data)
      ? wallets.data
      : Array.isArray(wallets && wallets.wallets)
        ? wallets.wallets
        : [];
  const wallet = list.find((w) => w && (w.primary || w.is_primary)) || list[0] || null;
  const walletId = wallet && (wallet.id || wallet.wallet_id);
  if (!walletId) {
    throw new Error("wallet_id não encontrado: " + String(walletRes.body).slice(0, 160));
  }

  // tenta slug brasileiro; fallback legado 204
  const slugs = [GAME_SLUG, "mega-roulette---brazilian-287-287", "mega-roulette-204-204"];
  let playData = null;
  let usedSlug = null;
  for (const slug of slugs) {
    const playRes = await httpRequest(`https://blaze.bet.br/api/v2/games/${slug}/play`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: "https://blaze.bet.br",
        Referer: `https://blaze.bet.br/pt/games/${slug}`,
        "x-client-language": "pt",
        "x-client-version": "242bb5ed0",
      },
      body: JSON.stringify({ wallet_id: walletId, selected_currency_type: "BRL" }),
    });
    try {
      playData = JSON.parse(playRes.body);
    } catch {
      playData = null;
    }
    if (playRes.status === 401 || playRes.status === 403) {
      const err = new Error(`token recusado no /play (HTTP ${playRes.status})`);
      err.code = "TOKEN_INVALID";
      throw err;
    }
    if (playData && playData.content) {
      usedSlug = slug;
      break;
    }
    console.log(
      `[megaroulette-ws-feed] /play slug=${slug} status=${playRes.status} body=${String(playRes.body).slice(0, 120)}`
    );
  }
  if (!playData || !playData.content) {
    throw new Error("play falhou em todos os slugs (brazilian / 204)");
  }
  console.log("[megaroulette-ws-feed] Blaze play OK slug=" + usedSlug);

  const loc1 = await followRedirect(playData.content);
  if (!loc1) throw new Error("sem redirect 1 (launch URL expirada?)");
  const loc2 = await followRedirect(loc1);
  if (!loc2) throw new Error("sem redirect 2");

  const finalUrl = new URL(loc2);
  const jsessionId = finalUrl.searchParams.get("JSESSIONID");
  const tableId = finalUrl.searchParams.get("table_id");
  const socketServer = finalUrl.searchParams.get("socket_server");
  if (!jsessionId || !tableId || !socketServer) {
    throw new Error("faltam parâmetros na URL final: " + loc2.slice(0, 200));
  }
  return { jsessionId, tableId, socketServer, slug: usedSlug };
}

function connectAndListen(session) {
  return new Promise((resolve) => {
    const wsUrl =
      `${session.socketServer}?JSESSIONID=${encodeURIComponent(session.jsessionId)}` +
      `&tableId=${encodeURIComponent(session.tableId)}&type=json&version=3&pageRefresh=true`;

    writeStatus({
      state: "connecting",
      tableId: session.tableId,
      source: "pragmatic-ws",
      slug: session.slug || null,
    });
    console.log(`[megaroulette-ws-feed] Pragmatic mesa=${session.tableId} slug=${session.slug || "?"}`);

    let closed = false;
    const ws = new WebSocket(wsUrl, {
      headers: { Origin: "https://client.pragmaticplaylive.net", "User-Agent": UA },
      handshakeTimeout: 15000,
    });

    const done = (why) => {
      if (closed) return;
      closed = true;
      try {
        ws.close();
      } catch {
        /* */
      }
      resolve(why || "closed");
    };

    // ~45s entre rodadas; 3 min evita cortar sessão saudável sem traffic
    let watchdog = setTimeout(() => done("watchdog"), 180_000);
    const kickWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => done("watchdog"), 180_000);
    };

    // Heartbeat só no status (NÃO mexe mtime do history — senão parece “vivo” sem resultado)
    let lastResultMs = Date.now();
    const heartbeat = setInterval(() => {
      if (closed) return;
      writeStatus({
        state: "connected",
        tableId: session.tableId,
        source: "pragmatic-ws",
        heartbeatAt: new Date().toISOString(),
      });
      // Sem novo resultado ~90s → reconecta (WS “zumbi” após 1006)
      if (Date.now() - lastResultMs > 90_000) {
        console.log("[megaroulette-ws-feed] sem resultado há 90s — forçando reconnect");
        done("stale-no-results");
      }
    }, 15_000);

    ws.on("open", () => {
      lastResultMs = Date.now();
      writeStatus({
        state: "connected",
        tableId: session.tableId,
        source: "pragmatic-ws",
        lastOpenAt: new Date().toISOString(),
      });
      console.log("[megaroulette-ws-feed] Pragmatic WS aberto — ouvindo resultados");
      kickWatchdog();
    });

    ws.on("message", (raw) => {
      kickWatchdog();
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const rows = extractPragmaticRows(data);
      if (!rows.length) return;

      if (rows.length === 1) {
        const row = rows[0];
        const added = pushResult(row, "pragmatic-ws");
        if (added) {
          lastResultMs = Date.now();
          console.log(`[megaroulette-ws-feed] +1 resultado: ${row.roll} ${row.color} (id=${row.id})`);
          writeStatus({
            state: "connected",
            tableId: session.tableId,
            source: "pragmatic-ws",
            lastResultAt: new Date().toISOString(),
            lastResult: row,
          });
        }
        return;
      }

      const added = pushMany(rows, "pragmatic-ws");
      if (added > 0) {
        lastResultMs = Date.now();
        const newest = sortNewestFirst(rows)[0];
        console.log(
          `[megaroulette-ws-feed] +${added} resultados (batch ${rows.length}) · newest=${newest.roll} ${newest.color}`
        );
        writeStatus({
          state: "connected",
          tableId: session.tableId,
          source: "pragmatic-ws",
          lastResultAt: new Date().toISOString(),
          lastResult: newest,
        });
      }
    });

    ws.on("error", (err) => {
      console.error("[megaroulette-ws-feed] WS error:", err && err.message ? err.message : err);
      writeStatus({ state: "error", lastError: String(err && err.message ? err.message : err) });
    });

    ws.on("close", (code, reason) => {
      clearTimeout(watchdog);
      clearInterval(heartbeat);
      const r = reason ? reason.toString() : "";
      console.log(`[megaroulette-ws-feed] WS fechou code=${code} ${r}`);
      writeStatus({ state: "disconnected", lastCloseCode: code, lastCloseReason: r });
      done("close");
    });
  });
}

async function runBlazeLoop(token) {
  let authFails = 0;
  while (true) {
    try {
      writeStatus({ state: "opening-session", source: "pragmatic-ws" });
      const session = await openSession(token);
      authFails = 0;
      const why = await connectAndListen(session);
      console.log(`[megaroulette-ws-feed] sessão encerrou (${why}) — reconectando em ${RECONNECT_MS}ms`);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      console.error("[megaroulette-ws-feed] falha:", msg);
      writeStatus({ state: "error", lastError: msg, code: e && e.code ? e.code : null });
      if (e && e.code === "TOKEN_INVALID") {
        authFails++;
        const waitMs = Math.min(5 * 60_000, 30_000 * authFails);
        console.error(`[megaroulette-ws-feed] token inválido — aguardando ${Math.round(waitMs / 1000)}s`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
    }
    await new Promise((r) => setTimeout(r, RECONNECT_MS));
  }
}

async function runGcLoop(wsUrl) {
  while (true) {
    const why = await connectGamblingCounting(wsUrl);
    if (why === "gc-auth-error") {
      // hash morto: espera mais pra não spammar; user precisa atualizar URL
      await new Promise((r) => setTimeout(r, 60_000));
    } else {
      await new Promise((r) => setTimeout(r, RECONNECT_MS));
    }
  }
}

async function main() {
  ensureDirs();
  fs.writeFileSync(PID_FILE, String(process.pid), "utf8");
  process.on("exit", () => {
    try {
      if (fs.existsSync(PID_FILE) && fs.readFileSync(PID_FILE, "utf8").trim() === String(process.pid)) {
        fs.unlinkSync(PID_FILE);
      }
    } catch {
      /* */
    }
  });

  const token = (process.env.MEGAROULETTE_FEED_TOKEN || "").trim();
  const gcUrl = GC_WS_URL;

  console.log(
    `[megaroulette-ws-feed] iniciado pid=${process.pid} pref=${SOURCE_PREF} slug=${GAME_SLUG}`
  );
  writeStatus({ state: "starting", sourcePref: SOURCE_PREF, slug: GAME_SLUG, gcGameKey: GC_GAME_KEY });

  // Modo 0: URL Pragmatic direta (sem token Blaze) — máxima prioridade
  if (PRAGMATIC_WS_URL && PRAGMATIC_WS_URL.startsWith("wss://")) {
    const sess = parsePragmaticUrl(PRAGMATIC_WS_URL);
    if (sess) {
      console.log(`[megaroulette-ws-feed] modo DIRETO Pragmatic — tableId=${sess.tableId} server=${sess.socketServer}`);
      await runDirectLoop(PRAGMATIC_WS_URL);
      return;
    }
    console.error("[megaroulette-ws-feed] MEGAROULETTE_PRAGMATIC_WS_URL inválida — ignorando");
  }

  // Padrão: WebSocket direto da mesa Pragmatic (via token Blaze /play)
  const useBlaze =
    (SOURCE_PREF === "blaze" ||
      SOURCE_PREF === "auto" ||
      SOURCE_PREF === "pragmatic" ||
      SOURCE_PREF === "") &&
    !!token;
  const useGc =
    !gcHashDead &&
    (SOURCE_PREF === "gc" || SOURCE_PREF === "auto") &&
    gcUrl.startsWith("wss://");

  // Prioriza mesa real (Blaze/Pragmatic). GC só se source=gc ou auto sem token.
  if (useBlaze && SOURCE_PREF !== "gc") {
    console.log(
      "[megaroulette-ws-feed] modo Blaze/Pragmatic — WS direto da mesa " + GAME_SLUG
    );
    await runBlazeLoop(token);
    return;
  }

  if (useGc) {
    console.log("[megaroulette-ws-feed] modo GamblingCounting (fallback)");
    if (useBlaze) {
      while (!gcHashDead) {
        const why = await connectGamblingCounting(gcUrl);
        if (why === "gc-auth-error" || gcHashDead) {
          console.log("[megaroulette-ws-feed] GC morto — caindo pra mesa Pragmatic");
          break;
        }
        await new Promise((r) => setTimeout(r, RECONNECT_MS));
      }
      await runBlazeLoop(token);
      return;
    }
    await runGcLoop(gcUrl);
    return;
  }

  console.error(
    "[megaroulette-ws-feed] precisa de MEGAROULETTE_FEED_TOKEN (token Blaze) " +
      "para WS direto da mesa Brazilian Mega Roulette"
  );
  writeStatus({
    state: "error",
    lastError: "sem MEGAROULETTE_FEED_TOKEN (token Blaze da conta)",
  });
  process.exit(1);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  module.exports = { main, openSession, extractGcResults, colorOf };
}
