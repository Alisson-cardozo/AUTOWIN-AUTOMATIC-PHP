const WebSocket = require("ws");

const WS =
  process.env.GC_WS_URL ||
  "wss://squid-app-67gkf.ondigitalocean.app/ws?hash=0638b7a825d3798540e4eb917cda32dad5425cc22108edb46d721a0f17f48b10";

const ws = new WebSocket(WS, {
  headers: {
    Origin: "https://gamblingcounting.com",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  },
});

let n = 0;
ws.on("open", () => console.log("open"));
ws.on("message", (raw) => {
  n++;
  const s = raw.toString();
  let j;
  try {
    j = JSON.parse(s);
  } catch {
    console.log("non-json", s.slice(0, 200));
    return;
  }
  console.log("msg full", JSON.stringify(j).slice(0, 800));
  console.log(
    "msg",
    n,
    "type=",
    j.type,
    "event=",
    j.event,
    "keys=",
    j.data && typeof j.data === "object" ? Object.keys(j.data).slice(0, 8) : null
  );
  if (j.event === "liveGameFullData" && j.data && j.data["8-287"]) {
    const r = j.data["8-287"].df && j.data["8-287"].df.result;
    console.log("8-287 results sample", Array.isArray(r) ? r.slice(0, 5) : r);
  }
  if (n >= 8) {
    ws.close();
    process.exit(0);
  }
});
ws.on("error", (e) => {
  console.error("err", e.message);
  process.exit(1);
});
ws.on("close", (c, r) => {
  console.log("close", c, r && r.toString());
});
setTimeout(() => {
  console.log("timeout msgs=", n);
  process.exit(n > 0 ? 0 : 2);
}, 20000);
