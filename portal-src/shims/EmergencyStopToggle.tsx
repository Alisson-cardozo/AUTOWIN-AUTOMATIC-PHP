"use client"

import { useEffect, useState } from "react"

export function EmergencyStopToggle() {
  const [active, setActive] = useState<boolean | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    try {
      const r = await fetch("/api/admin/emergency-stop")
      const d = await r.json()
      setActive(!!d.active)
      setPendingCount(d.pendingCount ?? 0)
    } catch {
      setActive((prev) => prev ?? false)
    }
  }

  useEffect(() => {
    refresh()
    // Enquanto tem conta ainda finalizando a aposta atual (pendingStop),
    // o card se atualiza sozinho até esse número zerar.
    const interval = setInterval(refresh, 4000)
    return () => clearInterval(interval)
  }, [])

  async function toggle() {
    if (active === null) return
    const next = !active
    const msg = next
      ? "Isso vai parar AGORA as apostas de todos os clientes ativos, avisar cada um por notificação, e impedir qualquer um de iniciar o bot até você desligar esse interruptor. Confirma?"
      : "Desligar o interruptor de emergência? Os clientes voltam a poder iniciar o bot normalmente."
    if (!confirm(msg)) return

    setBusy(true)
    try {
      const res = await fetch("/api/admin/emergency-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      })
      const data = await res.json()
      setActive(!!data.active)
      if (next) {
        setPendingCount(data.pendingStop ?? 0)
        alert(`${data.stoppedImmediately} bot(s) parados na hora. ${data.pendingStop} bot(s) vão parar assim que a aposta atual terminar.`)
      } else {
        setPendingCount(0)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`rounded-xl border p-5 space-y-3 ${
      active ? "bg-red-500/10 border-red-500/30" : "bg-gray-900 border-gray-800"
    }`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white">Interruptor de Emergência</p>
          <p className="text-xs text-gray-400 mt-1">
            {active === null
              ? "Carregando..."
              : active
              ? "Ativo — nenhum cliente consegue apostar até você desligar."
              : "Desligado — clientes podem iniciar o bot normalmente."}
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={active === null || busy}
          className={`shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${
            active ? "bg-gray-700 hover:bg-gray-600 text-white" : "bg-red-600 hover:bg-red-500 text-white"
          }`}
        >
          {busy ? "..." : active ? "Desligar" : "Parar Tudo"}
        </button>
      </div>

      {active && pendingCount > 0 && (
        <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse shrink-0" />
          <p className="text-xs text-yellow-300">
            {pendingCount} conta(s) ainda finalizando a aposta atual — param assim que o resultado sair.
          </p>
        </div>
      )}
    </div>
  )
}
