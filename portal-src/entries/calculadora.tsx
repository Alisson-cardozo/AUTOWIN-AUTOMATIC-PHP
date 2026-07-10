import { createRoot } from "react-dom/client"
import React from "react"
import * as PageModule from "../pages/calculadora"

function resolvePage(mod: any): React.ComponentType {
  const p = mod?.default ?? mod
  if (typeof p === "function") return p
  if (p && typeof p === "object" && typeof p.default === "function") return p.default
  throw new Error("Export default da página inválido (" + typeof p + ")")
}

function showError(el: HTMLElement, err: unknown) {
  const msg = err instanceof Error ? (err.stack || err.message) : String(err)
  console.error("[portal/calculadora]", err)
  el.innerHTML =
    '<div style="padding:24px;color:#f87171;font-family:ui-monospace,monospace;font-size:13px;max-width:900px">' +
    '<p style="font-weight:700;margin:0 0 8px;color:#fca5a5">Erro ao carregar a aba (calculadora)</p>' +
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
    console.error("[portal/calculadora] render error", error, info)
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
          "Erro na interface (calculadora)"
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
    console.error("[portal/calculadora] #portal-root não encontrado")
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
