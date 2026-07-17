/**
 * Bridge Evolution Bac Bo — multi-usuário (HTTP + WebSocket, SEM Chrome).
 *
 * Cada userId tem sessão própria em storage/bacbo-evo/{userId}.json
 * Fluxo:
 *   1) Blaze token → POST /api/games/bac-bo/play (e bac-bo-ao-vivo)
 *   2) GET entry?JSESSIONID&params (cookie jar, redirects)
 *   3) EVOSESSIONID da URL final / Location / Set-Cookie
 *   4) WebSocket bacbo → aposta em AcceptingBets / WaitingForBets
 *
 * Sala capturada (blaze.bet.br/pt/games/bac-bo):
 *   table  BacBo00000000001
 *   vt     sp4xxdwvb7ye75c5
 *   min bet R$ 5
 *   WS     wss://…/public/bacbo/player/game/{table}/socket
 *   bet    type "bacbo.bet" + betMap + actions (Chipstack)
 *   client_version 6.20260710.73542.63265-ab3d820afb-r2
 *   instance {6chars}-{evo16}-{vtId}
 *   pós-sessão: GET /setup + /style + /config (Referer frontend/evo/r2/)
 *
 * Ações (JSON stdin → JSON stdout):
 *   ensure-session | place-bet | clear-session | ping
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { URL } = require("url");

let WebSocket;
try {
  WebSocket = require("ws");
} catch {
  process.stdout.write(JSON.stringify({ ok: false, error: 'Pacote "ws" não instalado. npm install ws' }));
  process.exit(0);
}

/**
 * Proxy residencial opcional para o entry + WebSocket da Evolution (bloqueio
 * Akamai por reputação de IP de datacenter — ver storage/bacbo-evo/*.json
 * com status 403 na VPS vs 302 em IP residencial).
 * Configure BACBO_PROXY_URL no .env / Admin, ex.:
 *   http://usuario:senha@host:porta
 *   socks5://usuario:senha@host:porta
 *
 * Também aceita proxyUrl no payload de cada ação (server.cjs / PHP) para
 * recarregar sem reiniciar o processo — o agent NÃO fica congelado no boot.
 */
let proxyUrlActive = (process.env.BACBO_PROXY_URL || "").trim();
let proxyAgent = null;

function buildProxyAgent(url) {
  const u = String(url || "").trim();
  if (!u) return null;
  try {
    if (u.startsWith("socks")) {
      const { SocksProxyAgent } = require("socks-proxy-agent");
      return new SocksProxyAgent(u);
    }
    const { HttpsProxyAgent } = require("https-proxy-agent");
    return new HttpsProxyAgent(u);
  } catch (e) {
    process.stderr.write(`[bacbo-evo-bridge] falha ao carregar proxy: ${e.message}\n`);
    return null;
  }
}

proxyAgent = buildProxyAgent(proxyUrlActive);

/** Atualiza proxy em runtime (payload.proxyUrl ou env). Retorna URL ativa. */
function setProxyUrl(url) {
  const prev = proxyUrlActive;
  const next = url === undefined || url === null ? proxyUrlActive : String(url).trim();
  if (next === proxyUrlActive && proxyAgent) return proxyUrlActive;
  // se next vazio e env tem valor, usa env (fallback)
  const resolved = next || (process.env.BACBO_PROXY_URL || "").trim();
  if (resolved === proxyUrlActive && (proxyAgent || !resolved)) return proxyUrlActive;
  proxyUrlActive = resolved;
  process.env.BACBO_PROXY_URL = resolved;
  proxyAgent = buildProxyAgent(resolved);
  if (prev !== proxyUrlActive) {
    const hint = (u) => (u ? String(u).replace(/:[^:@/]+@/, ":***@") : "(nenhum)");
    // logBridge pode ainda não existir no boot — stderr seguro
    try {
      process.stderr.write(
        `[bacbo-evo-bridge] proxy atualizado: ${hint(prev)} → ${hint(proxyUrlActive)} agent=${proxyAgent ? "ok" : "null"}\n`
      );
    } catch {
      /* */
    }
  }
  return proxyUrlActive;
}

function getProxyUrl() {
  return proxyUrlActive || "";
}



function parseProxyUrl(url) {
  const u = String(url || "").trim();
  if (!u) return null;
  const m = u.match(/^(https?|socks5?):\/\/([^:]+):([^@]+)@(.+)$/);
  if (!m) return null;
  const [, scheme, user, pass, hostport] = m;
  return { scheme, user, pass, hostport };
}

/** Proxy só na Evolution — Blaze /play vai direto (IP do server costuma ok). */
function needsEvoProxy(hostname) {
  const h = String(hostname || "").toLowerCase();
  return (
    h.includes("evo-games.com") ||
    h.includes("egcvi.com") ||
    h.includes("evo-games") ||
    h.endsWith(".evo-games.com")
  );
}

function agentForUrl(urlStr) {
  if (!proxyAgent) return undefined;
  try {
    const u = new URL(urlStr);
    return needsEvoProxy(u.hostname) ? proxyAgent : undefined;
  } catch {
    return proxyAgent;
  }
}

function hopsLookLikeAkamai(hops) {
  if (!Array.isArray(hops)) return false;
  return hops.some((h) => {
    if (!h) return false;
    if (h.step === "blocked" && (h.status === 403 || h.status === 401)) return true;
    if (h.status === 403) return true;
    const body = String(h.bodySample || h.error || "");
    return /Access Denied|Reference\s*#|akamai|Permission denied/i.test(body);
  });
}

function akamaiBlockedError(hops, extra = {}) {
  const hasProxy = !!proxyUrlActive;
  return {
    ok: false,
    code: "AKAMAI_BLOCKED",
    error: hasProxy
      ? "Evolution (Akamai) bloqueou o /entry mesmo com proxy. Use proxy RESIDENCIAL/4G de verdade (não datacenter), teste no Admin → Proxy, e reinicie o bot."
      : "Evolution (Akamai) bloqueou o /entry — IP de VPS/datacenter. Configure proxy residencial em Admin → Proxy (BACBO_PROXY_URL) e tente de novo.",
    hops: hops || [],
    proxyConfigured: hasProxy,
    proxyHint: hasProxy ? proxyUrlActive.replace(/:[^:@/]+@/, ":***@") : null,
    ...extra,
  };
}

// AUTOWIN_ROOT: use quando este script rodar fora do projeto PHP (ex.: Aplicação
// Node.js separada no hPanel) — deve apontar pra pasta que contém "storage/"
// do app PHP, senão sessões/resultados ficam isolados num storage errado.
const ROOT = process.env.AUTOWIN_ROOT || path.resolve(__dirname, "..");
const SESSION_DIR = path.join(ROOT, "storage", "bacbo-evo");
const WS_DIR = path.join(ROOT, "storage", "bacbo-ws");
const WS_HISTORY = path.join(WS_DIR, "history.json");
// Log de cada tentativa (ensure-session / place-bet) — única forma de ver
// o que realmente aconteceu, já que este script roda como processo isolado
// (proc_open) e só devolve o JSON final ao PHP.
const ATTEMPT_LOG = path.join(SESSION_DIR, "attempts.log");
const ATTEMPT_LOG_MAX_BYTES = 5 * 1024 * 1024;

