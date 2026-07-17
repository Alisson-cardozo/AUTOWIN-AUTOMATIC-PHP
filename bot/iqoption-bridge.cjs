/**
 * Bridge IQ Option (API não oficial — login + WS)
 *
 * stdin JSON → stdout JSON
 * actions: login | get-balances | place-option | ping
 *
 * Protocolo baseado no app web (auth.iqoption.com + ws.iqoption.com).
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

let WebSocket;
try {
  WebSocket = require("ws");
} catch {
  process.stdout.write(JSON.stringify({ ok: false, error: 'Pacote "ws" não instalado' }));
  process.exit(0);
}

const ROOT = process.env.AUTOWIN_ROOT || path.resolve(__dirname, "..");
const LOG = path.join(ROOT, "storage", "logs", "iqoption-bridge.log");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

function logLine(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    /* */
  }
  try {
    process.stderr.write(`[iqoption] ${msg}\n`);
  } catch {
    /* */
  }
}

function ok(payload = {}) {
  process.stdout.write(JSON.stringify({ ok: true, ...payload }));
}
function fail(message, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, error: message, ...extra }));
}

function httpJson(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const body = opts.body ? JSON.stringify(opts.body) : null;
    const headers = {
      "User-Agent": UA,
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://iqoption.com",
      Referer: "https://iqoption.com/",
      ...(opts.headers || {}),
    };
    if (body) headers["Content-Length"] = Buffer.byteLength(body);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: opts.method || "GET",
        headers,
        timeout: opts.timeout || 25000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            /* */
          }
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            raw,
            json,
            cookies: res.headers["set-cookie"] || [],
          });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    if (body) req.write(body);
    req.end();
  });
}

function extractSsid(cookies) {
  for (const c of cookies || []) {
    const m = String(c).match(/(?:^|;\s*)ssid=([^;]+)/i);
    if (m) {
      try {
        return decodeURIComponent(m[1].trim());
      } catch {
        return m[1].trim();
      }
    }
  }
  return null;
}

function pickSsidFromJson(json) {
  if (!json || typeof json !== "object") return null;
  return (
    json.ssid ||
    json.token ||
    (json.data && (json.data.ssid || json.data.token)) ||
    (json.result && (json.result.ssid || json.result.token)) ||
    null
  );
}

async function login(email, password) {
  const identifier = String(email || "").trim();
  const pass = String(password || "");
  if (!identifier || !pass) {
    return { ok: false, error: "Email e senha obrigatórios" };
  }
  logLine(`login ${identifier}`);

  // Endpoint principal (web app) + fallback v1.0
  const endpoints = [
    "https://auth.iqoption.com/api/v2/login",
    "https://auth.iqoption.com/api/v1.0/login",
  ];

  let lastErr = null;
  for (const url of endpoints) {
    let res;
    try {
      res = await httpJson(url, {
        method: "POST",
        body: { identifier, password: pass },
        timeout: 30000,
      });
    } catch (e) {
      lastErr = { ok: false, error: e && e.message ? e.message : String(e) };
      logLine(`login request fail ${url}: ${lastErr.error}`);
      continue;
    }

    if (res.status === 401 || res.status === 400) {
      const code = (res.json && res.json.code) || "";
      const msg =
        (res.json && (res.json.message || res.json.code)) ||
        "Credenciais inválidas";
      return {
        ok: false,
        error: String(msg),
        code: String(code),
        status: res.status,
        body: res.json,
      };
    }

    // 2FA / challenges
    if (res.status === 403 || (res.json && (res.json.code === "two_factor_required" || res.json.isTwoFactor))) {
      return {
        ok: false,
        error: "Conta com verificação em 2 etapas (2FA). Desative temporariamente na IQ Option para conectar o bot.",
        code: "two_factor_required",
        status: res.status,
        body: res.json,
      };
    }

    if (res.status !== 200) {
      lastErr = {
        ok: false,
        error: `Login HTTP ${res.status}`,
        status: res.status,
        body: res.json || (res.raw || "").slice(0, 200),
      };
      logLine(`login HTTP ${res.status} @ ${url}`);
      continue;
    }

    let ssid = extractSsid(res.cookies);
    if (!ssid) ssid = pickSsidFromJson(res.json);
    // header cookie às vezes vem como string única
    if (!ssid && res.headers && res.headers["set-cookie"]) {
      ssid = extractSsid(
        Array.isArray(res.headers["set-cookie"])
          ? res.headers["set-cookie"]
          : [String(res.headers["set-cookie"])]
      );
    }
    if (!ssid) {
      lastErr = {
        ok: false,
        error: "Login OK mas ssid não veio no cookie",
        body: res.json,
      };
      continue;
    }
    logLine(`login OK ssid_len=${ssid.length} via ${url}`);
    return { ok: true, ssid, code: res.json && res.json.code };
  }

  return lastErr || { ok: false, error: "Login IQ Option falhou" };
}

