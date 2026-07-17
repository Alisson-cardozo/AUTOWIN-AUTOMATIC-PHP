import { useEffect, useState, useCallback } from "react"
import { NumberField } from "@/components/ui/NumberField"

// Sala: Bac Bo normal vs Ao Vivo (mesma UI; APIs e localStorage separados)
type BacBoRoom = "bacbo" | "bacbo-live"
function detectBacBoRoom(): BacBoRoom {
  if (typeof window === "undefined") return "bacbo"
  const path = window.location.pathname || ""
  if (path.includes("premium-bacbo-live") || path.includes("bacbo-live")) return "bacbo-live"
  const q = new URLSearchParams(window.location.search).get("room")
  if (q === "live" || q === "bacbo-live") return "bacbo-live"
  return "bacbo"
}
const BACBO_ROOM = detectBacBoRoom()
const BACBO_RECENT_API =
  BACBO_ROOM === "bacbo-live" ? "/api/game/bacbo-live/recent" : "/api/game/bacbo/recent"
const BACBO_ESTRAT_API =
  BACBO_ROOM === "bacbo-live" ? "/api/user/bacbo-live/estrategias" : "/api/user/bacbo/estrategias"
const BACBO_PAGE_TITLE = BACBO_ROOM === "bacbo-live" ? "Bac Bo Ao Vivo" : "Bac Bo"
const LS_PATTERNS_KEY =
  BACBO_ROOM === "bacbo-live" ? "premium_bacbo_live_padrao_patterns_v2" : "premium_bacbo_padrao_patterns_v2"
const LS_ACTIVE_KEY =
  BACBO_ROOM === "bacbo-live" ? "premium_bacbo_live_active_patterns" : "premium_bacbo_active_patterns"

