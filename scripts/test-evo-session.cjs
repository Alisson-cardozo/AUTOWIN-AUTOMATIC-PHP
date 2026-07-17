/**
 * Testa extração de EVOSESSIONID a partir do launchUrl salvo.
 * node scripts/test-evo-session.cjs
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const sessionFile = path.join(__dirname, "..", "storage", "bacbo-evo", "2.json");
const s = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
console.log("launchUrl:", (s.launchUrl || "").slice(0, 120));
console.log("evoSessionId:", s.evoSessionId);

function request(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: opts.method || "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9",
          ...(opts.headers || {}),
        },
        timeout: 25000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

function mergeCookies(jar, setCookie) {
  if (!setCookie) return jar;
  const parts = (Array.isArray(setCookie) ? setCookie : [setCookie]).map((c) => c.split(";")[0]);
  const map = {};
  for (const c of (jar || "").split(";").map((x) => x.trim()).filter(Boolean)) {
    const i = c.indexOf("=");
    if (i > 0) map[c.slice(0, i)] = c.slice(i + 1);
  }
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i > 0) map[p.slice(0, i)] = p.slice(i + 1);
  }
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

(async () => {
  let current = s.launchUrl;
  let cookies = "";
  let evo = null;
  for (let i = 0; i < 10 && current; i++) {
    console.log("\n--- hop", i, "---");
    console.log("GET", current.slice(0, 160));
    const res = await request(current, {
      headers: {
        Cookie: cookies,
        Referer: "https://blaze.bet.br/",
        Origin: "https://a8-latam.evo-games.com",
      },
    });
    console.log("status", res.status);
    cookies = mergeCookies(cookies, res.headers["set-cookie"]);
    console.log("cookies", cookies.slice(0, 200));
    const mCookie = cookies.match(/EVOSESSIONID=([a-zA-Z0-9]+)/);
    if (mCookie) evo = mCookie[1];
    const mBody = res.body.match(/EVOSESSIONID[=:]["']?([a-zA-Z0-9]+)/);
    if (mBody) evo = mBody[1];
    const loc = res.headers.location;
    console.log("location", loc || "(none)");
    console.log("body head", res.body.slice(0, 300).replace(/\s+/g, " "));
    if (evo) {
      console.log("FOUND EVOSESSIONID", evo.slice(0, 20) + "...");
      break;
    }
    if (loc) {
      current = loc.startsWith("http") ? loc : new URL(loc, current).toString();
      continue;
    }
    // tenta achar URL com EVO no body
    const mUrl = res.body.match(/https?:\/\/[^"'\\\s]*EVOSESSIONID=[a-zA-Z0-9]+[^"'\\\s]*/);
    if (mUrl) {
      current = mUrl[0];
      continue;
    }
    break;
  }
  console.log("\nRESULT evo=", evo, "cookies=", cookies.slice(0, 120));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