function normalizeBalanceRow(b) {
  if (!b || typeof b !== "object") return null;
  const id = b.id ?? b.balance_id ?? b.user_balance_id;
  if (id == null) return null;
  return {
    id: Number(id),
    type: Number(b.type ?? b.balance_type ?? 0),
    amount: Number(b.amount ?? b.balance ?? b.cash ?? b.enrolled_amount ?? 0),
    currency: String(b.currency || b.currency_name || b.currency_code || "USD"),
  };
}

function parseBalances(msg) {
  let list = null;
  if (Array.isArray(msg)) list = msg;
  else if (msg && Array.isArray(msg.msg)) list = msg.msg;
  else if (msg && msg.msg && Array.isArray(msg.msg.list)) list = msg.msg.list;
  else if (msg && msg.msg && Array.isArray(msg.msg.balances)) list = msg.msg.balances;
  else if (msg && Array.isArray(msg.balances)) list = msg.balances;
  else if (msg && msg.msg && msg.msg.profile && Array.isArray(msg.msg.profile.balances)) {
    list = msg.msg.profile.balances;
  }
  if (!list) {
    const walk = (o, d = 0) => {
      if (!o || d > 8) return null;
      if (
        Array.isArray(o) &&
        o.length &&
        typeof o[0] === "object" &&
        o[0] &&
        ("amount" in o[0] || "balance" in o[0] || "id" in o[0]) &&
        ("type" in o[0] || "currency" in o[0] || "amount" in o[0])
      ) {
        // só arrays que parecem lista de balances
        if (o.some((x) => x && (x.type != null || x.currency || x.amount != null))) return o;
      }
      if (typeof o === "object") {
        for (const k of Object.keys(o)) {
          const r = walk(o[k], d + 1);
          if (r) return r;
        }
      }
      return null;
    };
    list = walk(msg) || [];
  }
  return (list || []).map(normalizeBalanceRow).filter(Boolean);
}

/**
 * Sessão WS autenticada (fluxo oficial-ish):
 * 1) open → envia name:ssid
 * 2) espera profile (contém balances) e/ou balances
 * 3) se só profile sem balances, pede get-balances
 */
