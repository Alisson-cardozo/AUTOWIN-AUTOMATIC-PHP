import { useEffect, useState, useCallback, useRef } from "react"
import { NumberField } from "@/components/ui/NumberField"

// ─── Tipos ──────────────────────────────────────────────────────────────────
interface FutebolResult {
  id: string
  created_at: string
  scoreHome: number
  scoreAway: number
  winner: string // "Home" | "Away" | "Tie"
}

interface PatternResult {
  sequence: string
  betOutcome: string
  betOutcomeNum: number
  occurrences: number
  wins: number
  galeWins: number[]
  hitRate: number
}

type SignalStatus = "AGUARDANDO" | "WIN" | "GALE1" | "GALE2" | "GALE3" | "GALE4" | "GALE5" | "LOSS"

interface LiveSignal {
  id: number
  sequence: string
  betOutcomeNum: number
  hitRatePct: number
  occurrences: number
  recommendedGales: number
  entryIndex: number
  createdAtHHMM: string
  status: SignalStatus
  resolvedAtHHMM?: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────
// 0 = EMPATE, 1 = HOME (CASA), 2 = AWAY (FORA)
function winnerCode(w: string): number {
  if (w === "Home") return 1
  if (w === "Away") return 2
  return 0
}
const OUTCOME_NAME: Record<number, string> = { 0: "EMPATE", 1: "CASA", 2: "FORA" }
const OUTCOME_EMOJI: Record<number, string> = { 0: "🟡", 1: "🔵", 2: "🔴" }

const BR_TZ = "America/Sao_Paulo"
function toBR(iso: string) {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BR_TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(d)
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0")
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0")
  const s = parseInt(parts.find((p) => p.type === "second")?.value ?? "0")
  return { h, m, s, hhmm: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` }
}

async function fetchFutebolRecent(): Promise<{ results: FutebolResult[]; total: number; apiDown: boolean; isMock?: boolean }> {
  try {
    const res = await fetch("/api/game/futebol/recent", { cache: "no-store" })
    if (!res.ok) return { results: [], total: 0, apiDown: true }
    const data = await res.json()
    return { results: data.results ?? [], total: data.total ?? 0, apiDown: !!data.apiDown, isMock: data.isMock }
  } catch {
    return { results: [], total: 0, apiDown: true }
  }
}

function recommendedGaleCount(wins: number, galeWins: number[], occurrences: number, targetCoverage = 0.7): number {
  let cum = wins
  if (occurrences > 0 && cum / occurrences >= targetCoverage) return 0
  for (let g = 0; g < galeWins.length; g++) {
    cum += galeWins[g]
    if (occurrences > 0 && cum / occurrences >= targetCoverage) return g + 1
  }
  return galeWins.length
}

const outcomeBadgeClass = (code: number) =>
  code === 1 ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
  : code === 2 ? "bg-red-500/20 text-red-400 border-red-500/30"
  : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"

function marginBucket(r: FutebolResult): "APERTADA" | "FOLGADA" {
  return Math.abs(r.scoreHome - r.scoreAway) >= 3 ? "FOLGADA" : "APERTADA"
}

function roundToken(r: FutebolResult): string {
  const code = winnerCode(r.winner)
  if (code === 0) return "EMPATE"
  return `${OUTCOME_NAME[code]}_${marginBucket(r)}`
}

// ═══════════════════════════════════════════════════════════════════════════
//  ABA 1 — HISTÓRICO
// ═══════════════════════════════════════════════════════════════════════════
function HistoricoTab() {
  const [results, setResults] = useState<FutebolResult[]>([])
  const [apiDown, setApiDown] = useState(false)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { results, apiDown } = await fetchFutebolRecent()
    setResults(results)
    setApiDown(apiDown)
    setLastSync(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 5000)
    return () => clearInterval(iv)
  }, [load])

  const stats = results.reduce(
    (acc, r) => {
      const code = winnerCode(r.winner)
      if (code === 1) acc.player++
      else if (code === 2) acc.banker++
      else acc.tie++
      return acc
    },
    { player: 0, banker: 0, tie: 0 }
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${apiDown ? "bg-red-400" : "bg-green-400 animate-pulse"}`} />
          <span className="text-xs text-gray-500">
            {apiDown ? "Fonte de dados instável" : lastSync ? `Atualizado às ${toBR(lastSync.toISOString()).hhmm}` : "Carregando..."}
          </span>
        </div>
        <span className="text-xs text-gray-500">{results.length} resultados</span>
      </div>

      {results.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-blue-400">{stats.player}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Player</p>
          </div>
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-red-400">{stats.banker}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Banker</p>
          </div>
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-yellow-300">{stats.tie}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Empate</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
        {results.map((r) => {
          const code = winnerCode(r.winner)
          return (
            <div key={r.id} className={`flex flex-col items-center gap-0.5 rounded-xl p-2 border ${outcomeBadgeClass(code)}`}>
              <span className="text-lg leading-none">{OUTCOME_EMOJI[code]}</span>
              <span className="text-[10px] font-bold">{OUTCOME_NAME[code]}</span>
              <span className="text-[9px] text-gray-500">{r.scoreHome} × {r.scoreAway}</span>
              <span className="text-[9px] text-gray-600">{toBR(r.created_at).hhmm}</span>
            </div>
          )
        })}
      </div>

      {loading && <p className="text-center text-gray-500 text-sm py-8">Carregando histórico...</p>}
      {!loading && results.length === 0 && (
        <p className="text-center text-gray-500 text-sm py-8">Sem resultados disponíveis no momento.</p>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  ABA 2 — SINAIS COM IA (ao vivo)
// ═══════════════════════════════════════════════════════════════════════════
// Parâmetros fixos do motor — nada disso é configurável pelo cliente, o
// sinal roda sozinho assim que a aba abre.
const ENGINE_SEQ_LEN     = 2
const ENGINE_MIN_OCC      = 5
const ENGINE_MAX_GALES    = 3
const ENGINE_MIN_HIT_RATE = 0.9 // 90% de assertividade mínima

function SinaisIATab() {
  const [activeSignal, setActiveSignal] = useState<LiveSignal | null>(null)
  const [signalHistory, setSignalHistory] = useState<LiveSignal[]>([])
  const [historyCount, setHistoryCount] = useState(0)

  const historyRef = useRef<FutebolResult[]>([])
  const seenIdsRef = useRef<Set<string>>(new Set())
  const activeSignalRef = useRef<LiveSignal | null>(null)
  const nextIdRef = useRef(1)

  const tick = useCallback(async () => {
    const { results } = await fetchFutebolRecent()
    if (!results.length) return

    // A API devolve mais recente primeiro — inverte pra ordem cronológica
    const chronological = [...results].reverse()
    let changed = false
    for (const r of chronological) {
      if (!seenIdsRef.current.has(r.id)) {
        seenIdsRef.current.add(r.id)
        historyRef.current.push(r)
        changed = true
      }
    }
    if (historyRef.current.length > 500) historyRef.current = historyRef.current.slice(-500)
    if (!changed) return

    const hist = historyRef.current
    setHistoryCount(hist.length)

    // 1) Se tem sinal ativo, checa se as rodadas reais seguintes já resolveram.
    // O teto aqui é o gale RECOMENDADO ao cliente (não o teto interno do
    // motor) — se o sinal disse "até gale 1", só entrada+gale1 contam como
    // vitória; bater só no gale 2 em diante é derrota de verdade, porque foi
    // além do que a pessoa foi orientada a fazer.
    const active = activeSignalRef.current
    if (active && active.status === "AGUARDANDO") {
      for (let g = 0; g <= active.recommendedGales; g++) {
        const idx = active.entryIndex + g
        if (idx >= hist.length) break // essa rodada ainda não aconteceu
        const code = winnerCode(hist[idx].winner)
        if (code === active.betOutcomeNum) {
          const resolved: LiveSignal = { ...active, status: (g === 0 ? "WIN" : (`GALE${g}` as SignalStatus)), resolvedAtHHMM: toBR(hist[idx].created_at).hhmm }
          activeSignalRef.current = null
          setActiveSignal(null)
          setSignalHistory((sh) => [resolved, ...sh].slice(0, 50))
          break
        }
        if (g === active.recommendedGales) {
          // esgotou os gales recomendados sem bater
          const resolved: LiveSignal = { ...active, status: "LOSS", resolvedAtHHMM: toBR(hist[idx].created_at).hhmm }
          activeSignalRef.current = null
          setActiveSignal(null)
          setSignalHistory((sh) => [resolved, ...sh].slice(0, 50))
        }
      }
    }

    // 2) Sem sinal ativo — tenta detectar um novo olhando a "cauda" do histórico.
    // A sequência usa o placar de cada rodada (roundToken), não só quem
    // ganhou — vitória apertada e vitória folgada contam como padrões
    // diferentes, deixando a detecção mais fina.
    if (!activeSignalRef.current && hist.length >= ENGINE_SEQ_LEN + 10) {
      const stats: Record<string, { occurrences: number; wins: number; galeWins: number[] }> = {}
      for (let i = ENGINE_SEQ_LEN; i < hist.length; i++) {
        const seq = hist.slice(i - ENGINE_SEQ_LEN, i).map(roundToken).join(",")
        for (const betNum of [1, 2]) {
          const key = `${seq}→${betNum}`
          if (!stats[key]) stats[key] = { occurrences: 0, wins: 0, galeWins: new Array(ENGINE_MAX_GALES).fill(0) }
          const s = stats[key]
          s.occurrences++
          if (winnerCode(hist[i].winner) === betNum) {
            s.wins++
          } else {
            for (let g = 1; g <= ENGINE_MAX_GALES; g++) {
              if (i + g < hist.length && winnerCode(hist[i + g].winner) === betNum) {
                s.galeWins[g - 1]++
                break
              }
            }
          }
        }
      }

      const tailSeq = hist.slice(hist.length - ENGINE_SEQ_LEN).map(roundToken).join(",")
      let best: { betNum: number; hitRate: number; occurrences: number; wins: number; galeWins: number[] } | null = null
      for (const betNum of [1, 2]) {
        const key = `${tailSeq}→${betNum}`
        const s = stats[key]
        if (!s || s.occurrences < ENGINE_MIN_OCC) continue
        const totalWins = s.wins + s.galeWins.reduce((a, b) => a + b, 0)
        const hitRate = totalWins / s.occurrences
        if (hitRate >= ENGINE_MIN_HIT_RATE && (!best || hitRate > best.hitRate)) {
          best = { betNum, hitRate, occurrences: s.occurrences, wins: s.wins, galeWins: s.galeWins }
        }
      }

      if (best) {
        const newSignal: LiveSignal = {
          id: nextIdRef.current++,
          sequence: tailSeq,
          betOutcomeNum: best.betNum,
          hitRatePct: best.hitRate,
          occurrences: best.occurrences,
          recommendedGales: Math.min(ENGINE_MAX_GALES, recommendedGaleCount(best.wins, best.galeWins, best.occurrences)),
          entryIndex: hist.length,
          createdAtHHMM: toBR(new Date().toISOString()).hhmm,
          status: "AGUARDANDO",
        }
        activeSignalRef.current = newSignal
        setActiveSignal(newSignal)
      }
    }
  }, [])

  // Roda sozinho assim que a aba abre — sem configuração nem botão manual.
  useEffect(() => {
    tick()
    const iv = setInterval(tick, 4000)
    return () => clearInterval(iv)
  }, [tick])

  const wins  = signalHistory.filter((s) => s.status === "WIN" || s.status.startsWith("GALE")).length
  const total = signalHistory.length
  const assertividade = total > 0 ? ((wins / total) * 100).toFixed(1) : "0.0"

  const statusStyle = (status: SignalStatus) =>
    status === "WIN" ? "bg-green-500/20 text-green-400 border-green-500/30"
    : status.startsWith("GALE") ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
    : status === "AGUARDANDO" ? "bg-gray-700/50 text-gray-300 border-gray-600"
    : "bg-red-500/20 text-red-400 border-red-500/30"

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-gray-400">Monitorando automaticamente — {historyCount} rodadas coletadas</span>
        </div>
        <span className="text-xs text-gray-500">Assertividade mínima: 90%</span>
      </div>

      {!activeSignal && (
        <div className="flex items-center justify-center gap-3 h-20 text-gray-400 text-sm bg-gray-900 border border-gray-800 rounded-xl">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          Monitorando... nenhum padrão formado ainda
        </div>
      )}

      {activeSignal && (
        <div className="bg-blue-500/10 border border-blue-500/40 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Sinal ao vivo — {activeSignal.createdAtHHMM}</p>
            <span className={`text-xs font-bold px-3 py-1 rounded-full border ${statusStyle(activeSignal.status)}`}>
              {activeSignal.status === "AGUARDANDO" ? "⏳ AGUARDANDO" : activeSignal.status}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{OUTCOME_EMOJI[activeSignal.betOutcomeNum]}</span>
            <div>
              <p className="text-white font-bold text-lg">{OUTCOME_NAME[activeSignal.betOutcomeNum]}</p>
              <p className="text-xs text-gray-400">Padrão: {activeSignal.sequence.replace(/_/g, " ").replace(/,/g, " → ")}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-gray-900/60 rounded-lg py-2">
              <p className="text-base font-bold text-blue-400">{(activeSignal.hitRatePct * 100).toFixed(1)}%</p>
              <p className="text-[10px] text-gray-500">Assertividade</p>
            </div>
            <div className="bg-gray-900/60 rounded-lg py-2">
              <p className="text-base font-bold text-white">{activeSignal.occurrences}</p>
              <p className="text-[10px] text-gray-500">Ocorrências</p>
            </div>
            <div className="bg-gray-900/60 rounded-lg py-2">
              <p className="text-base font-bold text-yellow-400">até gale {activeSignal.recommendedGales}</p>
              <p className="text-[10px] text-gray-500">Recomendado</p>
            </div>
          </div>
        </div>
      )}

      {signalHistory.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Histórico de sinais</p>
            <span className="text-xs text-gray-400">WIN: {wins} | Assertividade: {assertividade}%</span>
          </div>
          <div className="divide-y divide-gray-800/60">
            {signalHistory.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-white font-mono text-sm font-bold">{s.createdAtHHMM}</span>
                  <span className="text-xl">{OUTCOME_EMOJI[s.betOutcomeNum]}</span>
                  <span className="text-xs text-gray-500">{(s.hitRatePct * 100).toFixed(0)}%</span>
                </div>
                <span className={`text-xs font-bold px-3 py-1 rounded-full border ${statusStyle(s.status)}`}>
                  {s.status.startsWith("GALE") ? `GALE ${s.status.slice(4)}` : s.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  ABA 3 — BUSCAR PADRÃO
// ═══════════════════════════════════════════════════════════════════════════
function BuscarPadraoTab() {
  const [gales,    setGales]    = useState(1)
  const [minOcc,   setMinOcc]   = useState(5)
  const [seqLen,   setSeqLen]   = useState(2)
  const [mode,     setMode]     = useState<"normal" | "empate">("normal")
  const [loading,  setLoading]  = useState(false)
  const [patterns, setPatterns] = useState<PatternResult[]>([])
  const [sampleSize, setSampleSize] = useState(0)

  async function analyze(m: "normal" | "empate") {
    setMode(m)
    setLoading(true)
    setPatterns([])

    const { results } = await fetchFutebolRecent()
    const sorted = [...results].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    setSampleSize(sorted.length)

    const stats: Record<string, PatternResult> = {}
    const outcomesToSearch = m === "empate" ? [0] : [1, 2]
    const effectiveGales  = m === "empate" ? Math.max(gales, 10) : gales
    const effectiveSeqLen = m === "empate" ? Math.max(seqLen, 4) : seqLen

    for (let i = effectiveSeqLen; i < sorted.length - effectiveGales; i++) {
      // Sequência usa o placar de cada rodada (roundToken), não só quem
      // ganhou — vitória apertada e folgada contam como padrões diferentes.
      const seqKey = sorted.slice(i - effectiveSeqLen, i).map(roundToken).join(",")

      for (const betNum of outcomesToSearch) {
        const betOutcome = OUTCOME_NAME[betNum]
        const key = `${seqKey}→${betOutcome}`

        if (!stats[key]) stats[key] = {
          sequence: seqKey, betOutcome, betOutcomeNum: betNum,
          occurrences: 0, wins: 0, galeWins: new Array(effectiveGales).fill(0), hitRate: 0,
        }
        stats[key].occurrences++

        const nextOutcome = OUTCOME_NAME[winnerCode(sorted[i].winner)]
        if (nextOutcome === betOutcome) {
          stats[key].wins++
        } else {
          for (let g = 1; g <= effectiveGales; g++) {
            if (i + g < sorted.length && OUTCOME_NAME[winnerCode(sorted[i + g].winner)] === betOutcome) {
              stats[key].galeWins[g - 1]++
              break
            }
          }
        }
      }
    }

    const totalWins = (p: PatternResult) => p.wins + p.galeWins.reduce((a, b) => a + b, 0)
    const top = Object.values(stats)
      .filter((p) => p.occurrences >= minOcc)
      .map((p) => ({ ...p, hitRate: totalWins(p) / p.occurrences }))
      .sort((a, b) => b.hitRate - a.hitRate)
      .slice(0, 5)

    setPatterns(top)
    setLoading(false)
  }

  const hitBg = (rate: number) => (rate >= 0.7 ? "text-green-400" : rate >= 0.55 ? "text-yellow-400" : "text-red-400")

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Qtd. de Gales</p>
            <NumberField min={0} max={10} value={gales} onChange={setGales}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Mín. de ocorrências</p>
            <NumberField min={1} value={minOcc} onChange={setMinOcc}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Pedras na sequência</p>
            <NumberField min={1} max={5} value={seqLen} onChange={setSeqLen}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => analyze("normal")} disabled={loading}
            className="flex-1 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black font-bold py-3 rounded-xl text-sm transition-colors">
            {loading && mode === "normal" ? "Analisando..." : "🎯 Buscar Padrões"}
          </button>
          <button onClick={() => analyze("empate")} disabled={loading}
            className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-colors border border-gray-600">
            {loading && mode === "empate" ? "Analisando..." : "🟡 Buscar Empate"}
          </button>
        </div>
        <p className="text-[11px] text-gray-600">
          Amostra baseada nos últimos {sampleSize || "..."} resultados disponíveis (histórico do provedor é limitado).
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-3 h-24 text-gray-400 text-sm">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          Catalogando sequências...
        </div>
      )}

      {!loading && mode === "empate" && patterns.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-xl p-4 space-y-2">
          <p className="text-sm font-bold text-white">🟡 Atenção: Entrada no Empate</p>
          <p className="text-xs text-gray-300 leading-relaxed">
            O Empate é um resultado de baixa frequência — considere usar mais gales pra aumentar as chances de capturar a entrada quando ela ocorrer.
          </p>
        </div>
      )}

      {patterns.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Top {patterns.length} padrões encontrados</p>
          {patterns.map((p, i) => (
            <div key={i} className="rounded-xl p-4 border bg-gray-900 border-gray-800 transition-all">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 flex-wrap mb-2">
                  {p.sequence.split(",").map((token, j) => {
                    const base = token.split("_")[0]
                    const code = base === "PLAYER" ? 1 : base === "BANKER" ? 2 : 0
                    return (
                      <span key={j} className={`text-xs font-bold px-2 py-0.5 rounded border ${outcomeBadgeClass(code)}`}>
                        {OUTCOME_EMOJI[code]} {token.replace("_", " ")}
                      </span>
                    )
                  })}
                  <span className="text-gray-600 text-xs">→</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded border ${outcomeBadgeClass(p.betOutcomeNum)}`}>
                    {OUTCOME_EMOJI[p.betOutcomeNum]} {p.betOutcome}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs flex-wrap">
                  <span className={`font-bold text-base ${hitBg(p.hitRate)}`}>{(p.hitRate * 100).toFixed(1)}%</span>
                  <span className="text-gray-500">{p.occurrences} ocorrências</span>
                  <span className="text-green-400">{p.wins}× direto</span>
                  {p.galeWins.map((g, gi) => g > 0 && (
                    <span key={gi} className="text-yellow-400">{g}× gale{gi + 1}</span>
                  ))}
                </div>
                <div className="mt-2 h-1 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${p.hitRate * 100}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && patterns.length === 0 && (
        <p className="text-center text-gray-500 text-sm py-8">Configure os parâmetros e clique em "Buscar Padrões"</p>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  PÁGINA PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
type Tab = "historico" | "sinais" | "buscar"

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "historico", label: "Histórico",     icon: "📊" },
  { id: "sinais",    label: "Sinais com IA", icon: "🤖" },
  { id: "buscar",    label: "Buscar Padrão", icon: "🔍" },
]

export default function PremiumFutebolPage() {
  const [tab, setTab] = useState<Tab>("historico")
  const [licensed, setLicensed] = useState(true)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    fetch("/api/user/me").then((r) => r.json()).then((data) => {
      const isPaid = data.paymentStatus === "PAID" && (!data.expireIn || new Date(data.expireIn) > new Date())
      setLicensed(isPaid || !!data.isTesting || !!data.isAdminAccount)
      setChecking(false)
    }).catch(() => setChecking(false))
  }, [])

  if (checking) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin" />
    </div>
  )

  if (!licensed) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
      <div className="text-4xl">🔒</div>
      <div>
        <h2 className="text-white font-bold text-lg">Acesso Restrito</h2>
        <p className="text-gray-400 text-sm mt-1">Você precisa de uma assinatura ativa para acessar o Premium.</p>
      </div>
      <a href="/conta" className="bg-green-500 hover:bg-green-400 text-black font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors">
        Ver Planos
      </a>
    </div>
  )

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-3xl">⚽</span>
        <div>
          <h1 className="text-xl font-bold text-white">Futebol Studio</h1>
          <p className="text-xs text-gray-500">Análise avançada do Futebol Studio — em desenvolvimento</p>
        </div>
      </div>

      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg px-4 py-3 text-xs text-gray-400 leading-relaxed">
        O Futebol Studio roda numa mesa ao vivo de um provedor terceirizado protegido contra automação — o bot não aposta
        sozinho nesse jogo. Essa aba só detecta padrões e mostra sinais; a aposta é feita manualmente por você no site.
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-gray-900/80 border border-gray-800 rounded-xl p-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              tab === t.id ? "bg-white/10 text-white shadow" : "text-gray-500 hover:text-gray-300"
            }`}>
            <span>{t.icon}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div>
        {tab === "historico" && <HistoricoTab />}
        {tab === "sinais"    && <SinaisIATab />}
        {tab === "buscar"    && <BuscarPadraoTab />}
      </div>
    </div>
  )
}
