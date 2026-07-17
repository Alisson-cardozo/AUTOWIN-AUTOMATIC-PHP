/**
 * Diagnóstico detalhado do chain entry → EVOSESSIONID (sem Chrome).
 * Uso: node scripts/probe-evo-entry-hops.cjs [userId]
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const uid = process.argv[2] || "2";
const sessionFile = path.join(ROOT, "storage", "bacbo-evo", `${uid}.json`);

// precisa launchUrl — se não tem sessão, falha
let launchUrl = process.argv[3] || null;
if (!launchUrl && fs.existsSync(sessionFile)) {
  const s = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
  launchUrl = s.launchUrl;
}
if (!launchUrl) {
  console.error("sem launchUrl");
  process.exit(1);
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function req(urlStr, { method = "GET", headers = {}, cookie = "", maxRedir = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const h = {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept-Encoding": "identity",
      Connection: "keep-alive",
      ...headers,
    };
    if (cookie) h.Cookie = cookie;
    const r = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: h,
        timeout: 25000,
        // força TLS1.2+
        minVersion: "TLSv1.2",
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            url: urlStr,
          });
        });
      }
    );
    r.on("error", reject);
    r.on("timeout", () => {
      r.destroy();
      reject(new Error("timeout"));
    });
    r.end();
  });
}

function mergeCookies(jar, setCookie) {
  const map = {};
  for (const c of String(jar || "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean)) {
    const i = c.indexOf("=");
    if (i > 0) map[c.slice(0, i)] = c.slice(i + 1);
  }
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const sc of arr) {
    const p = sc.split(";")[0];
    const i = p.indexOf("=");
    if (i > 0) map[p.slice(0, i)] = p.slice(i + 1);
  }
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

(async () => {
  console.log("launch", launchUrl.slice(0, 140));
  let cookies = "";
  let current = launchUrl;

  // Warm-up Blaze homepage (como Python acessar_pagina_inicial)
  try {
    const warm = await req("https://blaze.bet.br/", {
      headers: { Accept: "text/html" },
    });
    cookies = mergeCookies(cookies, warm.headers["set-cookie"]);
    console.log("warm blaze", warm.status, "cookies", cookies.slice(0, 80));
  } catch (e) {
    console.log("warm fail", e.message);
  }

  for (let i = 0; i < 6 && current; i++) {
    console.log("\n=== hop", i, "===");
    console.log("GET", current.slice(0, 160));
    const variants = [
      {
        name: "browser-nav",
        headers: {
          Referer: i === 0 ? "https://blaze.bet.br/" : current,
          Origin: i === 0 ? "https://blaze.bet.br" : "https://a8-latam.evo-games.com",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": i === 0 ? "cross-site" : "same-origin",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
          "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "Cache-Control": "max-age=0",
        },
      },
    ];

    const v = variants[0];
    const res = await req(current, { headers: v.headers, cookie: cookies });
    cookies = mergeCookies(cookies, res.headers["set-cookie"]);
    console.log("status", res.status);
    console.log("location", res.headers.location || "(none)");
    console.log("set-cookie count", (res.headers["set-cookie"] || []).length);
    console.log("cookie jar head", cookies.slice(0, 200));
    console.log("body head", res.body.slice(0, 250).replace(/\s+/g, " "));
    const evo =
      (cookies.match(/EVOSESSIONID=([a-zA-Z0-9._-]{20,})/) || [])[1] ||
      (res.body.match(/EVOSESSIONID=([a-zA-Z0-9._-]{20,})/) || [])[1] ||
      ((res.headers.location || "").match(/EVOSESSIONID=([a-zA-Z0-9._-]{20,})/) || [])[1];
    if (evo) {
      console.log("FOUND EVO", evo.slice(0, 40) + "... len=" + evo.length);
      break;
    }
    if (res.status === 403) {
      console.log("AKAMAI 403 body sample:", res.body.slice(0, 400));
      // tenta setup path se houver jsession
      const m = current.match(/JSESSIONID=([^&]+)/);
      if (m) {
        const setup = `https://a8-latam.evo-games.com/setup?device=desktop&wrapped=true&JSESSIONID=${m[1]}`;
        console.log("\ntry setup", setup.slice(0, 100));
        const sres = await req(setup, {
          headers: {
            Referer: "https://a8-latam.evo-games.com/",
            Origin: "https://a8-latam.evo-games.com",
          },
          cookie: cookies,
        });
        console.log("setup status", sres.status, "loc", sres.headers.location);
        console.log("setup body", sres.body.slice(0, 300));
      }
      break;
    }
    if (res.headers.location) {
      let loc = res.headers.location;
      if (loc.startsWith("/")) loc = "https://a8-latam.evo-games.com" + loc;
      current = loc;
      continue;
    }
    break;
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
