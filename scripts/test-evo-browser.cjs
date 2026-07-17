/**
 * Testa captura automática de EVOSESSIONID via Chrome local (igual browser).
 * node scripts/test-evo-browser.cjs
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../storage/logs/bacbo-play-raw.json"), "utf8"));
const launchUrl = raw.url;

(async () => {
  console.log("Chrome:", CHROME);
  console.log("Launch:", launchUrl.slice(0, 100));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--window-size=1280,800",
    ],
    defaultViewport: { width: 1280, height: 800 },
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const found = { evo: null, cookies: [] };
    page.on("response", async (res) => {
      try {
        const url = res.url();
        if (url.includes("EVOSESSIONID=")) {
          const m = url.match(/EVOSESSIONID=([a-zA-Z0-9._-]+)/);
          if (m) found.evo = m[1];
        }
        const sc = res.headers()["set-cookie"];
        if (sc && String(sc).includes("EVOSESSIONID")) {
          const m = String(sc).match(/EVOSESSIONID=([a-zA-Z0-9._-]+)/);
          if (m) found.evo = m[1];
        }
      } catch {
        /* */
      }
    });

    await page.goto(launchUrl, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => null);
    await new Promise((r) => setTimeout(r, 5000));

    const cookies = await page.cookies();
    found.cookies = cookies.map((c) => `${c.name}=${c.value.slice(0, 16)}…`);
    const evoCookie = cookies.find((c) => c.name === "EVOSESSIONID");
    if (evoCookie) found.evo = evoCookie.value;

    console.log("url after", page.url().slice(0, 150));
    console.log("cookies", found.cookies);
    console.log("EVOSESSIONID", found.evo ? found.evo.slice(0, 24) + "…" : null);
    console.log("OK", !!found.evo);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