function wsSession(ssid, { timeoutMs = 15000, afterAuthMessages = [] } = {}) {
  return new Promise((resolve) => {
    const url = "wss://ws.iqoption.com/echo/websocket";
    const ws = new WebSocket(url, {
      headers: {
        Origin: "https://iqoption.com",
        "User-Agent": UA,
        Cookie: `ssid=${ssid}`,
      },
      handshakeTimeout: 12000,
    });
    let done = false;
    const bag = [];
    let authenticated = false;
    let getBalSent = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* */
      }
      resolve(payload);
    };
    const timer = setTimeout(() => {
      finish({ ok: false, error: "WS timeout", all: bag.slice(-12) });
    }, timeoutMs);

    const tryExtract = () => {
      for (const m of bag) {
        const n = m && m.name;
        if (n === "profile") {
          const bals = parseBalances(m);
          if (bals.length) return bals;
        }
        if (n === "balances") {
          const bals = parseBalances(m);
          if (bals.length) return bals;
        }
      }
      // last resort scan bag
      for (const m of bag) {
        const bals = parseBalances(m);
        if (bals.length >= 1 && bals.some((b) => b.type === 1 || b.type === 4 || b.type === 2)) {
          return bals;
        }
      }
      return null;
    };

    const requestBalances = () => {
      if (getBalSent) return;
      getBalSent = true;
      const reqId = "bal_" + Date.now();
      try {
        ws.send(
          JSON.stringify({
            name: "sendMessage",
            request_id: reqId,
            local_time: Math.floor(Date.now() / 1000),
            msg: { name: "get-balances", version: "1.0", body: {} },
          })
        );
      } catch {
        /* */
      }
    };

    ws.on("open", () => {
      // Fluxo clássico iqoptionapi: apenas ssid
      try {
        ws.send(JSON.stringify({ name: "ssid", msg: ssid }));
      } catch {
        /* */
      }
      // Compat auth protocol 3
      try {
        ws.send(
          JSON.stringify({
            name: "authenticate",
            request_id: String(Date.now()),
            local_time: Math.floor(Date.now() / 1000),
            msg: {
              ssid,
              protocol: 3,
              session_id: "",
              client_session_id: "",
            },
          })
        );
      } catch {
        /* */
      }
      // não dispara get-balances ainda — espera profile/auth
      setTimeout(() => {
        if (!done && !tryExtract()) requestBalances();
      }, 1200);
    });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      bag.push(msg);
      // limita bag
      if (bag.length > 80) bag.splice(0, bag.length - 80);

      const name = msg.name || "";
      if (name === "authenticated" || name === "auth" || name === "result") {
        authenticated = true;
      }
      if (name === "profile" || name === "authenticated") {
        authenticated = true;
        const bals = tryExtract();
        if (bals && bals.length) {
          finish({ ok: true, balances: bals, source: name, all: bag.slice(-8) });
          return;
        }
        // profile sem balances → pede
        requestBalances();
        for (const m of afterAuthMessages || []) {
          try {
            ws.send(JSON.stringify(m));
          } catch {
            /* */
          }
        }
      }
      if (name === "balances") {
        const bals = parseBalances(msg);
        if (bals.length) {
          finish({ ok: true, balances: bals, source: "balances", all: bag.slice(-8) });
          return;
        }
      }
      // respostas genéricas com balances embutidos
      if (name === "balance-changed" || name === "front" || name === "timeSync") {
        const bals = tryExtract();
        if (bals && bals.length && (authenticated || getBalSent)) {
          // só aceita cedo se já autenticou ou pediu
          if (authenticated || name === "balances") {
            finish({ ok: true, balances: bals, source: name, all: bag.slice(-8) });
          }
        }
      }
    });

    ws.on("error", (err) => finish({ ok: false, error: err.message || "WS error", all: bag.slice(-8) }));
    ws.on("close", () => {
      if (done) return;
      const bals = tryExtract();
      if (bals && bals.length) finish({ ok: true, balances: bals, source: "close", all: bag.slice(-8) });
      else finish({ ok: false, error: "WS closed", all: bag.slice(-8) });
    });
  });
}

function wsOnce(ssid, messages, waitName, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const url = "wss://ws.iqoption.com/echo/websocket";
    const ws = new WebSocket(url, {
      headers: {
        Origin: "https://iqoption.com",
        "User-Agent": UA,
        Cookie: `ssid=${ssid}`,
      },
      handshakeTimeout: 12000,
    });
    let done = false;
    const bag = [];
    const finish = (payload) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* */
      }
      resolve(payload);
    };
    const timer = setTimeout(() => finish({ ok: false, error: "WS timeout", all: bag }), timeoutMs);

    ws.on("open", () => {
      try {
        ws.send(JSON.stringify({ name: "ssid", msg: ssid }));
      } catch {
        /* */
      }
      // envia mensagens após pequeno delay (auth)
      setTimeout(() => {
        for (const m of messages || []) {
          try {
            ws.send(JSON.stringify(m));
          } catch {
            /* */
          }
        }
      }, 400);
    });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      bag.push(msg);
      const name = msg.name || "";
      if (waitName && (name === waitName || (msg.msg && msg.msg.name === waitName))) {
        finish({ ok: true, message: msg, all: bag });
        return;
      }
      if (waitName === "option" && (name === "option" || name === "option-opened" || name === "error")) {
        finish({ ok: name !== "error", message: msg, all: bag });
      }
      if (waitName === "position" && (name === "position" || name === "position-changed")) {
        finish({ ok: true, message: msg, all: bag });
      }
    });

    ws.on("error", (err) => finish({ ok: false, error: err.message, all: bag }));
    ws.on("close", () => {
      if (!done) finish({ ok: false, error: "WS closed", all: bag });
    });
  });
}

