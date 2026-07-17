/**
 * Feed contínuo de resultados Bac Bo via WebSocket Evolution.
 *
 * Substitui a API bacbominer: escuta bacbo.playerState (stage Confirmation),
 * grava em storage/bacbo-ws/history.json (mais recente primeiro).
 *
 * IMPORTANTE — multi-usuário / apostas REAL:
 *   NÃO usa storage/bacbo-evo/{userId}.json por padrão.
 *   Evolution = 1 WebSocket por EVOSESSIONID. Se o feed "roubar" a sessão
 *   do bot, a aposta REAL falha com connectionAlreadyExists.
 *
 * Sessão do feed (só):
 *   env BACBO_EVOSESSIONID (+ opcional BACBO_TABLE_ID / BACBO_VT_ID)
 *   ou BACBO_FEED_ALLOW_USER_SESSION=1 para reutilizar arquivo de user (dev).
 *
 * Uso:
 *   node bot/bacbo-ws-feed.cjs
 *
 * Resultados do bot em produção: preferir TipMiner (BacBoSource) — não precisa
 * deste feed para apostar.
 */

const fs = require("fs");
const path = require("path");

let WebSocket;
try {
  WebSocket = require("ws");
} catch {
  console.error('[bacbo-ws-feed] pacote "ws" não instalado. npm install ws');
  process.exit(1);
}

// AUTOWIN_ROOT: use quando este script rodar fora do projeto PHP (ex.: Aplicação
// Node.js separada no hPanel) — deve apontar pra pasta que contém "storage/"
// do app PHP, senão o feed grava resultados num storage que o PHP não lê.
const ROOT = process.env.AUTOWIN_ROOT || path.resolve(__dirname, "..");
const SESSION_DIR = path.join(ROOT, "storage", "bacbo-evo");
const OUT_DIR = path.join(ROOT, "storage", "bacbo-ws");
const HISTORY_FILE = path.join(OUT_DIR, "history.json");
const STATUS_FILE = path.join(OUT_DIR, "status.json");
const PID_FILE = path.join(OUT_DIR, "feed.pid");

const DEFAULT_TABLE = "BacBo00000000001";
const DEFAULT_VT = "sp4xxdwvb7ye75c5";
const EVO_HOST = process.env.BACBO_EVO_HOST || "a8-latam.evo-games.com";
const MAX_RESULTS = 300;
const RECONNECT_MS = 4000;

// Fallback pra quando não dá pra configurar env vars pelo painel de hospedagem
// (ex.: Hostinger) — bridge.config.json fica junto deste arquivo, fora do git.
let fileConfig = {};
try {
  fileConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "bridge.config.json"), "utf8"));
} catch {
  /* arquivo opcional */
}

function ensureDirs() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
}

function writeStatus(partial) {
  ensureDirs();
  let prev = {};
  try {
    if (fs.existsSync(STATUS_FILE)) prev = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
  } catch {
    prev = {};
  }
  const next = {
    ...prev,
    ...partial,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(next, null, 0), "utf8");
}

function loadHistory() {
  ensureDirs();
  if (!fs.existsSync(HISTORY_FILE)) {
    return { updatedAt: null, source: "evolution-ws", results: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    if (!data || !Array.isArray(data.results)) {
      return { updatedAt: null, source: "evolution-ws", results: [] };
    }
    return data;
  } catch {
    return { updatedAt: null, source: "evolution-ws", results: [] };
  }
}

function saveHistory(results) {
  ensureDirs();
  const payload = {
    updatedAt: new Date().toISOString(),
    source: "evolution-ws",
    results: results.slice(0, MAX_RESULTS),
  };
  const tmp = HISTORY_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 0), "utf8");
  fs.renameSync(tmp, HISTORY_FILE);
}

function winnerFromDice(p1, p2, b1, b2) {
  const pt = p1 + p2;
  const bt = b1 + b2;
  if (pt > bt) return "PlayerWon";
  if (bt > pt) return "BankerWon";
  return "Tie";
}

function diceById(dice, id) {
  if (!Array.isArray(dice)) return 0;
  for (const d of dice) {
    if (Number(d && d.id) === id) return Number(d.value || 0) || 0;
  }
  // fallback: ordem [p1,p2,b1,b2]
  if (dice.length >= 4 && id >= 1 && id <= 4) {
    const v = dice[id - 1];
    if (typeof v === "number") return v;
    if (v && typeof v.value === "number") return v.value;
  }
  return 0;
}

/**
 * Normaliza um game Confirmation (ou objeto de histórico) para o formato do painel/bot.
 */
