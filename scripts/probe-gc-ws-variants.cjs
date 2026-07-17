const WebSocket = require("ws");

const BASE = "wss://squid-app-67gkf.ondigitalocean.app";
const HASH = "0638b7a825d3798540e4eb917cda32dad5425cc22108edb46d721a0f17f48b10";

const variants = [
  `${BASE}/ws?hash=${HASH}`,
  `${BASE}/ws`,
  `${BASE}/`,
  `${BASE}/socket.io/?EIO=4&transport=websocket`,
  `${BASE}/ws?hash=${HASH}&game=8-287`,
  `${BASE}/ws?token=${HASH}`,
];

const headers = {
  Origin: "https://gamblingcounting.com",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

function tryOne(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers, handshakeTimeout: 8000 });
    let got = null;
    const t = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      resolve({ url, got: got || "timeout" });
    }, 6000);
    ws.on("open", () => {
      got = (got || "") + " open";
    });
    ws.on("message", (d) => {
      got = "msg:" + d.toString().slice(0, 200);
      clearTimeout(t);
      try {
        ws.close();
      } catch {}
      resolve({ url, got });
    });
    ws.on("error", (e) => {
      clearTimeout(t);
      resolve({ url, got: "err:" + e.message });
    });
    ws.on("close", (c, r) => {
      if (!got || got === " open") got = `close ${c} ${r}`;
    });
  });
}

(async () => {
  for (const u of variants) {
    const r = await tryOne(u);
    console.log(JSON.stringify(r));
  }
})();
