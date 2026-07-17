/**
 * Bridge de aposta REAL — Mega Roulette Brazilian (Pragmatic Play)
 *
 * Protocolo capturado no browser (mesa mrbras531mrbr532):
 *   <command channel="table-{tableId}">
 *     <lpbet gm="roulette_desktop" gId="{gameId}" uId="{uId}" ck="{ck}">
 *       <bet amt="{amount}" bc="{bc}" ck="{ck}"/>
 *     </lpbet>
 *   </command>
 *
 * Resposta OK:
 *   {"command":{"channel":"table-...","status":"success","seq":N}}
 *
 * bc (bet codes — fora da mesa europeia / desktop):
 *   VERMELHO = 48, PRETO = 49, BRANCO/0 = 0
 *
 * Uso (JSON stdin → JSON stdout):
 *   { "action":"place-bet", "blazeToken":"...", "spot":"VERMELHO", "amount":5, "timeoutMs":90000 }
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

let WebSocket;
try {
  WebSocket = require("ws");
} catch {
  process.stdout.write(JSON.stringify({ ok: false, error: 'Pacote "ws" não instalado' }));
  process.exit(0);
}

const ROOT = process.env.AUTOWIN_ROOT || path.resolve(__dirname, "..");
const LOG_DIR = path.join(ROOT, "storage", "logs");
const GAME_SLUG =
  process.env.MEGAROULETTE_GAME_SLUG || "mega-roulette---brazilian-287-287";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

/** Bet codes Pragmatic roulette_desktop (captura + convenção outside bets). */
const BC = {
  VERMELHO: 48,
  RED: 48,
  PRETO: 49,
  BLACK: 49,
  BRANCO: 0,
  GREEN: 0,
  ZERO: 0,
};

function logLine(msg) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(
      path.join(LOG_DIR, "megaroulette-bet.log"),
      `[${new Date().toISOString()}] ${msg}\n`,
      "utf8"
    );
  } catch {
    /* */
  }
  try {
    process.stderr.write(`[megaroulette-bet] ${msg}\n`);
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
        timeout: opts.timeout || 25000,
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
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("http timeout"));
    });
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
        timeout: 20000,
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

async function openSession(token) {
  const walletRes = await httpRequest("https://blaze.bet.br/api/wallets", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (walletRes.status === 401 || walletRes.status === 403) {
    throw Object.assign(new Error(`token inválido (wallets HTTP ${walletRes.status})`), {
      code: "TOKEN_INVALID",
    });
  }
  let wallets;
  try {
    wallets = JSON.parse(walletRes.body);
  } catch {
    throw new Error("wallets não-JSON");
  }
  const list = Array.isArray(wallets)
    ? wallets
    : Array.isArray(wallets?.data)
      ? wallets.data
      : Array.isArray(wallets?.wallets)
        ? wallets.wallets
        : [];
  const wallet = list.find((w) => w && (w.primary || w.is_primary)) || list[0];
  const walletId = wallet && (wallet.id || wallet.wallet_id);
  if (!walletId) throw new Error("wallet_id ausente");

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
      },
      body: JSON.stringify({ wallet_id: walletId, selected_currency_type: "BRL" }),
    });
    try {
      playData = JSON.parse(playRes.body);
    } catch {
      playData = null;
    }
    if (playRes.status === 401 || playRes.status === 403) {
      throw Object.assign(new Error(`token recusado no /play HTTP ${playRes.status}`), {
        code: "TOKEN_INVALID",
      });
    }
    if (playData && playData.content) {
      usedSlug = slug;
      break;
    }
  }
  if (!playData?.content) throw new Error("play falhou (sem launch URL)");

  const loc1 = await followRedirect(playData.content);
  if (!loc1) throw new Error("sem redirect 1");
  const loc2 = await followRedirect(loc1);
  if (!loc2) throw new Error("sem redirect 2");

  const finalUrl = new URL(loc2);
  const jsessionId = finalUrl.searchParams.get("JSESSIONID");
  const tableId = finalUrl.searchParams.get("table_id");
  const socketServer = finalUrl.searchParams.get("socket_server");
  if (!jsessionId || !tableId || !socketServer) {
    throw new Error("params ausentes na URL final");
  }
  return { jsessionId, tableId, socketServer, slug: usedSlug, walletId };
}

