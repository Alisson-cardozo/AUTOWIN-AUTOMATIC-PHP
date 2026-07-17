/**
 * Probe WS da sala BacBo com sessão salva (sem apostar).
 * node scripts/test-ws-probe.cjs [userId] [seconds]
 */
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const ROOT = path.resolve(__dirname, "..");
const uid = process.argv[2] || "2";
const secs = Number(process.argv[3] || 12);
const s = JSON.parse(fs.readFileSync(path.join(ROOT, "storage", "bacbo-evo", `${uid}.json`), "utf8"));

const tableId = s.tableId || "BacBo00000000001";
const vtId = s.vtId || "sp4xxdwvb7ye75c5";
const evo = s.evoSessionId;
const evo16 = evo.slice(0, 16);
const instance = `probe1-${evo16}-${vtId}`;
const clientVersion = "6.20260710.73542.63265-ab3d820afb-r2";
const wsUrl =
  `wss://a8-latam.evo-games.com/public/bacbo/player/game/${tableId}/socket` +
  `?messageFormat=json&tableConfig=${vtId}` +
  `&EVOSESSIONID=${evo}` +
  `&instance=${instance}` +
  `&client_version=${clientVersion}`;

console.log("table", tableId, "vt", vtId);
console.log("evo", evo.slice(0, 24) + "…");
console.log("url", wsUrl.slice(0, 140) + "…");

const ws = new WebSocket(wsUrl, {
  headers: {
    Origin: "https://a8-latam.evo-games.com",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    Cookie: s.cookies || `EVOSESSIONID=${evo}`,
  },
});

let states = 0;
ws.on("open", () => {
  console.log("WS open");
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
});

ws.on("message", (raw) => {
  let d;
  try {
    d = JSON.parse(raw.toString());
  } catch {
    console.log("non-json", String(raw).slice(0, 120));
    return;
  }
  if (d.type === "bacbo.playerState") {
    states++;
    const g = (d.args && d.args.game) || {};
    console.log(
      "playerState",
      "stage=",
      g.stage,
      "gameId=",
      g.gameId || g.id,
      "time=",
      d.time
    );
  } else if (d.type === "bacbo.bettingStats") {
    console.log("bettingStats gameId=", d.args && d.args.gameId);
  } else if (d.type && d.type.startsWith("connection")) {
    console.log("CONN", d.type, JSON.stringify(d).slice(0, 200));
  } else if (d.type) {
    console.log("msg", d.type);
  }
});

ws.on("error", (e) => console.error("error", e.message));
ws.on("close", (c, r) => {
  console.log("close", c, String(r));
  console.log("states received:", states);
  process.exit(states > 0 ? 0 : 1);
});

setTimeout(() => {
  console.log("timeout, closing… states=", states);
  try {
    ws.close();
  } catch {
    /* */
  }
  setTimeout(() => process.exit(states > 0 ? 0 : 1), 500);
}, secs * 1000);
