/**
 * Descobre como o gamblingcounting gera o hash do WS.
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        headers: { "User-Agent": UA, Accept: "*/*", ...headers },
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  const page = await get("https://gamblingcounting.com/pt-BR/pragmatic-mega-roulette-brazilian", {
    Accept: "text/html",
  });
  console.log("page status", page.status, "len", page.body.length);
  const out = path.join(__dirname, "../storage/logs/gc-page.html");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, page.body);

  // asset refs
  const assets = [...page.body.matchAll(/\/assets\/[A-Za-z0-9._-]+\.js/g)].map((m) => m[0]);
  console.log("assets", assets.slice(0, 15));

  // look for hash/ws in html
  const hashInHtml = page.body.match(/hash[=:]["']?([a-f0-9]{32,})/i);
  const wsInHtml = page.body.match(/wss?:\/\/[^"'\\\s]+/g);
  console.log("hashInHtml", hashInHtml && hashInHtml[1]);
  console.log("wsInHtml", wsInHtml);

  // fetch main index js
  const indexJs = assets.find((a) => /index\./.test(a)) || assets[0];
  if (indexJs) {
    const js = await get("https://gamblingcounting.com" + indexJs, {
      Referer: "https://gamblingcounting.com/pt-BR/pragmatic-mega-roulette-brazilian",
    });
    console.log("js", indexJs, "status", js.status, "len", js.body.length);
    fs.writeFileSync(path.join(__dirname, "../storage/logs/gc-index.js"), js.body);
    const hits = [];
    for (const re of [
      /ondigitalocean[^"'`\s]*/g,
      /ws\?hash[^"'`\s]*/g,
      /hash["'\s:=]+[a-f0-9]{20,}/gi,
      /\/api\/[^"'`\s]{0,80}/g,
      /liveGame[A-Za-z]*/g,
      /squid-app[^"'`\s]*/g,
    ]) {
      const m = js.body.match(re);
      if (m) hits.push({ re: String(re), sample: m.slice(0, 10) });
    }
    console.log("js hits", JSON.stringify(hits, null, 2).slice(0, 3000));
  }

  // try common auth/ws endpoints
  for (const p of [
    "/api/ws",
    "/api/hash",
    "/api/auth/guest",
    "/api/guest",
    "/api/socket",
    "/api/v1/ws-token",
    "/api/live/hash",
  ]) {
    try {
      const r = await get("https://gamblingcounting.com" + p, {
        Accept: "application/json",
        Referer: "https://gamblingcounting.com/pt-BR/pragmatic-mega-roulette-brazilian",
      });
      console.log("try", p, r.status, r.body.slice(0, 180).replace(/\s+/g, " "));
    } catch (e) {
      console.log("try", p, "err", e.message);
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
