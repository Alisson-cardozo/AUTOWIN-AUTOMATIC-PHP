import { useEffect, useState } from "react"

const ALL_TABS = [
  { key: "inicio",          label: "Início" },
  { key: "conta",           label: "Conta Blaze" },
  { key: "jonbet",          label: "Conta Jonbet" },
  { key: "jogos-premium",   label: "Jogos Ao Vivo" },
  { key: "premium",         label: "Premium Blaze" },
  { key: "premium-jonbet",  label: "Premium Jonbet" },
  { key: "calculadora",     label: "Calculadora Premium" },
  { key: "notificacoes",    label: "Notificações" },
]

const ALL_GAMES = [
  { key: "DOUBLE",  label: "Double (Blaze/Jonbet)" },
  { key: "CRASH",   label: "Crash (Blaze/Jonbet)" },
  { key: "FORTUNE", label: "Fortune Double" },
  { key: "BACBO",   label: "Bac Bo (Demo)" },
]

const ALL_STRATEGIES = [
  { key: "NÚMEROS",             label: "Números" },
  { key: "COPIAR SALA DE SINAL", label: "Copiar Sala de Sinal" },
  { key: "HORÁRIOS",            label: "Horários" },
  { key: "SEQUÊNCIA",           label: "Sequência" },
]

export default function OcultarRecursosPage() {
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([])
  const [hiddenGames, setHiddenGames] = useState<string[]>([])
  const [hiddenStrategies, setHiddenStrategies] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch("/api/admin/config")
      .then((r) => r.json())
      .then((data) => {
        setHiddenTabs((data.HIDDEN_TABS ?? "").split(",").filter(Boolean))
        setHiddenGames((data.HIDDEN_GAMES ?? "").split(",").filter(Boolean))
        setHiddenStrategies((data.HIDDEN_STRATEGY_TYPES ?? "").split(",").filter(Boolean))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function saveConfig(updates: { HIDDEN_TABS?: string; HIDDEN_GAMES?: string; HIDDEN_STRATEGY_TYPES?: string }) {
    setSaving(true)
    setSaved(false)
    try {
      await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  function handleToggleTab(key: string, checked: boolean) {
    const next = checked ? [...hiddenTabs, key] : hiddenTabs.filter((x) => x !== key)
    setHiddenTabs(next)
    saveConfig({ HIDDEN_TABS: next.join(",") })
  }

  function handleToggleGame(key: string, checked: boolean) {
    const next = checked ? [...hiddenGames, key] : hiddenGames.filter((x) => x !== key)
    setHiddenGames(next)
    saveConfig({ HIDDEN_GAMES: next.join(",") })
  }

  function handleToggleStrategy(key: string, checked: boolean) {
    const next = checked ? [...hiddenStrategies, key] : hiddenStrategies.filter((x) => x !== key)
    setHiddenStrategies(next)
    saveConfig({ HIDDEN_STRATEGY_TYPES: next.join(",") })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400">Carregando configurações...</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Configurações de Abas</h1>
          <p className="text-gray-400 text-sm mt-1">
            Selecione quais abas, jogos e opções de padrões ficarão ocultos para os clientes.
          </p>
        </div>
        {(saving || saved) && (
          <span className={`text-xs px-3 py-1 rounded-full font-medium ${saved ? "bg-green-500/10 text-green-400" : "bg-gray-800 text-gray-400"}`}>
            {saved ? "✓ Configurações salvas!" : "Salvando..."}
          </span>
        )}
      </div>

      {/* 1. OCULTAR ABAS */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center gap-2">
            <span>🗂️</span> Ocultar Abas (Menu Lateral)
          </h2>
          <p className="text-xs text-gray-500 mt-1">As abas selecionadas não aparecerão na barra lateral dos clientes.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ALL_TABS.map((tab) => {
            const isHidden = hiddenTabs.includes(tab.key)
            return (
              <label key={tab.key} className="flex items-center gap-3 cursor-pointer group bg-gray-850 border border-gray-800 hover:border-gray-700/60 rounded-xl px-4 py-3 hover:bg-gray-800/40 transition-all">
                <input
                  type="checkbox"
                  checked={isHidden}
                  onChange={(e) => handleToggleTab(tab.key, e.target.checked)}
                  className="w-4.5 h-4.5 rounded accent-green-500 cursor-pointer"
                />
                <span className="text-sm text-gray-300 group-hover:text-white transition-colors">{tab.label}</span>
                {isHidden && <span className="ml-auto text-[10px] uppercase font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">oculto</span>}
              </label>
            )
          })}
        </div>
      </div>

      {/* 2. OCULTAR JOGOS */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center gap-2">
            <span>🎮</span> Ocultar Jogos
          </h2>
          <p className="text-xs text-gray-500 mt-1">Os jogos selecionados não estarão visíveis no painel premium ou área de apostas.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ALL_GAMES.map((game) => {
            const isHidden = hiddenGames.includes(game.key)
            return (
              <label key={game.key} className="flex items-center gap-3 cursor-pointer group bg-gray-850 border border-gray-800 hover:border-gray-700/60 rounded-xl px-4 py-3 hover:bg-gray-800/40 transition-all">
                <input
                  type="checkbox"
                  checked={isHidden}
                  onChange={(e) => handleToggleGame(game.key, e.target.checked)}
                  className="w-4.5 h-4.5 rounded accent-green-500 cursor-pointer"
                />
                <span className="text-sm text-gray-300 group-hover:text-white transition-colors">{game.label}</span>
                {isHidden && <span className="ml-auto text-[10px] uppercase font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">oculto</span>}
              </label>
            )
          })}
        </div>
      </div>

      {/* 3. OCULTAR OPÇÕES DE PADRÃO */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center gap-2">
            <span>🎯</span> Ocultar Opções de Padrão (Tipos de Estratégia)
          </h2>
          <p className="text-xs text-gray-500 mt-1">Os tipos de estratégia selecionados serão desabilitados para os clientes.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ALL_STRATEGIES.map((strategy) => {
            const isHidden = hiddenStrategies.includes(strategy.key)
            return (
              <label key={strategy.key} className="flex items-center gap-3 cursor-pointer group bg-gray-850 border border-gray-800 hover:border-gray-700/60 rounded-xl px-4 py-3 hover:bg-gray-800/40 transition-all">
                <input
                  type="checkbox"
                  checked={isHidden}
                  onChange={(e) => handleToggleStrategy(strategy.key, e.target.checked)}
                  className="w-4.5 h-4.5 rounded accent-green-500 cursor-pointer"
                />
                <span className="text-sm text-gray-300 group-hover:text-white transition-colors">{strategy.label}</span>
                {isHidden && <span className="ml-auto text-[10px] uppercase font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">oculto</span>}
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}