function appendAttemptLog(entry) {
  try {
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
    if (fs.existsSync(ATTEMPT_LOG) && fs.statSync(ATTEMPT_LOG).size > ATTEMPT_LOG_MAX_BYTES) {
      const lines = fs.readFileSync(ATTEMPT_LOG, "utf8").split("\n").filter(Boolean);
      fs.writeFileSync(ATTEMPT_LOG, lines.slice(-1000).join("\n") + "\n", "utf8");
    }
    fs.appendFileSync(ATTEMPT_LOG, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    /* log é best-effort — nunca deve quebrar a aposta */
  }
}

/** Log legível em stderr + attempts.log (diagnóstico REAL / Akamai / proxy). */
function logBridge(msg, extra = {}) {
  const at = new Date().toISOString();
  const proxyHint = proxyUrlActive ? proxyUrlActive.replace(/:[^:@/]+@/, ":***@") : null;
  const payload = { at, action: "trace", message: msg, proxyConfigured: !!proxyUrlActive, proxyHint, ...extra };
  try {
    process.stderr.write(
      `[bacbo-evo-bridge ${at}] ${msg}` +
        (extra && Object.keys(extra).length
          ? " | " + JSON.stringify(extra).slice(0, 400)
          : "") +
        "\n"
    );
  } catch {
    /* */
  }
  appendAttemptLog(payload);
}

// Sala Blaze bac-bo (captura real do browser)
const DEFAULT_TABLE = "BacBo00000000001";
const DEFAULT_VT = "sp4xxdwvb7ye75c5";
// Mesa "ao vivo" (slug bac-bo-ao-vivo / bots Python antigos)
const FALLBACK_TABLE = "PorBacBo00000001";
const FALLBACK_VT = "sp4xxdm4b7ye74t7";
const EVO_HOST = "a8-latam.evo-games.com";
const CLIENT_VERSION = "6.20260710.73542.63265-ab3d820afb-r2";
const FRONTEND_REF = `https://${EVO_HOST}/frontend/evo/r2/`;
const MAX_WS_RESULTS = 300;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const SEC_CH_UA = '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"';

/** Headers HTTP alinhados à captura do browser (pós-EVOSESSIONID). */
function evoBrowserHeaders(extra = {}) {
  return {
    "User-Agent": UA,
    Accept: "*/*",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    Origin: `https://${EVO_HOST}`,
    Referer: FRONTEND_REF,
    "sec-ch-ua": SEC_CH_UA,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "priority": "u=1, i",
    ...extra,
  };
}

/** Cookie jar no estilo do browser: EVOSESSIONID= (vazio) + evo na query. */
function browserStyleCookie(sessionCookies, evoSessionId) {
  let jar = String(sessionCookies || "");
  // Browser real manda cookie EVOSESSIONID vazio e o valor na URL
  if (!/EVOSESSIONID=/.test(jar)) {
    jar = jar ? `EVOSESSIONID=; ${jar}` : "EVOSESSIONID=";
  } else {
    jar = jar.replace(/EVOSESSIONID=[^;]*/i, "EVOSESSIONID=");
  }
  // mantém evo na URL; se quiser forçar valor no cookie: descomente
  void evoSessionId;
  return jar;
}

/** instance = 6 chars + first 16 of EVOSESSIONID + vtId (captura real). */
function buildInstance(evoSessionId, vtId, userId) {
  const prefix = (userId ? "u" + String(userId) : "bot") + Math.random().toString(36).slice(2, 5);
  const evo16 = String(evoSessionId || "").slice(0, 16);
  return `${prefix.slice(0, 6)}-${evo16}-${vtId || DEFAULT_VT}`;
}

function buildWsUrl(tableId, vtId, evoSessionId, instance) {
  return (
    `wss://${EVO_HOST}/public/bacbo/player/game/${tableId}/socket` +
    `?messageFormat=json&tableConfig=${encodeURIComponent(vtId)}` +
    `&EVOSESSIONID=${encodeURIComponent(evoSessionId)}` +
    `&instance=${encodeURIComponent(instance)}` +
    `&client_version=${CLIENT_VERSION}`
  );
}

/**
 * Handshake HTTP do cliente real (captura browser):
 *   GET /setup?device=desktop&wrapped=true&locale=pt-BR&EVOSESSIONID=…&client_version=…
 *   GET /style?EVOSESSIONID=…
 *   GET /config?table_id=…&vt_id=…&EVOSESSIONID=…
 * Não grava EVOSESSIONID fixo — usa o da sessão do user.
 */
async function warmEvoClient(session) {
  const evo = session.evoSessionId;
  const tableId = session.tableId || DEFAULT_TABLE;
  const vtId = session.vtId || DEFAULT_VT;
  if (!evo) return { ok: false, steps: [] };

  const cookie = browserStyleCookie(session.cookies, evo);
  const steps = [];
  const qEvo = encodeURIComponent(evo);
  const urls = [
    {
      name: "setup",
      url:
        `https://${EVO_HOST}/setup?device=desktop&wrapped=true&locale=pt-BR` +
        `&EVOSESSIONID=${qEvo}&client_version=${CLIENT_VERSION}`,
      headers: evoBrowserHeaders({
        "X-Fingerprint": Buffer.from(`autowin-${session.userId || 0}-${evo.slice(0, 12)}`).toString("base64"),
      }),
    },
    {
      name: "style",
      url: `https://${EVO_HOST}/style?EVOSESSIONID=${qEvo}&client_version=${CLIENT_VERSION}`,
      headers: evoBrowserHeaders(),
    },
    {
      name: "config",
      url:
        `https://${EVO_HOST}/config?table_id=${encodeURIComponent(tableId)}` +
        `&vt_id=${encodeURIComponent(vtId)}` +
        `&EVOSESSIONID=${qEvo}&client_version=${CLIENT_VERSION}`,
      headers: evoBrowserHeaders(),
    },
  ];

  let cookies = cookie;
  for (const step of urls) {
    try {
      const res = await httpRequest(step.url, {
        method: "GET",
        headers: { ...step.headers, Cookie: cookies },
        cookieJar: cookies,
        maxRedirects: 2,
        timeout: 15000,
      });
      cookies = res.cookieJar || cookies;
      steps.push({ name: step.name, status: res.status, bodyLen: (res.body || "").length });
    } catch (e) {
      steps.push({ name: step.name, error: e.message });
    }
  }
  return { ok: steps.some((s) => s.status && s.status < 400), steps, cookies };
}

function winnerFromDice(p1, p2, b1, b2) {
  const pt = p1 + p2;
  const bt = b1 + b2;
  if (pt > bt) return "PlayerWon";
  if (bt > pt) return "BankerWon";
  return "Tie";
}

function diceVal(dice, id) {
  if (!Array.isArray(dice)) return 0;
  for (const d of dice) {
    if (Number(d && d.id) === id) return Number(d.value || 0) || 0;
  }
  return 0;
}

/** Grava resultado no feed local (mesmo arquivo do bacbo-ws-feed). */
function appendWsResult(game) {
  try {
    if (!game || typeof game !== "object") return;
    const stage = game.stage || "";
    if (stage && stage !== "Confirmation" && stage !== "Resolved" && stage !== "Settled") return;
    const id = String(game.gameId || game.id || "");
    if (!id) return;
    const dice = game.dice || [];
    let p1 = diceVal(dice, 1);
    let p2 = diceVal(dice, 2);
    let b1 = diceVal(dice, 3);
    let b2 = diceVal(dice, 4);
    if (p1 + p2 + b1 + b2 === 0 && dice.length >= 4) {
      const vals = dice.map((d) => (typeof d === "number" ? d : Number(d && d.value) || 0));
      p1 = vals[0] || 0;
      p2 = vals[1] || 0;
      b1 = vals[2] || 0;
      b2 = vals[3] || 0;
    }
    if (p1 + p2 + b1 + b2 === 0) return;

    if (!fs.existsSync(WS_DIR)) fs.mkdirSync(WS_DIR, { recursive: true });
    let hist = { results: [] };
    if (fs.existsSync(WS_HISTORY)) {
      try {
        hist = JSON.parse(fs.readFileSync(WS_HISTORY, "utf8")) || hist;
      } catch {
        hist = { results: [] };
      }
    }
    const results = Array.isArray(hist.results) ? hist.results : [];
    if (results.some((r) => String(r._id) === id)) return;

    const row = {
      _id: id,
      createdAt: new Date().toISOString(),
      diceplayer1: p1,
      diceplayer2: p2,
      dicebanker1: b1,
      dicebanker2: b2,
      winner: winnerFromDice(p1, p2, b1, b2),
    };
    results.unshift(row);
    const payload = {
      updatedAt: new Date().toISOString(),
      source: "evolution-ws",
      results: results.slice(0, MAX_WS_RESULTS),
    };
    fs.writeFileSync(WS_HISTORY, JSON.stringify(payload, null, 0), "utf8");
  } catch {
    /* não quebra aposta se falhar gravar feed */
  }
}

function ok(payload = {}) {
  process.stdout.write(JSON.stringify({ ok: true, ...payload }));
}

function fail(message, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, error: message, ...extra }));
}

function ensureDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

function sessionPath(userId) {
  const id = String(userId).replace(/[^0-9]/g, "") || "0";
  return path.join(SESSION_DIR, `${id}.json`);
}