async function getBalancesHttp(ssid) {
  const urls = [
    "https://iqoption.com/api/v1/balances",
    "https://eu.iqoption.com/api/v1/balances",
    "https://iqoption.com/api/getprofile",
    "https://iqoption.com/api/v1/profile",
  ];
  for (const url of urls) {
    try {
      const res = await httpJson(url, {
        method: "GET",
        timeout: 10000,
        headers: {
          Cookie: `ssid=${ssid}`,
        },
      });
      if (res.status >= 200 && res.status < 300) {
        const bals = parseBalances(res.json || res.raw);
        if (bals.length) {
          logLine(`balances HTTP ok via ${url} n=${bals.length}`);
          return { ok: true, balances: bals, source: "http:" + url };
        }
        // profile shape
        if (res.json && res.json.result && Array.isArray(res.json.result.balances)) {
          const b2 = res.json.result.balances.map(normalizeBalanceRow).filter(Boolean);
          if (b2.length) return { ok: true, balances: b2, source: "http-profile:" + url };
        }
      } else {
        logLine(`balances HTTP ${res.status} ${url}`);
      }
    } catch (e) {
      logLine(`balances HTTP fail ${url}: ${e && e.message ? e.message : e}`);
    }
  }
  return { ok: false, error: "HTTP balances falhou" };
}

async function getBalances(ssid) {
  if (!ssid) return { ok: false, error: "ssid vazio" };
  logLine(`get-balances ssid_len=${String(ssid).length}`);

  // 1) WS sessão (profile + get-balances) — timeout curto para não travar o site
  try {
    const ws = await wsSession(ssid, { timeoutMs: 12000 });
    if (ws.ok && Array.isArray(ws.balances) && ws.balances.length) {
      logLine(`balances WS ok n=${ws.balances.length} source=${ws.source || "?"}`);
      return { ok: true, balances: ws.balances, source: ws.source || "ws" };
    }
    logLine(`balances WS fail: ${ws.error || "empty"} bag=${(ws.all || []).map((m) => m && m.name).filter(Boolean).slice(0, 12).join(",")}`);
  } catch (e) {
    logLine(`balances WS exception: ${e && e.message ? e.message : e}`);
  }

  // 2) HTTP fallback
  const http = await getBalancesHttp(ssid);
  if (http.ok) return http;

  return { ok: false, error: "Não foi possível ler saldos da IQ Option", balances: [] };
}

/** Ativos comuns OTC (active_id aproximados — podem variar; UI permite override) */
let ASSETS = {};
try {
  ASSETS = require("./iqoption-assets.cjs");
} catch {
  ASSETS = {
    "EURUSD-OTC": 76,
    EURUSD: 1,
    "GBPUSD-OTC": 81,
    GBPUSD: 5,
    "USDJPY-OTC": 85,
    USDJPY: 6,
  };
}

/**
 * Velas IQ Option (get-candles).
 * size = segundos da vela (60 = 1m, 300 = 5m)
 */
