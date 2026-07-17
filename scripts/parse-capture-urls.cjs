const fs = require("fs");
const path = require("path");

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "prompt_92.txt") out.push(p);
  }
  return out;
}

const files = walk("C:/Users/Aliss/.grok/sessions");
const f = files[0];
if (!f) {
  console.error("prompt not found");
  process.exit(1);
}
console.log("file", f);
const c = fs.readFileSync(f, "utf8");
const paths = new Set();
const re = /https?:\/\/[^\s'"\\]+/g;
let m;
while ((m = re.exec(c))) {
  let u = m[0].replace(/[,;]+$/, "");
  if (!u.includes("evo-games") && !u.includes("blaze")) continue;
  try {
    const url = new URL(u);
    paths.add(url.origin + url.pathname);
  } catch {
    /* */
  }
}
console.log([...paths].sort().join("\n"));
console.log("---count", paths.size);
const evo = (c.match(/EVOSESSIONID=([a-zA-Z0-9]{40,})/) || [])[1];
console.log("evo", evo ? evo.slice(0, 48) + "…" : null);
const fp = (c.match(/X-Fingerprint:\s*([^\s\\]+)/) || [])[1];
console.log("fingerprint header sample", fp);
