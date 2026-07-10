import { useEffect, useState } from "react"

interface UserData {
  name: string
  accountType: string
  gameType: string
  isActive: boolean
  isBetting: boolean
  paymentStatus: string
  expireIn: string | null
  isTesting: boolean
  hasToken: boolean
  isAdminAccount: boolean
}

interface PlatformSummary {
  balance: number
  firstBalance: number
  countWin: number
  countLoss: number
  monthCountWin: number
  monthCountLoss: number
  profitToday: number
  lossToday: number
  profitMonth: number
}

interface Summary {
  blaze: PlatformSummary
  jonbet: PlatformSummary
  combinedProfitToday: number
  combinedProfitMonth?: number
  monthCountWin?: number
  monthCountLoss?: number
  monthLabel?: string
}

interface BotEntry {
  id: number
  type: string
  gameType?: string | null
  signalColor: string | null
  resultColor: string | null
  pattern: string | null
  betAmount: number | null
  profit: number | null
  galeLevel: number | null
  platform: string
  createdAt: string
}

function money(v: number) {
  return `R$ ${v.toFixed(2)}`
}

export default function InicioPage() {
  const [user, setUser] = useState<UserData | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [entries, setEntries] = useState<BotEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  // Filters
  const [filterPlatform, setFilterPlatform] = useState<"TODOS" | "BLAZE" | "JONBET">("TODOS")
  const [filterGame, setFilterGame] = useState<"TODOS" | "DOUBLE" | "CRASH" | "FORTUNE" | "BACBO">("TODOS")
  const [filterResult, setFilterResult] = useState<"TODOS" | "WIN" | "LOSS">("TODOS")

  async function loadData() {
    try {
      const [resMe, resSummary, resEntries] = await Promise.all([
        fetch("/api/user/me"),
        fetch("/api/user/dashboard-summary"),
        fetch("/api/user/bot-entries"),
      ])
      
      if (resMe.ok) setUser(await resMe.json())
      if (resSummary.ok) setSummary(await resSummary.json())
      if (resEntries.ok) {
        const data = await resEntries.json()
        setEntries(Array.isArray(data) ? data : [])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    const iv = setInterval(loadData, 12000)
    return () => clearInterval(iv)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-12 h-12">
            <div className="w-12 h-12 rounded-full border-4 border-gray-800 border-t-green-500 animate-spin" />
            <div className="absolute inset-2 rounded-full border-4 border-gray-800 border-b-blue-500 animate-spin-reverse" />
          </div>
          <p className="text-gray-400 text-sm font-semibold tracking-wider animate-pulse">Carregando painel...</p>
        </div>
      </div>
    )
  }

  // Relatório do mês: apenas WIN/LOSS finais (gale intermediário não conta no placar)
  const monthlyResults = entries.filter((e) => e.type === "WIN" || e.type === "LOSS")

  const filtered = monthlyResults.filter((entry) => {
    const platMatch = filterPlatform === "TODOS" || (entry.platform || "").toUpperCase() === filterPlatform
    const gt = (entry.gameType || "").toUpperCase()
    const gameMatch = filterGame === "TODOS" || gt === filterGame
    const resultMatch = filterResult === "TODOS" || entry.type === filterResult
    return platMatch && gameMatch && resultMatch
  })

  // Cumulative profit for SVG graph
  let runningProfit = 0
  const realChartPoints = filtered
    .slice()
    .reverse()
    .map((entry, idx) => {
      runningProfit += entry.profit ?? 0
      return { idx, profit: runningProfit, label: new Date(entry.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) }
    })

  const hasChartData = realChartPoints.length >= 2
  const activePoints = realChartPoints

  const profits = activePoints.map((p) => p.profit)
  const minProfit = profits.length > 0 ? Math.min(...profits, 0) : 0
  const maxProfit = profits.length > 0 ? Math.max(...profits, 1) : 1
  const profitSpan = maxProfit - minProfit || 1

  // Relatório mensal (fonte: bot_entries + monthCount* no summary)
  const monthWinsFromList = filtered.filter((e) => e.type === "WIN").length
  const monthLossesFromList = filtered.filter((e) => e.type === "LOSS").length
  const monthProfitFromList = filtered.reduce((acc, e) => acc + (e.profit ?? 0), 0)

  const totalWins = (filterPlatform === "TODOS" && filterGame === "TODOS" && filterResult === "TODOS")
    ? (summary?.monthCountWin ?? monthWinsFromList)
    : monthWinsFromList
  const totalLosses = (filterPlatform === "TODOS" && filterGame === "TODOS" && filterResult === "TODOS")
    ? (summary?.monthCountLoss ?? monthLossesFromList)
    : monthLossesFromList
  const totalOperations = totalWins + totalLosses
  const winRate = totalOperations > 0 ? Math.round((totalWins / totalOperations) * 100) : 0
  const combinedProfit = (filterPlatform === "TODOS" && filterGame === "TODOS" && filterResult === "TODOS")
    ? (summary?.combinedProfitMonth ?? monthProfitFromList)
    : monthProfitFromList
  const monthLabel = summary?.monthLabel ?? new Date().toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })

  // Copy report to clipboard
  function handleCopyReport() {
    const wins = filtered.filter((e) => e.type === "WIN").length
    const losses = filtered.filter((e) => e.type === "LOSS").length
    const totalProfit = filtered.reduce((acc, e) => acc + (e.profit ?? 0), 0)
    const ops = wins + losses
    const rate = ops > 0 ? Math.round((wins / ops) * 100) : 0

    const text = `📊 *RELATÓRIO DO MÊS (${monthLabel})*\n\n` +
      `• *Plataforma:* ${filterPlatform}\n` +
      `• *Jogo:* ${filterGame}\n` +
      `• *Assertividade:* ${rate}%\n` +
      `• *Placar:* ${wins} WINS / ${losses} LOSSES\n` +
      `• *Lucro do mês:* R$ ${totalProfit.toFixed(2)}\n\n` +
      `*Histórico:*\n` +
      filtered.slice(0, 20).map((e) => {
        const color = e.type === "WIN" ? "🟢 WIN" : "🔴 LOSS"
        const game = e.gameType || "—"
        const amt = e.betAmount != null ? `(R$ ${Number(e.betAmount).toFixed(2)})` : ""
        const prof = e.profit != null ? `[R$ ${Number(e.profit).toFixed(2)}]` : ""
        return `- ${e.platform} | ${game} | ${color} ${amt} ${prof}`
      }).join("\n")

    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // License status calculations
  const isVitalicio = user?.isAdminAccount || user?.paymentStatus === "VITALICIO"
  const isTesting = user?.isTesting
  const isPaid = user?.paymentStatus === "PAID"
  
  let licenseTitle = "Expirado"
  let licenseColor = "text-red-400 bg-red-500/10 border-red-500/20"
  let daysLeft = 0

  if (isVitalicio) {
    licenseTitle = "Vitalício"
    licenseColor = "text-purple-400 bg-purple-500/15 border-purple-500/30 shadow-[0_0_20px_rgba(168,85,247,0.25)]"
  } else if (isTesting) {
    licenseTitle = "Teste Grátis"
    licenseColor = "text-yellow-400 bg-yellow-500/15 border-yellow-500/30 shadow-[0_0_20px_rgba(234,179,8,0.15)]"
    if (user?.expireIn) {
      daysLeft = Math.max(0, Math.ceil((new Date(user.expireIn).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))
    }
  } else if (isPaid) {
    licenseTitle = "Assinatura Ativa"
    licenseColor = "text-green-400 bg-green-500/15 border-green-500/30 shadow-[0_0_20px_rgba(16,185,129,0.25)]"
    if (user?.expireIn) {
      daysLeft = Math.max(0, Math.ceil((new Date(user.expireIn).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))
    }
  }

  return (
    <div className="space-y-6">
      
      {/* 1. TOP PREMIUM HEADER */}
      <div className="relative overflow-hidden bg-gradient-to-r from-gray-900 via-gray-850 to-gray-900 border border-gray-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
        <div className="absolute top-0 right-0 w-80 h-80 bg-green-500/5 rounded-full blur-3xl -z-10 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-blue-500/5 rounded-full blur-3xl -z-10 pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="bg-green-500/10 border border-green-500/20 text-green-400 text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider">
                Operando
              </span>
              {user?.isActive && (
                <span className="flex items-center gap-1.5 text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-full font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
                  Robô Ativo
                </span>
              )}
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight sm:text-4xl">
              Olá, {user?.name || "Usuário"} 👋
            </h1>
            <p className="text-gray-400 text-sm max-w-xl">
              Bem-vindo ao seu centro de inteligência. Acompanhe a assertividade das operações e analise os gráficos de desempenho em tempo real.
            </p>
          </div>

          {/* License Area */}
          <div className="flex items-center gap-4 bg-gray-950/40 border border-gray-800/60 rounded-2xl p-4 shrink-0">
            <div className="text-right">
              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-extrabold block">Sua Licença</span>
              <span className="text-xs text-gray-300 font-semibold block mt-0.5">
                {isVitalicio ? "Nunca expira" : daysLeft > 0 ? `${daysLeft} dias restantes` : "Assinatura pendente"}
              </span>
            </div>
            <span className={`px-4 py-2.5 rounded-xl text-xs font-black border uppercase tracking-wider ${licenseColor}`}>
              {licenseTitle}
            </span>
          </div>
        </div>
      </div>

      {/* 2. RELATÓRIO DO MÊS */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Relatório do Mês</h2>
          <p className="text-xs text-gray-500 mt-0.5">WIN/LOSS de todos os jogos e plataformas · {monthLabel}</p>
        </div>
        <span className="text-[10px] font-bold text-gray-400 bg-gray-900 border border-gray-800 px-3 py-1.5 rounded-full uppercase tracking-widest">
          {monthLabel}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Lucro do mês */}
        <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-5 flex items-center justify-between group hover:border-gray-700/60 transition-all">
          <div className="space-y-1">
            <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider block">Lucro do Mês</span>
            <p className={`text-2xl font-black tracking-tight ${combinedProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
              {combinedProfit >= 0 ? "+" : ""}R$ {combinedProfit.toFixed(2)}
            </p>
            <span className="text-[10px] text-gray-500 block">Blaze + Jonbet · todos os jogos</span>
          </div>
          <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.15)] group-hover:scale-110 transition-transform">
            <span className="text-green-400 text-lg">💰</span>
          </div>
        </div>

        {/* Vitórias do mês */}
        <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-5 flex items-center justify-between group hover:border-gray-700/60 transition-all">
          <div className="space-y-1">
            <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider block">Vitórias</span>
            <p className="text-2xl font-black text-green-400 tracking-tight">{totalWins}</p>
            <span className="text-[10px] text-gray-500 block">WIN no mês</span>
          </div>
          <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.15)] group-hover:scale-110 transition-transform">
            <span className="text-emerald-400 text-lg">🟢</span>
          </div>
        </div>

        {/* Derrotas do mês */}
        <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-5 flex items-center justify-between group hover:border-gray-700/60 transition-all">
          <div className="space-y-1">
            <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider block">Derrotas</span>
            <p className="text-2xl font-black text-red-500 tracking-tight">{totalLosses}</p>
            <span className="text-[10px] text-gray-500 block">LOSS no mês (gales esgotados)</span>
          </div>
          <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center shadow-[0_0_15px_rgba(239,68,68,0.15)] group-hover:scale-110 transition-transform">
            <span className="text-red-400 text-lg">🔴</span>
          </div>
        </div>

        {/* Assertividade Circular Gauge */}
        <div className="bg-gray-900 border border-gray-800/80 rounded-2xl p-5 flex items-center justify-between group hover:border-gray-700/60 transition-all">
          <div className="space-y-1">
            <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider block">Assertividade</span>
            <p className="text-2xl font-black text-blue-400 tracking-tight">{winRate}%</p>
            <span className="text-[10px] text-gray-500 block">{totalOperations} ops no mês</span>
          </div>
          
          {/* Circular Donut Progress */}
          <div className="relative w-12 h-12 flex-shrink-0">
            <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
              <circle cx="18" cy="18" r="15.915" fill="none" stroke="#1f2937" strokeWidth="3" />
              <circle
                cx="18"
                cy="18"
                r="15.915"
                fill="none"
                stroke="#3b82f6"
                strokeWidth="3.5"
                strokeDasharray={`${winRate} ${100 - winRate}`}
                strokeLinecap="round"
                className="transition-all duration-1000"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-blue-400">
              %
            </div>
          </div>
        </div>
      </div>

      {/* 3. INTERACTIVE GRAPH AND COMPREHENSIVE FILTER PORTAL */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Filter Operations List */}
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-6 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Histórico do Mês</h3>
                <p className="text-xs text-gray-500 mt-0.5">Todos os WIN/LOSS · não zera ao reiniciar o bot</p>
              </div>
              <button
                onClick={handleCopyReport}
                disabled={filtered.length === 0}
                className="text-xs font-bold bg-green-500 hover:bg-green-400 disabled:bg-gray-800 text-black disabled:text-gray-500 px-4 py-2.5 rounded-xl transition-all shadow-[0_4px_15px_rgba(16,185,129,0.15)] flex items-center justify-center gap-1.5 shrink-0"
              >
                <span>📋</span> {copied ? "Relatório Copiado" : "Copiar Relatório"}
              </button>
            </div>

            {/* Pill Filters Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-gray-950 p-4 rounded-xl border border-gray-850">
              {/* Platform Pills */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block">Plataforma</span>
                <div className="flex flex-wrap gap-1.5">
                  {(["TODOS", "BLAZE", "JONBET"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setFilterPlatform(p)}
                      className={`text-xs px-3.5 py-1.5 rounded-lg font-bold border transition-all ${
                        filterPlatform === p
                          ? "bg-green-500 border-green-500/30 text-black shadow-lg shadow-green-500/15"
                          : "bg-gray-900 border-gray-800 text-gray-400 hover:text-white"
                      }`}
                    >
                      {p === "TODOS" ? "Todas" : p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Game Pills */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block">Jogo</span>
                <div className="flex flex-wrap gap-1.5">
                  {(["TODOS", "DOUBLE", "CRASH", "FORTUNE", "BACBO"] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => setFilterGame(g)}
                      className={`text-xs px-3.5 py-1.5 rounded-lg font-bold border transition-all ${
                        filterGame === g
                          ? "bg-green-500 border-green-500/30 text-black shadow-lg shadow-green-500/15"
                          : "bg-gray-900 border-gray-800 text-gray-400 hover:text-white"
                      }`}
                    >
                      {g === "TODOS" ? "Todos" : g === "FORTUNE" ? "Fortune" : g}
                    </button>
                  ))}
                </div>
              </div>

              {/* Result Pills */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block">Resultado</span>
                <div className="flex flex-wrap gap-1.5">
                  {(["TODOS", "WIN", "LOSS"] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setFilterResult(r)}
                      className={`text-xs px-3.5 py-1.5 rounded-lg font-bold border transition-all ${
                        filterResult === r
                          ? "bg-green-500 border-green-500/30 text-black shadow-lg shadow-green-500/15"
                          : "bg-gray-900 border-gray-800 text-gray-400 hover:text-white"
                      }`}
                    >
                      {r === "TODOS" ? "Todos" : r}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* List display */}
          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1 mt-4">
            {filtered.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-gray-800 rounded-2xl bg-gray-950/20">
                <p className="text-gray-500 text-xs">Nenhum WIN/LOSS neste mês com os filtros selecionados.</p>
                <p className="text-gray-600 text-[10px] mt-1">Os resultados do painel Iniciar Bot vão para cá e permanecem no mês.</p>
              </div>
            ) : (
              filtered.map((e) => {
                const isWin = e.type === "WIN"
                const game = e.gameType || "—"
                return (
                  <div key={e.id} className="flex items-center justify-between bg-gray-950/80 border border-gray-850 hover:border-gray-800 rounded-xl px-4 py-3.5 transition-all">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[9px] uppercase font-black px-2 py-0.5 rounded ${(e.platform || "").toUpperCase() === "BLAZE" ? "bg-red-500/15 text-red-400" : "bg-blue-500/15 text-blue-400"}`}>
                          {e.platform}
                        </span>
                        <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded bg-gray-800 text-gray-300">
                          {game}
                        </span>
                        <span className={`text-[9px] uppercase font-black px-2 py-0.5 rounded ${isWin ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                          {e.type}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-500">
                        {e.pattern ? `📋 ${e.pattern}` : "Automático"}
                        {" · "}
                        {new Date(e.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-[10px] text-gray-500">entrada: R$ {Number(e.betAmount ?? 0).toFixed(2)}</p>
                      </div>
                      <div className={`px-3 py-1.5 rounded-lg text-xs font-extrabold min-w-[5.5rem] text-center border ${
                        isWin ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-red-500/10 border-red-500/20 text-red-400"
                      }`}>
                        {isWin ? "+" : ""}R$ {Number(e.profit ?? 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Dynamic Profit curve chart block */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col justify-between gap-6">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider font-extrabold">Curva de Rendimento</h3>
            <p className="text-xs text-gray-500">Evolução e flutuação do saldo nas últimas rodadas</p>
          </div>

          {/* SVG line chart */}
          <div className="relative pt-2">
            {!hasChartData ? (
              <div className="h-36 flex flex-col items-center justify-center border border-dashed border-gray-800 rounded-2xl bg-gray-950/20 px-4 text-center">
                <span className="text-gray-500 text-xs font-semibold text-gray-400">Sem dados suficientes</span>
                <span className="text-gray-600 text-[10px] mt-1">Aguardando as primeiras entradas reais do robô para traçar seu rendimento.</span>
              </div>
            ) : (
              <svg viewBox="0 0 200 110" className="w-full h-36 overflow-visible">
                <defs>
                  <linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Grid Lines */}
                <line x1="0" y1="10" x2="200" y2="10" stroke="#1f2937" strokeWidth="0.5" strokeDasharray="2" />
                <line x1="0" y1="50" x2="200" y2="50" stroke="#1f2937" strokeWidth="0.5" strokeDasharray="2" />
                <line x1="0" y1="90" x2="200" y2="90" stroke="#1f2937" strokeWidth="0.5" strokeDasharray="2" />

                {/* Area & line points path */}
                {(() => {
                  const points = activePoints.map((p) => {
                    const x = (p.idx / (activePoints.length - 1)) * 200
                    const y = 90 - ((p.profit - minProfit) / profitSpan) * 70
                    return { x, y }
                  })
                  
                  // Build a smooth cubic bezier curve
                  let pathD = `M ${points[0].x},${points[0].y}`
                  for (let i = 0; i < points.length - 1; i++) {
                    const cpX1 = points[i].x + (points[i+1].x - points[i].x) / 2
                    const cpY1 = points[i].y
                    const cpX2 = points[i].x + (points[i+1].x - points[i].x) / 2
                    const cpY2 = points[i+1].y
                    pathD += ` C ${cpX1},${cpY1} ${cpX2},${cpY2} ${points[i+1].x},${points[i+1].y}`
                  }

                  const areaD = `${pathD} L 200,90 L 0,90 Z`

                  return (
                    <>
                      <path d={areaD} fill="url(#curveGrad)" />
                      <path d={pathD} fill="none" stroke="#10B981" strokeWidth="3" strokeLinecap="round" />
                      {points.map((p, i) => (
                        <circle key={i} cx={p.x} cy={p.y} r="3" fill="#10B981" stroke="#000" strokeWidth="1" />
                      ))}
                    </>
                  )
                })()}
              </svg>
            )}
          </div>

          {/* Active configuration details */}
          <div className="space-y-3 pt-2">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block font-extrabold">Configuração Ativa</span>
            
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-950/60 border border-gray-850 rounded-xl p-3">
                <span className="text-[10px] text-gray-500 block">Tipo de Conta</span>
                <span className="text-xs font-bold text-white uppercase">{user?.accountType ?? "—"}</span>
              </div>
              <div className="bg-gray-950/60 border border-gray-850 rounded-xl p-3">
                <span className="text-[10px] text-gray-500 block">Jogo Preferencial</span>
                <span className="text-xs font-bold text-white uppercase">{user?.gameType ?? "—"}</span>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  )
}