async function getCandles(ssid, activeId, size = 60, count = 100) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - size * (count + 5);
  const reqId = "cand_" + Date.now();
  const res = await wsOnce(
    ssid,
    [
      {
        name: "sendMessage",
        request_id: reqId,
        local_time: Math.floor(Date.now() / 1000),
        msg: {
          name: "get-candles",
          version: "2.0",
          body: {
            active_id: Number(activeId),
            size: Number(size),
            from,
            to,
            count: Number(count),
          },
        },
      },
    ],
    "candles",
    18000
  );
  const bag = res.all || [];
  let list = [];
  for (const m of bag) {
    const n = m.name || "";
    const msg = m.msg || {};
    if (n === "candles" || (msg.candles && Array.isArray(msg.candles))) {
      const raw = Array.isArray(msg.candles) ? msg.candles : Array.isArray(msg) ? msg : [];
      list = raw;
      break;
    }
    if (Array.isArray(msg) && msg[0] && (msg[0].close != null || msg[0].open != null)) {
      list = msg;
      break;
    }
  }
  if (!list.length && res.message) {
    const msg = res.message.msg || res.message;
    if (Array.isArray(msg?.candles)) list = msg.candles;
    else if (Array.isArray(msg)) list = msg;
  }
  const candles = (list || [])
    .map((c) => ({
      open: Number(c.open ?? c.o ?? 0),
      high: Number(c.max ?? c.high ?? c.h ?? 0),
      low: Number(c.min ?? c.low ?? c.l ?? 0),
      close: Number(c.close ?? c.c ?? 0),
      from: Number(c.from ?? c.at ?? 0),
      volume: Number(c.volume ?? 0),
    }))
    .filter((c) => c.close > 0 || c.open > 0)
    .sort((a, b) => (a.from || 0) - (b.from || 0));
  if (!candles.length) {
    return { ok: false, error: res.error || "sem candles", bag: bag.slice(0, 5).map((m) => m.name) };
  }
  logLine(`candles ok active=${activeId} size=${size} n=${candles.length}`);
  return { ok: true, candles };
}

/** Extrai id numérico de resposta de open-option / position. */
function extractOptionId(msg) {
  const found = [];
  const walk = (o, d = 0) => {
    if (!o || d > 8) return;
    if (typeof o !== "object") return;
    if (Array.isArray(o)) {
      for (const x of o) walk(x, d + 1);
      return;
    }
    for (const k of ["id", "option_id", "external_id", "position_id", "order_id", "externalId"]) {
      if (o[k] != null && o[k] !== "") {
        const n = Number(o[k]);
        if (Number.isFinite(n) && n > 1000) found.push(String(o[k]));
      }
    }
    // option wrapper
    if (o.option) walk(o.option, d + 1);
    if (o.msg) walk(o.msg, d + 1);
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") walk(v, d + 1);
    }
  };
  walk(msg);
  return found[0] || null;
}

/** Interpreta WIN/LOSS/EMPATE a partir de um objeto de posição/opção. */
function parseResultFromPosition(p) {
  if (!p || typeof p !== "object") return null;
  const profit = Number(
    p.pnl_realized ?? p.pnl_net ?? p.pnl ?? p.profit_amount ?? p.profit ?? p.expected_profit ?? NaN
  );
  const winRaw = String(p.win ?? p.close_reason ?? p.status ?? p.result ?? "").toLowerCase();
  let result = null;
  if (winRaw === "win" || winRaw === "won" || winRaw === "equal" || winRaw === "loose" || winRaw === "lose" || winRaw === "lost" || winRaw === "sold") {
    result = winRaw === "win" || winRaw === "won" ? "WIN" : winRaw === "equal" ? "EMPATE" : "LOSS";
  } else if (Number.isFinite(profit)) {
    // só usa profit se a posição já fechou (status closed / has close_at / pnl_realized)
    const closed =
      p.pnl_realized != null ||
      p.close_quote != null ||
      p.close_profit != null ||
      String(p.status || "").toLowerCase().includes("closed") ||
      p.expired_at ||
      p.close_at;
    if (closed || profit !== 0) {
      result = profit > 0.0001 ? "WIN" : profit < -0.0001 ? "LOSS" : "EMPATE";
    }
  }
  if (!result) return null;
  return {
    result,
    profit: Number.isFinite(profit) ? profit : null,
    raw: p,
  };
}

function collectPositionsFromBag(bag) {
  const out = [];
  for (const m of bag || []) {
    const n = m.name || "";
    const inner = m.msg != null ? m.msg : m;
    if (n === "position" || n === "position-changed" || n === "option" || n === "option-closed" || n === "option-opened") {
      if (inner && typeof inner === "object") out.push(inner);
    }
    if (Array.isArray(inner)) {
      for (const p of inner) if (p && typeof p === "object") out.push(p);
    }
    if (inner && typeof inner === "object") {
      for (const k of ["positions", "list", "items", "options", "result"]) {
        const arr = inner[k];
        if (Array.isArray(arr)) {
          for (const p of arr) if (p && typeof p === "object") out.push(p);
        }
      }
      // single nested position
      if (inner.position && typeof inner.position === "object") out.push(inner.position);
      if (inner.option && typeof inner.option === "object") out.push(inner.option);
    }
  }
  return out;
}

