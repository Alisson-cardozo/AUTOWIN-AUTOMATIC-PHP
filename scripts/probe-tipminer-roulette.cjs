const https = require("https");

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/json",
          Origin: "https://www.tipminer.com",
          Referer: "https://www.tipminer.com/br/cassinos/blaze",
        },
      },
      (res) => {
        const c = [];
        res.on("data", (d) => c.push(d));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: Buffer.concat(c).toString("utf8") })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  // try known slug patterns / list
  const urls = [
    "https://api.core.public.tipminer.com/v1/catalog/games?q=mega%20roulette&limit=30",
    "https://api.core.public.tipminer.com/v1/games/search?q=brazilian&limit=30",
    "https://api.core.public.tipminer.com/v1/catalog/search?query=brazilian%20mega&limit=20",
  ];
  for (const url of urls) {
    try {
      const r = await get(url);
      console.log("\n===", url, r.status);
      console.log(r.body.slice(0, 500));
    } catch (e) {
      console.log(url, e.message);
    }
  }
})();