// ─── Tipos ──────────────────────────────────────────────────────────────────
interface BacBoResult {
  id: string
  created_at: string
  diceplayer1: number
  diceplayer2: number
  dicebanker1: number
  dicebanker2: number
  winner: string
  score?: number
  result?: number
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

// ─── Helpers ────────────────────────────────────────────────────────────────
function winnerCode(w: string): number {
  if (w === "PlayerWon") return 1
  if (w === "BankerWon") return 2
  return 0
}
const OUTCOME_NAME: Record<number, string> = { 0: "EMPATE", 1: "PLAYER", 2: "BANKER" }
const OUTCOME_EMOJI: Record<number, string> = { 0: "🟡", 1: "🔵", 2: "🔴" }

const BR_TZ = "America/Sao_Paulo"
function toBR(iso: string) {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BR_TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(d)
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0")
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0")
  return { hhmm: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` }
}

async function fetchBacBoRecent(): Promise<{ results: BacBoResult[]; total: number; apiDown: boolean }> {
  try {
    const res = await fetch(BACBO_RECENT_API, { cache: "no-store" })
    if (!res.ok) return { results: [], total: 0, apiDown: true }
    const data = await res.json()
    return { results: data.results ?? [], total: data.total ?? 0, apiDown: !!data.apiDown }
  } catch {
    return { results: [], total: 0, apiDown: true }
  }
}

const outcomeBadgeClass = (code: number) =>
  code === 1 ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
  : code === 2 ? "bg-red-500/20 text-red-400 border-red-500/30"
  : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"

/** Total do vencedor (TipMiner score ou soma dos dados). */
function scoreOf(r: BacBoResult): number {
  if (typeof r.score === "number" && r.score > 0) return r.score
  if (typeof r.result === "number" && r.result > 0) return r.result
  const code = winnerCode(r.winner)
  if (code === 1) return r.diceplayer1 + r.diceplayer2
  if (code === 2) return r.dicebanker1 + r.dicebanker2
  return r.diceplayer1 + r.diceplayer2
}

/** Token SEQUÊNCIA (igual Double): só o lado. */
function seqTokenOf(r: BacBoResult): string {
  return OUTCOME_NAME[winnerCode(r.winner)]
}

/** Token SOMA exato: PLAYER_8, BANKER_4, EMPATE_6 */
function somaTokenExact(r: BacBoResult): string {
  const side = OUTCOME_NAME[winnerCode(r.winner)]
  const sc = scoreOf(r)
  return sc > 0 ? `${side}_${sc}` : `${side}_X`
}

/** Token só lado (qualquer total): PLAYER_X, BANKER_X, EMPATE_X */
function somaTokenWild(r: BacBoResult): string {
  return `${OUTCOME_NAME[winnerCode(r.winner)]}_X`
}

/** Opções de token por rodada: exato + curinga de lado (não precisa alinhar o número). */
function somaTokenOptions(r: BacBoResult): string[] {
  const exact = somaTokenExact(r)
  const wild = somaTokenWild(r)
  return exact === wild ? [exact] : [exact, wild]
}

/** Produto cartesiano — gera combinações exact/wild da janela. */
function cartesian(opts: string[][]): string[][] {
  return opts.reduce<string[][]>(
    (acc, list) => {
      const next: string[][] = []
      for (const a of acc) for (const b of list) next.push([...a, b])
      return next
    },
    [[]]
  )
}

function parseTokenSide(token: string): number {
  const base = token.split("_")[0].toUpperCase()
  if (base === "PLAYER") return 1
  if (base === "BANKER") return 2
  return 0
}

function formatSomaTokenLabel(token: string): string {
  const [side, sc] = token.toUpperCase().split("_")
  const lab = side === "PLAYER" ? "Azul" : side === "BANKER" ? "Vermelho" : "Empate"
  if (!sc || sc === "X") return `qualquer ${lab.toLowerCase()}`
  return `${sc} ${lab.toLowerCase()}`
}

function specificity(seq: string): number {
  // quantos itens têm total fixo (não _X)
  return seq.split(",").filter((t) => {
    const p = t.split("_")
    return p.length > 1 && p[1] !== "X"
  }).length
}

// ═══════════════════════════════════════════════════════════════════════════
//  ABA 1 — HISTÓRICO
// ═══════════════════════════════════════════════════════════════════════════
function HistoricoTab() {
  const [results, setResults] = useState<BacBoResult[]>([])
  const [apiDown, setApiDown] = useState(false)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { results, apiDown } = await fetchBacBoRecent()
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
          const sc = scoreOf(r)
          return (
            <div key={r.id} className={`flex flex-col items-center gap-0.5 rounded-xl p-2 border ${outcomeBadgeClass(code)}`}>
              <span className="text-lg leading-none">{OUTCOME_EMOJI[code]}</span>
              <span className="text-[10px] font-bold">{OUTCOME_NAME[code]}</span>
              <span className="text-sm font-bold text-white tabular-nums">{sc > 0 ? sc : "—"}</span>
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
//  ABA 2 — BUSCAR PADRÃO (Sequência | Soma | Empate)
// ═══════════════════════════════════════════════════════════════════════════
type SearchMode = "sequencia" | "soma" | "empate"

const LS_PATTERNS = LS_PATTERNS_KEY
const LS_ACTIVE = LS_ACTIVE_KEY

function loadPatternsForMode(mode: SearchMode): PatternResult[] {
  try {
    const raw = localStorage.getItem(LS_PATTERNS)
    if (!raw) return []
    const all = JSON.parse(raw) as Record<string, PatternResult[]>
    return Array.isArray(all[mode]) ? all[mode] : []
  } catch {
    return []
  }
}

function savePatternsForMode(mode: SearchMode, list: PatternResult[]) {
  try {
    const raw = localStorage.getItem(LS_PATTERNS)
    const all: Record<string, PatternResult[]> = raw ? JSON.parse(raw) : {}
    all[mode] = list
    localStorage.setItem(LS_PATTERNS, JSON.stringify(all))
  } catch {
    /* */
  }
}

function BuscarPadraoTab({ initialMode = "sequencia" as SearchMode }: { initialMode?: SearchMode }) {
  const [searchMode, setSearchMode] = useState<SearchMode>(initialMode)
  const [gales, setGales] = useState(1)
  const [minOcc, setMinOcc] = useState(2)
  /** Sequência: 2–4 itens */
  const [seqLen, setSeqLen] = useState(2)
  const [loading, setLoading] = useState(false)
  // Padrões por modo — Sequência não mistura com Soma/Empate
  const [patterns, setPatterns] = useState<PatternResult[]>(() => loadPatternsForMode(initialMode))
  const [sampleSize, setSampleSize] = useState(0)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<Set<string>>(() => {
    try {
      const s = localStorage.getItem(LS_ACTIVE)
      if (!s) return new Set()
      const arr = JSON.parse(s) as { sequence: string; betOutcome: string }[]
      return new Set(arr.map((p) => `${p.sequence}→${p.betOutcome}`))
    } catch {
      return new Set()
    }
  })
  const [infoMsg, setInfoMsg] = useState("")

  useEffect(() => {
    setSearchMode(initialMode)
    setPatterns(loadPatternsForMode(initialMode))
    if (initialMode === "sequencia") setMinOcc(5)
    else setMinOcc(3)
  }, [initialMode])

  useEffect(() => {
    const st = searchMode === "sequencia" ? "SEQUÊNCIA" : "SOMA"
    fetch(`${BACBO_ESTRAT_API}?strategyType=${encodeURIComponent(st)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((list) => {
        if (!Array.isArray(list)) return
        setSaved((prev) => {
          const next = new Set(prev)
          for (const s of list) next.add(`${s.sequence}→${s.color}`)
          return next
        })
      })
      .catch(() => {})
  }, [searchMode])

  async function analyze() {
    setLoading(true)
    setInfoMsg("")
    const len = Math.max(2, Math.min(4, seqLen))

    try {
      const { results } = await fetchBacBoRecent()
      const sorted = [...results].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
      setSampleSize(sorted.length)

      if (sorted.length < len + 1) {
        setPatterns([])
        setInfoMsg(`Poucos resultados (${sorted.length}). Precisa de pelo menos ${len + 1}.`)
        return
      }

      const outcomesToSearch = searchMode === "empate" ? [0] : [1, 2]
      const maxGales = Math.max(0, gales)
      const stats: Record<string, PatternResult> = {}
      const lastI = sorted.length - 1

      for (let i = len; i <= lastI; i++) {
        const window = sorted.slice(i - len, i)

        // SEQUÊNCIA: só lado. SOMA/EMPATE: combinações exact + wild (qualquer vermelho/azul)
        let seqVariants: string[][]
        if (searchMode === "sequencia") {
          seqVariants = [window.map(seqTokenOf)]
        } else {
          seqVariants = cartesian(window.map(somaTokenOptions))
        }

        for (const tokens of seqVariants) {
          const seqKey = tokens.join(",")
          if (!seqKey) continue

          for (const betNum of outcomesToSearch) {
            const betOutcome = OUTCOME_NAME[betNum]
            const key = `${seqKey}→${betOutcome}`

            if (!stats[key]) {
              stats[key] = {
                sequence: seqKey,
                betOutcome,
                betOutcomeNum: betNum,
                occurrences: 0,
                wins: 0,
                galeWins: new Array(Math.max(maxGales, 1)).fill(0),
                hitRate: 0,
              }
            }
            stats[key].occurrences++

            for (let g = 0; g <= maxGales; g++) {
              const idx = i + g
              if (idx > lastI) break
              if (OUTCOME_NAME[winnerCode(sorted[idx].winner)] === betOutcome) {
                if (g === 0) stats[key].wins++
                else if (g - 1 < stats[key].galeWins.length) stats[key].galeWins[g - 1]++
                break
              }
            }
          }
        }
      }

      const totalWins = (p: PatternResult) => p.wins + p.galeWins.reduce((a, b) => a + b, 0)

      let list = Object.values(stats)
        .filter((p) => p.occurrences >= minOcc)
        .map((p) => ({ ...p, hitRate: totalWins(p) / Math.max(1, p.occurrences) }))
        .sort(
          (a, b) =>
            b.hitRate - a.hitRate ||
            b.occurrences - a.occurrences ||
            specificity(b.sequence) - specificity(a.sequence)
        )

      let usedMin = minOcc
      if (list.length === 0) {
        for (const soft of [2, 1]) {
          if (soft >= minOcc) continue
          list = Object.values(stats)
            .filter((p) => p.occurrences >= soft)
            .map((p) => ({ ...p, hitRate: totalWins(p) / Math.max(1, p.occurrences) }))
            .sort(
              (a, b) =>
                b.hitRate - a.hitRate ||
                b.occurrences - a.occurrences ||
                specificity(b.sequence) - specificity(a.sequence)
            )
          if (list.length > 0) {
            usedMin = soft
            setInfoMsg(`Nenhum com ≥${minOcc} ocorrências. Mostrando ≥${soft}.`)
            break
          }
        }
      }

      // Remove padrões 100% curingas na SOMA se houver alternativas com número fixo
      // (ex.: prefira "7 azul → qualquer vermelho" a "qualquer azul → qualquer vermelho")
      if (searchMode !== "sequencia") {
        const hasSpecific = list.some((p) => specificity(p.sequence) > 0)
        if (hasSpecific) {
          list = list.filter((p) => specificity(p.sequence) > 0)
        }
      }

      const top = list.slice(0, 12)
      setPatterns(top)
      savePatternsForMode(searchMode, top)

      if (top.length === 0) {
        setInfoMsg(`Nenhum padrão em ${sorted.length} resultados. Baixe o mínimo de ocorrências.`)
      } else if (usedMin === minOcc) {
        setInfoMsg(
          `${top.length} padrões · ${sorted.length} resultados · mín. ${usedMin}` +
            (searchMode !== "sequencia" ? " · curingas = qualquer total da cor" : "")
        )
      }
    } catch (e) {
      setInfoMsg("Erro ao buscar padrões. Tente de novo.")
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function savePattern(p: PatternResult) {
    const key = `${p.sequence}→${p.betOutcome}`
    if (saved.has(key) || saving) return
    setSaving(key)
    try {
      const strategyType = searchMode === "sequencia" ? "SEQUÊNCIA" : "SOMA"
      const res = await fetch(BACBO_ESTRAT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sequence: p.sequence,
          color: p.betOutcome,
          strategyType,
          gameType: BACBO_ROOM === "bacbo-live" ? "BACBO_LIVE" : "BACBO",
          platform: "BLAZE",
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setInfoMsg(err.error ?? "Falha ao salvar")
      } else {
        setSaved((prev) => new Set([...prev, key]))
        try {
          const raw = localStorage.getItem(LS_ACTIVE)
          const prev: PatternResult[] = raw ? JSON.parse(raw) : []
          if (!prev.some((s) => `${s.sequence}→${s.betOutcome}` === key)) {
            localStorage.setItem(LS_ACTIVE, JSON.stringify([...prev, p]))
          }
        } catch {
          /* */
        }
      }
    } catch {
      setInfoMsg("Erro de rede ao salvar")
    } finally {
      setSaving(null)
    }
  }

  const hitBg = (rate: number) =>
    rate >= 0.7 ? "text-green-400" : rate >= 0.55 ? "text-yellow-400" : "text-red-400"

  const MODE_META: Record<SearchMode, { title: string; desc: string; btn: string; accent: string }> = {
    sequencia: {
      title: "Padrão de sequência",
      desc: "Igual ao Double: só a cor/lado (Player, Banker, Empate).",
      btn: "🎯 Buscar sequências",
      accent: "border-blue-500/40 bg-blue-500/10 text-blue-300",
    },
    soma: {
      title: "Padrão de soma",
      desc: "Número + cor, com curingas: ex. 7 azul → qualquer vermelho → qualquer vermelho → entrada no azul.",
      btn: "🔢 Buscar somas",
      accent: "border-green-500/40 bg-green-500/10 text-green-300",
    },
    empate: {
      title: "Padrão de empate",
      desc: "Mesmo modelo da soma (número/cor + curingas), mas a entrada é só no Empate.",
      btn: "🟡 Buscar empates",
      accent: "border-yellow-500/40 bg-yellow-500/10 text-yellow-200",
    },
  }

  const meta = MODE_META[searchMode]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            { id: "sequencia" as const, lab: "Sequência", icon: "🔗" },
            { id: "soma" as const, lab: "Soma", icon: "🔢" },
            { id: "empate" as const, lab: "Empate", icon: "🟡" },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setSearchMode(m.id)
              setInfoMsg("")
              setPatterns(loadPatternsForMode(m.id))
              if (m.id === "sequencia") setMinOcc(5)
              else setMinOcc(3)
            }}
            className={`py-2.5 rounded-xl border text-xs font-semibold transition ${
              searchMode === m.id
                ? MODE_META[m.id].accent + " ring-1 ring-white/10"
                : "bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300"
            }`}
          >
            <span className="mr-1">{m.icon}</span>
            {m.lab}
          </button>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-white">{meta.title}</p>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{meta.desc}</p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Qtd. de Gales</p>
            <NumberField
              min={0}
              max={10}
              value={gales}
              onChange={setGales}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Mín. de ocorrências</p>
            <NumberField
              min={1}
              value={minOcc}
              onChange={setMinOcc}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Itens na sequência (2–4)</p>
            <NumberField
              min={2}
              max={4}
              value={seqLen}
              onChange={(n) => setSeqLen(Math.max(2, Math.min(4, n)))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </div>
        </div>

        <button
          onClick={analyze}
          disabled={loading}
          className="w-full bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black font-bold py-3 rounded-xl text-sm transition-colors"
        >
          {loading ? "Analisando..." : meta.btn}
        </button>

        {infoMsg && <p className="text-xs text-yellow-400/90">{infoMsg}</p>}
      </div>

      {searchMode === "empate" && !loading && patterns.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-xl p-4 space-y-1">
          <p className="text-sm font-bold text-white">🟡 Entrada no Empate</p>
          <p className="text-xs text-gray-300 leading-relaxed">
            Mesmo modelo da soma (número/cor + “qualquer vermelho/azul”), com aposta só no Empate.
          </p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-3 h-24 text-gray-400 text-sm">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          Catalogando padrões...
        </div>
      )}

      {patterns.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">
            Top {patterns.length} padrões
          </p>
          {patterns.map((p, i) => {
            const key = `${p.sequence}→${p.betOutcome}`
            const isSaved = saved.has(key)
            const isSaving = saving === key
            return (
              <div
                key={i}
                className={`rounded-xl p-4 border transition-all ${
                  isSaved ? "bg-yellow-500/5 border-yellow-500/30" : "bg-gray-900 border-gray-800"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 flex-wrap mb-2">
                      {isSaved && <span className="text-base mr-1">👑</span>}
                      {p.sequence.split(",").map((token, j) => {
                        const code = parseTokenSide(token)
                        return (
                          <span
                            key={j}
                            className={`text-xs font-bold px-2 py-0.5 rounded border ${outcomeBadgeClass(code)}`}
                            title={token}
                          >
                            {OUTCOME_EMOJI[code]}{" "}
                            {searchMode === "sequencia" ? token : formatSomaTokenLabel(token)}
                          </span>
                        )
                      })}
                      <span className="text-gray-600 text-xs">→</span>
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded border ${outcomeBadgeClass(p.betOutcomeNum)}`}
                      >
                        {OUTCOME_EMOJI[p.betOutcomeNum]} {p.betOutcome}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs flex-wrap">
                      <span className={`font-bold text-base ${hitBg(p.hitRate)}`}>
                        {(p.hitRate * 100).toFixed(1)}%
                      </span>
                      <span className="text-gray-500">{p.occurrences} ocorrências</span>
                      <span className="text-green-400">{p.wins}× direto</span>
                      {p.galeWins.map(
                        (g, gi) =>
                          g > 0 && (
                            <span key={gi} className="text-yellow-400">
                              {g}× gale{gi + 1}
                            </span>
                          )
                      )}
                    </div>
                    <div className="mt-2 h-1 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full"
                        style={{ width: `${p.hitRate * 100}%` }}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => savePattern(p)}
                    disabled={isSaved || !!saving}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-60 ${
                      isSaved
                        ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                        : "bg-green-500 hover:bg-green-400 text-black"
                    }`}
                  >
                    {isSaving ? "..." : isSaved ? "👑 Salvo" : "Usar"}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && patterns.length === 0 && (
        <p className="text-center text-gray-500 text-sm py-8">
          {infoMsg || "Configure os parâmetros e clique em buscar."}
        </p>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  PÁGINA PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
type Tab = "historico" | "buscar"

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "historico", label: "Histórico", icon: "📊" },
  { id: "buscar", label: "Buscar Padrão", icon: "🔍" },
]

export default function PremiumBacBoPage() {
  const [tab, setTab] = useState<Tab>("historico")
  const [licensed, setLicensed] = useState(true)
  const [checking, setChecking] = useState(true)
  // Se o bot está em SOMA, a aba Buscar já abre no modelo Soma
  const [defaultSearchMode, setDefaultSearchMode] = useState<SearchMode>("sequencia")

  useEffect(() => {
    fetch("/api/user/me")
      .then((r) => r.json())
      .then((data) => {
        const isPaid =
          data.paymentStatus === "PAID" && (!data.expireIn || new Date(data.expireIn) > new Date())
        setLicensed(isPaid || !!data.isTesting || !!data.isAdminAccount)

        const st = String(data.bacBoSettings?.strategyType ?? data.settings?.strategyType ?? "")
        if (st === "SOMA") {
          setDefaultSearchMode("soma")
          // Cliente com SOMA ativo → já leva pra busca de soma
          setTab("buscar")
        } else if (st === "SEQUÊNCIA" || st === "SEQUENCIA") {
          setDefaultSearchMode("sequencia")
        }

        // Query ?mode=soma|empate|sequencia
        try {
          const q = new URLSearchParams(window.location.search).get("mode")
          if (q === "soma" || q === "empate" || q === "sequencia") {
            setDefaultSearchMode(q)
            setTab("buscar")
          }
        } catch {
          /* */
        }

        setChecking(false)
      })
      .catch(() => setChecking(false))
  }, [])

  if (checking) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin" />
      </div>
    )
  }

  if (!licensed) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
        <div className="text-4xl">🔒</div>
        <div>
          <h2 className="text-white font-bold text-lg">Acesso Restrito</h2>
          <p className="text-gray-400 text-sm mt-1">
            Você precisa de uma assinatura ativa para acessar o Premium.
          </p>
        </div>
        <a
          href="/conta"
          className="bg-green-500 hover:bg-green-400 text-black font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors"
        >
          Ver Planos
        </a>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-3xl">🎲</span>
        <div>
          <h1 className="text-xl font-bold text-white">Premium {BACBO_PAGE_TITLE}</h1>
          <p className="text-xs text-gray-500">Histórico e busca de padrões (sequência, soma e empate)</p>
        </div>
      </div>

      <div className="flex gap-1 bg-gray-900/80 border border-gray-800 rounded-xl p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              tab === t.id ? "bg-white/10 text-white shadow" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            <span>{t.icon}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      <div>
        {tab === "historico" && <HistoricoTab />}
        {tab === "buscar" && <BuscarPadraoTab initialMode={defaultSearchMode} />}
      </div>
    </div>
  )
}