function readSession(userId) {
  const p = sessionPath(userId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeSession(userId, data) {
  ensureDir();
  const payload = {
    ...data,
    userId: Number(userId),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(sessionPath(userId), JSON.stringify(payload, null, 0), "utf8");
}

function clearSession(userId) {
  const p = sessionPath(userId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function mergeCookieJar(jar, setCookie) {
  if (!setCookie) return jar || "";
  const map = {};
  for (const c of String(jar || "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean)) {
    const i = c.indexOf("=");
    if (i > 0) map[c.slice(0, i)] = c.slice(i + 1);
  }
  const parts = (Array.isArray(setCookie) ? setCookie : [setCookie]).map((c) => c.split(";")[0]);
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i > 0) {
      const k = p.slice(0, i);
      const v = p.slice(i + 1);
      // não sobrescrever EVOSESSIONID válido com vazio
      if (k === "EVOSESSIONID" && (!v || v.length < 20) && map[k] && map[k].length >= 20) {
        continue;
      }
      map[k] = v;
    }
  }
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function cookieValue(jar, name) {
  if (!jar) return null;
  const re = new RegExp("(?:^|;\\s*)" + name + "=([^;]*)");
  const m = String(jar).match(re);
  return m ? m[1] : null;
}

/**
 * HTTP com cookie jar (equivalente a requests.Session).
 * maxRedirects: 0 = não seguir (como allow_redirects=False do Python).
 */
function httpRequest(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    let current = urlStr;
    let cookies = opts.cookieJar || "";
    let redirectsLeft = opts.maxRedirects === undefined ? 10 : opts.maxRedirects;
    const method = opts.method || "GET";
    const body = opts.body || null;

    const doOne = (url, isRedirect) => {
      let u;
      try {
        u = new URL(url);
      } catch (e) {
        reject(e);
        return;
      }
      const lib = u.protocol === "https:" ? https : http;
      const headers = {
        "User-Agent": UA,
        Accept: opts.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "upgrade-insecure-requests": "1",
        "sec-ch-ua": SEC_CH_UA,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-User": "?1",
        "priority": "u=0, i",
        ...(opts.headers || {}),
      };
      if (cookies) headers.Cookie = cookies;
      if (body && !isRedirect) {
        headers["Content-Length"] = Buffer.byteLength(body);
      }

      let agent;
      if (opts.agent !== undefined) {
        agent = opts.agent;
      } else if (opts.forceProxy && proxyAgent) {
        // diagnóstico de IP de saída: força o proxy mesmo em hosts não-Evolution
        agent = proxyAgent;
      } else {
        agent = agentForUrl(url);
      }
      const reqOpts = {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: isRedirect ? "GET" : method,
        headers,
        timeout: opts.timeout || 30000,
        ...(agent ? { agent } : {}),
      };

      // Se for HTTPS, injeta evasão TLS (Chrome JA3 Bypass)
      if (u.protocol === "https:") {
        reqOpts.ciphers = "TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384";
        reqOpts.minVersion = "TLSv1.2";
        reqOpts.maxVersion = "TLSv1.3";
        reqOpts.honorCipherOrder = true;
      }

      const req = lib.request(
        reqOpts,
        (res) => {
          const chunks = [];
          res.on("data", (d) => chunks.push(d));
          res.on("end", () => {
            cookies = mergeCookieJar(cookies, res.headers["set-cookie"]);
            const status = res.statusCode || 0;
            const loc = res.headers.location;
            const rawBody = Buffer.concat(chunks);
            let text = rawBody.toString("utf8");

            // brotli / gzip se vier (Node 18+ tem zlib)
            const enc = String(res.headers["content-encoding"] || "").toLowerCase();
            if (enc === "br" || enc === "gzip" || enc === "deflate") {
              try {
                const zlib = require("zlib");
                if (enc === "br" && zlib.brotliDecompressSync) {
                  text = zlib.brotliDecompressSync(rawBody).toString("utf8");
                } else if (enc === "gzip") {
                  text = zlib.gunzipSync(rawBody).toString("utf8");
                } else if (enc === "deflate") {
                  text = zlib.inflateSync(rawBody).toString("utf8");
                }
              } catch {
                /* usa text cru */
              }
            }

            if (loc && status >= 300 && status < 400 && redirectsLeft > 0) {
              redirectsLeft -= 1;
              const next = loc.startsWith("http") ? loc : new URL(loc, url).toString();
              doOne(next, true);
              return;
            }

            resolve({
              status,
              headers: res.headers,
              body: text,
              url,
              finalUrl: url,
              cookieJar: cookies,
              location: loc || null,
            });
          });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("timeout HTTP"));
      });
      if (body && !isRedirect) req.write(body);
      req.end();
    };

    doOne(current, false);
  });
}

function findUrlDeep(node) {
  if (typeof node === "string" && (node.includes("evo-games.com") || node.includes("/entry") || node.includes("http"))) {
    if (node.includes("evo") || node.includes("entry") || node.includes("a8r") || node.includes("launcher")) {
      return node;
    }
  }
  if (!node || typeof node !== "object") return null;
  for (const v of Object.values(node)) {
    const f = findUrlDeep(v);
    if (f) return f;
  }
  return null;
}

/**
 * Tenta endpoints de /play Blaze.
 * @param {string} blazeToken
 * @param {string|null} preferredSlug 'bac-bo' | 'bac-bo-ao-vivo'
 */
async function blazePlay(blazeToken, preferredSlug = null) {
  // Sala normal: BacBo00000000001 | Ao vivo: PorBacBo00000001
  const all = [
    {
      url: "https://blaze.bet.br/api/games/bac-bo/play",
      referer: "https://blaze.bet.br/pt/games/bac-bo",
      label: "bac-bo",
    },
    {
      url: "https://blaze.bet.br/api/games/bac-bo-ao-vivo/play",
      referer: "https://blaze.bet.br/pt/games/bac-bo-ao-vivo",
      label: "bac-bo-ao-vivo",
    },
    {
      url: "https://blaze.bet.br/api/game/bac-bo/play",
      referer: "https://blaze.bet.br/pt/games/bac-bo",
      label: "game/bac-bo",
    },
  ];
  let endpoints = all;
  const pref = preferredSlug ? String(preferredSlug).replace(/^\/+|\/+$/g, "") : "";
  if (pref === "bac-bo-ao-vivo") {
    endpoints = [all[1], all[0], all[2]];
  } else if (pref === "bac-bo") {
    endpoints = [all[0], all[1], all[2]];
  }

  logBridge("blazePlay", { preferredSlug: pref || null, order: endpoints.map((e) => e.label) });

  let last = null;
  for (const ep of endpoints) {
    try {
      const res = await httpRequest(ep.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${blazeToken}`,
          "Content-Type": "application/json;charset=UTF-8",
          Origin: "https://blaze.bet.br",
          Referer: ep.referer,
          "x-client-language": "pt",
          "x-client-version": "v2.1583.0",
        },
        body: JSON.stringify({ selected_currency_type: "BRL" }),
        maxRedirects: 0,
      });
      let data = {};
      try {
        data = JSON.parse(res.body);
      } catch {
        data = { raw: String(res.body).slice(0, 400) };
      }
      const launchUrl =
        data.game_url ||
        data.url ||
        data.launch_url ||
        data.gameUrl ||
        (data.launch_options && (data.launch_options.game_url || data.launch_options.url)) ||
        (data.data && (data.data.game_url || data.data.url || data.data.launch_url)) ||
        findUrlDeep(data);

      last = { status: res.status, data, launchUrl, endpoint: ep.label };
      logBridge("blazePlay hop", {
        endpoint: ep.label,
        status: res.status,
        hasLaunch: !!launchUrl,
      });
      if (launchUrl && res.status < 400) {
        return last;
      }
    } catch (e) {
      last = { status: 0, data: { error: e.message }, launchUrl: null, endpoint: ep.label };
      logBridge("blazePlay hop error", { endpoint: ep.label, error: e.message });
    }
  }
  return last || { status: 0, data: {}, launchUrl: null, endpoint: null };
}

function parseEvoFromUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string") return null;
  try {
    const u = new URL(urlStr);
    const evo =
      u.searchParams.get("EVOSESSIONID") ||
      (urlStr.match(/EVOSESSIONID=([a-zA-Z0-9._-]+)/) || [])[1] ||
      null;
    const jsid = u.searchParams.get("JSESSIONID");
    let tableId = u.searchParams.get("table_id") || null;
    let vtId = u.searchParams.get("vt_id") || u.searchParams.get("tableConfig") || null;
    const paramsB64 = u.searchParams.get("params");
    if (paramsB64) {
      try {
        const decoded = Buffer.from(paramsB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
        const mTable = decoded.match(/table_id=([^\n\r&]+)/);
        const mVt = decoded.match(/vt_id=([^\n\r&]+)/);
        const mGame = decoded.match(/game=([^\n\r&]+)/);
        if (mTable) tableId = mTable[1].trim();
        if (mVt) vtId = mVt[1].trim();
        // game=bacbo sem table → ao vivo Python
        if (!tableId && mGame && /bacbo/i.test(mGame[1])) {
          tableId = DEFAULT_TABLE;
        }
      } catch {
        /* ignore */
      }
    }
    // path do WS às vezes embute table
    const mPath = urlStr.match(/\/game\/([A-Za-z0-9_]+)\//);
    if (mPath && !tableId) tableId = mPath[1];

    return {
      evoSessionId: evo,
      jsessionId: jsid,
      tableId: tableId || DEFAULT_TABLE,
      vtId: vtId || DEFAULT_VT,
      entryUrl: urlStr,
      params: paramsB64 || null,
    };
  } catch {
    return null;
  }
}

function extractEvoFromText(text) {
  if (!text) return null;
  const m = String(text).match(/EVOSESSIONID=([a-zA-Z0-9._-]{40,})/i);
  return m ? m[1] : null;
}

/**
 * Só a URL de entrada da Evolution (login Blaze + montar /entry), SEM seguir
 * os redirects — usada pelo bridge de dispositivo (celular do cliente): o
 * navegador real do celular é quem navega essa URL e segue os redirects
 * sozinho, do IP dele, evitando o bloqueio Akamai que a VPS toma no WS.
 */
async function getEntryUrl(blazeToken, preferredSlug = null) {
  const play = await blazePlay(blazeToken, preferredSlug);
  const launchUrl = play && play.launchUrl;
  if (!launchUrl) {
    return {
      ok: false,
      error: "Blaze não retornou launchUrl (verifique o token/plano).",
      blazeStatus: play ? play.status : null,
    };
  }

  const parsed0 = parseEvoFromUrl(launchUrl);

  // launchUrl já traz um EVOSESSIONID utilizável — pula /entry, vai direto
  // pro fragmento do frontend (mesmo destino que /entry redirecionaria).
  if (parsed0 && parsed0.evoSessionId && parsed0.evoSessionId.length >= 55) {
    const entryUrl =
      `https://${EVO_HOST}/frontend/evo/r2/#provider=evolution` +
      `&EVOSESSIONID=${encodeURIComponent(parsed0.evoSessionId)}`;
    return {
      ok: true,
      entryUrl,
      tableId: parsed0.tableId || DEFAULT_TABLE,
      vtId: parsed0.vtId || DEFAULT_VT,
      source: "launch-url",
    };
  }

  let entryUrl = launchUrl;
  if (parsed0 && parsed0.jsessionId && parsed0.params) {
    entryUrl =
      `https://${EVO_HOST}/entry?JSESSIONID=${encodeURIComponent(parsed0.jsessionId)}` +
      `&params=${encodeURIComponent(parsed0.params)}`;
  }

  return {
    ok: true,
    entryUrl,
    tableId: (parsed0 && parsed0.tableId) || DEFAULT_TABLE,
    vtId: (parsed0 && parsed0.vtId) || DEFAULT_VT,
    source: "entry-url",
  };
}

/**
 * Descobre IP de saída (via proxy Evolution, se ativo). Best-effort — não bloqueia aposta.
 * Útil pra ver se SOCKS/túnel/mobile realmente saiu do IP da VPS.
 */
async function probeExitIp() {
  const targets = [
    "https://api.ipify.org?format=json",
    "https://ifconfig.me/ip",
  ];
  for (const url of targets) {
    try {
      const res = await httpRequest(url, {
        method: "GET",
        maxRedirects: 1,
        timeout: 8000,
        // força agent do proxy se existir (mesmo host não-evo: para diagnóstico de saída)
        forceProxy: true,
      });
      if (res.status >= 200 && res.status < 300 && res.body) {
        const raw = String(res.body).trim();
        try {
          const j = JSON.parse(raw);
          if (j && j.ip) return { ip: String(j.ip), via: url };
        } catch {
          /* plain text */
        }
        const m = raw.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
        if (m) return { ip: m[1], via: url };
      }
    } catch (e) {
      /* tenta próximo */
    }
  }
  return { ip: null, via: null, error: "probe-exit-ip falhou" };
}

/**
 * Fluxo Python:
 *   GET /entry?JSESSIONID&params  (allow_redirects=False)
 *   Location → GET com redirects
 *   EVOSESSIONID em response3.url / cookies
 */
async function followToEvoSession(launchUrl) {
  let evoSessionId = null;
  let jsessionId = null;
  let tableId = DEFAULT_TABLE;
  let vtId = DEFAULT_VT;
  let cookies = "";
  let hops = [];
  let finalUrl = launchUrl;
  const t0 = Date.now();

  logBridge("followToEvo INÍCIO", {
    launchHint: String(launchUrl || "").slice(0, 100),
    proxyOn: !!proxyUrlActive,
  });

  const parsed0 = parseEvoFromUrl(launchUrl);
  if (parsed0) {
    if (parsed0.evoSessionId) evoSessionId = parsed0.evoSessionId;
    if (parsed0.jsessionId) jsessionId = parsed0.jsessionId;
    if (parsed0.tableId) tableId = parsed0.tableId;
    if (parsed0.vtId) vtId = parsed0.vtId;
  }

  // Se já veio EVOSESSIONID na URL de launch, usa
  if (evoSessionId && evoSessionId.length >= 55) {
    cookies = `EVOSESSIONID=${evoSessionId}` + (jsessionId ? `; JSESSIONID=${jsessionId}` : "");
    logBridge("followToEvo OK (launch-url)", {
      ms: Date.now() - t0,
      tableId,
      evoHint: evoSessionId.slice(0, 12) + "…",
    });
    return { evoSessionId, jsessionId, tableId, vtId, cookies, launchUrl, finalUrl, hops, source: "launch-url" };
  }

  // Monta URL de entry canônica (como Python)
  let entryUrl = launchUrl;
  if (jsessionId && parsed0 && parsed0.params) {
    entryUrl =
      `https://${EVO_HOST}/entry?JSESSIONID=${encodeURIComponent(jsessionId)}` +
      `&params=${encodeURIComponent(parsed0.params)}`;
  } else if (launchUrl.includes("/entry")) {
    entryUrl = launchUrl;
  }

  const evoHeaders = {
    Origin: "https://blaze.bet.br",
    Referer: "https://blaze.bet.br/pt/games/bac-bo",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
    "Upgrade-Insecure-Requests": "1",
    "sec-ch-ua": SEC_CH_UA,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
  };

  // Hop 1: entry SEM seguir redirect (Python allow_redirects=False)
  let res1;
  try {
    res1 = await httpRequest(entryUrl, {
      method: "GET",
      headers: evoHeaders,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      maxRedirects: 0,
      cookieJar: cookies,
    });
  } catch (e) {
    logBridge("followToEvo entry ERRO", { error: e.message, ms: Date.now() - t0 });
    return {
      evoSessionId: null,
      jsessionId,
      tableId,
      vtId,
      cookies,
      launchUrl,
      finalUrl,
      hops: [{ error: e.message, step: "entry" }],
      source: "http",
    };
  }
  cookies = res1.cookieJar || cookies;
  hops.push({
    step: "entry",
    status: res1.status,
    url: entryUrl.slice(0, 100),
    loc: (res1.location || "").slice(0, 120),
    bodySample:
      res1.status === 403 || res1.status === 401 ? String(res1.body || "").slice(0, 180) : undefined,
  });
  logBridge("followToEvo hop entry", {
    status: res1.status,
    hasLoc: !!(res1.location),
    locHint: String(res1.location || "").slice(0, 80),
    bodyHint:
      res1.status === 403 || res1.status === 401
        ? String(res1.body || "").replace(/\s+/g, " ").slice(0, 100)
        : undefined,
  });

  // Bloqueio Akamai no primeiro hop — não adianta seguir
  if (res1.status === 403 || (res1.status === 401 && /Access Denied|akamai/i.test(String(res1.body || "")))) {
    hops.push({
      step: "blocked",
      status: res1.status,
      bodySample: String(res1.body || "").slice(0, 180),
    });
    logBridge("followToEvo AKAMAI no /entry", {
      status: res1.status,
      ms: Date.now() - t0,
      proxyOn: !!proxyUrlActive,
    });
    return {
      evoSessionId: null,
      jsessionId,
      tableId,
      vtId,
      cookies,
      launchUrl,
      finalUrl,
      hops,
      source: "http-akamai",
      akamaiBlocked: true,
    };
  }

  const evoCookie1 = cookieValue(cookies, "EVOSESSIONID");
  if (evoCookie1 && evoCookie1.length >= 40) evoSessionId = evoCookie1;
  let fromLoc = extractEvoFromText(res1.location || "");
  if (fromLoc) evoSessionId = fromLoc;
  fromLoc = extractEvoFromText(res1.body || "");
  if (fromLoc) evoSessionId = fromLoc;

  // Hop 2+: segue Location com cookie jar (Python allow_redirects=True)
  let next = res1.location;
  if (next && next.startsWith("/")) {
    next = `https://${EVO_HOST}${next}`;
  }
  if (!next && res1.status >= 200 && res1.status < 300) {
    // às vezes o body já tem redirect meta/js
    const mUrl = (res1.body || "").match(/https?:\/\/[^"'\\\s]*EVOSESSIONID=[a-zA-Z0-9._-]+[^"'\\\s]*/i);
    if (mUrl) next = mUrl[0];
  }

  for (let i = 0; i < 8 && next; i++) {
    finalUrl = next;
    const pLoc = parseEvoFromUrl(next);
    if (pLoc) {
      if (pLoc.evoSessionId) evoSessionId = pLoc.evoSessionId;
      if (pLoc.jsessionId) jsessionId = pLoc.jsessionId;
      if (pLoc.tableId) tableId = pLoc.tableId;
      if (pLoc.vtId) vtId = pLoc.vtId;
    }
    if (evoSessionId && evoSessionId.length >= 55 && String(next).includes("EVOSESSIONID=")) {
      hops.push({ step: "found-in-url", url: next.slice(0, 120) });
      break;
    }

    let resN;
    try {
      resN = await httpRequest(next, {
        method: "GET",
        headers: {
          ...evoHeaders,
          Origin: `https://${EVO_HOST}`,
          Referer: entryUrl,
        },
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        maxRedirects: 0,
        cookieJar: cookies,
      });
    } catch (e) {
      hops.push({ step: "follow", error: e.message, url: next.slice(0, 100) });
      break;
    }
    cookies = resN.cookieJar || cookies;
    hops.push({
      step: "follow",
      status: resN.status,
      url: next.slice(0, 100),
      loc: (resN.location || "").slice(0, 120),
    });

    const evoC = cookieValue(cookies, "EVOSESSIONID");
    if (evoC && evoC.length >= 40) evoSessionId = evoC;
    const evoB = extractEvoFromText(resN.body || "");
    if (evoB) evoSessionId = evoB;
    const evoL = extractEvoFromText(resN.location || "");
    if (evoL) evoSessionId = evoL;
    const evoU = extractEvoFromText(resN.finalUrl || "");
    if (evoU) evoSessionId = evoU;

    if (evoSessionId && evoSessionId.length >= 55) break;

    if (resN.status === 403 || resN.status === 401) {
      hops.push({
        step: "blocked",
        status: resN.status,
        bodySample: String(resN.body || "").slice(0, 180),
      });
      break;
    }

    next = resN.location;
    if (next && next.startsWith("/")) next = `https://${EVO_HOST}${next}`;
    if (!next) {
      const mUrl = (resN.body || "").match(/https?:\/\/[^"'\\\s]*EVOSESSIONID=[a-zA-Z0-9._-]+[^"'\\\s]*/i);
      if (mUrl) next = mUrl[0];
    }
  }

  // Se Location do 302 já tinha EVO e não pegamos body
  if ((!evoSessionId || evoSessionId.length < 40) && res1.location) {
    const m = extractEvoFromText(res1.location);
    if (m) evoSessionId = m;
  }

  // EVOSESSIONID real costuma ser bem mais longo que o JSESSIONID.
  if (evoSessionId && (evoSessionId.length < 40 || (jsessionId && evoSessionId === jsessionId))) {
    evoSessionId = null;
  }

  // Garante cookie EVOSESSIONID no jar (Python usa na URL do WS)
  if (evoSessionId) {
    const has = cookieValue(cookies, "EVOSESSIONID");
    if (!has || has.length < 20) {
      cookies = mergeCookieJar(cookies, [`EVOSESSIONID=${evoSessionId}`]);
    }
    if (jsessionId && !cookieValue(cookies, "JSESSIONID")) {
      cookies = mergeCookieJar(cookies, [`JSESSIONID=${jsessionId}`]);
    }
  }

  logBridge("followToEvo FIM", {
    ms: Date.now() - t0,
    ok: !!(evoSessionId && evoSessionId.length >= 40),
    evoHint: evoSessionId ? evoSessionId.slice(0, 12) + "…" : null,
    tableId: tableId || DEFAULT_TABLE,
    hopCount: hops.length,
    hopSummary: hops
      .map((h) => (h.step || "?") + "=" + (h.status != null ? h.status : h.error || "?"))
      .slice(0, 8)
      .join(" · "),
  });

  return {
    evoSessionId,
    jsessionId,
    tableId: tableId || DEFAULT_TABLE,
    vtId: vtId || DEFAULT_VT,
    cookies,
    launchUrl,
    finalUrl,
    hops,
    source: "http-redirect",
  };
}

/**
 * Valida sessão abrindo WS por ~2s e vendo se recebe playerState.
 */
function probeWsSession(session, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const tableId = session.tableId || DEFAULT_TABLE;
    const vtId = session.vtId || DEFAULT_VT;
    const evo = session.evoSessionId;
    if (!evo) {
      resolve({ ok: false, error: "sem evoSessionId" });
      return;
    }
    const instance = buildInstance(evo, vtId, session.userId || "p");
    const wsUrl = buildWsUrl(tableId, vtId, evo, instance);

    let settled = false;
    let gotState = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* */
      }
      resolve(r);
    };
    const timer = setTimeout(() => {
      finish({ ok: gotState, error: gotState ? null : "timeout sem playerState", gotState });
    }, timeoutMs);

    let ws;
    try {
      ws = new WebSocket(wsUrl, {
        headers: {
          Origin: `https://${EVO_HOST}`,
          Referer: FRONTEND_REF,
          "User-Agent": UA,
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          "sec-ch-ua": SEC_CH_UA,
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          Cookie: browserStyleCookie(session.cookies, evo),
        },
        handshakeTimeout: 10000,
        perMessageDeflate: true,
        ...(proxyAgent ? { agent: proxyAgent } : {}),
      });
    } catch (e) {
      clearTimeout(timer);
      finish({ ok: false, error: e.message });
      return;
    }

    ws.on("open", () => {
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
      } catch {
        /* */
      }
    });

    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data && (data.type === "bacbo.playerState" || data.type === "connection.kickout" || data.args)) {
          if (data.type === "connection.kickout") {
            clearTimeout(timer);
            finish({ ok: false, error: "kickout: " + JSON.stringify(data.args || data).slice(0, 120) });
            return;
          }
          if (data.type === "bacbo.playerState") {
            gotState = true;
            clearTimeout(timer);
            finish({ ok: true, stage: (data.args && data.args.game && data.args.game.stage) || null });
          }
        }
      } catch {
        /* */
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      const msg = err && err.message ? err.message : String(err);
      finish({
        ok: false,
        error: "WS probe: " + msg,
        code: /403|Unexpected server response: 4/i.test(msg) ? "AKAMAI_BLOCKED" : undefined,
      });
    });

    ws.on("close", () => {
      if (!settled) {
        clearTimeout(timer);
        finish({ ok: gotState, gotState, error: gotState ? null : "WS fechou no probe" });
      }
    });
  });
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.force]  ignora cache e pede /play novo (aposta REAL exclusiva)
 * @param {boolean} [opts.forBet] marca sessão como exclusiveBet (feed não deve roubar)
 */
