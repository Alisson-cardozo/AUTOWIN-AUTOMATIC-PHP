/**
 * Blaze token → play fresh → Chrome → EVOSESSIONID automático
 * Uso: node scripts/test-evo-fresh.cjs <BLAZE_TOKEN>
 */
const https = require("https");
const puppeteer = require("puppeteer-core");

const token = process.argv[2] || process.env.BLAZE_TOKEN;
if (!token) {
  console.error("Passe o token Blaze: node scripts/test-evo-fresh.cjs <token>");
  process.exit(1);
}

function httpsJson(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
          Origin: "https://blaze.bet.br",
          Referer: "https://blaze.bet.br/pt/games/bac-bo",
          Authorization: "Bearer " + token,
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
          ...headers,
        },
      },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(b);
          } catch {
            json = { raw: b.slice(0, 300) };
          }
          resolve({ status: res.statusCode, json, body: b });
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function findUrlDeep(node) {
  if (typeof node === "string" && (node.includes("evo-games.com") || node.includes("/entry"))) return node;
  if (!node || typeof node !== "object") return null;
  for (const v of Object.values(node)) {
    const f = findUrlDeep(v);
    if (f) return f;
  }
  return null;
}

(async () => {
  console.log("1) Blaze /play ...");
  const play = await httpsJson("POST", "https://blaze.bet.br/api/game/bac-bo/play", {
    selected_currency_type: "BRL",
  });
  console.log("play status", play.status);
  const launchUrl =
    play.json?.url ||
    play.json?.game_url ||
    play.json?.launch_options?.game_url ||
    findUrlDeep(play.json);
  if (!launchUrl) {
    console.error("sem launch", play.json);
    process.exit(1);
  }
  console.log("launch", launchUrl.slice(0, 100));

  console.log("2) Chrome headless ...");
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: "new",
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    let evoFromNetwork = null;
    page.on("response", (res) => {
      const u = res.url();
      const m = u.match(/EVOSESSIONID=([a-zA-Z0-9._-]+)/i);
      if (m && m[1].length > 20) evoFromNetwork = m[1];
    });

    await page.goto(launchUrl, { waitUntil: "networkidle2", timeout: 60000 }).catch((e) => {
      console.log("goto warn", e.message);
    });

    // espera redirect SPA
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const url = page.url();
      const m = url.match(/EVOSESSIONID=([a-zA-Z0-9._-]+)/i);
      if (m && m[1].length > 20) {
        console.log("from page url", m[1].slice(0, 40) + "…");
        evoFromNetwork = m[1];
        break;
      }
      const cookies = await page.cookies();
      const c = cookies.find((x) => x.name === "EVOSESSIONID" && x.value && x.value.length > 20);
      if (c) {
        console.log("from cookie", c.value.slice(0, 40) + "…");
        evoFromNetwork = c.value;
        break;
      }
      // hash only
      const hash = await page.evaluate(() => location.href);
      const mh = hash.match(/EVOSESSIONID=([a-zA-Z0-9._-]+)/i);
      if (mh && mh[1].length > 20) {
        console.log("from href", mh[1].slice(0, 40) + "…");
        evoFromNetwork = mh[1];
        break;
      }
      process.stdout.write(".");
    }
    console.log("");
    console.log("finalUrl", page.url().slice(0, 180));
    console.log("EVOSESSIONID", evoFromNetwork ? evoFromNetwork.slice(0, 48) + "…" : null);
    console.log("SUCCESS", !!evoFromNetwork);
    process.exit(evoFromNetwork ? 0 : 2);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
