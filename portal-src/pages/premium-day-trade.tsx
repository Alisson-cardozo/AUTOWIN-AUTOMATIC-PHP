import { useEffect, useState } from "react"

type Dir = "CALL" | "PUT"

interface ListEntry {
  time: string
  direction: Dir
  asset: string
  confidence: number
  expirationMinutes: number
  strategyType: string
}

const ASSETS: string[] = [
  "EURUSD-OTC", "GBPUSD-OTC", "USDJPY-OTC", "AUDUSD-OTC", "EURGBP-OTC", "EURJPY-OTC",
  "USDCAD-OTC", "USDCHF-OTC", "NZDUSD-OTC", "GBPJPY-OTC", "AUDCAD-OTC",
  "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "EURJPY", "EURGBP",
  "XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD", "USOUSD", "UKOUSD",
  "US30", "USNDAQ100", "USSPX500", "GERMANY30", "UK100",
].sort((a, b) => a.localeCompare(b))

const MODELS: { id: string; name: string; icon: string; exp: number }[] = [
  { id: "SMA_CROSS", name: "Cruzamento SMA 8/21", icon: "📈", exp: 3 },
  { id: "SUPPORT_RES", name: "Suporte e Resistência", icon: "🧱", exp: 3 },
  { id: "RSI_DIV", name: "RSI + Momentum", icon: "📊", exp: 3 },
  { id: "BOLLINGER", name: "Bollinger Bands", icon: "🎀", exp: 3 },
  { id: "TREND_ADX", name: "Tendência (EMA)", icon: "🚀", exp: 5 },
  { id: "CANDLE_PATTERN", name: "Padrões de Velas", icon: "🕯️", exp: 2 },
  { id: "BREAKOUT", name: "Breakout de Canal", icon: "💥", exp: 3 },
  { id: "PSAR_EMA", name: "Parabolic SAR + EMA", icon: "🔵", exp: 3 },
]

const inp =
  "w-full bg-[#0d1117] border border-gray-700/60 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500/60"