async function getOptionResult(ssid, optionId, balanceId) {
  if (!optionId) return { ok: false, error: "optionId obrigatório" };
  const oid = String(optionId);
  const oidNum = Number(optionId);
  const now = Math.floor(Date.now() / 1000);
  logLine(`get-option-result id=${oid} bal=${balanceId || 0}`);

  const tryMatch = (positions) => {
    for (const p of positions) {
      const id = String(p.id || p.external_id || p.option_id || p.position_id || "");
      if (id && id === oid) {
        const parsed = parseResultFromPosition(p);
        if (parsed) {
          return { ok: true, optionId: oid, profit: parsed.profit, result: parsed.result, raw: parsed.raw, source: "match" };
        }
        // achou posição mas ainda aberta
        return { ok: false, error: "posição ainda aberta", pending: true, raw: p };
      }
    }
    return null;
  };

  // 1) get-position
  const resPos = await wsOnce(
    ssid,
    [
      {
        name: "sendMessage",
        request_id: "pos_" + Date.now(),
        local_time: now,
        msg: { name: "get-position", version: "1.0", body: { position_id: oidNum } },
      },
      {
        name: "sendMessage",
        request_id: "opt_" + Date.now(),
        local_time: now,
        msg: { name: "get-options", version: "1.0", body: { id: [oidNum] } },
      },
    ],
    "position",
    18000
  );
  let hit = tryMatch(collectPositionsFromBag(resPos.all));
  if (hit && hit.ok) {
    logLine(`get-option-result OK via get-position result=${hit.result} pnl=${hit.profit}`);
    return hit;
  }
  if (hit && hit.pending) {
    logLine(`get-option-result pending open id=${oid}`);
    return { ok: false, error: "resultado ainda não disponível", pending: true };
  }

  // 2) histórico portfolio (binary + turbo + blitz + digital)
  const balId = Number(balanceId) || 0;
  const instrumentTypes = ["binary-option", "turbo-option", "blitz-option", "digital-option", "binary", "turbo"];
  const histMsgs = instrumentTypes.map((it, i) => ({
    name: "sendMessage",
    request_id: "hist_" + Date.now() + "_" + i,
    local_time: now,
    msg: {
      name: "portfolio.get-history-positions",
      version: "2.0",
      body: {
        user_balance_id: balId,
        instrument_type: it,
        limit: 40,
        offset: 0,
      },
    },
  }));
  // sem balance id, tenta 0
  if (balId > 0) {
    for (const it of instrumentTypes.slice(0, 3)) {
      histMsgs.push({
        name: "sendMessage",
        request_id: "hist0_" + Date.now() + it,
        local_time: now,
        msg: {
          name: "portfolio.get-history-positions",
          version: "2.0",
          body: { user_balance_id: 0, instrument_type: it, limit: 40, offset: 0 },
        },
      });
    }
  }

  const resHist = await wsOnce(ssid, histMsgs, "positions", 22000);
  // aceita qualquer msg com lista
  const allPos = collectPositionsFromBag(resHist.all);
  // também varre bag bruto por id
  for (const m of resHist.all || []) {
    const dump = JSON.stringify(m);
    if (dump.includes(oid)) {
      const nested = collectPositionsFromBag([m]);
      for (const p of nested) allPos.push(p);
    }
  }
  hit = tryMatch(allPos);
  if (hit && hit.ok) {
    logLine(`get-option-result OK via history result=${hit.result} pnl=${hit.profit}`);
    return hit;
  }

  // 3) posições abertas (pode ter virado closed no payload)
  const resOpen = await wsOnce(
    ssid,
    [
      {
        name: "sendMessage",
        request_id: "open_" + Date.now(),
        local_time: now,
        msg: {
          name: "portfolio.get-positions",
          version: "4.0",
          body: { instrument_types: ["binary-option", "turbo-option", "blitz-option", "digital-option"] },
        },
      },
    ],
    "positions",
    18000
  );
  hit = tryMatch(collectPositionsFromBag(resOpen.all));
  if (hit && hit.ok) {
    logLine(`get-option-result OK via open-positions result=${hit.result}`);
    return hit;
  }

  logLine(
    `get-option-result miss id=${oid} bagNames=${(resPos.all || [])
      .concat(resHist.all || [])
      .map((m) => m.name)
      .slice(0, 12)
      .join(",")}`
  );
  return {
    ok: false,
    error: "resultado ainda não disponível",
    bag: (resHist.all || resPos.all || []).slice(0, 4).map((m) => m.name),
  };
}

