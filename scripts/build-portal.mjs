/**
 * Compila as páginas do portal do auto-autowin (Next/React) em bundles IIFE.
 * React/ReactDOM vêm do CDN (globals) — o bundle só tem a UI da página.
 */
import * as esbuild from "esbuild"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const original = path.resolve(root, "../auto-autowin")
const pagesDir = path.join(root, "portal-src", "pages")
const entriesDir = path.join(root, "portal-src", "entries")
const outDir = path.join(root, "public", "assets", "portal")
const shims = path.join(root, "portal-src", "shims")

if (!fs.existsSync(original)) {
  console.error("Original não encontrado em:", original)
  process.exit(1)
}

const pages = [
  "inicio",
  "conta",
  "jonbet",
  "premium",
  "premium-jonbet",
  "jogos-premium",
  "calculadora",
  "notificacoes",
  "aviso",
  "licenca",
  "premium-bacbo",
  "premium-futebol",
  "premium-roletas",
  "estrategias",
]

fs.mkdirSync(pagesDir, { recursive: true })
fs.mkdirSync(entriesDir, { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

function patchContaHiddenGames(src) {
  // 1) Ao carregar, se gameType estiver oculto, troca pro primeiro permitido e salva
  src = src.replace(
    `if (typeof data.hiddenGames === "string") {
        setHiddenGames(data.hiddenGames.split(",").map((g: string) => g.trim()).filter(Boolean))
      }
      if (data.isActive) setActiveTab("bot")`,
    `let hidden = [] as string[]
      if (typeof data.hiddenGames === "string") {
        hidden = data.hiddenGames.split(",").map((g: string) => g.trim()).filter(Boolean)
        setHiddenGames(hidden)
      }
      let gt = data.gameType ?? "DOUBLE"
      if (hidden.includes(gt)) {
        const order = ["DOUBLE", "CRASH", "FORTUNE", "BACBO"]
        gt = order.find((g) => !hidden.includes(g)) || "DOUBLE"
        setGameType(gt)
        fetch("/api/user/conta", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameType: gt }),
        }).catch(() => {})
      } else {
        setGameType(gt)
      }
      if (data.isActive) setActiveTab("bot")`
  )
  // evita setGameType duplicado na linha de cima do original
  src = src.replace(
    `setAccountType(data.accountType ?? "DEMO")
      setGameType(data.gameType ?? "DOUBLE")
      setEmail(data.blazeEmail ?? "")`,
    `setAccountType(data.accountType ?? "DEMO")
      // gameType resolvido abaixo (respeita HIDDEN_GAMES)
      setEmail(data.blazeEmail ?? "")`
  )

  // 2) Grid dinâmico: sem espaço vazio quando há 3 jogos (ex: BACBO oculto)
  src = src.replace(
    `<div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    {
                      key: "DOUBLE",`,
    `<div className={\`grid gap-4 grid-cols-2 \${
                    (() => {
                      const n = ["DOUBLE","CRASH","FORTUNE","BACBO"].filter((k) => !hiddenGames.includes(k)).length
                      return n >= 4 ? "sm:grid-cols-4" : n === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"
                    })()
                  }\`}>
                  {[
                    {
                      key: "DOUBLE",`
  )
  return src
}

function patchJonbetHiddenGames(src) {
  // Mesma lógica se jonbet tiver grid de jogos com hiddenGames
  if (!src.includes("hiddenGames")) return src
  src = src.replace(
    `grid grid-cols-2 sm:grid-cols-3 gap-4`,
    `grid gap-4 grid-cols-2 \${(() => { const n = ["DOUBLE","CRASH","FORTUNE"].filter((k) => !hiddenGames.includes(k)).length; return n >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2" })()}`
  )
  // fix if we broke className - only if pattern existed with template
  return src
}

/** Remove opção SYSTEM / BRANQUINHO de todos os jogos (pedido do produto). */
function stripSystemStrategy(src) {
  // arrays de tipos
  src = src.replace(/, "SYSTEM"/g, "").replace(/"SYSTEM", /g, "")
  // bloco JSX {strategyType === "SYSTEM" && ( ... )}
  src = src.replace(
    /\n\s*\{\s*\/\*\s*──\s*SYSTEM\s*──\s*\*\/\s*\}\s*\n/g,
    "\n"
  )
  src = src.replace(
    /\n\s*\{\s*\/\*\s*──\s*BRANQUINHO DO AUTOWIN\s*──\s*\*\/\s*\}\s*\n/g,
    "\n"
  )
  src = src.replace(
    /\n[ \t]*\{strategyType === "SYSTEM" && \([\s\S]*?\n[ \t]*\)\}\n/g,
    "\n"
  )
  src = src.replace(
    /\n[ \t]*\{strategyType === "BRANQUINHO DO AUTOWIN" && \([\s\S]*?\n[ \t]*\)\}\n/g,
    "\n"
  )
  // InfoCard / if (strategyType === "SYSTEM")
  src = src.replace(
    /\n[ \t]*if \(strategyType === "SYSTEM"\) \{\n(?:[ \t].*\n)*?[ \t]*\}\n/g,
    "\n"
  )
  src = src.replace(
    /\n[ \t]*if \(strategyType === "BRANQUINHO DO AUTOWIN"\) \{\n(?:[ \t].*\n)*?[ \t]*\}\n/g,
    "\n"
  )
  return src
}

/**
 * Preferência: se portal-src/pages/{name}.tsx já existir e for mais novo que o
 * original (ou se USE_LOCAL_PORTAL=1), usa o local — preserva fixes do PHP.
 * Caso contrário copia do auto-autowin e aplica patches.
 */
function loadPageSource(name) {
  const localPage = path.join(pagesDir, `${name}.tsx`)
  const srcPage = path.join(original, "app", "(user-portal)", name, "page.tsx")
  const localSrc = fs.existsSync(localPage) ? fs.readFileSync(localPage, "utf8") : ""
  // Prefer local when it has PHP-port fixes (fmtMoney, stop lock, etc.)
  // or when it's newer than upstream. Avoid overwriting local customizations.
  const hasPhpFixes =
    localSrc.includes("fmtMoney") ||
    localSrc.includes("Finalizando entrada") ||
    localSrc.includes("stopPending")
  const useLocal =
    process.env.USE_LOCAL_PORTAL === "1" ||
    (localSrc &&
      (hasPhpFixes ||
        (fs.existsSync(srcPage) &&
          fs.statSync(localPage).mtimeMs >= fs.statSync(srcPage).mtimeMs)))

  if (useLocal && localSrc) {
    console.log(`  [local] ${name}.tsx`)
    return localSrc
  }
  if (!fs.existsSync(srcPage)) {
    if (fs.existsSync(localPage)) {
      console.log(`  [local-fallback] ${name}.tsx`)
      return fs.readFileSync(localPage, "utf8")
    }
    return null
  }
  console.log(`  [upstream] ${name}.tsx`)
  let src = fs.readFileSync(srcPage, "utf8")
  src = src.replace(/^["']use client["'];?\s*/m, "")
  if (name === "conta") src = patchContaHiddenGames(src)
  if (name === "jonbet") src = patchJonbetHiddenGames(src)
  src = stripSystemStrategy(src)
  // null-safe toFixed (resultProfit/profit podem ser null no histórico)
  if (name === "conta" || name === "jonbet") {
    src = src.replace(
      /entry\.resultProfit !== undefined/g,
      "entry.resultProfit != null && Number.isFinite(Number(entry.resultProfit))"
    )
    src = src.replace(
      /\{isWin \? "\+" : ""\}R\$ \{entry\.resultProfit\.toFixed\(2\)\}/g,
      '{isWin ? "+" : ""}R$ {Number(entry.resultProfit).toFixed(2)}'
    )
    src = src.replace(
      /entry\.profit !== undefined/g,
      "entry.profit != null && Number.isFinite(Number(entry.profit))"
    )
    src = src.replace(
      /\+R\$ \{entry\.profit\.toFixed\(2\)\}/g,
      '+R$ {Number(entry.profit).toFixed(2)}'
    )
    src = src.replace(
      /-R\$ \{entry\.profit\.toFixed\(2\)\}/g,
      '-R$ {Number(entry.profit).toFixed(2)}'
    )
    src = src.replace(
      /R\$ \{entry\.amount\.toFixed\(2\)\}/g,
      'R$ {Number(entry.amount ?? 0).toFixed(2)}'
    )
    src = src.replace(
      /\(entry\.amount \?\? entry\.initialAmount\)\?\.toFixed\(2\) \?\? "—"/g,
      '((v) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(2) : "—" })(entry.amount ?? entry.initialAmount)'
    )
  }
  return src
}

for (const name of pages) {
  let src = loadPageSource(name)
  if (src == null) {
    console.warn("skip missing:", name)
    continue
  }
  fs.writeFileSync(path.join(pagesDir, `${name}.tsx`), src)

  fs.writeFileSync(
    path.join(entriesDir, `${name}.tsx`),
    `import { createRoot } from "react-dom/client"
import React from "react"
import * as PageModule from "../pages/${name}"

function resolvePage(mod: any): React.ComponentType {
  const p = mod?.default ?? mod
  if (typeof p === "function") return p
  if (p && typeof p === "object" && typeof p.default === "function") return p.default
  throw new Error("Export default da página inválido (" + typeof p + ")")
}

function showError(el: HTMLElement, err: unknown) {
  const msg = err instanceof Error ? (err.stack || err.message) : String(err)
  console.error("[portal/${name}]", err)
  el.innerHTML =
    '<div style="padding:24px;color:#f87171;font-family:ui-monospace,monospace;font-size:13px;max-width:900px">' +
    '<p style="font-weight:700;margin:0 0 8px;color:#fca5a5">Erro ao carregar a aba (${name})</p>' +
    '<pre style="white-space:pre-wrap;background:#1f2937;padding:12px;border-radius:8px;border:1px solid #374151;color:#fecaca">' +
    String(msg).replace(/</g, "&lt;") +
    "</pre></div>"
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: unknown) {
    console.error("[portal/${name}] render error", error, info)
  }
  render() {
    if (this.state.error) {
      const msg = this.state.error.stack || this.state.error.message
      return React.createElement(
        "div",
        {
          style: {
            padding: 24,
            color: "#f87171",
            fontFamily: "ui-monospace,monospace",
            fontSize: 13,
            maxWidth: 900,
          },
        },
        React.createElement(
          "p",
          { style: { fontWeight: 700, margin: "0 0 8px", color: "#fca5a5" } },
          "Erro na interface (${name})"
        ),
        React.createElement(
          "pre",
          {
            style: {
              whiteSpace: "pre-wrap",
              background: "#1f2937",
              padding: 12,
              borderRadius: 8,
              border: "1px solid #374151",
              color: "#fecaca",
            },
          },
          String(msg)
        )
      )
    }
    return this.props.children
  }
}

function boot() {
  const el = document.getElementById("portal-root")
  if (!el) {
    console.error("[portal/${name}] #portal-root não encontrado")
    return
  }
  try {
    const Page = resolvePage(PageModule)
    createRoot(el).render(
      React.createElement(ErrorBoundary, null, React.createElement(Page))
    )
  } catch (err) {
    showError(el, err)
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot)
} else {
  boot()
}
`
  )
}

/** Mapeia imports de React para window.React / window.ReactDOM */
const reactGlobalsPlugin = {
  name: "react-globals",
  setup(build) {
    const map = {
      react: "window.React",
      "react-dom": "window.ReactDOM",
      "react-dom/client": "window.ReactDOM",
      "react/jsx-runtime": "window.ReactJSX",
      "react/jsx-dev-runtime": "window.ReactJSX",
    }
    for (const [mod, globalExpr] of Object.entries(map)) {
      build.onResolve({ filter: new RegExp(`^${mod.replace("/", "\\/")}$`) }, () => ({
        path: mod,
        namespace: "react-global",
      }))
      build.onLoad({ filter: new RegExp(`^${mod.replace("/", "\\/")}$`), namespace: "react-global" }, () => {
        // jsx-runtime needs jsx/jsxs/Fragment
        if (mod.includes("jsx-runtime") || mod.includes("jsx-dev-runtime")) {
          return {
            contents: `
              const R = window.React;
              export const Fragment = R.Fragment;
              export const jsx = R.jsx || function(type, props, key) {
                const { children, ...rest } = props || {};
                const p = key !== undefined ? { ...rest, key } : rest;
                return R.createElement(type, p, ...(children === undefined ? [] : Array.isArray(children) ? children : [children]));
              };
              export const jsxs = R.jsxs || jsx;
              export const jsxDEV = jsx;
            `,
            loader: "js",
          }
        }
        if (mod === "react-dom/client") {
          return {
            contents: `
              const RD = window.ReactDOM;
              export const createRoot = RD.createRoot.bind(RD);
              export const hydrateRoot = RD.hydrateRoot ? RD.hydrateRoot.bind(RD) : undefined;
              export default RD;
            `,
            loader: "js",
          }
        }
        if (mod === "react-dom") {
          return {
            contents: `const RD = window.ReactDOM; export default RD; export const createPortal = RD.createPortal;`,
            loader: "js",
          }
        }
        // react
        return {
          contents: `const R = window.React; export default R; export const {
            useState, useEffect, useRef, useMemo, useCallback, useReducer,
            useContext, createContext, createElement, Fragment, Children,
            cloneElement, isValidElement, memo, forwardRef, lazy, Suspense,
            startTransition, useId, useLayoutEffect, useImperativeHandle,
            useDeferredValue, useTransition, useSyncExternalStore, use
          } = R;`,
          loader: "js",
        }
      })
    }
  },
}

const aliasPlugin = {
  name: "portal-aliases",
  setup(build) {
    const map = {
      "@/components/ui/NumberField": path.join(shims, "NumberField.tsx"),
      "@/lib/features": path.join(shims, "features.ts"),
      "@/lib/utils": path.join(shims, "utils.ts"),
      "@/components/dashboard/UsersTable": path.join(shims, "UsersTable.tsx"),
      "@/components/dashboard/StatsCard": path.join(shims, "StatsCard.tsx"),
      "@/components/dashboard/EmergencyStopToggle": path.join(shims, "EmergencyStopToggle.tsx"),
      "next/link": path.join(shims, "next-link.tsx"),
      "next/navigation": path.join(shims, "next-navigation.ts"),
      "next-auth/react": path.join(shims, "next-auth-react.tsx"),
    }
    for (const [filter, target] of Object.entries(map)) {
      build.onResolve(
        { filter: new RegExp(`^${filter.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}$`) },
        () => ({ path: target })
      )
    }
  },
}

function writeEntry(name, importPath) {
  const entry = path.join(entriesDir, `${name}.tsx`)
  fs.writeFileSync(
    entry,
    `import { createRoot } from "react-dom/client"
import React from "react"
import * as PageModule from "${importPath.replace(/\\/g, "/")}"

function resolvePage(mod: any): React.ComponentType {
  const p = mod?.default ?? mod
  if (typeof p === "function") return p
  if (p && typeof p === "object" && typeof p.default === "function") return p.default
  throw new Error("Export default inválido (" + typeof p + ")")
}

function showError(el: HTMLElement, err: unknown) {
  const msg = err instanceof Error ? (err.stack || err.message) : String(err)
  console.error("[portal/${name}]", err)
  el.innerHTML =
    '<div style="padding:24px;color:#f87171;font-family:ui-monospace,monospace;font-size:13px">' +
    '<p style="font-weight:700;margin:0 0 8px">Erro: ${name}</p>' +
    '<pre style="white-space:pre-wrap;background:#1f2937;padding:12px;border-radius:8px">' +
    String(msg).replace(/</g, "&lt;") + "</pre></div>"
}

function boot() {
  const el = document.getElementById("portal-root")
  if (!el) return
  try {
    createRoot(el).render(React.createElement(resolvePage(PageModule)))
  } catch (err) {
    showError(el, err)
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot)
else boot()
`
  )
  return entry
}

const entryPoints = pages
  .map((n) => path.join(entriesDir, `${n}.tsx`))
  .filter((p) => fs.existsSync(p))

// ─── Admin pages ───────────────────────────────────────────────
const adminPagesDir = path.join(root, "portal-src", "admin-pages")
const adminOriginal = [
  "financeiro",
  "comunicacao",
  "padroes",
  "sistema",
]
const adminLocal = ["dashboard", "users", "configuracoes"]

const adminEntries = []

for (const name of adminOriginal) {
  const srcPage = path.join(original, "app", "(dashboard)", name, "page.tsx")
  if (!fs.existsSync(srcPage)) {
    console.warn("admin skip:", name)
    continue
  }
  let src = fs.readFileSync(srcPage, "utf8")
  src = src.replace(/^["']use client["'];?\s*/m, "")
  const dest = path.join(adminPagesDir, `${name}.tsx`)
  fs.mkdirSync(adminPagesDir, { recursive: true })
  fs.writeFileSync(dest, src)
  adminEntries.push(writeEntry(`admin-${name}`, path.join(adminPagesDir, name)))
}

for (const name of adminLocal) {
  const dest = path.join(adminPagesDir, `${name}.tsx`)
  if (!fs.existsSync(dest)) {
    console.warn("admin local missing:", name)
    continue
  }
  adminEntries.push(writeEntry(`admin-${name}`, path.join(adminPagesDir, name)))
}

console.log(`Building ${entryPoints.length} user + ${adminEntries.length} admin pages...`)

await esbuild.build({
  entryPoints: [...entryPoints, ...adminEntries],
  bundle: true,
  outdir: outDir,
  entryNames: "[name]",
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  jsx: "automatic",
  loader: { ".tsx": "tsx", ".ts": "ts", ".jsx": "jsx", ".js": "js" },
  plugins: [reactGlobalsPlugin, aliasPlugin],
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  minify: true,
  sourcemap: true,
  logLevel: "info",
})

console.log("Portal bundles → public/assets/portal/")
for (const name of [...pages, ...adminOriginal.map((n) => `admin-${n}`), ...adminLocal.map((n) => `admin-${n}`)]) {
  const f = path.join(outDir, `${name}.js`)
  if (fs.existsSync(f)) {
    console.log(`  ${name}.js  ${(fs.statSync(f).size / 1024).toFixed(1)} KB`)
  }
}
