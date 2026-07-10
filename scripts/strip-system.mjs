import fs from "fs"

function cleanSource(t) {
  t = t.split(', "SYSTEM"').join("").split('"SYSTEM", ').join("")
  t = t.replace(/\n\s*\{\/\* ── SYSTEM ── \*\/\}\n/g, "\n")
  t = t.replace(/\n\s*\{\/\* ── BRANQUINHO DO AUTOWIN ── \*\/\}\n/g, "\n")
  t = t.replace(
    /\n[ \t]*\{strategyType === "SYSTEM" && \([\s\S]*?\n[ \t]*\)\}\n/g,
    "\n"
  )
  t = t.replace(
    /\n[ \t]*\{strategyType === "BRANQUINHO DO AUTOWIN" && \([\s\S]*?\n[ \t]*\)\}\n/g,
    "\n"
  )
  t = t.replace(
    /\n[ \t]*if \(strategyType === "SYSTEM"\) \{\n(?:[ \t].*\n)*?[ \t]*\}\n/g,
    "\n"
  )
  t = t.replace(
    /\n[ \t]*if \(strategyType === "BRANQUINHO DO AUTOWIN"\) \{\n(?:[ \t].*\n)*?[ \t]*\}\n/g,
    "\n"
  )
  return t
}

function cleanBundle(t) {
  // remove from minified arrays
  t = t.split(',"SYSTEM"').join("").split('"SYSTEM",').join("")
  t = t.split(', "SYSTEM"').join("").split('"SYSTEM", ').join("")
  // remove dead UI branches r==="SYSTEM"&&...  is large; array removal is enough
  // for dropdown. Also kill r==="SYSTEM"&&t(...) simple short-circuit by renaming
  // remaining literal so it never matches
  t = t.split('r==="SYSTEM"').join('r==="__REMOVED_SYSTEM__"')
  t = t.split('r==="BRANQUINHO DO AUTOWIN"').join('r==="__REMOVED__"')
  return t
}

const srcFiles = [
  "portal-src/pages/conta.tsx",
  "portal-src/pages/jonbet.tsx",
  "portal-src/pages/estrategias.tsx",
]
for (const f of srcFiles) {
  const o = fs.readFileSync(f, "utf8")
  const t = cleanSource(o)
  fs.writeFileSync(f, t)
  const n = (t.match(/SYSTEM/g) || []).length
  console.log("src", f, "SYSTEM=", n, "changed=", t !== o)
}

const jsFiles = [
  "public/assets/portal/conta.js",
  "public/assets/portal/jonbet.js",
  "public/assets/portal/estrategias.js",
]
for (const f of jsFiles) {
  if (!fs.existsSync(f)) continue
  const o = fs.readFileSync(f, "utf8")
  const t = cleanBundle(o)
  fs.writeFileSync(f, t)
  const n = (t.match(/"SYSTEM"/g) || []).length
  console.log("js", f, '"SYSTEM"=', n, "changed=", t !== o)
}