function normalizeGame(game, tsHint) {
  if (!game || typeof game !== "object") return null;
  const id = String(game.gameId || game.id || game._id || "");
  if (!id) return null;

  let p1 = 0,
    p2 = 0,
    b1 = 0,
    b2 = 0;
  const dice = game.dice;

  if (Array.isArray(dice) && dice.length >= 4) {
    p1 = diceById(dice, 1);
    p2 = diceById(dice, 2);
    b1 = diceById(dice, 3);
    b2 = diceById(dice, 4);
    // se ids não baterem e tudo zero, tenta ordem
    if (p1 + p2 + b1 + b2 === 0) {
      const vals = dice.map((d) => (typeof d === "number" ? d : Number(d && d.value) || 0));
      if (vals.length >= 4) {
        p1 = vals[0];
        p2 = vals[1];
        b1 = vals[2];
        b2 = vals[3];
      }
    }
  } else {
    p1 = Number(game.diceplayer1 ?? game.player1 ?? game.playerDice1 ?? 0) || 0;
    p2 = Number(game.diceplayer2 ?? game.player2 ?? game.playerDice2 ?? 0) || 0;
    b1 = Number(game.dicebanker1 ?? game.banker1 ?? game.bankerDice1 ?? 0) || 0;
    b2 = Number(game.dicebanker2 ?? game.banker2 ?? game.bankerDice2 ?? 0) || 0;
  }

  // sem dados válidos (todos zero) ignora — ainda pode ser round sem resultado
  if (p1 + p2 + b1 + b2 === 0) {
    // se tiver winningSpot sem dados, ainda não dá pra mostrar dados no painel
    return null;
  }

  const winner = winnerFromDice(p1, p2, b1, b2);
  const createdAt =
    game.settledAt ||
    game.resolvedAt ||
    game.createdAt ||
    game.timestamp ||
    tsHint ||
    new Date().toISOString();

  return {
    _id: id,
    createdAt: String(createdAt),
    diceplayer1: p1,
    diceplayer2: p2,
    dicebanker1: b1,
    dicebanker2: b2,
    winner,
  };
}

function mergeResults(existing, incoming) {
  const map = new Map();
  for (const r of existing) {
    if (r && r._id) map.set(String(r._id), r);
  }
  for (const r of incoming) {
    if (r && r._id) map.set(String(r._id), r);
  }
  // mais recente primeiro (createdAt desc, fallback inserção)
  const list = Array.from(map.values());
  list.sort((a, b) => {
    const ta = Date.parse(a.createdAt || 0) || 0;
    const tb = Date.parse(b.createdAt || 0) || 0;
    if (tb !== ta) return tb - ta;
    return String(b._id).localeCompare(String(a._id));
  });
  return list.slice(0, MAX_RESULTS);
}

function pushResults(list) {
  if (!list || !list.length) return 0;
  const hist = loadHistory();
  const merged = mergeResults(hist.results || [], list);
  const before = (hist.results || []).length;
  saveHistory(merged);
  const added = Math.max(0, merged.length - before) || list.length;
  return added;
}

function findSession() {
  // 1) env dedicado ao FEED (não misturar com sessão de aposta do user)
  if (process.env.BACBO_EVOSESSIONID) {
    return {
      evoSessionId: process.env.BACBO_EVOSESSIONID,
      tableId: process.env.BACBO_TABLE_ID || DEFAULT_TABLE,
      vtId: process.env.BACBO_VT_ID || DEFAULT_VT,
      cookies: process.env.BACBO_EVO_COOKIES || `EVOSESSIONID=${process.env.BACBO_EVOSESSIONID}`,
      source: "env",
    };
  }

  // 2) opcional — NÃO roubar sessão de aposta por padrão
  const allowUser =
    String(process.env.BACBO_FEED_ALLOW_USER_SESSION || "").trim() === "1" || fileConfig.allowUserSession === true;
  if (!allowUser) {
    return null;
  }

  ensureDirs();
  let files = [];
  try {
    files = fs.readdirSync(SESSION_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    files = [];
  }
  files.sort((a, b) => {
    try {
      return fs.statSync(path.join(SESSION_DIR, b)).mtimeMs - fs.statSync(path.join(SESSION_DIR, a)).mtimeMs;
    } catch {
      return 0;
    }
  });

  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, f), "utf8"));
      // permite usar sessão mesmo de aposta (exclusiveBet) para destravar o feed local na VPS
      if (s && s.evoSessionId) {
        return {
          evoSessionId: s.evoSessionId,
          tableId: s.tableId || DEFAULT_TABLE,
          vtId: s.vtId || DEFAULT_VT,
          cookies: s.cookies || `EVOSESSIONID=${s.evoSessionId}`,
          source: "session:" + f,
          userId: s.userId,
        };
      }
    } catch {
      /* next */
    }
  }
  return null;
}

