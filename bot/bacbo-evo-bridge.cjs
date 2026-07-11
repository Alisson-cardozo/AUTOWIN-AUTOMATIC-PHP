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

const ROOT = path.resolve(__dirname, "..");
const SESSION_DIR = path.join(ROOT, "storage", "bacbo-evo");
const WS_DIR = path.join(ROOT, "storage", "bacbo-ws");
const WS_HISTORY = path.join(WS_DIR, "history.json");

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
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const SEC_CH_UA = '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"';

/** Headers HTTP alinhados à captura do browser (pós-EVOSESSIONID). */
function evoBrowserHeaders(extra = {}) {
  return {
    "User-Agent": UA,
    Accept: "*/*",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    Origin: `https://${EVO_HOST}`,
    Referer: FRONTEND_REF,
    "sec-ch-ua": SEC_CH_UA,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
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
        Accept: opts.accept || "application/json, text/plain, */*",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        ...(opts.headers || {}),
      };
      if (cookies) headers.Cookie = cookies;
      if (body && !isRedirect) {
        headers["Content-Length"] = Buffer.byteLength(body);
      }

      const req = lib.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || (u.protocol === "https:" ? 443 : 80),
          path: u.pathname + u.search,
          method: isRedirect ? "GET" : method,
          headers,
          timeout: opts.timeout || 30000,
        },
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
 * Tenta vários endpoints de play (ao vivo primeiro, como no Python).
 */
async function blazePlay(blazeToken) {
  // Sala real: blaze.bet.br/pt/games/bac-bo → BacBo00000000001
  const endpoints = [
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
      if (launchUrl && res.status < 400) {
        return last;
      }
    } catch (e) {
      last = { status: 0, data: { error: e.message }, launchUrl: null, endpoint: ep.label };
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
  hops.push({ step: "entry", status: res1.status, url: entryUrl.slice(0, 100), loc: (res1.location || "").slice(0, 120) });

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
      hops.push({ step: "blocked", status: resN.status });
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
      finish({ ok: false, error: "WS probe: " + (err && err.message ? err.message : String(err)) });
    });

    ws.on("close", () => {
      if (!settled) {
        clearTimeout(timer);
        finish({ ok: gotState, gotState, error: gotState ? null : "WS fechou no probe" });
      }
    });
  });
}

async function ensureSession(userId, blazeToken, launchUrlHint) {
  // Env global (dev/debug) — opcional
  if (process.env.BACBO_EVOSESSIONID) {
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
    });
    return { ok: true, tableId, vtId, evoSessionId: evoSessionId.slice(0, 12) + "…", source: "env" };
  }

  // Cache por usuário (multi-tenant: arquivo isolado)
  const existing = readSession(userId);
  if (existing && existing.evoSessionId && existing.evoSessionId.length >= 40) {
    const ageMs = existing.updatedAt ? Date.now() - Date.parse(existing.updatedAt) : 99999999;
    // reutiliza por até 6 min
    if (ageMs < 6 * 60 * 1000 && existing.source !== "chrome") {
      return {
        ok: true,
        tableId: existing.tableId || DEFAULT_TABLE,
        vtId: existing.vtId || DEFAULT_VT,
        evoSessionId: existing.evoSessionId.slice(0, 12) + "…",
        source: "cache",
      };
    }
  }

  let launchUrl = launchUrlHint || null;
  let playMeta = null;
  if (!launchUrl) {
    if (!blazeToken) {
      return { ok: false, error: "blazeToken obrigatório para obter sessão Evolution (multi-usuário)." };
    }
    const play = await blazePlay(blazeToken);
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
    });
    return {
      ok: false,
      error:
        "Não foi possível obter EVOSESSIONID via HTTP/redirect (multi-usuário, sem Chrome). " +
        "A Evolution pode estar bloqueando o entry (Akamai). Token Blaze do usuário continua ok — tente de novo em instantes.",
      launchUrl: String(launchUrl).slice(0, 140) + "…",
      hops: evo.hops || [],
      play: playMeta,
      source: "http-redirect",
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
  };

  // Handshake igual ao browser: /setup + /style + /config (captura real)
  try {
    const warm = await warmEvoClient(sessionData);
    sessionData.warm = warm.steps || [];
    if (warm.cookies) sessionData.cookies = warm.cookies;
  } catch {
    /* warm é best-effort */
  }

  // Probe opcional: se mesa padrão falhar no WS, tenta mesa fallback
  const probe = await probeWsSession({ ...sessionData, userId }, 4500);
  if (!probe.ok) {
    // tenta table/vt alternativos do launch
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
      // ainda salva sessão — aposta pode funcionar mesmo se probe flocou
      sessionData.probeError = probe.error || "probe falhou";
    }
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
 * Conecta no WS e aposta na próxima janela aberta (WaitingForBets / AcceptingBets).
 * TipMiner adiantar resultado → espera ciclo fechar antes de apostar.
 */
