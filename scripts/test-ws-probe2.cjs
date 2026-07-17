const WebSocket = require("ws");
const evo = process.argv[2] || "ttxi56p4gkuqhjndt5h6mmah5dcg565edd0d708d1c9eddf7f2aa809712eebc62643dda81aa54e310";
const table = "BacBo00000000001";
const vt = "sp4xxdwvb7ye75c5";
const inst = "tc3y22-" + evo.slice(0, 16) + "-" + vt;
const url =
  "wss://a8-latam.evo-games.com/public/bacbo/player/game/" +
  table +
  "/socket?messageFormat=json&tableConfig=" +
  vt +
  "&EVOSESSIONID=" +
  evo +
  "&instance=" +
  inst +
  "&client_version=6.20260710.73542.63265-ab3d820afb-r2";

console.log("evo len", evo.length, evo.slice(0, 28));
console.log("connecting...");

const ws = new WebSocket(url, {
  headers: {
    Origin: "https://a8-latam.evo-games.com",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Cookie: "EVOSESSIONID=",
  },
  perMessageDeflate: true,
});

ws.on("open", () => {
  console.log("open readyState=", ws.readyState);
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

ws.on("message", (d, isBin) => {
  console.log("MSG bin=", !!isBin, "len=", d.length, String(d).slice(0, 400));
});

ws.on("ping", () => console.log("ping"));
ws.on("pong", () => console.log("pong"));
ws.on("unexpected-response", (req, res) => {
  console.log("unexpected", res.statusCode);
  res.on("data", (c) => console.log(c.toString().slice(0, 300)));
});
ws.on("error", (e) => console.log("err", e.message));
ws.on("close", (c, r) => console.log("close", c, String(r || "")));

setTimeout(() => {
  console.log("timeout exit");
  process.exit(0);
}, 15000);