async function ensureSession(userId, blazeToken, launchUrlHint, opts = {}) {
  const startedAt = Date.now();
  if (opts && opts.proxyUrl !== undefined) setProxyUrl(opts.proxyUrl);
  let result;
  try {
    result = await ensureSessionCore(userId, blazeToken, launchUrlHint, opts);
  } catch (e) {
    result = { ok: false, error: "ensureSession exception: " + (e && e.message ? e.message : String(e)) };
  }
  logBridge("ensure-session FIM", {
    userId,
    force: !!(opts && opts.force),
    forBet: !!(opts && opts.forBet),
    preferredSlug: opts.preferredSlug || null,
    ms: Date.now() - startedAt,
    ok: !!result.ok,
    code: result.code || null,
    error: result.error ? String(result.error).slice(0, 180) : null,
    source: result.source || null,
    tableId: result.tableId || null,
    playEndpoint: result.playEndpoint || result.play?.endpoint || null,
  });
  appendAttemptLog({
    at: new Date().toISOString(),
    userId,
    action: "ensure-session",
    force: !!(opts && opts.force),
    forBet: !!(opts && opts.forBet),
    preferredSlug: opts.preferredSlug || null,
    ms: Date.now() - startedAt,
    ok: result.ok,
    error: result.error || null,
    code: result.code || null,
    source: result.source || null,
    tableId: result.tableId || null,
    vtId: result.vtId || null,
    probeOk: result.probeOk,
    playStatus: result.playStatus,
    playEndpoint: result.playEndpoint,
    playKeys: result.playKeys,
    hops: result.hops || undefined,
    proxyConfigured: !!proxyUrlActive,
    proxyHint: proxyUrlActive ? proxyUrlActive.replace(/:[^:@/]+@/, ":***@") : null,
  });
  return result;
}