function collectFromMessage(data) {
  const found = [];
  if (!data || typeof data !== "object") return found;

  const tryGame = (game) => {
    if (!game) return;
    const stage = game.stage || "";
    // Confirmation = resultado final; alguns payloads vêm sem stage mas com dice
    if (stage && stage !== "Confirmation" && stage !== "Resolved" && stage !== "Settled") {
      // ainda assim tenta se tiver dice completo e winner
      if (!(Array.isArray(game.dice) && game.dice.length >= 4 && (game.winningSpot || game.winner))) {
        return;
      }
    }
    const n = normalizeGame(game);
    if (n) found.push(n);
  };

  if (data.type === "bacbo.playerState" || data.type === "bacbo.gameState") {
    tryGame(data.args && data.args.game);
  }

  // histórico embutido em vários formatos
  const buckets = [];
  if (data.args) {
    buckets.push(data.args.history, data.args.results, data.args.road, data.args.previousGames, data.args.gamesHistory);
    if (data.args.game) {
      buckets.push(data.args.game.history, data.args.game.results, data.args.game.previousResults);
    }
  }
  buckets.push(data.history, data.results);

  for (const b of buckets) {
    if (!Array.isArray(b)) continue;
    for (const item of b) {
      const n = normalizeGame(item);
      if (n) found.push(n);
    }
  }

  return found;
}

function connectLoop(session) {
  return new Promise((resolve) => {
    const tableId = session.tableId || DEFAULT_TABLE;
    const vtId = session.vtId || DEFAULT_VT;
    const evo = session.evoSessionId;
    const instance = `feed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const wsUrl =
      `wss://${EVO_HOST}/public/bacbo/player/game/${tableId}/socket` +
      `?messageFormat=json&tableConfig=${encodeURIComponent(vtId)}` +
      `&EVOSESSIONID=${encodeURIComponent(evo)}` +
      `&instance=${encodeURIComponent(instance)}` +
      `&client_version=6.20260710.73542.63265-ab3d820afb-r2`;

    writeStatus({
      state: "connecting",
      tableId,
      vtId,
      sessionSource: session.source || "?",
      wsHost: EVO_HOST,
    });
    console.log(`[bacbo-ws-feed] conectando mesa=${tableId} via ${session.source || "?"}`);

    let closed = false;
    const ws = new WebSocket(wsUrl, {
      headers: {
        Origin: `https://${EVO_HOST}`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9",
        Cookie: session.cookies || `EVOSESSIONID=${evo}`,
      },
      handshakeTimeout: 20000,
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

    ws.on("open", () => {
      writeStatus({ state: "connected", tableId, lastOpenAt: new Date().toISOString() });
      console.log("[bacbo-ws-feed] WS aberto — ouvindo resultados");
    });

    ws.on("message", (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const list = collectFromMessage(data);
      if (!list.length) return;
      const hist = loadHistory();
      const beforeIds = new Set((hist.results || []).map((r) => r._id));
      pushResults(list);
      const fresh = list.filter((r) => !beforeIds.has(r._id));
      if (fresh.length) {
        console.log(
          `[bacbo-ws-feed] +${fresh.length} resultado(s): ` +
            fresh
              .slice(0, 3)
              .map((r) => `${r._id.slice(0, 8)} ${r.winner} P${r.diceplayer1}+${r.diceplayer2} B${r.dicebanker1}+${r.dicebanker2}`)
              .join(" | ")
        );
        writeStatus({
          state: "connected",
          lastResultAt: new Date().toISOString(),
          lastResult: fresh[0],
          total: loadHistory().results.length,
        });
      }
    });

    ws.on("error", (err) => {
      console.error("[bacbo-ws-feed] WS error:", err && err.message ? err.message : err);
      writeStatus({ state: "error", lastError: String(err && err.message ? err.message : err) });
    });

    ws.on("close", (code, reason) => {
      const r = reason ? reason.toString() : "";
      console.log(`[bacbo-ws-feed] WS fechou code=${code} ${r}`);
      writeStatus({ state: "disconnected", lastCloseCode: code, lastCloseReason: r });
      done("close");
    });
  });
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

  console.log("[bacbo-ws-feed] iniciado pid=" + process.pid);
  writeStatus({ state: "starting" });

  while (true) {
    const session = findSession();
    if (!session) {
      writeStatus({
        state: "waiting-session",
        lastError:
          "Nenhuma sessão Evolution com EVOSESSIONID. Inicie o bot Bac Bo em REAL (com token) ou defina BACBO_EVOSESSIONID.",
      });
      console.log("[bacbo-ws-feed] aguardando sessão Evolution (storage/bacbo-evo/*.json ou env)...");
      await new Promise((r) => setTimeout(r, 8000));
      continue;
    }

    try {
      await connectLoop(session);
    } catch (e) {
      console.error("[bacbo-ws-feed] falha:", e && e.message ? e.message : e);
      writeStatus({ state: "error", lastError: String(e && e.message ? e.message : e) });
    }
    await new Promise((r) => setTimeout(r, RECONNECT_MS));
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  module.exports = { main };
}
