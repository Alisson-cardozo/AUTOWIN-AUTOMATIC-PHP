import { createRoot } from "react-dom/client"
import React from "react"
import * as PageModule from "../pages/premium-bacbo"

function resolvePage(mod: any): React.ComponentType {
  const p = mod?.default ?? mod
  if (typeof p === "function") return p
  if (p && typeof p === "object" && typeof p.default === "function") return p.default
  throw new Error("Export default da página inválido (" + typeof p + ")")
}

function showError(el: HTMLElement, err: unknown) {
  const msg = err instanceof Error ? err.stack || err.message : String(err)
  console.error("[portal/premium-bacbo-live]", err)
  el.innerHTML =
    '<div style="padding:24px;color:#f87171;font-family:ui-monospace,monospace;font-size:13px;max-width:900px">' +
    '<p style="font-weight:700;margin:0 0 8px;color:#fca5a5">Erro ao carregar a aba (premium-bacbo-live)</p>' +
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
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[portal/premium-bacbo-live] render error", error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 text-red-400">
          <p className="font-bold mb-2">Erro na interface (premium-bacbo-live)</p>
          <pre className="text-xs whitespace-pre-wrap">{this.state.error.message}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

const rootEl = document.getElementById("portal-root")
if (!rootEl) {
  console.error("[portal/premium-bacbo-live] #portal-root não encontrado")
} else {
  try {
    const Page = resolvePage(PageModule)
    createRoot(rootEl).render(
      <ErrorBoundary>
        <Page />
      </ErrorBoundary>
    )
  } catch (err) {
    showError(rootEl, err)
  }
}
