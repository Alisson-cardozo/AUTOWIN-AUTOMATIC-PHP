import { useEffect, useState } from "react"

const ALL_TABS = [
  { key: "inicio",          label: "Início" },
  { key: "conta",           label: "Conta Blaze" },
  { key: "jonbet",          label: "Conta Jonbet" },
  { key: "day-trade",       label: "Day Trade" },
  { key: "premium-day-trade", label: "Premium Day Trade" },
  { key: "jogos-premium",   label: "Jogos Ao Vivo" },
  { key: "premium",         label: "Premium Blaze" },
  { key: "premium-jonbet",  label: "Premium Jonbet" },
  { key: "calculadora",     label: "Calculadora Premium" },
  { key: "notificacoes",    label: "Notificações" },
]

const GAMES_BLAZE = [
  { key: "DOUBLE",  label: "Double" },
  { key: "FORTUNE", label: "Fortune Double" },
  { key: "BACBO",   label: "Bac Bo" },
  { key: "BACBO_LIVE", label: "Bac Bo Ao Vivo" },
  { key: "ROLETA",  label: "Mega Roulette - Brazilian" },
]

const GAMES_JONBET = [
  { key: "DOUBLE",  label: "Double" },
  { key: "FORTUNE", label: "Fortune Double" },
]

const LIVE_GAMES = [
  { key: "bacbo",   label: "Bac Bo (Premium)" },
  { key: "bacbo-live", label: "Bac Bo Ao Vivo (Premium)" },
  { key: "futebol", label: "Futebol Studio" },
  { key: "roletas", label: "Roletas Ao Vivo" },
]

// Cada aba com sub-itens tem sua própria config key — ocultar um jogo numa
// aba não afeta as outras (ex: ocultar Bac Bo em Conta Blaze não mexe em
// Conta Jonbet, nem no card "Bac Bo Ao Vivo" de Jogos Ao Vivo).
const TAB_SUBGAMES: Record<string, { configKey: string; items: { key: string; label: string }[] } | null> = {
  inicio: null,
  conta: { configKey: "HIDDEN_GAMES_CONTA_BLAZE", items: GAMES_BLAZE },
  jonbet: { configKey: "HIDDEN_GAMES_CONTA_JONBET", items: GAMES_JONBET },
  "day-trade": null,
  "premium-day-trade": null,
  "jogos-premium": { configKey: "HIDDEN_LIVE_GAMES", items: LIVE_GAMES },
  premium: { configKey: "HIDDEN_GAMES_PREMIUM_BLAZE", items: GAMES_BLAZE.filter((g) => g.key === "DOUBLE" || g.key === "FORTUNE") },
  "premium-jonbet": { configKey: "HIDDEN_GAMES_PREMIUM_JONBET", items: GAMES_JONBET },
  calculadora: null,
  notificacoes: null,
}

const ALL_STRATEGIES = [
  { key: "NÚMEROS",             label: "Números" },
  { key: "COPIAR SALA DE SINAL", label: "Copiar Sala de Sinal" },
  { key: "HORÁRIOS",            label: "Horários" },
  { key: "SEQUÊNCIA",           label: "Sequência" },
]

export default function OcultarRecursosPage() {
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([])
  const [hiddenByConfigKey, setHiddenByConfigKey] = useState<Record<string, string[]>>({})
  const [hiddenStrategies, setHiddenStrategies] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const allConfigKeys = Array.from(
    new Set(Object.values(TAB_SUBGAMES).filter(Boolean).map((s) => s!.configKey))
  )

  useEffect(() => {
    fetch("/api/admin/config")
      .then((r) => r.json())
      .then((data) => {
        setHiddenTabs((data.HIDDEN_TABS ?? "").split(",").filter(Boolean))
        const byKey: Record<string, string[]> = {}
        for (const key of allConfigKeys) {
          byKey[key] = (data[key] ?? "").split(",").filter(Boolean)
        }
        setHiddenByConfigKey(byKey)
        setHiddenStrategies((data.HIDDEN_STRATEGY_TYPES ?? "").split(",").filter(Boolean))
        setLoading(false)
      })
      .catch(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function saveConfig(updates: Record<string, string>) {
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

  function handleToggleSubgame(configKey: string, gameKey: string, checked: boolean) {
    const current = hiddenByConfigKey[configKey] ?? []
    const next = checked ? [...current, gameKey] : current.filter((x) => x !== gameKey)
    setHiddenByConfigKey((prev) => ({ ...prev, [configKey]: next }))
    saveConfig({ [configKey]: next.join(",") })
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
            Para cada aba, oculte ela inteira ou só alguns jogos/cards de dentro dela — cada aba tem sua própria lista, independente das outras.
          </p>
        </div>
        {(saving || saved) && (
          <span className={`text-xs px-3 py-1 rounded-full font-medium ${saved ? "bg-green-500/10 text-green-400" : "bg-gray-800 text-gray-400"}`}>
            {saved ? "✓ Configurações salvas!" : "Salvando..."}
          </span>
        )}
      </div>

      {/* 1. OCULTAR ABAS + SUB-ITENS */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-widest flex items-center gap-2">
            <span>🗂️</span> Ocultar Abas e Jogos
          </h2>
          <p className="text-xs text-gray-500 mt-1">Oculte a aba inteira, ou mantenha ela visível e oculte só alguns jogos de dentro dela.</p>
        </div>
        <div className="space-y-2">
          {ALL_TABS.map((tab) => {
            const isHidden = hiddenTabs.includes(tab.key)
            const sub = TAB_SUBGAMES[tab.key]
            return (
              <div key={tab.key} className="bg-gray-850 border border-gray-800 rounded-xl px-4 py-3 space-y-3">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={isHidden}
                    onChange={(e) => handleToggleTab(tab.key, e.target.checked)}
                    className="w-4.5 h-4.5 rounded accent-green-500 cursor-pointer"
                  />
                  <span className="text-sm text-gray-300 group-hover:text-white transition-colors">{tab.label}</span>
                  {isHidden && <span className="ml-auto text-[10px] uppercase font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">oculto</span>}
                </label>
                {sub && (
                  <div className="pl-8 space-y-2">
                    <p className="text-[11px] text-gray-500">Ou oculte só alguns jogos, mantendo a aba visível:</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {sub.items.map((game) => {
                        const hiddenList = hiddenByConfigKey[sub.configKey] ?? []
                        const gameHidden = hiddenList.includes(game.key)
                        return (
                          <label key={game.key} className="flex items-center gap-2 cursor-pointer group bg-gray-900 border border-gray-800 hover:border-gray-700/60 rounded-lg px-3 py-2 hover:bg-gray-800/40 transition-all">
                            <input
                              type="checkbox"
                              checked={gameHidden}
                              onChange={(e) => handleToggleSubgame(sub.configKey, game.key, e.target.checked)}
                              className="w-4 h-4 rounded accent-green-500 cursor-pointer"
                            />
                            <span className="text-xs text-gray-300 group-hover:text-white transition-colors">{game.label}</span>
                            {gameHidden && <span className="ml-auto text-[9px] uppercase font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded-full border border-red-500/20">oculto</span>}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 2. OCULTAR OPÇÕES DE PADRÃO */}
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
