const https = require("https");
const fs = require("fs");
const path = require("path");

const raw = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../storage/logs/bacbo-play-raw.json"), "utf8")
);
const launch = raw.url;
const opts = raw.launch_options || {};
const jsid = new URL(launch).searchParams.get("JSESSIONID");
const tokenId = opts.token_id;

function request(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body != null ? (typeof body === "string" ? body : JSON.stringify(body)) : null;
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
          Accept: "*/*",
          "Accept-Language": "pt-BR,pt;q=0.9",
          Referer: "https://blaze.bet.br/pt/games/bac-bo",
          Origin: "https://blaze.bet.br",
          ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
          ...headers,
        },
      },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: b,
          })
        );
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log("token_id", tokenId);
  console.log("jsid", jsid && jsid.slice(0, 20));
  console.log("launcher", opts.game_launcher_url);

  const html = await request("GET", opts.game_launcher_url);
  console.log("launcher html", html.status, html.body.length);
  const scripts = [...html.body.matchAll(/src=["']([^"']+)["']/g)].map((m) => m[1]);
  console.log("scripts", scripts.slice(0, 15));

  // fetch first few scripts for API hints
  for (const src of scripts.slice(0, 5)) {
    const full = src.startsWith("http") ? src : new URL(src, opts.game_launcher_url).toString();
    try {
      const js = await request("GET", full);
      const hits = js.body.match(/EVOSESSION|session|entry|token_id|softswiss|launch/gi) || [];
      console.log("script", full.slice(-40), "hits", hits.length, "sample", [...new Set(hits)].slice(0, 12).join(","));
      const apiHits = js.body.match(/https?:\/\/[a-z0-9._/-]+(?:api|session|entry|config)[a-z0-9._/-]*/gi) || [];
      if (apiHits.length) console.log("  apis", [...new Set(apiHits)].slice(0, 10));
    } catch (e) {
      console.log("script err", e.message);
    }
  }

  // SoftSwiss style endpoints
  const tries = [
    ["GET", `https://cdn-3.launcher.a8r.games/api/v1/launcher/token/${tokenId}`],
    ["GET", `https://cdn-3.launcher.a8r.games/api/v1/games/${tokenId}`],
    ["POST", "https://cdn-3.launcher.a8r.games/api/v1/launcher/start", { token_id: tokenId }],
    ["POST", "https://iframe.a8r.games/api/v1/launcher/start", { token_id: tokenId, url: launch }],
    ["GET", `https://blaze.bet.br/api/game/bac-bo/play`],
  ];

  for (const t of tries) {
    const [method, url, body] = t;
    try {
      const r = await request(method, url, body || null);
      console.log(method, url, r.status, r.body.slice(0, 180).replace(/\s+/g, " "));
    } catch (e) {
      console.log(method, url, "ERR", e.message);
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
