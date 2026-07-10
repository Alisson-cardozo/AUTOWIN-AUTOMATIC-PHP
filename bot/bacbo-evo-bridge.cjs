/**
 * Bridge Evolution Bac Bo — multi-usuário isolado.
 *
 * Cada userId tem sessão própria em storage/bacbo-evo/{userId}.json
 * Nenhum estado global compartilhado entre usuários.
 *
 * Ações (JSON stdin → JSON stdout):
 *   ensure-session | place-bet | clear-session
 *
 * Protocolo capturado:
 *   type: "bacbo.bet"
 *   args.betMap: { player, tie, banker }
 *   args.actions: Chipstack → Player|Banker|Tie
 *   stage: "AcceptingBets"
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

const DEFAULT_TABLE = "PorBacBo00000001";
const DEFAULT_VT = "sp4xxdwvb7ye75c5";
const EVO_HOST = "a8-latam.evo-games.com";

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

function httpRequest(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === "https:" ? https : http;
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "pt-BR,pt;q=0.9",
      ...(opts.headers || {}),
    };
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: opts.method || "GET",
        headers,
        timeout: opts.timeout || 25000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body,
            url: urlStr,
          });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout HTTP"));
    });
    if (opts.body) req.write(opts.body);
    req.end();
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

async function blazePlay(blazeToken) {
  const res = await httpRequest("https://blaze.bet.br/api/games/bac-bo/play", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${blazeToken}`,
      "Content-Type": "application/json",
      Origin: "https://blaze.bet.br",
      Referer: "https://blaze.bet.br/pt/games/bac-bo",
      "x-client-language": "pt",
    },
    body: JSON.stringify({ selected_currency_type: "BRL" }),
  });
  let data = {};
  try {
    data = JSON.parse(res.body);
  } catch {
    data = { raw: res.body };
  }
  const launchUrl =
    data.game_url ||
    data.url ||
    data.launch_url ||
    data.gameUrl ||
    (data.data && (data.data.game_url || data.data.url || data.data.launch_url)) ||
    findUrlDeep(data);

  return { status: res.status, data, launchUrl };
}

function parseEvoFromUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string") return null;
  try {
    const u = new URL(urlStr);
    const evo =
      u.searchParams.get("EVOSESSIONID") ||
      (urlStr.match(/EVOSESSIONID=([a-zA-Z0-9]+)/) || [])[1] ||
      null;
    const jsid = u.searchParams.get("JSESSIONID");
    let tableId = u.searchParams.get("table_id") || DEFAULT_TABLE;
    let vtId = u.searchParams.get("vt_id") || u.searchParams.get("tableConfig") || DEFAULT_VT;
    const paramsB64 = u.searchParams.get("params");
    if (paramsB64) {
      try {
        const decoded = Buffer.from(paramsB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
        const mTable = decoded.match(/table_id=([^\n\r&]+)/);
        const mVt = decoded.match(/vt_id=([^\n\r&]+)/);
        if (mTable) tableId = mTable[1].trim();
        if (mVt) vtId = mVt[1].trim();
      } catch {
        /* ignore */
      }
    }
    return { evoSessionId: evo, jsessionId: jsid, tableId, vtId, entryUrl: urlStr };
  } catch {
    return null;
  }
}