function connectAndBet(session, spot, amount, protectionAmount, timeoutMs) {
  return new Promise((resolve) => {
    const tableId = session.tableId || DEFAULT_TABLE;
    const vtId = session.vtId || DEFAULT_VT;
    const evo = session.evoSessionId;
    const instance = buildInstance(evo, vtId, session.userId);
    const wsUrl = buildWsUrl(tableId, vtId, evo, instance);

    let settled = false;
    let currentGameId = null;
    let betSent = false;
    let lastStage = null;
    let sawBusyOrClosed = false;
    let openGameIdSkipped = null;
    let lastServerTime = null;
    let betProtocol = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* */
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        error:
          "Timeout aguardando janela de apostas aberta na mesa (WaitingForBets/AcceptingBets). " +
          "A API pode adiantar o resultado — o bot só aposta com a mesa aberta.",
        lastStage,
        betSent,
        gameId: currentGameId,
        sawBusyOrClosed,
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
    });

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
        lastStage = game.stage || lastStage;
        appendWsResult(game);

        const received = (game.receivedBets && game.receivedBets.validBets) || [];
        if (betSent && Array.isArray(received) && received.length > 0) {
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
        const busy = isBusyStage(game.stage);

        if (busy) {
          sawBusyOrClosed = true;
          openGameIdSkipped = null;
        }

        if (open && currentGameId && !sawBusyOrClosed && openGameIdSkipped === null) {
          openGameIdSkipped = currentGameId;
        }
        if (openGameIdSkipped && currentGameId && currentGameId !== openGameIdSkipped) {
          sawBusyOrClosed = true;
        }
        if (openGameIdSkipped && busy) {
          sawBusyOrClosed = true;
        }

        const safeOpen =
          open && !betSent && currentGameId && sawBusyOrClosed && currentGameId !== openGameIdSkipped;

        if (safeOpen) {
          try {
            // Protocolo real da sala: bacbo.bet + betMap + actions
            const msg = buildBetMessage(currentGameId, spot, amount, protectionAmount || 0);
            ws.send(JSON.stringify(msg));
            betProtocol = "bacbo.bet";
            betSent = true;
          } catch (e) {
            clearTimeout(timer);
            finish({ ok: false, error: "Falha ao enviar aposta: " + e.message });
          }
        }

        if (betSent && (game.stage === "ClosingBets" || game.stage === "BetsClosed")) {
          const last = game.lastGameBets || [];
          if (Array.isArray(last) && last.length > 0) {
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
      clearTimeout(timer);
      finish({ ok: false, error: "WS error: " + (err && err.message ? err.message : String(err)) });
    });

    ws.on("close", () => {
      if (!settled) {
        clearTimeout(timer);
        finish({
          ok: betSent,
          error: betSent
            ? "WS fechou após envio (sem confirmação explícita)"
            : "WS fechou antes da janela de apostas segura",
          betSent,
          lastStage,
          gameId: currentGameId,
          tableId,
          sawBusyOrClosed,
          protocol: betProtocol,
        });
      }
    });
  });
}

async function placeBet(userId, blazeToken, spot, amount, protectionAmount, launchUrl, timeoutMs) {
  let session = readSession(userId);
  // força renovar se veio de chrome legado ou sem evo
  const needFresh =
    !session ||
    !session.evoSessionId ||
    session.source === "chrome" ||
    session.source === "http-failed";

  if (needFresh) {
    if (session && session.source === "chrome") clearSession(userId);
    const ens = await ensureSession(userId, blazeToken, launchUrl);
    if (!ens.ok) return ens;
    session = readSession(userId);
  }
  if (!session || !session.evoSessionId) {
    return { ok: false, error: "Sessão Evolution ausente para este usuário (HTTP/WS multi-usuário)." };
  }

  session.userId = userId;
  const result = await connectAndBet(session, spot, amount, protectionAmount || 0, timeoutMs || 45000);

  // Renova se sessão morta / kickout / já usada por outra conexão
  const errStr = String(result.error || "");
  if (
    !result.ok &&
    (/EVOSESSION|401|403|closed|WS error|kickout|rejeitada|connectionAlreadyExists/i.test(errStr) ||
      result.code === "connectionAlreadyExists")
  ) {
    clearSession(userId);
    const ens = await ensureSession(userId, blazeToken, launchUrl);
    if (!ens.ok) return { ...result, renew: ens };
    session = readSession(userId);
    session.userId = userId;
    return await connectAndBet(session, spot, amount, protectionAmount || 0, timeoutMs || 45000);
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

  try {
    if (action === "ping") {
      ok({ pong: true, mode: "http-ws-multiuser" });
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
      const r = await ensureSession(userId, payload.blazeToken, payload.launchUrl || null);
      if (r.ok) ok(r);
      else fail(r.error || "ensure-session falhou", r);
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
        Number(payload.timeoutMs || 45000)
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

main();
