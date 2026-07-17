"use client"

import { useEffect, useState } from "react"
import { StatsCard } from "../shims/StatsCard"
import { EmergencyStopToggle } from "../shims/EmergencyStopToggle"

function money(v: number) {
  return `R$ ${v.toFixed(2)}`
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null
  return Number((((current - previous) / previous) * 100).toFixed(0))
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<any>(null)
  const [error, setError] = useState("")
  const [resettingRevenue, setResettingRevenue] = useState(false)

  function loadStats() {
    fetch("/api/admin/dashboard-stats")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error)
        else setStats(d)
      })
      .catch(() => setError("Falha ao carregar métricas"))
  }

  useEffect(() => {
    loadStats()
  }, [])

  async function handleResetRevenue() {
    if (!confirm("Isso zera o Faturamento Mensal exibido no painel (pagamentos anteriores a agora somem da métrica). O acesso dos clientes PAID não é afetado. Continuar?")) return
    setResettingRevenue(true)
    try {
      await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ REVENUE_RESET_AT: new Date().toISOString() }),
      })
      loadStats()
    } finally {
      setResettingRevenue(false)
    }
  }

  if (error) return <div className="text-red-400 py-8">{error}</div>
  if (!stats) return <div className="text-gray-400 py-8">Carregando indicadores...</div>

  const maxRegs = Math.max(...stats.last7DaysRegs.map((d: any) => d.count), 1)
  const chartHeight = 120
  const maxRev = Math.max(...stats.revenue.monthsRevenue.map((m: any) => m.value), 1)
  const totalGamesPicked = (stats.games.double + stats.games.fortune) || 1
  const pctDouble = Math.round((stats.games.double / totalGamesPicked) * 100)
  const pctFortune = Math.round((stats.games.fortune / totalGamesPicked) * 100)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Painel de Indicadores</h1>
          <p className="text-gray-400 text-sm mt-1">Análise inteligente e métricas consolidadas em tempo real.</p>
        </div>
        <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-xl px-4 py-2 text-xs font-semibold text-gray-300">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
          <span>{stats.activeBots} robôs rodando agora</span>
        </div>
      </div>

      <EmergencyStopToggle />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          label="Total de Usuários"
          value={stats.totalUsers.toLocaleString("pt-BR")}
          delta={{ text: `+${stats.newUsersThisMonth} este mês`, tone: stats.newUsersThisMonth > 0 ? "up" : "neutral" }}
        />
        <div className="relative">
          <StatsCard
            label="Faturamento Mensal"
            value={money(stats.revenue.valueThisMonth)}
            delta={(() => {
              const pct = pctDelta(stats.revenue.valueThisMonth, stats.revenue.valueLastMonth)
              if (pct === null) return undefined
              return { text: `${pct >= 0 ? "+" : ""}${pct}% vs mês anterior`, tone: pct >= 0 ? "up" : "down" }
            })()}
          />
          <button
            onClick={handleResetRevenue}
            disabled={resettingRevenue}
            title="Zera o faturamento exibido (não afeta o acesso dos clientes)"
            className="absolute top-3 right-3 text-[10px] font-bold bg-gray-950/60 hover:bg-red-500/10 border border-gray-800 hover:border-red-500/30 disabled:opacity-50 text-gray-500 hover:text-red-400 px-2 py-1 rounded-lg transition-all"
          >
            {resettingRevenue ? "..." : "🔄 Resetar"}
          </button>
        </div>
        <StatsCard
          label="Usuários em Trial"
          value={stats.plansDist.trial.toLocaleString("pt-BR")}
          delta={{ text: "Período de teste grátis", tone: "neutral" }}
        />
        <StatsCard
          label="Clientes Ativos"
          value={stats.plansDist.paid.toLocaleString("pt-BR")}
          delta={{ text: `+${stats.revenue.payingThisMonth} este mês`, tone: stats.revenue.payingThisMonth > 0 ? "up" : "neutral" }}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Histórico de Receita</h3>
              <p className="text-xs text-gray-500 mt-0.5">Evolução do faturamento bruto nos últimos 6 meses</p>
            </div>
            <span className="text-xs font-bold text-green-400 bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-full">
              {money(stats.revenue.valueThisMonth)} este mês
            </span>
          </div>
          <div className="relative pt-4">
            <svg viewBox="0 0 500 150" className="w-full h-44 overflow-visible">
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <line x1="0" y1="0" x2="500" y2="0" stroke="#1f2937" strokeWidth="1" strokeDasharray="3" />
              <line x1="0" y1="50" x2="500" y2="50" stroke="#1f2937" strokeWidth="1" strokeDasharray="3" />
              <line x1="0" y1="100" x2="500" y2="100" stroke="#1f2937" strokeWidth="1" strokeDasharray="3" />
              <line x1="0" y1="150" x2="500" y2="150" stroke="#1f2937" strokeWidth="1" />
              {(() => {
                const points = stats.revenue.monthsRevenue.map((m: any, i: number) => {
                  const x = (i / 5) * 500
                  const y = 150 - (m.value / maxRev) * 110 - 20
                  return { x, y, val: m.value }
                })
                const pathD = `M ${points.map((p: any) => `${p.x},${p.y}`).join(" L ")}`
                const areaD = `${pathD} L 500,150 L 0,150 Z`
                return (
                  <>
                    <path d={areaD} fill="url(#areaGrad)" />
                    <path d={pathD} fill="none" stroke="#10B981" strokeWidth="3" strokeLinecap="round" />
                    {points.map((p: any, i: number) => (
                      <g key={i} className="group cursor-pointer">
                        <circle cx={p.x} cy={p.y} r="5" fill="#10B981" stroke="#000" strokeWidth="2" />
                      </g>
                    ))}
                  </>
                )
              })()}
            </svg>
            <div className="flex justify-between mt-2 px-1">
              {stats.revenue.monthsRevenue.map((m: any, i: number) => (
                <span key={i} className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">
                  {m.monthLabel}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Novas Inscrições</h3>
            <p className="text-xs text-gray-500 mt-0.5">Cadastros diários na última semana</p>
          </div>
          <div className="relative pt-6 h-36 flex items-end justify-between gap-1.5">
            {stats.last7DaysRegs.map((d: any, i: number) => {
              const h = (d.count / maxRegs) * chartHeight
              return (
                <div key={i} className="flex-1 flex flex-col items-center group">
                  <div className="text-[10px] font-bold text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity mb-1.5">
                    {d.count}
                  </div>
                  <div
                    className="w-full rounded-t-lg bg-gradient-to-t from-blue-600 to-blue-400 group-hover:from-blue-500 group-hover:to-blue-300 transition-all"
                    style={{ height: `${Math.max(h, 4)}px` }}
                  />
                  <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mt-2 block">
                    {d.dateStr}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Preferência de Jogos</h3>
            <p className="text-xs text-gray-500 mt-0.5">Distribuição da seleção de robô ativa entre os clientes</p>
          </div>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-gray-300 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> Double
                </span>
                <span className="text-gray-400 font-bold">{stats.games.double} ({pctDouble}%)</span>
              </div>
              <div className="w-full bg-gray-800 h-2.5 rounded-full overflow-hidden">
                <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${pctDouble}%` }} />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-gray-300 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-yellow-400" /> Fortune Double
                </span>
                <span className="text-gray-400 font-bold">{stats.games.fortune} ({pctFortune}%)</span>
              </div>
              <div className="w-full bg-gray-800 h-2.5 rounded-full overflow-hidden">
                <div className="bg-yellow-400 h-full rounded-full" style={{ width: `${pctFortune}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Status das Contas</h3>
            <p className="text-xs text-gray-500 mt-0.5">Visão geral do modelo de cobrança dos usuários ativos</p>
          </div>
          <div className="flex items-center gap-6 py-2">
            <svg viewBox="0 0 36 36" className="w-24 h-24 flex-shrink-0">
              <circle cx="18" cy="18" r="15.915" fill="none" stroke="#1f2937" strokeWidth="4.5" />
              {(() => {
                const total = (stats.plansDist.paid + stats.plansDist.trial + stats.plansDist.other) || 1
                const paidPct = (stats.plansDist.paid / total) * 100
                const trialPct = (stats.plansDist.trial / total) * 100
                return (
                  <>
                    <circle cx="18" cy="18" r="15.915" fill="none" stroke="#a855f7" strokeWidth="4.5"
                      strokeDasharray={`${paidPct} ${100 - paidPct}`} strokeDashoffset="25" />
                    <circle cx="18" cy="18" r="15.915" fill="none" stroke="#eab308" strokeWidth="4.5"
                      strokeDasharray={`${trialPct} ${100 - trialPct}`} strokeDashoffset={25 - paidPct} />
                  </>
                )
              })()}
            </svg>
            <div className="space-y-2.5 flex-1">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 font-medium text-gray-300">
                  <span className="w-2.5 h-2.5 rounded bg-purple-500" /> Pagantes / Vitalícios
                </span>
                <span className="font-bold text-gray-400">{stats.plansDist.paid}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 font-medium text-gray-300">
                  <span className="w-2.5 h-2.5 rounded bg-yellow-500" /> Teste Grátis (Trial)
                </span>
                <span className="font-bold text-gray-400">{stats.plansDist.trial}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 font-medium text-gray-300">
                  <span className="w-2.5 h-2.5 rounded bg-gray-700" /> Pendentes / Expirados
                </span>
                <span className="font-bold text-gray-400">{stats.plansDist.other}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
