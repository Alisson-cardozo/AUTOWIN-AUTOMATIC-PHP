const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const raw = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../storage/logs/bacbo-play-raw.json"), "utf8")
);
const out = path.join(__dirname, "../storage/logs/evo-browser-test.txt");
const log = (s) => {
  fs.appendFileSync(out, s + "\n");
  console.log(s);
};
fs.writeFileSync(out, "");

(async () => {
  log("start");
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: "new",
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
  });
  log("browser ok");
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
  );
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  log("goto " + raw.url.slice(0, 80));
  await page.goto(raw.url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => log("goto err " + e.message));
  await new Promise((r) => setTimeout(r, 6000));
  const url = page.url();
  log("finalUrl " + url);
  const m = url.match(/EVOSESSIONID=([a-zA-Z0-9._-]+)/i);
  log("fromUrl " + (m ? m[1] : "null"));
  const cookies = await page.cookies();
  for (const c of cookies) {
    if (/EVO|SESSION|JSESSION/i.test(c.name)) {
      log(`cookie ${c.name} len=${c.value.length} val=${c.value.slice(0, 48)}`);
    }
  }
  // try all frames
  for (const frame of page.frames()) {
    try {
      const fu = frame.url();
      if (fu.includes("EVOSESSION") || fu.includes("evo-games")) log("frame " + fu.slice(0, 160));
    } catch {
      /* */
    }
  }
  await browser.close();
  log("done");
})().catch((e) => {
  log("FAIL " + e.stack);
  process.exit(1);
});
