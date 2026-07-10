# -*- coding: utf-8 -*-
from pathlib import Path
import re

FILES = [
    Path("portal-src/pages/conta.tsx"),
    Path("portal-src/pages/jonbet.tsx"),
    Path("portal-src/pages/estrategias.tsx"),
]


def clean(path: Path) -> None:
    raw = path.read_bytes()
    # detect encoding
    try:
        t = raw.decode("utf-8")
        enc = "utf-8"
    except UnicodeDecodeError:
        t = raw.decode("latin-1")
        enc = "latin-1"

    orig = t
    t = t.replace(', "SYSTEM"', "")
    t = t.replace('"SYSTEM", ', "")

    t = re.sub(
        r"\n\s*\{/\* ── SYSTEM ── \*/\}\s*\n\s*\{strategyType === \"SYSTEM\" && \([\s\S]*?\n\s*\)\}\s*\n",
        "\n",
        t,
    )
    t = re.sub(
        r"\n\s*\{strategyType === \"SYSTEM\" && \([\s\S]*?\n\s*\)\}\s*\n",
        "\n",
        t,
    )
    t = re.sub(
        r"\n\s*\{/\* ── BRANQUINHO DO AUTOWIN ── \*/\}\s*\n\s*\{strategyType === \"BRANQUINHO DO AUTOWIN\" && \([\s\S]*?\n\s*\)\}\s*\n",
        "\n",
        t,
    )
    t = re.sub(
        r"\n\s*\{strategyType === \"BRANQUINHO DO AUTOWIN\" && \([\s\S]*?\n\s*\)\}\s*\n",
        "\n",
        t,
    )
    t = re.sub(
        r"\n\s*if \(strategyType === \"SYSTEM\"\) \{\n(?:[ \t].*\n)*?[ \t]*\}\n",
        "\n",
        t,
    )
    t = re.sub(
        r"\n\s*if \(strategyType === \"BRANQUINHO DO AUTOWIN\"\) \{\n(?:[ \t].*\n)*?[ \t]*\}\n",
        "\n",
        t,
    )

    path.write_bytes(t.encode(enc))
    print(f"{path.name}: enc={enc} SYSTEM={t.count('SYSTEM')} changed={t != orig}")


if __name__ == "__main__":
    for f in FILES:
        clean(f)