async function followToEvoSession(launchUrl) {
  // Segue entry e tenta extrair EVOSESSIONID da URL final / set-cookie / body
  let current = launchUrl;
  let evoSessionId = null;
  let tableId = DEFAULT_TABLE;
  let vtId = DEFAULT_VT;
  let cookies = "";

  for (let i = 0; i < 6 && current; i++) {
    const parsed = parseEvoFromUrl(current);
    if (parsed) {
      if (parsed.evoSessionId) evoSessionId = parsed.evoSessionId;
      if (parsed.tableId) tableId = parsed.tableId;
      if (parsed.vtId) vtId = parsed.vtId;
    }
    if (evoSessionId && current.includes("EVOSESSIONID=")) break;

    const res = await httpRequest(current, {
      method: "GET",
      headers: {
        Origin: "https://a8-latam.evo-games.com",
        Referer: "https://cdn-3.launcher.a8r.games/",
        Cookie: cookies,
      },
    });

    const setCookie = res.headers["set-cookie"];
    if (setCookie) {
      const parts = (Array.isArray(setCookie) ? setCookie : [setCookie]).map((c) => c.split(";")[0]);
      cookies = parts.join("; ");
      for (const p of parts) {
        if (p.startsWith("EVOSESSIONID=")) {
          evoSessionId = p.slice("EVOSESSIONID=".length);
        }
      }
    }

    // Location redirect
    const loc = res.headers.location;
    if (loc) {
      current = loc.startsWith("http") ? loc : new URL(loc, current).toString();
      continue;
    }

    // body pode ter EVOSESSIONID
    const m = res.body.match(/EVOSESSIONID=([a-zA-Z0-9]+)/);
    if (m) evoSessionId = m[1];
    const mTable = res.body.match(/table_id[=:]["']?([A-Za-z0-9_]+)/);
    if (mTable) tableId = mTable[1];
    break;
  }

  if (!evoSessionId) {
    const p = parseEvoFromUrl(launchUrl);
    if (p && p.evoSessionId) evoSessionId = p.evoSessionId;
  }

  return { evoSessionId, tableId, vtId, cookies, launchUrl };
}

async function ensureSession(userId, blazeToken, launchUrlHint) {
  let launchUrl = launchUrlHint || null;
  if (!launchUrl) {
    const play = await blazePlay(blazeToken);
    if (play.status >= 400) {
      return {
        ok: false,
        error: `Blaze /play falhou HTTP ${play.status}`,
        detail: typeof play.data === "object" ? play.data : String(play.data).slice(0, 200),
      };
    }
    launchUrl = play.launchUrl;
    if (!launchUrl) {
      return {
        ok: false,
        error: "Resposta /play sem URL de launch Evolution. Verifique token e se o jogo está liberado.",
        playStatus: play.status,
        playKeys: play.data && typeof play.data === "object" ? Object.keys(play.data) : [],
      };
    }
  }

  const evo = await followToEvoSession(launchUrl);
  if (!evo.evoSessionId) {
    // Ainda assim grava launchUrl — place-bet pode usar WS se session vier no hint
    writeSession(userId, {
      blazeTokenHint: blazeToken.slice(0, 12) + "…",
      launchUrl,
      tableId: evo.tableId || DEFAULT_TABLE,
      vtId: evo.vtId || DEFAULT_VT,
      evoSessionId: null,
      cookies: evo.cookies || "",
    });
    return {
      ok: false,
      error: "Não foi possível extrair EVOSESSIONID do launch. Abra o Bac Bo no browser uma vez ou envie launchUrl completa.",
      launchUrl: launchUrl.slice(0, 120) + "…",
    };
  }

  writeSession(userId, {
    blazeTokenHint: blazeToken.slice(0, 12) + "…",
    launchUrl,
    tableId: evo.tableId || DEFAULT_TABLE,
    vtId: evo.vtId || DEFAULT_VT,
    evoSessionId: evo.evoSessionId,
    cookies: evo.cookies || `EVOSESSIONID=${evo.evoSessionId}`,
  });

  return {
    ok: true,
    tableId: evo.tableId || DEFAULT_TABLE,
    vtId: evo.vtId || DEFAULT_VT,
    evoSessionId: evo.evoSessionId.slice(0, 12) + "…",
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

function buildBetMessage(gameId, spot, amount, protectionAmount) {
  const { betMap, actions } = spotToMap(spot, amount, protectionAmount);
  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    type: "bacbo.bet",
    args: {
      gameId,
      betTags: {
        mwLayout: "8",
        openMwTables: "1",
        latency: String(150 + Math.floor(Math.random() * 120)),
        videoProtocol: "fmp4",
        btVideoQuality: "9",
        btTableView: "0",
        orientation: "landscape",
      },
      betMap,
      actions,
    },
  };
}

function connectAndBet(session, spot, amount, protectionAmount, timeoutMs) {
  return new Promise((resolve) => {
    const tableId = session.tableId || DEFAULT_TABLE;
    const vtId = session.vtId || DEFAULT_VT;
    const evo = session.evoSessionId;
    const instance = `bot${session.userId || "0"}-${Date.now().toString(36)}-${vtId}`;
    const wsUrl =
      `wss://${EVO_HOST}/public/bacbo/player/game/${tableId}/socket` +
      `?messageFormat=json&tableConfig=${encodeURIComponent(vtId)}` +
      `&EVOSESSIONID=${encodeURIComponent(evo)}` +
      `&instance=${encodeURIComponent(instance)}` +
      `&client_version=6.20260710.73542.63265-ab3d820afb-r2`;

    let settled = false;
    let currentGameId = null;
    let betSent = false;
    let lastStage = null;

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
        error: "Timeout aguardando AcceptingBets / confirmação de aposta",
        lastStage,
        betSent,
        gameId: currentGameId,
      });
    }, timeoutMs);

    const ws = new WebSocket(wsUrl, {
      headers: {
        Origin: `https://${EVO_HOST}`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9",
        Cookie: session.cookies || `EVOSESSIONID=${evo}`,
      },
      handshakeTimeout: 15000,
    });

    ws.on("open", () => {
      // só espera playerState
    });

    ws.on("message", (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!data || typeof data !== "object") return;

      if (data.type === "bacbo.playerState") {
        const game = (data.args && data.args.game) || {};
        currentGameId = game.gameId || game.id || currentGameId;
        lastStage = game.stage || lastStage;

        // Confirmação
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
          });
          return;
        }

        // Envia na janela de apostas
        const open =
          game.stage === "AcceptingBets" ||
          game.stage === "WaitingForBets" ||
          game.stage === "BetsOpen";
        if (open && !betSent && currentGameId) {
          const msg = buildBetMessage(currentGameId, spot, amount, protectionAmount);
          try {
            ws.send(JSON.stringify(msg));
            betSent = true;
          } catch (e) {
            clearTimeout(timer);
            finish({ ok: false, error: "Falha ao enviar bacbo.bet: " + e.message });
          }
        }

        // Se já enviou e fechou bets com lastGameBets
        if (betSent && game.stage === "ClosingBets") {
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
          error: betSent ? "WS fechou após envio (sem confirmação explícita)" : "WS fechou antes de apostar",
          betSent,
          lastStage,
          gameId: currentGameId,
          tableId,
        });
      }
    });
  });
}

async function placeBet(userId, blazeToken, spot, amount, protectionAmount, launchUrl, timeoutMs) {
  let session = readSession(userId);
  if (!session || !session.evoSessionId) {
    const ens = await ensureSession(userId, blazeToken, launchUrl);
    if (!ens.ok) return ens;
    session = readSession(userId);
  }
  if (!session || !session.evoSessionId) {
    return { ok: false, error: "Sessão Evolution ausente para este usuário." };
  }

  session.userId = userId;
  const result = await connectAndBet(session, spot, amount, protectionAmount || 0, timeoutMs || 45000);

  // Se falhou por sessão morta, tenta renovar 1x
  if (!result.ok && /EVOSESSION|401|403|closed|WS error/i.test(String(result.error || ""))) {
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
      ok({ pong: true });
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