async function placeOption(ssid, opts) {
  const {
    balanceId,
    asset = "EURUSD-OTC",
    direction = "call",
    amount = 1,
    expirationMinutes = 1,
    activeId: activeIdIn,
  } = opts || {};

  const assetKey = String(asset || "");
  let resolvedActive = activeIdIn || ASSETS[assetKey] || ASSETS[assetKey.toUpperCase()] || null;
  if (!resolvedActive) {
    const up = assetKey.toUpperCase();
    for (const k of Object.keys(ASSETS)) {
      if (String(k).toUpperCase() === up) {
        resolvedActive = ASSETS[k];
        break;
      }
    }
  }
  const activeId = resolvedActive || 76;
  const dir = String(direction).toLowerCase() === "put" ? "put" : "call";
  const price = Math.max(1, Number(amount) || 1);
  const expMin = Math.max(1, Math.min(60, parseInt(expirationMinutes, 10) || 1));

  // expired: próximo fechamento em N minutos (UTC epoch seconds, arredondado)
  const now = Math.floor(Date.now() / 1000);
  const expired = now - (now % 60) + expMin * 60 + 60; // +1 min buffer slot

  const reqId = String(Date.now());
  const body = {
    user_balance_id: Number(balanceId),
    active_id: Number(activeId),
    option_type_id: expMin <= 5 ? 3 : 1, // turbo / binary
    direction: dir,
    expired,
    refund_value: 0,
    price,
    value: 0,
    profit_percent: 0,
  };

  logLine(`place-option asset=${asset} active=${activeId} ${dir} $${price} exp=${expired}`);

  const res = await wsOnce(
    ssid,
    [
      {
        name: "sendMessage",
        request_id: reqId,
        local_time: now,
        msg: {
          name: "binary-options.open-option",
          version: "2.0",
          body,
        },
      },
    ],
    "option",
    30000
  );

  // aceita várias respostas
  const bag = res.all || [];
  for (const m of bag) {
    const n = m.name || "";
    const inner = m.msg || {};
    if (n === "error" || inner.message === "error" || m.status === 4000 || inner.code) {
      const errText =
        inner.message ||
        inner.msg ||
        m.message ||
        (inner.code ? `code ${inner.code}` : null) ||
        JSON.stringify(m).slice(0, 200);
      logLine(`place-option ERROR ${errText}`);
      return {
        ok: false,
        error: errText,
        raw: m,
      };
    }
    if (n === "option" || n === "option-opened" || n === "option-changed" || (inner.id && (inner.active_id || inner.direction))) {
      const optionId = extractOptionId(m) || extractOptionId(inner);
      logLine(`place-option OK id=${optionId || "null"} active=${activeId}`);
      return {
        ok: true,
        optionId: optionId,
        direction: dir,
        amount: price,
        asset,
        activeId,
        expired,
        raw: inner,
      };
    }
  }
  // varredura profunda por id em todo o bag
  for (const m of bag) {
    const optionId = extractOptionId(m);
    if (optionId) {
      logLine(`place-option OK (deep) id=${optionId}`);
      return {
        ok: true,
        optionId,
        direction: dir,
        amount: price,
        asset,
        activeId,
        expired,
        raw: m,
      };
    }
  }
  if (!res.ok) {
    logLine(`place-option fail: ${res.error || "sem confirmação"} names=${bag.map((m) => m.name).join(",")}`);
    return { ok: false, error: res.error || "sem confirmação de ordem", bag: bag.slice(0, 8).map((m) => m.name) };
  }
  // sem id: se não houve error no bag, assume enviada (resultado por vela/saldo)
  const names = bag.map((m) => m.name || "");
  const hasHardError = bag.some((m) => m.name === "error" || m.status === 4000);
  if (!hasHardError && bag.length > 0) {
    logLine(`place-option OK sem id (fallback vela) names=${names.join(",")}`);
    return {
      ok: true,
      optionId: null,
      direction: dir,
      amount: price,
      asset,
      activeId,
      expired,
      bag: names.slice(0, 6),
    };
  }
  logLine(`place-option fail names=${names.join(",")}`);
  return {
    ok: false,
    error: "ordem sem confirmação da IQ",
    direction: dir,
    amount: price,
    asset,
    activeId,
    expired,
    bag: names.slice(0, 6),
  };
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  let payload;
  try {
    payload = JSON.parse(input || "{}");
  } catch {
    fail("JSON inválido no stdin");
    return;
  }

  const action = String(payload.action || "").toLowerCase();
  try {
    if (action === "login") {
      const r = await login(String(payload.email || ""), String(payload.password || ""));
      if (!r.ok) {
        fail(r.error || "login falhou", r);
        return;
      }
      // já puxa balances
      const b = await getBalances(r.ssid);
      ok({
        ssid: r.ssid,
        balances: b.ok ? b.balances : [],
        balancesError: b.ok ? null : b.error,
      });
      return;
    }
    if (action === "get-balances") {
      const ssid = String(payload.ssid || "");
      if (!ssid) {
        fail("ssid obrigatório");
        return;
      }
      const b = await getBalances(ssid);
      if (!b.ok) {
        fail(b.error || "balances falhou", b);
        return;
      }
      ok({ balances: b.balances });
      return;
    }
    if (action === "place-option") {
      const ssid = String(payload.ssid || "");
      if (!ssid) {
        fail("ssid obrigatório");
        return;
      }
      if (!payload.balanceId) {
        fail("balanceId obrigatório");
        return;
      }
      const r = await placeOption(ssid, payload);
      if (!r.ok) {
        fail(r.error || "ordem falhou", r);
        return;
      }
      ok(r);
      return;
    }
    if (action === "get-option-result") {
      const ssid = String(payload.ssid || "");
      const optionId = payload.optionId || payload.externalId || payload.id;
      const balanceId = payload.balanceId || payload.user_balance_id || 0;
      if (!ssid) {
        fail("ssid obrigatório");
        return;
      }
      const r = await getOptionResult(ssid, optionId, balanceId);
      // ainda pendente → devolve ok:false sem "fail" fatal (PHP retenta)
      process.stdout.write(JSON.stringify(r));
      return;
    }
    if (action === "assets") {
      ok({ assets: ASSETS });
      return;
    }
    if (action === "get-candles" || action === "candles") {
      const ssid = String(payload.ssid || "");
      if (!ssid) {
        fail("ssid obrigatório");
        return;
      }
      const asset = String(payload.asset || "EURUSD-OTC");
      const size = Math.max(1, parseInt(payload.size || payload.timeframe || 60, 10) || 60);
      const count = Math.max(30, Math.min(300, parseInt(payload.count || 100, 10) || 100));
      let activeId = payload.activeId || ASSETS[asset] || ASSETS[asset.toUpperCase()];
      if (!activeId) {
        const up = asset.toUpperCase();
        for (const k of Object.keys(ASSETS)) {
          if (String(k).toUpperCase() === up) {
            activeId = ASSETS[k];
            break;
          }
        }
      }
      activeId = Number(activeId || 76);
      const r = await getCandles(ssid, activeId, size, count);
      if (!r.ok) {
        fail(r.error || "candles falhou", r);
        return;
      }
      ok({ candles: r.candles, activeId, size, count: r.candles.length });
      return;
    }
    if (action === "ping") {
      ok({ pong: true, ts: Date.now() });
      return;
    }
    fail("action inválida: " + action);
  } catch (e) {
    logLine("exception " + (e && e.message ? e.message : e));
    fail(e && e.message ? e.message : String(e));
  }
}

main();