function spotToBc(spot) {
  const s = String(spot || "").toUpperCase().trim();
  if (BC[s] !== undefined) return BC[s];
  // número 0–36
  const n = parseInt(s, 10);
  if (!isNaN(n) && n >= 0 && n <= 36) return n;
  return null;
}

/** @param {Array<{bc:number,amount:number}>} betList */
function buildLpBetXml(tableId, gameId, betList, uId, ck) {
  const bets = (betList || [])
    .map((b) => {
      const amt = Number(b.amount);
      const amtStr = Number.isInteger(amt) ? String(amt) : String(amt);
      return `<bet amt="${amtStr}" bc="${b.bc}" ck="${ck}"/>`;
    })
    .join("");
  return (
    `<command channel="table-${tableId}">` +
    `<lpbet gm="roulette_desktop" gId="${gameId}" uId="${uId}" ck="${ck}">` +
    bets +
    `</lpbet></command>`
  );
}

/**
 * Interpreta spot:
 *   VERMELHO | COR:VERMELHO | NUM:1,20,33 | VIZ:1@1 | TERM:1@2 | "12"
 * @returns {number[]|null} lista de bc
 */
function resolveBetCodes(spot) {
  const s = String(spot || "").trim();
  if (!s) return null;
  const up = s.toUpperCase();

  if (up.startsWith("COR:")) {
    const c = up.slice(4);
    if (BC[c] === undefined) return null;
    return [BC[c]];
  }
  if (up.startsWith("NUM:")) {
    const codes = [];
    for (const p of up.slice(4).split(",")) {
      const n = parseInt(p.trim(), 10);
      if (!isNaN(n) && n >= 0 && n <= 36) codes.push(n);
    }
    return codes.length ? [...new Set(codes)] : null;
  }
  // VIZ / TERM — PHP já expande de preferência; bridge aceita NUM: se vier expandido
  if (up.startsWith("VIZ:") || up.startsWith("TERM:")) {
    // fallback: não expande roda no Node se PHP mandar cru — pede NUM expandido
    return null;
  }
  if (BC[up] !== undefined) return [BC[up]];
  const n = parseInt(up, 10);
  if (!isNaN(n) && n >= 0 && n <= 36) return [n];
  // lista "1,20,33"
  if (up.includes(",")) {
    const codes = [];
    for (const p of up.split(",")) {
      const x = parseInt(p.trim(), 10);
      if (!isNaN(x) && x >= 0 && x <= 36) codes.push(x);
    }
    return codes.length ? [...new Set(codes)] : null;
  }
  return null;
}

/**
 * Conecta no WS da mesa, espera janela de apostas + gameId, envia lpbet.
 */
/**
 * @param {object} session
 * @param {string} spot
 * @param {number} amount
 * @param {number} timeoutMs
 * @param {number} [protectionAmount] ficha extra no bc=0 (só se 0 não estiver na entrada)
 */
