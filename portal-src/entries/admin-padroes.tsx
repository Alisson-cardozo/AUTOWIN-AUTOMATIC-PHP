import { createRoot } from "react-dom/client"
import React from "react"
import * as PageModule from "C:/Users/Aliss/Desktop/autowin-php-cp/portal-src/admin-pages/padroes"

function resolvePage(mod: any): React.ComponentType {
  const p = mod?.default ?? mod
  if (typeof p === "function") return p
  if (p && typeof p === "object" && typeof p.default === "function") return p.default
  throw new Error("Export default inválido (" + typeof p + ")")
}

function showError(el: HTMLElement, err: unknown) {
  const msg = err instanceof Error ? (err.stack || err.message) : String(err)
  console.error("[portal/admin-padroes]", err)
  el.innerHTML =
    '<div style="padding:24px;color:#f87171;font-family:ui-monospace,monospace;font-size:13px">' +
    '<p style="font-weight:700;margin:0 0 8px">Erro: admin-padroes</p>' +
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