async function ensureSessionCore(userId, blazeToken, launchUrlHint, opts = {}) {
  const force = !!(opts && opts.force);
  const forBet = !!(opts && opts.forBet);
  const preferredSlug = opts.preferredSlug || null;

  logBridge("ensure-session INÍCIO", {
    userId,
    force,
    forBet,
    preferredSlug,
    hasLaunchHint: !!(launchUrlHint && String(launchUrlHint).length > 20),
    hasToken: !!(blazeToken && String(blazeToken).length > 10),
  });

  // Env global (dev/debug) — NÃO usar para aposta se force/forBet (evita compartilhar com feed)
  if (process.env.BACBO_EVOSESSIONID && !force && !forBet) {
    const evoSessionId = process.env.BACBO_EVOSESSIONID.trim();
    const tableId = process.env.BACBO_TABLE_ID || DEFAULT_TABLE;
    const vtId = process.env.BACBO_VT_ID || DEFAULT_VT;
    writeSession(userId, {
      blazeTokenHint: blazeToken ? blazeToken.slice(0, 12) + "…" : "",
      launchUrl: launchUrlHint || null,
      tableId,
      vtId,
      evoSessionId,
      cookies: process.env.BACBO_EVO_COOKIES || `EVOSESSIONID=${evoSessionId}`,
      source: "env",
      exclusiveBet: false,
    });
    return { ok: true, tableId, vtId, evoSessionId: evoSessionId.slice(0, 12) + "…", source: "env" };
  }

  // Cache por usuário — NUNCA em force/forBet (aposta precisa de WS exclusivo)
  if (!force && !forBet) {
    const existing = readSession(userId);
    if (existing && existing.evoSessionId && existing.evoSessionId.length >= 40) {
      const ageMs = existing.updatedAt ? Date.now() - Date.parse(existing.updatedAt) : 99999999;
      if (ageMs < 6 * 60 * 1000 && existing.source !== "chrome" && existing.source !== "http-failed") {
        return {
          ok: true,
          tableId: existing.tableId || DEFAULT_TABLE,
          vtId: existing.vtId || DEFAULT_VT,
          evoSessionId: existing.evoSessionId.slice(0, 12) + "…",
          source: "cache",
        };
      }
    }
  } else {
    // aposta: descarta sessão antiga para não herdar WS já ocupado
    clearSession(userId);
  }

  // force/forBet: sempre /play fresco (launchUrl hint costuma estar expirado/ocupado)
  let launchUrl = force || forBet ? null : launchUrlHint || null;
  let playMeta = null;
  if (!launchUrl) {
    if (!blazeToken) {
      return { ok: false, error: "blazeToken obrigatório para obter sessão Evolution (multi-usuário)." };
    }
    const play = await blazePlay(blazeToken, preferredSlug);
    playMeta = { status: play.status, endpoint: play.endpoint };
    if (play.status >= 400) {
      return {
        ok: false,
        error: `Blaze /play falhou HTTP ${play.status} (${play.endpoint || "?"})`,
        detail: typeof play.data === "object" ? play.data : String(play.data).slice(0, 200),
      };
    }
    launchUrl = play.launchUrl;
    if (!launchUrl) {
      return {
        ok: false,
        error: "Resposta /play sem URL de launch Evolution. Verifique token e se o jogo está liberado.",
        playStatus: play.status,
        playEndpoint: play.endpoint,
        playKeys: play.data && typeof play.data === "object" ? Object.keys(play.data) : [],
      };
    }
  }

  // HTTP + redirects (como Python) — SEM Chrome
  const evo = await followToEvoSession(launchUrl);

  if (!evo.evoSessionId || evo.evoSessionId.length < 40) {
    writeSession(userId, {
      blazeTokenHint: blazeToken ? blazeToken.slice(0, 12) + "…" : "",
      launchUrl,
      tableId: evo.tableId || DEFAULT_TABLE,
      vtId: evo.vtId || DEFAULT_VT,
      evoSessionId: null,
      cookies: evo.cookies || "",
      hops: evo.hops || [],
      source: "http-failed",
      proxyConfigured: !!proxyUrlActive,
    });
    if (evo.akamaiBlocked || hopsLookLikeAkamai(evo.hops)) {
      return akamaiBlockedError(evo.hops, {
        launchUrl: String(launchUrl).slice(0, 140) + "…",
        play: playMeta,
        source: evo.source || "http-redirect",
      });
    }
    return {
      ok: false,
      code: "EVO_SESSION_MISSING",
      error:
        "Não foi possível obter EVOSESSIONID via HTTP/redirect. " +
        "Token Blaze ok — confira se o jogo está liberado e se o proxy (Admin → Proxy) passa no teste da Evolution.",
      launchUrl: String(launchUrl).slice(0, 140) + "…",
      hops: evo.hops || [],
      play: playMeta,
      source: "http-redirect",
      proxyConfigured: !!proxyUrlActive,
    };
  }

  const sessionData = {
    blazeTokenHint: blazeToken ? blazeToken.slice(0, 12) + "…" : "",
    launchUrl,
    tableId: evo.tableId || DEFAULT_TABLE,
    vtId: evo.vtId || DEFAULT_VT,
    evoSessionId: evo.evoSessionId,
    jsessionId: evo.jsessionId || null,
    cookies: evo.cookies || "",
    source: evo.source || "http-redirect",
    hops: evo.hops || [],
    userId: Number(userId),
    exclusiveBet: forBet || force,
  };

  // Handshake igual ao browser: /setup + /style + /config (captura real)
  try {
    const warm = await warmEvoClient(sessionData);
    sessionData.warm = warm.steps || [];
    if (warm.cookies) sessionData.cookies = warm.cookies;
    logBridge("ensure-session warm", {
      userId,
      ok: !!warm.ok,
      steps: (warm.steps || [])
        .map((s) => s.name + "=" + (s.status != null ? s.status : s.error || "?"))
        .join(" · "),
    });
  } catch (eWarm) {
    logBridge("ensure-session warm erro", { userId, error: eWarm.message });
  }

  // Probe WS: NÃO rodar em forBet/force de aposta.
  // Evolution = 1 WS por EVOSESSIONID. Abrir probe e fechar antes do place-bet
  // gasta a janela, atrasa ~4s e às vezes deixa a 2ª conexão com kickout /
  // connectionAlreadyExists. Na aposta REAL o connectAndBet já valida o WS.
  if (!forBet && !force) {
    const probe = await probeWsSession({ ...sessionData, userId }, 4500);
    if (!probe.ok) {
      const altTables = [
        { tableId: evo.tableId, vtId: evo.vtId },
        { tableId: DEFAULT_TABLE, vtId: DEFAULT_VT },
        { tableId: FALLBACK_TABLE, vtId: FALLBACK_VT },
      ];
      let probed = false;
      for (const alt of altTables) {
        if (!alt.tableId) continue;
        const p = await probeWsSession(
          {
            ...sessionData,
            tableId: alt.tableId,
            vtId: alt.vtId,
            userId,
          },
          4000
        );
        if (p.ok) {
          sessionData.tableId = alt.tableId;
          sessionData.vtId = alt.vtId;
          probed = true;
          break;
        }
      }
      if (!probed) {
        sessionData.probeError = probe.error || "probe falhou";
      }
    }
  } else {
    sessionData.probeSkipped = "forBet";
  }

  writeSession(userId, sessionData);

  return {
    ok: true,
    tableId: sessionData.tableId,
    vtId: sessionData.vtId,
    evoSessionId: evo.evoSessionId.slice(0, 12) + "…",
    source: sessionData.source,
    probeOk: !sessionData.probeError,
  };
}