function connectAndPlaceBet(session, spot, amount, timeoutMs, protectionAmount = 0) {
  return new Promise((resolve) => {
    const tableId = session.tableId;
    const jsessionId = session.jsessionId;
    const wsUrl =
      `${session.socketServer}?JSESSIONID=${encodeURIComponent(jsessionId)}` +
      `&tableId=${encodeURIComponent(tableId)}&type=json&version=3&pageRefresh=true`;

    let bcs = resolveBetCodes(spot);
    if ((!bcs || !bcs.length) && session.betCodes && Array.isArray(session.betCodes)) {
      bcs = session.betCodes.map(Number).filter((n) => n >= 0 && n <= 49);
    }
    if (!bcs || !bcs.length) {
      resolve({ ok: false, error: `spot/entrada inválida: ${spot}` });
      return;
    }
    if (bcs.length > 30) {
      resolve({ ok: false, error: `muitos números na entrada (${bcs.length}) — máx 30` });
      return;
    }

    // Lista {bc, amount} — proteção no 0 com valor separado
    const betList = bcs.map((bc) => ({ bc, amount: Number(amount) }));
    const prot = Number(protectionAmount) || 0;
    const alreadyHasZero = bcs.some((bc) => Number(bc) === 0 || Number(bc) === BC.BRANCO);
    if (prot > 0 && !alreadyHasZero) {
      betList.push({ bc: 0, amount: prot });
    }

    const uId = "ppc" + Date.now();
    let gameId = null;
    let betsOpen = false;
    let betSent = false;
    let settled = false;
    const events = [];

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* */
      }
      resolve({
        ...result,
        events,
        tableId,
        gameId,
        bc: betList.map((b) => b.bc),
        protectionAmount: prot > 0 && !alreadyHasZero ? prot : 0,
        betSent,
      });
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        error: "Timeout aguardando janela de apostas / confirmação na mesa Pragmatic",
        code: "TIMEOUT",
      });
    }, timeoutMs || 90000);

    logLine(
      `WS connect table=${tableId} spot=${spot} amt=${amount} bcs=${bcs.join(",")}` +
        (prot > 0 && !alreadyHasZero ? ` prot0=${prot}` : "")
    );

    const ws = new WebSocket(wsUrl, {
      headers: {
        Origin: "https://client.pragmaticplaylive.net",
        "User-Agent": UA,
      },
      handshakeTimeout: 15000,
    });

    const trySendBet = () => {
      if (betSent || settled) return;
      if (!gameId || !betsOpen) return;
      const ck = String(Date.now());
      const xml = buildLpBetXml(tableId, gameId, betList, uId, ck);
      try {
        ws.send(xml);
        betSent = true;
        events.push({
          t: Date.now(),
          type: "bet-sent",
          gameId,
          betList,
          xml: xml.slice(0, 320),
        });
        logLine(
          `lpbet sent gId=${gameId} main=${bcs.join(",")}@${amount}` +
            (prot > 0 && !alreadyHasZero ? ` +0@${prot}` : "")
        );
      } catch (e) {
        finish({ ok: false, error: "Falha ao enviar lpbet: " + e.message });
      }
    };

    ws.on("open", () => {
      events.push({ t: Date.now(), type: "ws-open" });
      logLine("WS open");
    });

    ws.on("message", (raw) => {
      const text = raw.toString();

      // Resposta de comando (sucesso/falha da aposta)
      if (text.includes('"command"') && text.includes("status")) {
        try {
          const j = JSON.parse(text);
          const st = j.command && j.command.status;
          if (st === "success" && betSent) {
            events.push({ t: Date.now(), type: "bet-confirmed", raw: text.slice(0, 160) });
            logLine("bet confirmed success");
            finish({
              ok: true,
              confirmed: true,
              status: "success",
              spot,
              amount,
              bc,
              gameId,
              tableId,
              via: "lpbet",
            });
            return;
          }
          if (st && st !== "success" && betSent) {
            events.push({ t: Date.now(), type: "bet-rejected", status: st, raw: text.slice(0, 200) });
            finish({
              ok: false,
              error: "Aposta rejeitada: " + st,
              code: "BET_REJECTED",
              detail: j.command,
            });
            return;
          }
        } catch {
          /* */
        }
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        // XML de controle — ignora
        return;
      }
      if (!data || typeof data !== "object") return;

      // Extrai gameId de vários formatos Pragmatic
      const gidCandidates = [
        data.gameId,
        data.gameid,
        data.gId,
        data.game && (data.game.gameId || data.game.id || data.game.gameid),
        data.startGame && (data.startGame.gameId || data.startGame.gameid),
        data.table && data.table.gameId,
        data.rng && data.rng.gameid,
      ];
      for (const g of gidCandidates) {
        if (g != null && String(g).length > 3) {
          const gStr = String(g);
          if (gStr !== gameId) {
            gameId = gStr;
            events.push({ t: Date.now(), type: "game-id", gameId });
            trySendBet();
          }
          break;
        }
      }

      // Janela de apostas aberta
      const statusHints = JSON.stringify(data).toLowerCase();
      if (
        data.betsopen != null ||
        data.betsOpen != null ||
        data.BetsOpen != null ||
        /betsopen|place_your_bets|betting|status":"bets|gamestate":"bets/i.test(statusHints)
      ) {
        // se explicitamente fechado, não apostar
        const closed =
          /betsclosed|no_more_bets|dealing|result|closed/i.test(statusHints) &&
          !/betsopen|place_your_bets/i.test(statusHints);
        if (!closed) {
          betsOpen = true;
          events.push({ t: Date.now(), type: "bets-open" });
          trySendBet();
        }
      }

      // timer / startGame costuma indicar rodada ativa com apostas
      if (data.startGame || data.timer || data.time || data.betTime) {
        betsOpen = true;
        trySendBet();
      }

      // se só temos gameId e ainda não enviou, após ~1s força tentativa (muitas mesas já estão open)
      if (gameId && !betSent && !betsOpen) {
        // marca open se recebemos rng (ainda na rodada) — cuidado: rng pode ser late
      }

      // erro explícito
      if (data.error || data.err) {
        events.push({ t: Date.now(), type: "ws-error-msg", data: JSON.stringify(data).slice(0, 160) });
      }
    });

    ws.on("error", (err) => {
      logLine("WS error " + (err && err.message));
      finish({ ok: false, error: "WS error: " + (err && err.message ? err.message : String(err)) });
    });

    ws.on("close", () => {
      if (!settled) {
        if (betSent) {
          // enviou mas não viu success — assume enviado (confirm via feed de resultados)
          finish({
            ok: true,
            confirmed: false,
            betSent: true,
            warning: "WS fechou após envio (sem status success explícito)",
            spot,
            amount,
            bc,
            gameId,
            tableId,
          });
        } else {
          finish({ ok: false, error: "WS fechou antes de enviar aposta", gameId, tableId });
        }
      }
    });

    // fallback: se em 8s temos gameId mas betsOpen nunca veio, tenta mesmo assim
    setTimeout(() => {
      if (!betSent && gameId) {
        betsOpen = true;
        events.push({ t: Date.now(), type: "bets-open-fallback" });
        trySendBet();
      }
    }, 8000);
  });
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
    fail("JSON inválido");
    return;
  }

  const action = payload.action || "place-bet";
  if (action === "ping") {
    ok({ pong: true });
    return;
  }
  if (action !== "place-bet") {
    fail("ação inválida: " + action);
    return;
  }

  const token = String(payload.blazeToken || payload.token || "").trim();
  const spot = String(payload.spot || payload.color || "VERMELHO");
  const amount = Number(payload.amount || 0);
  const protectionAmount = Number(payload.protectionAmount || 0);
  const timeoutMs = Number(payload.timeoutMs || 90000);
  const betCodes = Array.isArray(payload.betCodes) ? payload.betCodes.map(Number) : null;

  if (!token) {
    fail("blazeToken obrigatório");
    return;
  }
  if (!(amount > 0)) {
    fail("amount inválido");
    return;
  }

  const t0 = Date.now();
  logLine(`place-bet INÍCIO spot=${spot} amount=${amount} prot=${protectionAmount || 0}`);

  try {
    const session = await openSession(token);
    if (betCodes && betCodes.length) session.betCodes = betCodes;
    logLine(`session ok table=${session.tableId} slug=${session.slug}`);
    const result = await connectAndPlaceBet(session, spot, amount, timeoutMs, protectionAmount);
    logLine(
      `place-bet FIM ok=${!!result.ok} ms=${Date.now() - t0} err=${result.error || ""} gameId=${result.gameId || ""}`
    );
    if (result.ok) ok({ ...result, ms: Date.now() - t0, slug: session.slug });
    else fail(result.error || "aposta falhou", { ...result, ms: Date.now() - t0 });
  } catch (e) {
    logLine("exception " + e.message);
    fail(e.message || String(e), { code: e.code || null, ms: Date.now() - t0 });
  }
}

main().catch((e) => {
  fail(e && e.message ? e.message : String(e));
});
