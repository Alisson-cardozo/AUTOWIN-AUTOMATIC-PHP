#!/usr/bin/env python3
import re
from pathlib import Path
import hashlib

seg = Path.home() / ".grok" / "sessions" / "c%3A%5CUsers%5CAliss%5CDesktop%5Cautowin-php-cp"
cands = set()
patterns = [
    r"VPS_PASS\s*=\s*([^\s\"']+)",
    r"VPS_PASS\s*=\s*[\"']([^\"']+)[\"']",
    r'password\s*=\s*[\"\']([^\"\']{8,40})[\"\']',
    r"password=([^\s\"']{8,40})",
]
for p in seg.rglob("*"):
    if not p.is_file():
        continue
    if p.suffix.lower() not in {".md", ".json", ".jsonl", ".txt", ".log"}:
        continue
    if p.stat().st_size > 20_000_000:
        continue
    try:
        t = p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        continue
    if "187.77" not in t and "VPS_PASS" not in t and "password" not in t:
        continue
    for pat in patterns:
        for m in re.finditer(pat, t, flags=re.I):
            pw = m.group(1).strip().strip("'\"")
            if len(pw) < 8 or len(pw) > 40:
                continue
            if any(x in pw.lower() for x in ("environ", "vps_pass", "http", "root", "path")):
                continue
            cands.add(pw)

# also prompt history
ph = seg / "prompt_history.jsonl"
if ph.is_file():
    t = ph.read_text(encoding="utf-8", errors="ignore")
    for pat in patterns:
        for m in re.finditer(pat, t, flags=re.I):
            pw = m.group(1).strip().strip("'\"")
            if 8 <= len(pw) <= 40:
                cands.add(pw)

out = Path(__file__).with_name("_vps_cands.txt")
out.write_text("\n".join(sorted(cands, key=len)), encoding="utf-8")
for pw in sorted(cands, key=lambda x: (len(x), x)):
    print(f"len={len(pw)} sha={hashlib.sha256(pw.encode()).hexdigest()[:12]}")
print("total", len(cands))