function spotToMap(spot, amount, protectionAmount) {
  const s = String(spot || "PLAYER").toUpperCase();
  const map = { player: 0, tie: 0, banker: 0 };
  const actions = [];
  const entries = [];

  if (s === "EMPATE" || s === "TIE") {
    map.tie = amount;
    entries.push({ to: "Tie", amount });
  } else if (s === "BANKER" || s === "BANK") {
    map.banker = amount;
    entries.push({ to: "Banker", amount });
  } else {
    map.player = amount;
    entries.push({ to: "Player", amount });
  }

  if (protectionAmount > 0 && s !== "EMPATE" && s !== "TIE") {
    map.tie = protectionAmount;
    entries.push({ to: "Tie", amount: protectionAmount });
  }

  actions.push({ from: "Chipstack", entries });
  return { betMap: map, actions };
}

function randId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 10; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/** Tags capturadas no browser real (Chrome 150 / bac-bo). */
function defaultBetTags() {
  return {
    mwLayout: "8",
    openMwTables: "1",
    latency: String(150 + Math.floor(Math.random() * 120)),
    videoProtocol: "fmp4",
    btVideoQuality: "9",
    btTableView: "0",
    orientation: "landscape",
  };
}

/**
 * Protocolo real da sala (captura browser):
 *   type: "bacbo.bet"
 *   args.betMap + args.actions (Chipstack → Player|Banker|Tie)
 */
function buildBetMessage(gameId, spot, amount, protectionAmount) {
  const { betMap, actions } = spotToMap(spot, amount, protectionAmount);
  return {
    id: randId(),
    type: "bacbo.bet",
    args: {
      gameId,
      betTags: defaultBetTags(),
      betMap,
      actions,
    },
  };
}

function isBusyStage(stage) {
  const s = String(stage || "");
  return (
    s === "Confirmation" ||
    s === "ClosingBets" ||
    s === "BetsClosed" ||
    s === "Resolved" ||
    s === "Settled" ||
    s === "GameResolved" ||
    s === "Result" ||
    s === "DiceThrown" ||
    s === "Dealing" ||
    s.includes("Confirm") ||
    s.includes("Result") ||
    s.includes("Clos")
  );
}

function isOpenStage(stage) {
  const s = String(stage || "");
  // Python usa WaitingForBets; captura recente também AcceptingBets
  return (
    s === "AcceptingBets" ||
    s === "WaitingForBets" ||
    s === "BetsOpen" ||
    s === "PlaceYourBets" ||
    s === "BetsOpened"
  );
}

/**
 * Conecta no WS e aposta na PRIMEIRA janela aberta (AcceptingBets / WaitingForBets).
 *
 * TipMiner publica o resultado ANTES da mesa — quando o bot recebe o sinal e
 * conecta, a próxima janela aberta já é a rodada correta. NÃO pular a 1ª
 * janela (isso atrasava 1 rodada inteira = "entrando atrasado").
 *
 * Se ao conectar a mesa ainda estiver em Resolved/Closing/…, espera a abertura.
 */
