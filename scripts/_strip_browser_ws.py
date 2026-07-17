# -*- coding: utf-8 -*-
from pathlib import Path
import re

p = Path(r"c:/Users/Aliss/Desktop/autowin-php-cp/bot/bacbo-evo-bridge.cjs")
text = p.read_text(encoding="utf-8")
lines = text.splitlines(keepends=True)

# 1-based inclusive ranges to delete
# 99-119: browser flag stub
# 1544-1856: CHROME_PATH + connectAndBetViaBrowser
out = []
i = 1
while i <= len(lines):
    if i == 99:
        while i <= 119:
            i += 1
        out.append("\n")
        continue
    if i == 1544:
        while i <= 1856:
            i += 1
        out.append("\n")
        continue
    out.append(lines[i - 1])
    i += 1

text2 = "".join(out)

new_connect = """function connectAndBet(session, spot, amount, protectionAmount, timeoutMs) {
  // Somente HTTPS + WebSocket puro (sem Chrome/puppeteer)
  return connectAndBetViaWs(session, spot, amount, protectionAmount, timeoutMs);
}"""

pat = re.compile(
    r"function connectAndBet\(session, spot, amount, protectionAmount, timeoutMs\) \{[\s\S]*?"
    r"return connectAndBetViaWs\(session, spot, amount, protectionAmount, timeoutMs\);\n\}"
)
m = pat.search(text2)
if not m:
    idx = text2.find("function connectAndBet")
    print("FAIL connectAndBet")
    print(repr(text2[idx : idx + 500]) if idx >= 0 else "missing")
    raise SystemExit(1)
text2 = text2[: m.start()] + new_connect + text2[m.end() :]
print("connectAndBet simplified")

# payload handling
pat2 = re.compile(
    r"\n  if \(payload\.useBrowserWs !== undefined && payload\.useBrowserWs !== null\) \{\n"
    r"    setUseBrowserWs\(payload\.useBrowserWs\);\n"
    r"  \}\n"
)
text2, n = pat2.subn("\n", text2)
print("removed payload useBrowserWs:", n)

leftovers = []
for s in [
    "useBrowserWsActive",
    "setUseBrowserWs",
    "getUseBrowserWs",
    "connectAndBetViaBrowser",
    "CHROME_PATH",
    "puppeteer",
    "BACBO_USE_BROWSER_WS",
]:
    if s in text2:
        leftovers.append(s)
if leftovers:
    print("WARN leftovers:", leftovers)
else:
    print("no browser leftovers")

p.write_text(text2, encoding="utf-8")
print("lines now", len(text2.splitlines()))
print("OK")