export default function PremiumDayTradePage() {
  const [licensed, setLicensed] = useState(true)
  const [checking, setChecking] = useState(true)
  const [connected, setConnected] = useState(false)
  const [modelId, setModelId] = useState("SMA_CROSS")
  const [assets, setAssets] = useState<string[]>(["EURUSD-OTC", "GBPUSD-OTC", "USDJPY-OTC"])
  const [assetSearch, setAssetSearch] = useState("")
  const [count, setCount] = useState(20)
  const [spacing, setSpacing] = useState(3)
  const [startOffset, setStartOffset] = useState(10)
  const [loading, setLoading] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [list, setList] = useState<ListEntry[]>(() => {
    try {
      const s = localStorage.getItem("premium_daytrade_list")
      return s ? JSON.parse(s) : []
    } catch {
      return []
    }
  })
  const [meta, setMeta] = useState<{ strategyName?: string; signalsFound?: number; generatedAt?: string } | null>(
    () => {
      try {
        const s = localStorage.getItem("premium_daytrade_meta")
        return s ? JSON.parse(s) : null
      } catch {
        return null
      }
    }
  )
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch("/api/user/me")
      .then((r) => r.json())
      .then((d) => {
        const ok =
          d.paymentStatus === "PAID" && (!d.expireIn || new Date(d.expireIn) > new Date())
        setLicensed(ok || !!d.isTesting || !!d.isAdminAccount)
      })
      .catch(() => setLicensed(true))
      .finally(() => setChecking(false))

    fetch("/api/daytrade/status")
      .then((r) => r.json())
      .then((d) => setConnected(!!d.connected))
      .catch(() => {})
  }, [])

  function toggleAsset(a: string) {
    setAssets((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]))
  }

  function selectAllVisible() {
    const q = assetSearch.trim().toUpperCase()
    const pool = q ? ASSETS.filter((a) => a.toUpperCase().includes(q)) : [...ASSETS]
    setAssets(pool)
  }

  async function generate() {
    setError("")
    setSuccess("")
    if (!assets.length) {
      setError("Selecione ao menos um ativo.")
      return
    }
    if (!connected) {
      setError("Conecte a IQ Option na aba Day Trade antes de gerar.")
      return
    }
    const model = MODELS.find((m) => m.id === modelId)
    setLoading(true)
    try {
      const res = await fetch("/api/daytrade/premium-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assets,
          strategyType: modelId,
          count,
          spacingMinutes: spacing,
          startOffsetMinutes: startOffset,
          expirationMinutes: model?.exp ?? 3,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error || "Falha ao gerar lista")
        return
      }
      const entries = Array.isArray(d.entries) ? d.entries : []
      setList(entries)
      const m = {
        strategyName: d.strategyName || modelId,
        signalsFound: d.signalsFound ?? 0,
        generatedAt: d.generatedAt || "",
      }
      setMeta(m)
      try {
        localStorage.setItem("premium_daytrade_list", JSON.stringify(entries))
        localStorage.setItem("premium_daytrade_meta", JSON.stringify(m))
      } catch {
        /* */
      }
      setSuccess(`${entries.length} entradas geradas`)
      setTimeout(() => setSuccess(""), 3000)
    } catch {
      setError("Erro de rede ao gerar lista")
    } finally {
      setLoading(false)
    }
  }

  function copyList() {
    const text = list
      .map((e) => `${e.time} ${e.direction === "CALL" ? "🟢 CALL" : "🔴 PUT"} ${e.asset}`)
      .join("\n")
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function pushToBot(replace: boolean) {
    if (!list.length) return
    setPushing(true)
    setError("")
    try {
      const res = await fetch("/api/daytrade/premium-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: list, replace: replace ? 1 : 0 }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error || "Falha ao enviar para o bot")
        return
      }
      setSuccess(`${d.inserted ?? 0} horários enviados para Day Trade`)
      setTimeout(() => setSuccess(""), 4000)
    } catch {
      setError("Erro de rede ao enviar lista")
    } finally {
      setPushing(false)
    }
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        Carregando…
      </div>
    )
  }

  if (!licensed) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-5 py-6 text-amber-300 text-sm">
        Licença necessária para usar o Premium Day Trade. Ative em{" "}
        <a href="/licenca" className="underline font-bold">
          Licença
        </a>
        .
      </div>
    )
  }

  const filteredAssets = ASSETS.filter(
    (a) => !assetSearch.trim() || a.toUpperCase().includes(assetSearch.trim().toUpperCase())
  )

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-r from-emerald-950/40 via-[#0a0f1a] to-[#0a0f1a] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-xl">
            📋
          </div>
          <div>
            <h1 className="text-white text-lg font-black tracking-wide uppercase">
              Premium Day Trade
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Gerador de lista · 20 entradas · ativos + horários + CALL/PUT
            </p>
          </div>
        </div>
      </div>

      {!connected && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-amber-300 text-sm">
          Conecte a IQ Option na aba{" "}
          <a href="/day-trade" className="font-bold underline">
            Day Trade
          </a>{" "}
          para analisar os ativos e gerar a lista.
        </div>
      )}

      {/* Config */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">1. Modelo de análise</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setModelId(m.id)
                setSpacing(m.exp)
              }}
              className={`text-left px-3 py-2.5 rounded-xl border text-xs transition-all ${
                modelId === m.id
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                  : "bg-gray-950 border-gray-800 text-gray-400 hover:border-gray-700"
              }`}
            >
              <span className="mr-1.5">{m.icon}</span>
              {m.name}
              <span className="text-gray-600 ml-1">· exp {m.exp}m</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3 pt-2">
          <div>
            <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">Qtd. entradas</p>
            <input
              type="number"
              min={5}
              max={40}
              value={count}
              onChange={(e) => setCount(Math.max(5, Math.min(40, parseInt(e.target.value, 10) || 20)))}
              className={inp}
            />
          </div>
          <div>
            <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">Espaço (min)</p>
            <input
              type="number"
              min={2}
              max={30}
              value={spacing}
              onChange={(e) => setSpacing(Math.max(2, Math.min(30, parseInt(e.target.value, 10) || 3)))}
              className={inp}
            />
          </div>
          <div>
            <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">Inicia em (min)</p>
            <input
              type="number"
              min={3}
              max={60}
              value={startOffset}
              onChange={(e) =>
                setStartOffset(Math.max(3, Math.min(60, parseInt(e.target.value, 10) || 10)))
              }
              className={inp}
            />
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">
            2. Ativos ({assets.length} sel.)
          </h2>
          <button
            type="button"
            onClick={selectAllVisible}
            className="text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold"
          >
            Selecionar todos
          </button>
        </div>
        <input
          value={assetSearch}
          onChange={(e) => setAssetSearch(e.target.value)}
          placeholder="Buscar ativo…"
          className={inp}
        />
        <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
          {filteredAssets.map((a) => {
            const on = assets.includes(a)
            return (
              <button
                key={a}
                type="button"
                onClick={() => toggleAsset(a)}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${
                  on
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                    : "bg-gray-950 text-gray-500 border-gray-800"
                }`}
              >
                {on ? "✓ " : ""}
                {a}
              </button>
            )
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={generate}
        disabled={loading || !connected || assets.length === 0}
        className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold py-3.5 rounded-xl text-sm transition-colors"
      >
        {loading ? "Analisando ativos e gerando…" : `🎯 Gerar Lista (${count} entradas)`}
      </button>

      {(error || success) && (
        <div
          className={`rounded-xl px-4 py-3 text-sm border ${
            error
              ? "bg-red-500/10 border-red-500/30 text-red-400"
              : "bg-green-500/10 border-green-500/30 text-green-400"
          }`}
        >
          {error || success}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-3 h-20 text-gray-400 text-sm">
          <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          Lendo velas da IQ e montando horários…
        </div>
      )}

      {list.length > 0 && !loading && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b border-gray-800">
            <div>
              <p className="text-white font-semibold text-sm">
                {list.length} entradas · {meta?.strategyName || modelId}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {meta?.signalsFound != null ? `${meta.signalsFound} sinais técnicos · ` : ""}
                fuso America/Sao_Paulo
                {meta?.generatedAt ? ` · ${meta.generatedAt}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copyList}
                className="text-xs font-bold bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg"
              >
                {copied ? "✅ Copiado!" : "📋 Copiar lista"}
              </button>
              <button
                type="button"
                disabled={pushing}
                onClick={() => pushToBot(true)}
                className="text-xs font-bold bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                {pushing ? "Enviando…" : "➡️ Enviar p/ Day Trade"}
              </button>
            </div>
          </div>

          <div className="bg-yellow-500/8 border-b border-yellow-500/20 px-4 py-2.5">
            <p className="text-[11px] text-yellow-300/90">
              ⚠️ Lista por horário (BR). Ao enviar para o Day Trade, o bot opera no minuto exato com
              CALL/PUT e ativo. Recomendado: gales 1–2 e valor mínimo R$ 2.
            </p>
          </div>

          <div className="p-3 space-y-1.5 max-h-96 overflow-y-auto">
            {list.map((e, i) => (
              <div
                key={`${e.time}-${e.asset}-${i}`}
                className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2.5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-white font-mono text-sm font-bold w-12 shrink-0">
                    {e.time}
                  </span>
                  <span
                    className={`text-[10px] font-black px-2 py-0.5 rounded ${
                      e.direction === "CALL"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-red-500/15 text-red-400"
                    }`}
                  >
                    {e.direction === "CALL" ? "🟢 CALL" : "🔴 PUT"}
                  </span>
                  <span className="text-xs text-gray-300 font-mono truncate">{e.asset}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-gray-500">{e.expirationMinutes}m</span>
                  <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full"
                      style={{ width: `${Math.round((e.confidence || 0.5) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