function connectAndBet(session, spot, amount, protectionAmount, timeoutMs) {
  // Somente HTTPS + WebSocket puro (sem Chrome/puppeteer)
  return connectAndBetViaWs(session, spot, amount, protectionAmount, timeoutMs);
}

function connectAndBetViaWs(session, spot, amount, protectionAmount, timeoutMs) {
  return new Promise((resolve) => {
    const tableId = session.tableId || DEFAULT_TABLE;
    const vtId = session.vtId || DEFAULT_VT;
    const evo = session.evoSessionId;
    const instance = buildInstance(evo, vtId, session.userId);
    const wsUrl = buildWsUrl(tableId, vtId, evo, instance);
    const userIdHint = session.userId != null ? session.userId : null;

    logBridge("connectAndBet INÍCIO", {
      userId: userIdHint,
      tableId,
      vtId,
      spot,
      amount,
      protectionAmount: protectionAmount || 0,
      timeoutMs,
      proxyOn: !!proxyAgent,
      evoHint: evo ? String(evo).slice(0, 12) + "…" : null,
    });

    let settled = false;
    let currentGameId = null;
    let betSent = false;
    let lastStage = null;
    let lastServerTime = null;
    let betProtocol = null;

    // Timeline da tentativa — para diagnosticar exatamente onde travou
    // (nunca abriu WS, mesa nunca abriu janela, aposta enviada mas sem
    // confirmação, kickout/sessão ocupada, etc). Vai junto no resultado
    // final e é gravado em storage/bacbo-evo/attempts.log.
    const events = [];
    const track = (type, extra = {}) => {
      events.push({ t: Date.now(), type, ...extra });
      // só marcos importantes no log legível (evita spam de stage a cada tick)
      if (
        type === "ws-open" ||
        type === "bet-sent" ||
        type === "bet-confirmed" ||
        type === "bet-send-failed" ||
        type === "connection-already-exists" ||
        type === "kickout" ||
        type === "ws-error" ||
        type === "ws-close" ||
        type === "timeout" ||
        (type === "stage" && extra && extra.stage && isOpenStage(extra.stage))
      ) {
        logBridge("connectAndBet " + type, { userId: userIdHint, tableId, ...extra });
      }
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* */
      }
      resolve({ ...result, events });
    };

    const timer = setTimeout(() => {
      track("timeout", { lastStage, betSent });
      finish({
        ok: false,
        error:
          "Timeout aguardando janela de apostas aberta na mesa (WaitingForBets/AcceptingBets). " +
          "Feche o Bac Bo no browser se estiver aberto (1 WS por sessão).",
        lastStage,
        betSent,
        gameId: currentGameId,
        tableId,
      });
    }, timeoutMs);

    const ws = new WebSocket(wsUrl, {
      headers: {
        Origin: `https://${EVO_HOST}`,
        Referer: FRONTEND_REF,
        "User-Agent": UA,
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "sec-ch-ua": SEC_CH_UA,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        Cookie: browserStyleCookie(session.cookies, evo),
      },
      handshakeTimeout: 15000,
      perMessageDeflate: true,
      ...(proxyAgent ? { agent: proxyAgent } : {}),
    });

    ws.on("open", () => {
      track("ws-open");
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
      } catch {
        /* */
      }
    });

    ws.on("message", (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!data || typeof data !== "object") return;

      if (data.time != null) lastServerTime = data.time;

      // Sessão já usada pelo browser/outra aba (singleConnectionPerSession)
      if (data.subscribe && data.subscribe.status === "connectionAlreadyExists") {
        track("connection-already-exists", { channel: data.subscribe.channel || null });
        clearTimeout(timer);
        finish({
          ok: false,
          error:
            "EVOSESSIONID já em uso (browser/outra conexão aberta na mesa). " +
            "Feche o Bac Bo no site ou renove a sessão — Evolution permite 1 WS por sessão.",
          code: "connectionAlreadyExists",
          tableId,
          channel: data.subscribe.channel || null,
        });
        return;
      }

      if (data.type === "connection.kickout" || data.type === "connection.error") {
        track("kickout", { type: data.type, args: JSON.stringify(data.args || data).slice(0, 160) });
        clearTimeout(timer);
        finish({
          ok: false,
          error: "Sessão Evolution rejeitada: " + JSON.stringify(data.args || data).slice(0, 160),
          tableId,
        });
        return;
      }

      if (data.type === "bacbo.playerState") {
        const game = (data.args && data.args.game) || {};
        const gid = game.gameId || game.id || null;
        if (gid) currentGameId = gid;
        if (game.stage && game.stage !== lastStage) {
          track("stage", { stage: game.stage, gameId: gid });
        }
        lastStage = game.stage || lastStage;
        appendWsResult(game);

        const received = (game.receivedBets && game.receivedBets.validBets) || [];
        if (betSent && Array.isArray(received) && received.length > 0) {
          track("bet-confirmed", { via: "receivedBets", stage: lastStage });
          clearTimeout(timer);
          finish({
            ok: true,
            confirmed: true,
            stage: lastStage,
            gameId: currentGameId,
            validBets: received,
            tableId,
            protocol: betProtocol,
            waitedForWindow: true,
          });
          return;
        }

        const open = isOpenStage(game.stage);

        // Primeira janela aberta = aposta já (não espera pular rodada)
        if (open && !betSent && currentGameId) {
          try {
            const msg = buildBetMessage(currentGameId, spot, amount, protectionAmount || 0);
            ws.send(JSON.stringify(msg));
            betProtocol = "bacbo.bet";
            betSent = true;
            track("bet-sent", { gameId: currentGameId, spot, amount, protectionAmount: protectionAmount || 0 });
          } catch (e) {
            track("bet-send-failed", { error: e.message });
            clearTimeout(timer);
            finish({ ok: false, error: "Falha ao enviar aposta: " + e.message });
          }
        }

        if (betSent && (game.stage === "ClosingBets" || game.stage === "BetsClosed")) {
          const last = game.lastGameBets || [];
          if (Array.isArray(last) && last.length > 0) {
            track("bet-confirmed", { via: "lastGameBets", stage: lastStage });
            clearTimeout(timer);
            finish({
              ok: true,
              confirmed: true,
              via: "lastGameBets",
              stage: lastStage,
              gameId: currentGameId,
              validBets: last,
              tableId,
              protocol: betProtocol,
              waitedForWindow: true,
            });
          }
        }
      }
    });

    ws.on("error", (err) => {
      const msg = err && err.message ? err.message : String(err);
      track("ws-error", { message: msg });
      clearTimeout(timer);
      const akamai = /403|Unexpected server response: 4/i.test(msg);
      finish({
        ok: false,
        error: akamai
          ? "WebSocket Evolution bloqueado (HTTP 403/Akamai). Proxy residencial obrigatório em VPS."
          : "WS error: " + msg,
        code: akamai ? "AKAMAI_BLOCKED" : "WS_ERROR",
        tableId,
      });
    });

    ws.on("close", (code, reason) => {
      if (!settled) {
        track("ws-close", { code, reason: reason ? String(reason).slice(0, 120) : null, betSent });
        clearTimeout(timer);
        finish({
          ok: betSent,
          error: betSent
            ? "WS fechou após envio (sem confirmação explícita)"
            : "WS fechou antes da janela de apostas",
          betSent,
          lastStage,
          gameId: currentGameId,
          tableId,
          protocol: betProtocol,
        });
      }
    });
  });
}

async function placeBet(userId, blazeToken, spot, amount, protectionAmount, launchUrl, timeoutMs, opts = {}) {
  const startedAt = Date.now();
  if (opts && opts.proxyUrl !== undefined) setProxyUrl(opts.proxyUrl);
  logBridge("place-bet INÍCIO", {
    userId,
    spot,
    amount,
    protectionAmount: protectionAmount || 0,
    hasLaunchUrl: !!(launchUrl && String(launchUrl).length > 20),
    preferredSlug: opts.preferredSlug || null,
    timeoutMs: timeoutMs || 60000,
  });
  // IP de saída (proxy/túnel) — diagnostica se ainda é o IP da VPS
  let exitIpInfo = null;
  try {
    exitIpInfo = await probeExitIp();
    logBridge("place-bet exit-ip", {
      userId,
      ip: exitIpInfo.ip || null,
      proxyOn: !!proxyUrlActive,
      via: exitIpInfo.via || null,
      error: exitIpInfo.error || null,
    });
  } catch (eIp) {
    logBridge("place-bet exit-ip erro", { userId, error: eIp.message });
  }
  let result;
  try {
    result = await placeBetCore(
      userId,
      blazeToken,
      spot,
      amount,
      protectionAmount,
      launchUrl,
      timeoutMs,
      opts
    );
  } catch (e) {
    result = { ok: false, error: "placeBet exception: " + (e && e.message ? e.message : String(e)) };
  }
  if (exitIpInfo && exitIpInfo.ip && result && typeof result === "object") {
    result.exitIp = exitIpInfo.ip;
  }
  // resumo dos events da timeline (se houver)
  let eventSummary = null;
  if (result && Array.isArray(result.events) && result.events.length) {
    eventSummary = result.events
      .map((ev) => ev.type + (ev.stage ? ":" + ev.stage : ""))
      .slice(0, 12)
      .join(" → ");
  }
  logBridge("place-bet FIM", {
    userId,
    spot,
    amount,
    ms: Date.now() - startedAt,
    ok: !!result.ok,
    code: result.code || null,
    error: result.error ? String(result.error).slice(0, 220) : null,
    confirmed: !!result.confirmed,
    betSent: !!result.betSent,
    tableId: result.tableId || null,
    gameId: result.gameId || null,
    lastStage: result.lastStage || result.stage || null,
    exitIp: exitIpInfo && exitIpInfo.ip ? exitIpInfo.ip : null,
    events: eventSummary,
    lastBalance: result.lastBalance || null,
    validBets: result.validBets || null,
  });
  appendAttemptLog({
    at: new Date().toISOString(),
    userId,
    action: "place-bet",
    spot,
    amount,
    protectionAmount: protectionAmount || 0,
    preferredSlug: opts.preferredSlug || null,
    ms: Date.now() - startedAt,
    ok: result.ok,
    error: result.error || null,
    code: result.code || null,
    confirmed: result.confirmed || false,
    via: result.via || null,
    lastStage: result.lastStage || result.stage || null,
    betSent: result.betSent || false,
    tableId: result.tableId || null,
    gameId: result.gameId || null,
    events: result.events || undefined,
    eventSummary: eventSummary || null,
    exitIp: exitIpInfo && exitIpInfo.ip ? exitIpInfo.ip : null,
    proxyConfigured: !!proxyUrlActive,
    proxyHint: proxyUrlActive ? proxyUrlActive.replace(/:[^:@/]+@/, ":***@") : null,
    lastBalance: result.lastBalance || null,
    validBets: result.validBets || null,
    rawReceivedBets: result.rawReceivedBets || null,
  });
  return result;
}

async function placeBetCore(userId, blazeToken, spot, amount, protectionAmount, launchUrl, timeoutMs, opts = {}) {
  // Aposta REAL = sempre sessão EXCLUSIVA e NOVA (/play).
  // Cache compartilhado + bacbo-ws-feed/browser geravam connectionAlreadyExists.
  // forBet:true → sem probe WS prévio (1 conexão só, a da aposta).
  logBridge("place-bet: ensureSession force+forBet", { userId });
  const ens = await ensureSession(userId, blazeToken, null, {
    force: true,
    forBet: true,
    preferredSlug: opts.preferredSlug || null,
  });
  if (!ens.ok) {
    logBridge("place-bet: ensureSession FALHOU", {
      userId,
      code: ens.code || null,
      error: ens.error ? String(ens.error).slice(0, 200) : null,
      hops: ens.hops || undefined,
      play: ens.play || undefined,
    });
    // Akamai no entry: não adianta retry sem mudar IP/proxy
    if (ens.code === "AKAMAI_BLOCKED") return ens;
    // fallback: tenta launchUrl do PHP uma vez
    if (launchUrl) {
      logBridge("place-bet: retry ensureSession com launchUrl do PHP", { userId });
      const ens2 = await ensureSession(userId, blazeToken, launchUrl, {
        force: true,
        forBet: true,
        preferredSlug: opts.preferredSlug || null,
      });
      if (!ens2.ok) {
        logBridge("place-bet: retry launchUrl FALHOU", {
          userId,
          code: ens2.code || null,
          error: ens2.error ? String(ens2.error).slice(0, 200) : null,
        });
        return ens2;
      }
    } else {
      return ens;
    }
  } else {
    logBridge("place-bet: ensureSession OK", {
      userId,
      tableId: ens.tableId || null,
      source: ens.source || null,
      probeOk: ens.probeOk,
    });
  }

  let session = readSession(userId);
  if (!session || !session.evoSessionId) {
    logBridge("place-bet: sessão ausente após ensure", { userId });
    return {
      ok: false,
      error:
        "Sessão Evolution ausente (HTTP/WS). Token Blaze do usuário precisa abrir /play e entry. Sem navegador.",
    };
  }

  session.userId = userId;
  logBridge("place-bet: connectAndBet", {
    userId,
    tableId: session.tableId || null,
    evoHint: String(session.evoSessionId || "").slice(0, 12) + "…",
    spot,
    amount,
  });
  let result = await connectAndBet(session, spot, amount, protectionAmount || 0, timeoutMs || 60000);

  // Renova com OUTRA sessão exclusiva se ocupada / kickout / timeout
  // (NÃO renova se for Akamai — mesmo IP/proxy vai falhar de novo)
  const errStr = String(result.error || "");
  if (result.code === "AKAMAI_BLOCKED") {
    logBridge("place-bet: WS/entry AKAMAI_BLOCKED", { userId, error: errStr.slice(0, 160) });
    return { ...result, ...akamaiBlockedError(result.hops || [], { tableId: result.tableId }) };
  }
  if (
    !result.ok &&
    (/EVOSESSION|401|403|closed|WS error|kickout|rejeitada|connectionAlreadyExists|Timeout/i.test(errStr) ||
      result.code === "connectionAlreadyExists")
  ) {
    logBridge("place-bet: renew sessão (ocupada/timeout/kick)", {
      userId,
      code: result.code || null,
      error: errStr.slice(0, 160),
    });
    // espera o outro WS soltar (feed/browser) e pede sessão nova
    await new Promise((r) => setTimeout(r, 1500));
    const ensR = await ensureSession(userId, blazeToken, null, {
      force: true,
      forBet: true,
      preferredSlug: opts.preferredSlug || null,
    });
    if (!ensR.ok) return { ...result, renew: ensR };
    session = readSession(userId);
    if (!session || !session.evoSessionId) return { ...result, renew: ensR };
    session.userId = userId;
    result = await connectAndBet(session, spot, amount, protectionAmount || 0, timeoutMs || 60000);
  }

  return result;
}

async function main() {
  let raw = "";
  try {
    raw = await readStdin();
  } catch (e) {
    fail("stdin: " + e.message);
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    fail("JSON inválido no stdin");
    return;
  }

  const action = payload.action || "";
  const userId = Number(payload.userId || 0);
  if (!userId && action !== "ping") {
    fail("userId obrigatório (isolamento multi-usuário)");
    return;
  }

  // Proxy do PHP/Admin tem prioridade e recarrega o agent sem reiniciar o Node
  if (payload.proxyUrl !== undefined && payload.proxyUrl !== null) {
    setProxyUrl(payload.proxyUrl);
  }

  try {
    if (action === "ping") {
      ok({
        pong: true,
        mode: "http-ws-multiuser",
        proxyConfigured: !!proxyUrlActive,
        proxyHint: proxyUrlActive ? proxyUrlActive.replace(/:[^:@/]+@/, ":***@") : null,
      });
      return;
    }
    if (action === "clear-session") {
      clearSession(userId);
      ok({ cleared: true, userId });
      return;
    }
    if (action === "ensure-session") {
      if (!payload.blazeToken) {
        fail("blazeToken obrigatório");
        return;
      }
      const r = await ensureSession(userId, payload.blazeToken, payload.launchUrl || null, {
        force: !!payload.force,
        forBet: !!payload.forBet,
        proxyUrl: payload.proxyUrl,
        preferredSlug: payload.preferredSlug || null,
      });
      if (r.ok) ok(r);
      else fail(r.error || "ensure-session falhou", r);
      return;
    }
    if (action === "get-entry-url") {
      if (!payload.blazeToken) {
        fail("blazeToken obrigatório");
        return;
      }
      const r = await getEntryUrl(payload.blazeToken, payload.preferredSlug || null);
      if (r.ok) ok(r);
      else fail(r.error || "get-entry-url falhou", r);
      return;
    }
    if (action === "place-bet") {
      if (!payload.blazeToken) {
        fail("blazeToken obrigatório");
        return;
      }
      const amount = Number(payload.amount || 0);
      if (!(amount > 0)) {
        fail("amount inválido");
        return;
      }
      const r = await placeBet(
        userId,
        payload.blazeToken,
        payload.spot || "PLAYER",
        amount,
        Number(payload.protectionAmount || 0),
        payload.launchUrl || null,
        Number(payload.timeoutMs || 45000),
        { proxyUrl: payload.proxyUrl, preferredSlug: payload.preferredSlug || null }
      );
      if (r.ok) ok(r);
      else fail(r.error || "place-bet falhou", r);
      return;
    }
    fail("Ação inválida: " + action);
  } catch (e) {
    fail(e && e.message ? e.message : String(e));
  }
}

module.exports = {
  ensureSession,
  placeBet,
  clearSession,
  setProxyUrl,
  getProxyUrl,
  getEntryUrl,
};

if (require.main === module) {
  main();
}
