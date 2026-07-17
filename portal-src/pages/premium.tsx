import { useEffect, useState, useCallback, useRef } from "react"
import { NumberField } from "@/components/ui/NumberField"

// ─── Types ────────────────────────────────────────────────────────────────────
interface DoubleResult {
  id: string
  color: number
  roll: number
  created_at: string
}

interface GeneratedEntry {
  time: string
  color: number
  confidence: number
  samples: number
}

interface PatternResult {
  sequence: string
  betColor: string
  betColorNum: number
  occurrences: number
  wins: number
  galeWins: number[]
  hitRate: number
}

interface ValidationEntry {
  time: string
  color: number
  result: "WIN" | "GALE1" | "GALE2" | "GALE3" | "GALE4" | "GALE5" | "PROTEGIDO" | "LOSS" | "PENDENTE"
  actualColor?: number
  nextHitInfo?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const COLOR_NAME: Record<number, string> = { 0: "BRANCO", 1: "VERMELHO", 2: "PRETO" }
const COLOR_EMOJI: Record<number, string> = { 0: "⚪️", 1: "🔴", 2: "⚫️" }

// Procura, a partir de um índice (depois dos gales já esgotados), o próximo
// round real que teria batido a cor — só informativo, não conta como vitória.
function findNextHit(rounds: { created_at: string; color: number }[], fromIdx: number, color: number, labelMap: Record<number, string> = COLOR_NAME): string | undefined {
  for (let i = fromIdx; i < rounds.length; i++) {
    if (rounds[i].color === color) {
      const { hhmm } = toBR(rounds[i].created_at)
      return `${hhmm} (${labelMap[color]})`
    }
  }
  return undefined
}

const BR_TZ = "America/Sao_Paulo"

function intlParts(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BR_TZ,
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(date)
}

function toBR(iso: string) {
  const d = new Date(iso)
  const parts = intlParts(d)
  const h = parseInt(parts.find(p => p.type === "hour")?.value   ?? "0")
  const m = parseInt(parts.find(p => p.type === "minute")?.value ?? "0")
  const s = parseInt(parts.find(p => p.type === "second")?.value ?? "0")
  return { h, m, s, hhmm: `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}` }
}

function brNowHM(): { h: number; m: number; min: number } {
  const parts = intlParts(new Date())
  const h = parseInt(parts.find(p => p.type === "hour")?.value   ?? "0")
  const m = parseInt(parts.find(p => p.type === "minute")?.value ?? "0")
  return { h, m, min: h * 60 + m }
}

function toBRDate(iso: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BR_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d)
  const y  = parts.find(p => p.type === "year")?.value  ?? ""
  const mo = parts.find(p => p.type === "month")?.value ?? ""
  const dy = parts.find(p => p.type === "day")?.value   ?? ""
  return `${y}-${mo}-${dy}`
}

function brTodayStr(): string { return toBRDate(new Date().toISOString()) }

function brYesterdayStr(): string { return toBRDate(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) }

function isoRange(daysBack: number) {
  const end   = new Date()
  const start = new Date(end.getTime() - daysBack * 24 * 60 * 60 * 1000)
  return { start: start.toISOString(), end: end.toISOString() }
}

function parseListLine(line: string): { hhmm: string; color: number } | null {
  line = line.trim()
  if (!line) return null
  const timeMatch = line.match(/^(\d{1,2}:\d{2})/)
  if (!timeMatch) return null
  const hhmm = timeMatch[1].padStart(5, "0")
  const rest = line.slice(timeMatch[0].length)
  if (rest.includes("🔴")) return { hhmm, color: 1 }
  if (rest.includes("⚫") || rest.includes("⚫️")) return { hhmm, color: 2 }
  if (rest.includes("⚪") || rest.includes("⚪️")) return { hhmm, color: 0 }
  return null
}

function extractRecords(data: any): any[] {
  if (Array.isArray(data)) return data
  return data.records ?? data.data ?? data.results ?? []
}

function extractLastPage(data: any): number {
  return data.last_page ?? data.totalPages ?? data.total_pages ?? data.pages ?? 1
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function fetchPages(start: string, end: string, maxPages = 10, pageDelay = 300): Promise<DoubleResult[]> {
  let all: DoubleResult[] = []
  for (let page = 1; page <= maxPages; page++) {
    if (page > 1) await sleep(pageDelay)
    let res: Response
    let data: any
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await sleep(attempt * 5000)
      res = await fetch(
        `/api/premium/history?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&page=${page}`
      )
      data = await res.json()
      if (res.status !== 429) break
    }
    if (!res!.ok) throw new Error(data?.error ?? `Erro ${res!.status} na página ${page}`)
    const items = extractRecords(data)
    if (!items.length) break
    all = [...all, ...items]
    const lastPage = extractLastPage(data)
    if (lastPage && page >= lastPage) break
    if (items.length < 5) break
  }
  return all
}

// Single-request aggregate helpers — server handles paging + caching internally
async function fetchDoubleAggregate(days = 1, maxPages = 30): Promise<DoubleResult[]> {
  const res = await fetch(`/api/premium/double-aggregate?days=${days}&maxPages=${maxPages}`)
  if (!res.ok) { const d = await res.json(); throw new Error(d?.error ?? `Erro ${res.status}`) }
  const d = await res.json()
  return d.records ?? []
}

// Busca só o dia BR exato — necessário pro corretor de lista do Double,
// já que pedir "vários dias de uma vez" nunca cabe no limite de páginas
// (~2800 rounds/dia) e devolvia histórico vazio pra qualquer data que não
// fosse hoje.
async function fetchDoubleAggregateByDate(date: string, maxPages = 30): Promise<DoubleResult[]> {
  const res = await fetch(`/api/premium/double-aggregate?date=${date}&maxPages=${maxPages}`)
  if (!res.ok) { const d = await res.json(); throw new Error(d?.error ?? `Erro ${res.status}`) }
  const d = await res.json()
  return d.records ?? []
}

// ─── Color Tile ───────────────────────────────────────────────────────────────
function Tile({ color, roll, time }: { color: number; roll: number; time?: string }) {
  if (color === 0) return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="w-14 h-14 bg-white rounded-xl flex items-center justify-center shadow">
        <span className="text-xl">💎</span>
      </div>
      {time && <span className="text-[10px] text-gray-500">{time}</span>}
    </div>
  )
  const bg = color === 1 ? "bg-red-600" : "bg-gray-900 border border-gray-600"
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className={`w-14 h-14 ${bg} rounded-xl flex items-center justify-center shadow`}>
        <span className="text-white text-lg font-bold">{roll}</span>
      </div>
      {time && <span className="text-[10px] text-gray-500">{time}</span>}
    </div>
  )
}

// ─── Sub-tab nav ──────────────────────────────────────────────────────────────
type SubTab = "historico" | "gerador" | "buscar" | "validar"
const TABS: { id: SubTab; label: string; icon: string }[] = [
  { id: "historico", label: "Histórico",     icon: "📊" },
  { id: "gerador",   label: "Gerador de Lista", icon: "📋" },
  { id: "buscar",    label: "Buscar Padrão", icon: "🔍" },
  { id: "validar",   label: "Corrigir Lista", icon: "✅" },
]

// ═══════════════════════════════════════════════════════════════════════════════
//  ABA 1 — HISTÓRICO
// ═══════════════════════════════════════════════════════════════════════════════
function HistoricoTab() {
  const [page,     setPage]     = useState(1)
  const [results,  setResults]  = useState<DoubleResult[]>([])
  const [lastPage, setLastPage] = useState(1)
  const [loading,  setLoading]  = useState(false)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (p: number) => {
    setLoading(true)
    setError(null)
    try {
      const end   = new Date()
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)
      const res = await fetch(
        `/api/premium/history?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}&page=${p}`
      )
      const data = await res.json()
      if (!res.ok) { setError(data?.error ?? `Erro ${res.status}`); return }
      const records = extractRecords(data).map((r: any) => ({
        ...r,
        color: Number(r.color),
        roll:  Number(r.roll),
      }))
      setResults(records)
      setLastPage(extractLastPage(data))
      setLastSync(new Date())
    } catch (e: any) {
      setError(e?.message ?? "Erro de rede")
    } finally {
      setLoading(false)
    }
  }, [])

  // Carrega página 1 ao montar e polling a cada 30s (só se estiver na página 1)
  useEffect(() => {
    load(1)
    timerRef.current = setInterval(() => {
      setPage(p => { if (p === 1) load(1); return p })
    }, 30000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [load])

  function goTo(p: number) { setPage(p); load(p) }

  return (
    <div className="space-y-3">
      {/* Cabeçalho com info de sync */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${loading ? "bg-yellow-400 animate-pulse" : "bg-green-400"}`} />
          <span className="text-xs text-gray-500">
            {loading ? "Atualizando..." : lastSync ? `Atualizado às ${toBR(lastSync.toISOString()).hhmm}` : ""}
          </span>
        </div>
        {lastPage > 1 && (
          <span className="text-xs text-gray-500">
            Página {page} de {lastPage.toLocaleString("pt-BR")}
          </span>
        )}
      </div>

      {/* Erro */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* Grid */}
      {loading && results.length === 0 ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !loading && results.length === 0 && !error ? (
        <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
          Nenhum resultado encontrado
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {results.map((r) => (
              <Tile key={r.id} color={r.color} roll={r.roll} time={toBR(r.created_at).hhmm} />
            ))}
          </div>

          {/* Paginação */}
          {lastPage > 1 && (
            <div className="flex items-center gap-2 justify-center pt-2">
              <button disabled={page <= 1} onClick={() => goTo(1)}
                className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 text-xs disabled:opacity-30 hover:bg-gray-700 transition">«</button>
              <button disabled={page <= 1} onClick={() => goTo(page - 1)}
                className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 text-xs disabled:opacity-30 hover:bg-gray-700 transition">‹</button>
              <span className="text-xs text-gray-400 px-3 bg-gray-800 rounded-lg py-1.5">
                {page} / {lastPage.toLocaleString("pt-BR")}
              </span>
              <button disabled={page >= lastPage} onClick={() => goTo(page + 1)}
                className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 text-xs disabled:opacity-30 hover:bg-gray-700 transition">›</button>
              <button disabled={page >= lastPage} onClick={() => goTo(lastPage)}
                className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 text-xs disabled:opacity-30 hover:bg-gray-700 transition">»</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ABA 2 — GERADOR DE LISTA
// ═══════════════════════════════════════════════════════════════════════════════
function GeradorListaTab() {
  const [loading,  setLoading]  = useState(false)
  const [listMode, setListMode] = useState<"normal" | "branco">("normal")
  const [list,     setList]     = useState<GeneratedEntry[]>(() => {
    try { const s = localStorage.getItem("premium_gerador_full"); return s ? JSON.parse(s) : [] } catch { return [] }
  })
  const [copied,  setCopied]  = useState(false)
  const [stats,   setStats]   = useState<{ results: number } | null>(() => {
    try { const s = localStorage.getItem("premium_gerador_stats"); return s ? JSON.parse(s) : null } catch { return null }
  })
  const [error,   setError]   = useState<string | null>(null)

  async function generate(m: "normal" | "branco") {
    setListMode(m)
    setLoading(true)
    setList([])
    setStats(null)
    setError(null)
    try {
      const { min: nowMin } = brNowHM()
      const startMin = nowMin + 10

      const toMin = (hhmm: string) => {
        const [h, mn] = hhmm.split(":").map(Number)
        return h * 60 + mn
      }

      let chosen: GeneratedEntry[] = []
      let totalResults = 0

      if (m === "branco") {
        // 24h de histórico para o branco
        const results7 = await fetchDoubleAggregate(1, 30)
        totalResults = results7.length

        const groups7: Record<string, { branco: number; total: number }> = {}
        for (const r of results7) {
          const color = Number(r.color)
          const { hhmm } = toBR(r.created_at)
          if (!groups7[hhmm]) groups7[hhmm] = { branco: 0, total: 0 }
          if (color === 0) groups7[hhmm].branco++
          groups7[hhmm].total++
        }

        // Todos os minutos onde branco apareceu pelo menos 1x, ordenados por horário futuro
        const candidates: GeneratedEntry[] = Object.entries(groups7)
          .filter(([, g]) => g.branco >= 1)
          .map(([hhmm, g]) => ({
            time: hhmm,
            color: 0 as const,
            confidence: g.branco / g.total,
            samples: g.total,
          }))

        // Só futuros (próximas 8 horas), sem wrap para amanhã
        const maxFutureMin = startMin + 480
        const futureToday = candidates
          .filter(e => {
            const em = toMin(e.time)
            return em >= startMin && em <= Math.min(maxFutureMin, 1439)
          })
          .sort((a, b) => toMin(a.time) - toMin(b.time))

        // Se cruzar meia-noite, pega também os primeiros minutos do dia seguinte
        const overflow = maxFutureMin > 1440
          ? candidates
              .filter(e => toMin(e.time) <= maxFutureMin - 1440)
              .sort((a, b) => toMin(a.time) - toMin(b.time))
          : []

        const ordered = [...futureToday, ...overflow]

        const usedMins: number[] = []
        for (const entry of ordered) {
          if (chosen.length >= 7) break
          const em = toMin(entry.time)
          const tooClose = usedMins.some(u => Math.abs(u - em) < 3)
          if (!tooClose) {
            chosen.push(entry)
            usedMins.push(em)
          }
        }
      } else {
        const results = await fetchDoubleAggregate(1, 30)
        totalResults = results.length

        const groups: Record<string, { 0: number; 1: number; 2: number; total: number }> = {}
        for (const r of results) {
          const color = Number(r.color) as 0 | 1 | 2
          const { hhmm } = toBR(r.created_at)
          if (!groups[hhmm]) groups[hhmm] = { 0: 0, 1: 0, 2: 0, total: 0 }
          groups[hhmm][color]++
          groups[hhmm].total++
        }

        let generated: GeneratedEntry[] = []
        for (const [hhmm, g] of Object.entries(groups)) {
          if (g.total < 1) continue
          let domColor: 0 | 1 | 2 = 0
          if (g[1] >= g[2] && g[1] >= g[0]) domColor = 1
          else if (g[2] >= g[0]) domColor = 2
          const confidence = g[domColor] / g.total
          generated.push({ time: hhmm, color: domColor, confidence, samples: g.total })
        }

        const toOrd = (hhmm: string) => {
          const mn = toMin(hhmm)
          return mn >= startMin ? mn : mn + 1440
        }
        const ordered = [
          ...generated.filter(e => toMin(e.time) >= startMin),
          ...generated.filter(e => toMin(e.time) < nowMin),
        ].sort((a, b) => toOrd(a.time) - toOrd(b.time))

        const usedMins: number[] = []
        for (const entry of ordered) {
          if (chosen.length >= 20) break
          const em = toMin(entry.time)
          const tooClose = usedMins.some(u => {
            const diff = Math.abs(u - em)
            return diff < 3 || diff > 1440 - 3
          })
          if (!tooClose) {
            chosen.push(entry)
            usedMins.push(em)
          }
        }
      }

      setList(chosen)
      setStats({ results: totalResults })
      try {
        localStorage.setItem("premium_gerador_full",  JSON.stringify(chosen))
        localStorage.setItem("premium_gerador_list",  JSON.stringify(chosen.map(e => ({ time: e.time, color: e.color }))))
        localStorage.setItem("premium_gerador_stats", JSON.stringify({ results: totalResults }))
      } catch {}
    } catch (e: any) {
      const msg: string = e?.message ?? "Erro ao buscar histórico"
      setError(msg.includes("429")
        ? "O Blaze está bloqueando temporariamente. Aguarde 1 minuto e tente novamente."
        : msg)
    } finally {
      setLoading(false)
    }
  }

  function copyList() {
    const text = listMode === "branco"
      ? list.map(e => `${e.time} ⚪️`).join("\n")
      : list.map(e => `${e.time} ${COLOR_EMOJI[e.color]}⚪️`).join("\n")
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex gap-3">
          <button onClick={() => generate("normal")} disabled={loading}
            className="flex-1 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold py-3 rounded-xl text-sm transition-colors">
            {loading && listMode === "normal" ? "Analisando..." : "🎯 Gerar Lista"}
          </button>
          <button onClick={() => generate("branco")} disabled={loading}
            className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-colors border border-gray-600">
            {loading && listMode === "branco" ? "Analisando..." : "⚪ Gerar Lista Branco"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          ⚠️ {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-3 h-24 text-gray-400 text-sm">
          <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          Aguarde um instante até a geração terminar...
        </div>
      )}

      {!loading && listMode === "branco" && list.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-xl p-4 space-y-2">
          <p className="text-sm font-bold text-white">⚪ Atenção: Lista de Entrada no Branco</p>
          <p className="text-xs text-gray-300 leading-relaxed">O Branco é um resultado de baixa frequência, por isso é essencial configurar o robô com no mínimo 10 gales mão fixa para aumentar as chances de capturar a entrada quando ela ocorrer.</p>
          <p className="text-xs font-semibold text-yellow-400">⚠️ Recomendação: utilize sempre 10 gales mão fixa ao operar com essa lista.</p>
        </div>
      )}

      {list.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <div>
              <p className="text-white font-semibold text-sm">{list.length} entradas encontradas</p>
              {stats && <p className="text-xs text-gray-500">{stats.results} resultados das últimas 24h</p>}
            </div>
            <button onClick={copyList}
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
              {copied ? "✅ Copiado!" : "📋 Copiar lista"}
            </button>
          </div>
          <div className="p-4 space-y-1.5 max-h-96 overflow-y-auto">
            {list.map((e, i) => (
              <div key={i} className="flex items-center justify-between bg-gray-800/60 rounded-lg px-3 py-2">
                <div className="flex items-center gap-3">
                  <span className="text-white font-mono font-bold text-sm">{e.time}</span>
                  <span className="text-xl">{listMode === "branco" ? "⚪️" : `${COLOR_EMOJI[e.color]}⚪️`}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 bg-gray-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${listMode === "branco" ? "bg-white/60" : e.color === 1 ? "bg-red-500" : "bg-gray-400"}`}
                      style={{ width: `${e.confidence * 100}%` }} />
                  </div>
                  <span className="text-xs text-gray-400 w-10 text-right">{(e.confidence*100).toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && list.length === 0 && stats && (
        <div className="text-center text-gray-500 text-sm py-8">
          Nenhum padrão encontrado.<br/>
          <span className="text-xs">{stats.results} resultados analisados.</span>
        </div>
      )}
    </div>
  )
}

// ─── Modo "Número" — mesma técnica de curingas usada no SOMA do Bac Bo:
//     token exato (roll) + token curinga (só a cor) por rodada, cartesiano
//     na janela. Sem isso, sequências de número exato são raras demais pra
//     bater "Mín. de ocorrências" (15 valores possíveis por posição vs 3 na cor).
function numTokenOptions(r: DoubleResult): string[] {
  const exact = String(r.roll)
  const wild = COLOR_NAME[r.color]
  return exact === wild ? [exact, "X"] : [exact, wild, "X"]
}

function cartesianTokens(opts: string[][]): string[][] {
  return opts.reduce<string[][]>(
    (acc, list) => {
      const next: string[][] = []
      for (const a of acc) for (const b of list) next.push([...a, b])
      return next
    },
    [[]]
  )
}

// Quantas posições da sequência são número exato (não cor-curinga) — usado
// pra preferir padrões mais específicos quando existirem alternativas.
function numSpecificity(seq: string): number {
  return seq.split(",").filter(t => /^\d+$/.test(t)).length
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ABA 3 — BUSCAR PADRÃO
// ═══════════════════════════════════════════════════════════════════════════════
function BuscarPadraoTab() {
  const [gales,    setGales]    = useState(1)
  const [minOcc,   setMinOcc]   = useState(10)
  const [seqLen,   setSeqLen]   = useState(3)
  const [mode,     setMode]     = useState<"normal" | "branco" | "numero">("normal")
  const [loading,  setLoading]  = useState(false)
  const [patterns, setPatterns] = useState<PatternResult[]>(() => {
    try { const s = localStorage.getItem("premium_padrao_patterns"); return s ? JSON.parse(s) : [] } catch { return [] }
  })
  const [saving,   setSaving]   = useState<string | null>(null)
  const [error,    setError]    = useState("")
  const [saved,    setSaved]    = useState<Set<string>>(() => {
    try { const s = localStorage.getItem("premium_double_active_patterns"); return s ? new Set((JSON.parse(s) as PatternResult[]).map(p => `${p.sequence}→${p.betColor}`)) : new Set() } catch { return new Set() }
  })

  async function savePattern(p: PatternResult) {
    const key = `${p.sequence}→${p.betColor}`
    if (saved.has(key) || saving) return
    setSaving(key)
    await fetch("/api/user/estrategias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequence: p.sequence, color: p.betColor, gameType: "DOUBLE", strategyType: p.sequence.split(",").some(t => /^\d+$/.test(t)) ? "NÚMEROS" : "SEQUÊNCIA" }),
    })
    setSaving(null)
    setSaved(prev => new Set([...prev, key]))
    try {
      const raw = localStorage.getItem("premium_double_active_patterns")
      const prev: PatternResult[] = raw ? JSON.parse(raw) : []
      if (!prev.some(s => `${s.sequence}→${s.betColor}` === key)) {
        localStorage.setItem("premium_double_active_patterns", JSON.stringify([...prev, p]))
      }
    } catch {}
  }

  async function analyze(m: "normal" | "branco" | "numero") {
    setMode(m)
    setLoading(true)
    setPatterns([])
    setError("")

    try {
      const results = await fetchDoubleAggregate(1, 30)
      if (!results.length) {
        setError("Nenhum resultado encontrado no histórico das últimas 24h. Tente novamente em instantes.")
        return
      }
      const sorted = [...results].sort((a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )

      const stats: Record<string, PatternResult> = {}
      const colorsToSearch = m === "branco" ? [0] : [1, 2]
      const effectiveGales  = m === "branco" ? Math.max(gales, 10)  : gales
      const effectiveSeqLen = m === "branco" ? Math.max(seqLen, 5) : seqLen

      for (let i = effectiveSeqLen; i < sorted.length - effectiveGales; i++) {
        const window = sorted.slice(i - effectiveSeqLen, i)
        // Número: gera exato (roll) + curinga (cor) por rodada, cartesiano na
        // janela — senão sequência de número exato é rara demais pra achar padrão.
        const seqVariants = m === "numero"
          ? cartesianTokens(window.map(numTokenOptions))
          : [window.map(r => COLOR_NAME[r.color])]

        for (const seqTokens of seqVariants) {
          const seqKey = seqTokens.join(",")

          for (const betColorNum of colorsToSearch) {
            const betColor = COLOR_NAME[betColorNum]
            const key = `${seqKey}→${betColor}`

            if (!stats[key]) stats[key] = {
              sequence: seqKey,
              betColor,
              betColorNum,
              occurrences: 0,
              wins: 0,
              galeWins: new Array(effectiveGales).fill(0),
              hitRate: 0,
            }
            stats[key].occurrences++

            const nextColor = COLOR_NAME[sorted[i].color]
            if (nextColor === betColor) {
              stats[key].wins++
            } else {
              for (let g = 1; g <= effectiveGales; g++) {
                if (i + g < sorted.length && COLOR_NAME[sorted[i + g].color] === betColor) {
                  stats[key].galeWins[g - 1]++
                  break
                }
              }
            }
          }
        }
      }

      const totalWins = (p: PatternResult) => p.wins + p.galeWins.reduce((a, b) => a + b, 0)
      let usedMinOcc = minOcc
      let list = Object.values(stats)
        .filter(p => p.occurrences >= minOcc)
        .map(p => ({ ...p, hitRate: totalWins(p) / p.occurrences }))
        .sort((a, b) => b.hitRate - a.hitRate)

      // Número: se nada bateu o mínimo configurado, tenta com mínimo menor
      // (mesmo fallback do SOMA do Bac Bo) antes de desistir.
      if (m === "numero" && list.length === 0) {
        for (const soft of [3, 2]) {
          if (soft >= minOcc) continue
          const relaxed = Object.values(stats)
            .filter(p => p.occurrences >= soft)
            .map(p => ({ ...p, hitRate: totalWins(p) / p.occurrences }))
            .sort((a, b) => b.hitRate - a.hitRate)
          if (relaxed.length > 0) {
            list = relaxed
            usedMinOcc = soft
            setError(`Nenhum padrão com ≥${minOcc} ocorrências — mostrando com ≥${soft}.`)
            break
          }
        }
      }

      // Número: prefere sequências mais específicas (com número exato) quando
      // existirem, em vez de só cor-curinga em tudo.
      if (m === "numero" && list.length > 0) {
        const hasSpecific = list.some(p => numSpecificity(p.sequence) > 0)
        if (hasSpecific) {
          list = list.filter(p => numSpecificity(p.sequence) > 0)
        }
      }

      const top = list.slice(0, 5)
      setPatterns(top)
      try { localStorage.setItem("premium_padrao_patterns", JSON.stringify(top)) } catch {}
    } catch (e: any) {
      setError(e?.message ?? "Erro ao buscar padrões. Tente novamente.")
    } finally {
      setLoading(false)
    }
  }

  const hitBg = (rate: number) =>
    rate >= 0.7 ? "text-green-400" : rate >= 0.55 ? "text-yellow-400" : "text-red-400"

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Qtd. de Gales</p>
            <NumberField min={0} max={10} value={gales}
              onChange={(n) => setGales(n)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50" />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Mín. de ocorrências</p>
            <NumberField min={1} value={minOcc}
              onChange={(n) => setMinOcc(n)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50" />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Pedras na sequência</p>
            <NumberField min={1} max={6} value={seqLen}
              onChange={(n) => setSeqLen(n)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50" />
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => analyze("normal")} disabled={loading}
            className="flex-1 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold py-3 rounded-xl text-sm transition-colors">
            {loading && mode === "normal" ? "Analisando..." : "🎯 Buscar Padrões"}
          </button>
          <button onClick={() => analyze("numero")} disabled={loading}
            className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-colors border border-blue-500">
            {loading && mode === "numero" ? "Analisando..." : "🔢 Buscar Número"}
          </button>
          <button onClick={() => analyze("branco")} disabled={loading}
            className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-colors border border-gray-600">
            {loading && mode === "branco" ? "Analisando..." : "⚪ Buscar Branco"}
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-3 h-24 text-gray-400 text-sm">
          <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          Aguarde um instante até a busca terminar...
        </div>
      )}

      {!loading && error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {!loading && mode === "branco" && patterns.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-xl p-4 space-y-2">
          <p className="text-sm font-bold text-white">⚪ Atenção: Entrada no Branco</p>
          <p className="text-xs text-gray-300 leading-relaxed">O Branco é um resultado de baixa frequência, por isso é essencial configurar o robô com no mínimo 10 gales mão fixa para aumentar as chances de capturar a entrada quando ela ocorrer.</p>
          <p className="text-xs font-semibold text-yellow-400">⚠️ Recomendação: utilize sempre 10 gales mão fixa ao operar estratégias focadas no Branco.</p>
        </div>
      )}

      {patterns.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Top {patterns.length} padrões encontrados</p>
          {patterns.map((p, i) => {
            const pKey    = `${p.sequence}→${p.betColor}`
            const isSaved  = saved.has(pKey)
            const isSaving = saving === pKey
            return (
              <div key={i} className={`rounded-xl p-4 border transition-all ${isSaved ? "bg-yellow-500/5 border-yellow-500/30" : "bg-gray-900 border-gray-800"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 flex-wrap mb-2">
                      {isSaved && <span className="text-base mr-1">👑</span>}
                      {p.sequence.split(",").map((c, j) => {
                        const n = /^\d+$/.test(c) ? parseInt(c, 10) : null
                        if (n !== null) {
                          const nColorNum = n === 0 ? 0 : n <= 7 ? 1 : 2
                          return (
                            <span key={j} className={`text-xs font-bold px-2 py-0.5 rounded ${
                              nColorNum === 1 ? "bg-red-600/30 text-red-300" :
                              nColorNum === 2 ? "bg-gray-700 text-gray-300" :
                                                "bg-white/10 text-gray-200"
                            }`}>
                              {COLOR_EMOJI[nColorNum]} {n}
                            </span>
                          )
                        }
                        if (c === "X") {
                          return (
                            <span key={j} className="text-xs font-bold px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                              ✳️ X
                            </span>
                          )
                        }
                        return (
                          <span key={j} className={`text-xs font-bold px-2 py-0.5 rounded ${
                            c === "VERMELHO" ? "bg-red-600/30 text-red-300" :
                            c === "PRETO"    ? "bg-gray-700 text-gray-300" :
                                              "bg-white/10 text-gray-200"
                          }`}>
                            {COLOR_EMOJI[c === "VERMELHO" ? 1 : c === "PRETO" ? 2 : 0]} {c}
                          </span>
                        )
                      })}
                      <span className="text-gray-600 text-xs">→</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        p.betColorNum === 1 ? "bg-red-600/40 text-red-300" :
                        p.betColorNum === 0 ? "bg-white/20 text-white" :
                                              "bg-gray-700 text-gray-200"
                      }`}>
                        {COLOR_EMOJI[p.betColorNum]} {p.betColor}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className={`font-bold text-base ${hitBg(p.hitRate)}`}>
                        {(p.hitRate * 100).toFixed(1)}%
                      </span>
                      <span className="text-gray-500">{p.occurrences} ocorrências</span>
                      <span className="text-green-400">{p.wins}× direto</span>
                      {p.galeWins.map((g, gi) => g > 0 && (
                        <span key={gi} className="text-yellow-400">{g}× gale{gi+1}</span>
                      ))}
                    </div>
                    <div className="mt-2 h-1 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${p.hitRate * 100}%` }} />
                    </div>
                  </div>
                  <button onClick={() => savePattern(p)} disabled={isSaved || !!saving}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-60 ${
                      isSaved ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30" : "bg-green-500 hover:bg-green-400 text-black"
                    }`}>
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
          Configure os parâmetros e clique em "Buscar Padrões"
        </p>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ABA 4 — VALIDAR LISTA
// ═══════════════════════════════════════════════════════════════════════════════
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function ValidarListaTab() {
  const [listText,   setListText]   = useState("")
  const [gales,      setGales]      = useState(1)
  const [protection, setProtection] = useState(false)
  const [validateDate, setValidateDate] = useState(brTodayStr())
  const [loading,    setLoading]    = useState(false)
  const [results,    setResults]    = useState<ValidationEntry[]>([])
  const [copied,     setCopied]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  async function validate() {
    const entries = listText
      .split("\n")
      .map(parseListLine)
      .filter(Boolean) as { hhmm: string; color: number }[]

    if (!entries.length) return

    setLoading(true)
    setResults([])
    setError(null)

    try {
      // Busca histórico cobrindo a data escolhida (não sempre "hoje") — uma
      // lista colada depois da meia-noite é de ontem, não de hoje.
      const isToday = validateDate === brTodayStr()
      const history = await fetchDoubleAggregateByDate(validateDate, 30)
      // Ordena cronologicamente — Double joga a cada ~3 min, não a cada minuto
      const targetRounds = history
        .filter(r => toBRDate(r.created_at) === validateDate)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

      const validated: ValidationEntry[] = entries.map(({ hhmm, color }) => {
        // Encontra o primeiro round no horário do sinal ou após ele
        const startIdx = targetRounds.findIndex(r => toBR(r.created_at).hhmm >= hhmm)

        if (startIdx === -1) {
          if (!isToday) return { time: hhmm, color, result: "LOSS" }
          const { h: brH, m: brM } = brNowHM()
          const nowHHMM = `${String(brH).padStart(2,"0")}:${String(brM).padStart(2,"0")}`
          return { time: hhmm, color, result: hhmm > nowHHMM ? "PENDENTE" : "LOSS" }
        }

        // Checa o round de entrada + rounds seguintes reais (não minutos consecutivos)
        for (let g = 0; g <= gales; g++) {
          const idx = startIdx + g
          if (idx >= targetRounds.length) break
          const round = targetRounds[idx]
          if (round.color === color) {
            return {
              time: hhmm, color,
              result: (g === 0 ? "WIN" : `GALE${g}`) as ValidationEntry["result"],
              actualColor: round.color,
            }
          }
          // Proteção no branco
          if (protection && round.color === 0) {
            return { time: hhmm, color, result: "PROTEGIDO", actualColor: 0 }
          }
        }

        // Gales esgotados sem bater — mostra informativamente onde essa cor
        // bateria depois (não conta como vitória, é só contexto pro cliente)
        const nextHitInfo = findNextHit(targetRounds, startIdx + gales + 1, color)

        // Data passada: nada fica pendente, o dia já acabou
        if (!isToday) return { time: hhmm, color, result: "LOSS", nextHitInfo }

        // Pendente (horário ainda não ocorreu hoje)
        const { h: brH, m: brM } = brNowHM()
        const nowHHMM = `${String(brH).padStart(2,"0")}:${String(brM).padStart(2,"0")}`
        if (hhmm > nowHHMM) {
          return { time: hhmm, color, result: "PENDENTE" }
        }
        return { time: hhmm, color, result: "LOSS", nextHitInfo }
      })

      setResults(validated)
    } catch (e: any) {
      setError(e?.message ?? "Erro ao corrigir a lista. Tente novamente.")
    } finally {
      setLoading(false)
    }
  }

  function copyResultsList() {
    const colorEmoji = (c: number) => c === 1 ? "🔴" : c === 2 ? "⚫" : "⚪"
    const resLabel = (r: ValidationEntry) => {
      if (r.result === "WIN") return "✅ WIN"
      if (r.result.startsWith("GALE")) return `⚡ GALE ${r.result.slice(4)}`
      if (r.result === "PROTEGIDO") return "⚪ PROTEGIDO"
      if (r.result === "PENDENTE") return "⏳ PENDENTE"
      return "❌ LOSS"
    }

    const lines: string[] = [
      "⚡ AUTOWIN — Validação de Lista",
      `Gales: ${gales}   |   Proteção no Branco: ${protection ? "✅ Sim" : "❌ Não"}`,
      "",
    ]

    for (const r of results.filter(x => x.result !== "PENDENTE")) {
      const extra = r.result === "LOSS" && r.nextHitInfo ? `  (bateria ${r.nextHitInfo})` : ""
      lines.push(`${r.time} ${colorEmoji(r.color)}  →  ${resLabel(r)}${extra}`)
    }

    const pending = results.filter(x => x.result === "PENDENTE")
    if (pending.length) {
      lines.push("", "⏳ PENDENTES (copie para usar):")
      for (const r of pending) lines.push(`${r.time} ${colorEmoji(r.color)}`)
    }

    const assertividade = total > 0 ? ((wins / total) * 100).toFixed(1) : "0.0"
    lines.push(
      "",
      `📊  WIN: ${wins}  |  LOSS: ${loss}`,
      `🎯  Assertividade: ${assertividade}%`,
    )
    navigator.clipboard.writeText(lines.join("\n")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500) })
  }

  function downloadImage() {
    const colorEmoji = (c: number) => c === 1 ? "🔴" : c === 2 ? "⚫" : "⚪"
    const display    = results.filter(r => r.result !== "PENDENTE")
    const pending    = results.filter(r => r.result === "PENDENTE")

    const W   = 500
    const ROW = 40
    const H   = 130 + 80 + 48 + display.length * ROW + (pending.length ? 28 + pending.length * 32 : 0) + 80

    const canvas = document.createElement("canvas")
    canvas.width  = W * 2; canvas.height = H * 2
    const ctx = canvas.getContext("2d")!
    ctx.scale(2, 2)

    // BG
    ctx.fillStyle = "#0d1117"; ctx.fillRect(0, 0, W, H)
    // top border
    const grad = ctx.createLinearGradient(0,0,W,0)
    grad.addColorStop(0,"#39FF14"); grad.addColorStop(1,"#FFE600")
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, 3)

    let y = 22
    // Logo
    ctx.textAlign = "center"
    ctx.font = "bold 26px Arial"
    ctx.fillStyle = "#39FF14"
    ctx.shadowColor = "#39FF14"; ctx.shadowBlur = 18
    ctx.fillText("⚡ AUTOWIN", W/2, y + 26)
    ctx.shadowBlur = 0
    y += 44
    ctx.font = "12px Arial"; ctx.fillStyle = "#6b7280"
    ctx.fillText("Validação de Lista — Premium", W/2, y)
    y += 22
    ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(20,y); ctx.lineTo(W-20,y); ctx.stroke()
    y += 14

    // Config pill
    ctx.fillStyle = "#161b22"
    rrect(ctx, 20, y, W-40, 28, 6); ctx.fill()
    ctx.font = "11px Arial"; ctx.fillStyle = "#9ca3af"; ctx.textAlign = "center"
    ctx.fillText(`Gales: ${gales}     Proteção no Branco: ${protection ? "✅ Sim" : "❌ Não"}`, W/2, y + 19)
    y += 38

    // Stats
    const statItems: { label:string; count:number; color:string }[] = [
      { label:"WIN",  count:wins, color:"#4ade80" },
      { label:"LOSS", count:loss, color:"#f87171" },
    ]
    const cols   = statItems.length
    const boxW   = (W - 40 - (cols-1)*6) / cols
    const boxH   = 58
    for (let i = 0; i < cols; i++) {
      const s  = statItems[i], bx = 20 + i*(boxW+6)
      ctx.fillStyle = s.color + "18"
      rrect(ctx, bx, y, boxW, boxH, 8); ctx.fill()
      ctx.strokeStyle = s.color + "50"; ctx.lineWidth = 1
      rrect(ctx, bx, y, boxW, boxH, 8); ctx.stroke()
      ctx.font = "bold 20px Arial"; ctx.fillStyle = s.color; ctx.textAlign = "center"
      ctx.fillText(String(s.count), bx+boxW/2, y+30)
      ctx.font = "9px Arial"; ctx.fillStyle = s.color+"bb"
      ctx.fillText(s.label, bx+boxW/2, y+47)
    }
    y += boxH + 14

    // Result rows
    const RESULT_CLR: Record<string,string> = { WIN:"#4ade80", PROTEGIDO:"#d1d5db", LOSS:"#f87171" }
    const RESULT_LBL: Record<string,string> = { WIN:"WIN", PROTEGIDO:"⚪ PROT.", LOSS:"LOSS" }
    const getC = (r: string) => r.startsWith("GALE") ? "#fbbf24" : (RESULT_CLR[r] ?? "#9ca3af")
    const getL = (r: string) => r.startsWith("GALE") ? `GALE ${r.slice(4)}` : (RESULT_LBL[r] ?? r)
    for (let i = 0; i < display.length; i++) {
      const r = display[i]
      ctx.fillStyle = i%2===0 ? "#161b22" : "#0d1117"
      ctx.fillRect(20, y, W-40, ROW-2)
      // Time
      ctx.font = "bold 13px monospace"; ctx.fillStyle = "#f9fafb"; ctx.textAlign = "left"
      ctx.fillText(r.time, 32, y+25)
      // Color
      ctx.font = "15px Arial"
      ctx.fillText(colorEmoji(r.color)+" ⚪", 92, y+25)
      // Badge
      const c   = getC(r.result)
      const lbl = getL(r.result)
      const bw  = 72, bh = 24, bx = W-20-bw, by = y+8
      ctx.fillStyle = c+"25"; rrect(ctx,bx,by,bw,bh,10); ctx.fill()
      ctx.strokeStyle = c+"60"; ctx.lineWidth = 1; rrect(ctx,bx,by,bw,bh,10); ctx.stroke()
      ctx.font = "bold 11px Arial"; ctx.fillStyle = c; ctx.textAlign = "center"
      ctx.fillText(lbl, bx+bw/2, by+16)
      y += ROW
    }

    // Pending
    if (pending.length) {
      y += 8
      ctx.font = "11px Arial"; ctx.fillStyle = "#6b7280"; ctx.textAlign = "left"
      ctx.fillText("⏳  Pendentes:", 20, y+14)
      y += 26
      for (const r of pending) {
        ctx.font = "12px monospace"; ctx.fillStyle = "#4b5563"
        ctx.fillText(`${r.time}  ${colorEmoji(r.color)}`, 32, y+14)
        y += 30
      }
    }

    // Footer
    y += 8
    ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(20,y); ctx.lineTo(W-20,y); ctx.stroke()
    y += 18
    const assertividade = total > 0 ? ((wins/total)*100).toFixed(1) : "0.0"
    ctx.font = "bold 14px Arial"; ctx.fillStyle = "#39FF14"
    ctx.shadowColor = "#39FF14"; ctx.shadowBlur = 10; ctx.textAlign = "center"
    ctx.fillText(`${assertividade}% assertividade`, W/2, y+16)
    ctx.shadowBlur = 0
    y += 34
    ctx.font = "10px Arial"; ctx.fillStyle = "#374151"
    const dateStr = new Date().toLocaleDateString("pt-BR")+" "+new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})
    ctx.fillText(`AUTOWIN • ${dateStr}`, W/2, y)

    const link = document.createElement("a")
    link.download = `autowin-lista-${Date.now()}.png`
    link.href = canvas.toDataURL("image/png")
    link.click()
  }

  const RESULT_STYLE: Record<string, string> = {
    WIN:       "bg-green-500/20 text-green-400 border-green-500/30",
    PROTEGIDO: "bg-gray-400/20 text-gray-200 border-gray-400/30",
    LOSS:      "bg-red-500/20 text-red-400 border-red-500/30",
    PENDENTE:  "bg-gray-700/50 text-gray-400 border-gray-600",
  }
  const getStyle = (r: string) => r.startsWith("GALE") ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" : (RESULT_STYLE[r] ?? "")

  const wins      = results.filter(r => r.result === "WIN" || r.result.startsWith("GALE") || (protection && r.result === "PROTEGIDO")).length
  const protegido = results.filter(r => r.result === "PROTEGIDO").length
  const loss      = results.filter(r => r.result === "LOSS").length
  const total     = results.filter(r => r.result !== "PENDENTE").length

  return (
    <div className="space-y-4">
      {/* Input */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div>
          <p className="text-xs text-gray-500 mb-1.5 font-medium">Cole sua lista (formato: HH:MM 🔴⚪️)</p>
          <textarea
            value={listText}
            onChange={(e) => setListText(e.target.value)}
            rows={8}
            placeholder={"15:00 🔴⚪️\n15:04 🔴⚪️\n15:19 ⚫️⚪️\n15:27 ⚫️⚪️"}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500/50 resize-none"
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Data da lista</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setValidateDate(brTodayStr())}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${validateDate === brTodayStr() ? "bg-green-500 text-black" : "bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700"}`}>
                Hoje
              </button>
              <button type="button" onClick={() => setValidateDate(brYesterdayStr())}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${validateDate === brYesterdayStr() ? "bg-green-500 text-black" : "bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700"}`}>
                Ontem
              </button>
            </div>
          </div>
          <div className="flex-1">
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Gales a validar</p>
            <NumberField min={0} max={10} value={gales}
              onChange={(n) => setGales(n)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50" />
          </div>
        </div>
        <button onClick={validate} disabled={loading || !listText.trim()}
          className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold py-2.5 rounded-xl text-sm transition-colors">
          {loading ? "Corrigindo..." : "Corrigir Lista"}
        </button>
        {loading && (
          <div className="flex items-center justify-center gap-3 h-16 text-gray-400 text-sm">
            <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            Aguarde um instante até a correção terminar...
          </div>
        )}
        {!loading && error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
            ⚠️ {error}
          </div>
        )}
        <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
          <div
            onClick={() => setProtection(p => !p)}
            className={`w-10 h-5 rounded-full transition-colors relative ${protection ? "bg-green-500" : "bg-gray-600"}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${protection ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
          <span className="text-xs text-gray-400">Proteção no Branco ⚪</span>
        </label>
      </div>

      {/* Resumo */}
      {results.length > 0 && total > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-green-500/15 border border-green-500/30 text-green-400 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold">{wins}</p>
            <p className="text-xs opacity-80 mt-0.5">WIN</p>
          </div>
          <div className="bg-red-500/15 border border-red-500/30 text-red-400 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold">{loss}</p>
            <p className="text-xs opacity-80 mt-0.5">LOSS</p>
          </div>
        </div>
      )}

      {/* Botões de exportar */}
      {results.length > 0 && (
        <div className="flex gap-2">
          <button
            onClick={downloadImage}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all"
            style={{ background: "rgba(57,255,20,0.1)", border: "1px solid rgba(57,255,20,0.3)", color: "#39FF14" }}
          >
            📸 Baixar Imagem
          </button>
          <button
            onClick={copyResultsList}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all"
            style={{ background: "rgba(255,230,0,0.08)", border: "1px solid rgba(255,230,0,0.25)", color: "#FFE600" }}
          >
            {copied ? "✅ Copiado!" : "📋 Copiar Resultados"}
          </button>
        </div>
      )}

      {/* Resultados linha a linha */}
      {results.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="divide-y divide-gray-800/60">
            {results.map((r, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-white font-mono text-sm font-bold">{r.time}</span>
                  <span className="text-xl">{COLOR_EMOJI[r.color]}⚪️</span>
                  {r.result === "LOSS" && r.nextHitInfo && (
                    <span className="text-[11px] text-gray-500">bateria {r.nextHitInfo}</span>
                  )}
                </div>
                <span className={`text-xs font-bold px-3 py-1 rounded-full border ${getStyle(r.result)}`}>
                  {r.result.startsWith("GALE") ? `GALE ${r.result.slice(4)}` : r.result === "PROTEGIDO" ? "⚪ PROT." : r.result}
                </span>
              </div>
            ))}
          </div>
          {total > 0 && (
            <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
              <span className="text-xs text-gray-500">{total} entradas verificadas</span>
              <span className="text-sm font-bold text-white">
                {((wins / total) * 100).toFixed(1)}% assertividade
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FORTUNE DOUBLE — helpers e tabs
// ═══════════════════════════════════════════════════════════════════════════════
interface FortuneResult {
  id: string
  color: number
  roll: number
  multiplier?: number
  created_at: string
}

const FORTUNE_COLOR_EMOJI: Record<number, string> = { 0: "💛", 1: "❤️", 2: "💙" }

function parseFortuneListLine(line: string): { hhmm: string; color: number } | null {
  line = line.trim()
  if (!line) return null
  const timeMatch = line.match(/^(\d{1,2}:\d{2})/)
  if (!timeMatch) return null
  const hhmm = timeMatch[1].padStart(5, "0")
  const rest = line.slice(timeMatch[0].length)
  if (rest.includes("❤") || /\bvermelho\b/i.test(rest)) return { hhmm, color: 1 }
  if (rest.includes("💙") || /\bazul\b/i.test(rest))    return { hhmm, color: 2 }
  if (rest.includes("💛") || /\bamarelo\b/i.test(rest)) return { hhmm, color: 0 }
  return null
}

async function fetchFortuneAggregate(days = 1, maxPages = 30): Promise<FortuneResult[]> {
  const res = await fetch(`/api/premium/fortune-aggregate?days=${days}&maxPages=${maxPages}`)
  if (!res.ok) { const d = await res.json(); throw new Error(d?.error ?? `Erro ${res.status}`) }
  const d = await res.json()
  return (d.records ?? []).map((r: any) => ({ ...r, color: Number(r.color), roll: Number(r.roll ?? 0) }))
}

async function fetchFortunePages(start: string, end: string, maxPages = 10, pageDelay = 300): Promise<FortuneResult[]> {
  const all: FortuneResult[] = []
  let page = 1
  while (page <= maxPages) {
    const res = await fetch(`/api/premium/fortune-history?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&page=${page}`)
    if (!res.ok) {
      if (res.status === 429) throw new Error("429")
      break
    }
    const data = await res.json()
    const records: FortuneResult[] = extractRecords(data).map((r: any) => ({ ...r, color: Number(r.color), roll: Number(r.roll ?? 0) }))
    all.push(...records)
    const lastPage = extractLastPage(data)
    if (page >= lastPage || page >= maxPages) break
    page++
    if (page <= maxPages) await sleep(pageDelay)
  }
  return all
}

function FortuneTile({ color, time }: { color: number; time?: string }) {
  const emoji = FORTUNE_COLOR_EMOJI[color] ?? "?"
  const bg = color === 0 ? "bg-yellow-400" : color === 1 ? "bg-red-600" : "bg-blue-600"
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className={`w-14 h-14 ${bg} rounded-xl flex items-center justify-center shadow`}>
        <span className="text-2xl">{emoji}</span>
      </div>
      {time && <span className="text-[10px] text-gray-500">{time}</span>}
    </div>
  )
}

function FortuneHistoricoTab() {
  const [page,     setPage]     = useState(1)
  const [results,  setResults]  = useState<FortuneResult[]>([])
  const [lastPage, setLastPage] = useState(1)
  const [loading,  setLoading]  = useState(false)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (p: number) => {
    setLoading(true)
    setError(null)
    try {
      const end   = new Date()
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)
      const res = await fetch(
        `/api/premium/fortune-history?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}&page=${p}`
      )
      const data = await res.json()
      if (!res.ok) { setError(data?.error ?? `Erro ${res.status}`); return }
      const records = extractRecords(data).map((r: any) => ({ ...r, color: Number(r.color), roll: Number(r.roll ?? 0) }))
      setResults(records)
      setLastPage(extractLastPage(data))
      setLastSync(new Date())
    } catch (e: any) {
      setError(e?.message ?? "Erro de rede")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(1)
    timerRef.current = setInterval(() => {
      setPage(p => { if (p === 1) load(1); return p })
    }, 30000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [load])

  function goTo(p: number) { setPage(p); load(p) }

  const stats = results.reduce((a, r) => {
    if (r.color === 0) a.yellow++
    else if (r.color === 1) a.red++
    else a.blue++
    return a
  }, { red: 0, blue: 0, yellow: 0 })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${loading ? "bg-yellow-400 animate-pulse" : "bg-green-400"}`} />
          <span className="text-xs text-gray-500">
            {loading ? "Atualizando..." : lastSync ? `Atualizado às ${toBR(lastSync.toISOString()).hhmm}` : ""}
          </span>
        </div>
        <div className="flex gap-3 text-xs text-gray-500">
          <span>❤️ {stats.red}</span>
          <span>💙 {stats.blue}</span>
          <span>💛 {stats.yellow}</span>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">⚠️ {error}</div>
      )}

      {loading && results.length === 0 ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !loading && results.length === 0 && !error ? (
        <div className="flex items-center justify-center h-48 text-gray-500 text-sm">Nenhum resultado encontrado</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {results.map((r) => (
              <FortuneTile key={r.id} color={r.color} time={r.created_at ? toBR(r.created_at).hhmm : undefined} />
            ))}
          </div>

          {lastPage > 1 && (
            <div className="flex items-center gap-2 justify-center pt-2">
              <button disabled={page <= 1} onClick={() => goTo(1)}
                className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 text-xs disabled:opacity-30 hover:bg-gray-700 transition">«</button>
              <button disabled={page <= 1} onClick={() => goTo(page - 1)}
                className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 text-xs disabled:opacity-30 hover:bg-gray-700 transition">‹</button>
              <span className="text-xs text-gray-400 px-3 bg-gray-800 rounded-lg py-1.5">
                {page} / {lastPage.toLocaleString("pt-BR")}
              </span>
              <button disabled={page >= lastPage} onClick={() => goTo(page + 1)}
                className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 text-xs disabled:opacity-30 hover:bg-gray-700 transition">›</button>
              <button disabled={page >= lastPage} onClick={() => goTo(lastPage)}
                className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 text-xs disabled:opacity-30 hover:bg-gray-700 transition">»</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FortuneBuscarPadraoTab() {
  const [gales,    setGales]    = useState(1)
  const [minOcc,   setMinOcc]   = useState(10)
  const [seqLen,   setSeqLen]   = useState(3)
  const [mode,     setMode]     = useState<"normal" | "amarelo">("normal")
  const [loading,  setLoading]  = useState(false)
  const [patterns, setPatterns] = useState<PatternResult[]>(() => {
    try { const s = localStorage.getItem("premium_fortune_padrao_patterns"); return s ? JSON.parse(s) : [] } catch { return [] }
  })
  const [saving,   setSaving]   = useState<string | null>(null)
  const [saved,    setSaved]    = useState<Set<string>>(() => {
    try { const s = localStorage.getItem("premium_fortune_active_patterns"); return s ? new Set((JSON.parse(s) as PatternResult[]).map(p => `${p.sequence}→${p.betColor}`)) : new Set() } catch { return new Set() }
  })

  async function savePattern(p: PatternResult) {
    const key = `${p.sequence}→${p.betColor}`
    if (saved.has(key) || saving) return
    setSaving(key)
    await fetch("/api/user/estrategias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequence: p.sequence, color: p.betColor, gameType: "FORTUNE", strategyType: "SEQUÊNCIA" }),
    })
    setSaving(null)
    setSaved(prev => new Set([...prev, key]))
    try {
      const raw = localStorage.getItem("premium_fortune_active_patterns")
      const prev: PatternResult[] = raw ? JSON.parse(raw) : []
      if (!prev.some(s => `${s.sequence}→${s.betColor}` === key)) {
        localStorage.setItem("premium_fortune_active_patterns", JSON.stringify([...prev, p]))
      }
    } catch {}
  }

  async function analyze(m: "normal" | "amarelo") {
    setMode(m)
    setLoading(true)
    setPatterns([])
    try {
      // mesma cache-key do Gerador (7 dias) — se um rodou, o outro aproveita o cache
      const results = await fetchFortuneAggregate(1, 60)
      const sorted = [...results].sort((a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )

      const F_COLOR: Record<number, string> = { 0: "AMARELO", 1: "VERMELHO", 2: "AZUL" }
      const stats: Record<string, PatternResult> = {}
      const betColorsToSearch = m === "amarelo" ? [0] : [1, 2]
      const effectiveGales  = m === "amarelo" ? Math.max(gales, 10)  : gales
      const effectiveSeqLen = m === "amarelo" ? Math.max(seqLen, 5) : seqLen

      for (let i = effectiveSeqLen; i < sorted.length - effectiveGales; i++) {
        const seqColors = sorted.slice(i - effectiveSeqLen, i).map(r => F_COLOR[r.color] ?? "AMARELO")
        const seqKey    = seqColors.join(",")

        for (const betColorNum of betColorsToSearch) {
          const betColor = betColorNum === 0 ? "AMARELO" : betColorNum === 1 ? "VERMELHO" : "AZUL"
          const key = `${seqKey}→${betColor}`

          if (!stats[key]) stats[key] = {
            sequence: seqKey,
            betColor,
            betColorNum,
            occurrences: 0,
            wins: 0,
            galeWins: new Array(effectiveGales).fill(0),
            hitRate: 0,
          }
          stats[key].occurrences++

          const nextColor = F_COLOR[sorted[i].color] ?? "AMARELO"
          if (nextColor === betColor) {
            stats[key].wins++
          } else if (m === "amarelo" || nextColor !== "AMARELO") {
            for (let g = 1; g <= effectiveGales; g++) {
              if (i + g >= sorted.length) break
              const gc = F_COLOR[sorted[i + g].color] ?? "AMARELO"
              if (gc === betColor) { stats[key].galeWins[g - 1]++; break }
              if (m !== "amarelo" && gc !== "AMARELO") break
            }
          }
        }
      }

      const totalWins = (p: PatternResult) => p.wins + p.galeWins.reduce((a, b) => a + b, 0)
      const top = Object.values(stats)
        .filter(p => p.occurrences >= minOcc)
        .map(p => ({ ...p, hitRate: totalWins(p) / p.occurrences }))
        .sort((a, b) => b.hitRate - a.hitRate)
        .slice(0, 5)

      setPatterns(top)
      try { localStorage.setItem("premium_fortune_padrao_patterns", JSON.stringify(top)) } catch {}
    } catch {
      // erro silencioso — loading desliga pelo finally
    } finally {
      setLoading(false)
    }
  }

  const F_EMOJI: Record<string, string> = { VERMELHO: "❤️", AZUL: "💙", AMARELO: "💛" }
  const hitBg = (rate: number) =>
    rate >= 0.7 ? "text-green-400" : rate >= 0.55 ? "text-yellow-400" : "text-red-400"

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Qtd. de Gales</p>
            <NumberField min={0} max={5} value={gales}
              onChange={(n) => setGales(n)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/50" />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Mín. de ocorrências</p>
            <NumberField min={1} value={minOcc}
              onChange={(n) => setMinOcc(n)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/50" />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Pedras na sequência</p>
            <NumberField min={1} max={6} value={seqLen}
              onChange={(n) => setSeqLen(n)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/50" />
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => analyze("normal")} disabled={loading}
            className="flex-1 bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-black font-bold py-3 rounded-xl text-sm transition-colors">
            {loading && mode === "normal" ? "Analisando..." : "🎯 Buscar Padrões"}
          </button>
          <button onClick={() => analyze("amarelo")} disabled={loading}
            className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-colors border border-gray-600">
            {loading && mode === "amarelo" ? "Analisando..." : "💛 Buscar Amarelo"}
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-3 h-24 text-gray-400 text-sm">
          <div className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
          Aguarde um instante até a busca terminar...
        </div>
      )}

      {!loading && mode === "amarelo" && patterns.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-xl p-4 space-y-2">
          <p className="text-sm font-bold text-white">💛 Atenção: Entrada no Amarelo</p>
          <p className="text-xs text-gray-300 leading-relaxed">O Amarelo é um resultado de baixa frequência, por isso é essencial configurar o robô com no mínimo 10 gales mão fixa para aumentar as chances de capturar a entrada quando ela ocorrer.</p>
          <p className="text-xs font-semibold text-yellow-400">⚠️ Recomendação: utilize sempre 10 gales mão fixa ao operar estratégias focadas no Amarelo.</p>
        </div>
      )}

      {patterns.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Top {patterns.length} padrões encontrados</p>
          {patterns.map((p, i) => {
            const pKey    = `${p.sequence}→${p.betColor}`
            const isSaved  = saved.has(pKey)
            const isSaving = saving === pKey
            return (
              <div key={i} className={`rounded-xl p-4 border transition-all ${isSaved ? "bg-yellow-500/5 border-yellow-500/30" : "bg-gray-900 border-gray-800"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 flex-wrap mb-2">
                      {isSaved && <span className="text-base mr-1">👑</span>}
                      {p.sequence.split(",").map((c, j) => (
                        <span key={j} className={`text-xs font-bold px-2 py-0.5 rounded ${
                          c === "VERMELHO" ? "bg-red-600/30 text-red-300" :
                          c === "AZUL"    ? "bg-blue-600/30 text-blue-300" :
                                            "bg-yellow-500/20 text-yellow-300"
                        }`}>
                          {F_EMOJI[c] ?? "?"} {c}
                        </span>
                      ))}
                      <span className="text-gray-600 text-xs">→</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        p.betColorNum === 1 ? "bg-red-600/40 text-red-300" :
                        p.betColorNum === 2 ? "bg-blue-600/40 text-blue-300" :
                                               "bg-yellow-500/30 text-yellow-300"
                      }`}>
                        {F_EMOJI[p.betColor] ?? "?"} {p.betColor}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className={`font-bold text-base ${hitBg(p.hitRate)}`}>
                        {(p.hitRate * 100).toFixed(1)}%
                      </span>
                      <span className="text-gray-500">{p.occurrences} ocorrências</span>
                      <span className="text-green-400">{p.wins}× direto</span>
                      {p.galeWins.map((g, gi) => g > 0 && (
                        <span key={gi} className="text-yellow-400">{g}× gale{gi+1}</span>
                      ))}
                    </div>
                    <div className="mt-2 h-1 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${p.hitRate * 100}%` }} />
                    </div>
                  </div>
                  <button onClick={() => savePattern(p)} disabled={isSaved || !!saving}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-60 ${
                      isSaved ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30" : "bg-yellow-400 hover:bg-yellow-300 text-black"
                    }`}>
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
          Configure os parâmetros e clique em "Buscar Padrões"
        </p>
      )}
    </div>
  )
}

function FortuneGeradorListaTab() {
  const [loading, setLoading] = useState(false)
  const [list,    setList]    = useState<GeneratedEntry[]>(() => {
    try { const s = localStorage.getItem("premium_fortune_gerador_full"); return s ? JSON.parse(s) : [] } catch { return [] }
  })
  const [copied,  setCopied]  = useState(false)
  const [stats,   setStats]   = useState<{ results: number } | null>(() => {
    try { const s = localStorage.getItem("premium_fortune_gerador_stats"); return s ? JSON.parse(s) : null } catch { return null }
  })
  const [error,   setError]   = useState<string | null>(null)

  async function generate() {
    setLoading(true)
    setList([])
    setStats(null)
    setError(null)
    try {
      // 7 dias de dados para ter amostras suficientes por minuto
      const results = await fetchFortuneAggregate(1, 60)

      // Agrupa por HH:MM igual ao Double
      const groups: Record<string, { 0: number; 1: number; 2: number; total: number }> = {}
      for (const r of results) {
        const color = Number(r.color) as 0 | 1 | 2
        const { hhmm } = toBR(r.created_at)
        if (!groups[hhmm]) groups[hhmm] = { 0: 0, 1: 0, 2: 0, total: 0 }
        groups[hhmm][color]++
        groups[hhmm].total++
      }

      // Gera lista — pula se AMARELO domina, senão pega VERMELHO ou AZUL dominante
      const generated: GeneratedEntry[] = []
      for (const [hhmm, g] of Object.entries(groups)) {
        if (g.total < 1) continue
        // Se AMARELO é maioria, pula (não apostamos no amarelo pela lista)
        if (g[0] > g[1] && g[0] > g[2]) continue
        // Cor dominante entre VERMELHO e AZUL
        const domColor: 0 | 1 | 2 = g[1] >= g[2] ? 1 : 2
        const confidence = g[domColor] / g.total
        generated.push({ time: hhmm, color: domColor, confidence, samples: g.total })
      }

      // Igual ao Double: a partir de agora+10 min, até 20 horários espaçados ≥3 min
      const { min: nowMin } = brNowHM()
      const startMin = nowMin + 10
      const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m }
      const toOrd = (hhmm: string) => { const m = toMin(hhmm); return m >= startMin ? m : m + 1440 }

      const ordered = [
        ...generated.filter(e => toMin(e.time) >= startMin),
        ...generated.filter(e => toMin(e.time) < nowMin),
      ].sort((a, b) => toOrd(a.time) - toOrd(b.time))

      const chosen: GeneratedEntry[] = []
      const usedMins: number[] = []
      for (const entry of ordered) {
        if (chosen.length >= 20) break
        const em = toMin(entry.time)
        const tooClose = usedMins.some(u => { const d = Math.abs(u - em); return d < 3 || d > 1440 - 3 })
        if (!tooClose) { chosen.push(entry); usedMins.push(em) }
      }

      setList(chosen)
      setStats({ results: results.length })
      try {
        localStorage.setItem("premium_fortune_gerador_full",  JSON.stringify(chosen))
        localStorage.setItem("premium_fortune_gerador_stats", JSON.stringify({ results: results.length }))
      } catch {}
    } catch (e: any) {
      const msg: string = e?.message ?? "Erro ao buscar histórico"
      setError(msg.includes("429")
        ? "O Blaze está bloqueando temporariamente. Aguarde 1 minuto e tente novamente."
        : msg)
    } finally {
      setLoading(false)
    }
  }

  function copyList() {
    const lines = list.map(e => `${e.time} ${FORTUNE_COLOR_EMOJI[e.color]}`)
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <p className="text-xs text-gray-400">
          Gera uma lista de horários baseada na frequência das cores dos últimos 7 dias no Fortune Double.
          AMARELO é ignorado (proteção). Seleciona os próximos 20 horários a partir de agora.
        </p>
        <button onClick={generate} disabled={loading}
          className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold py-2.5 rounded-xl text-sm transition-colors">
          {loading ? "Gerando..." : "Gerar Lista"}
        </button>
        {loading && (
          <div className="flex items-center justify-center gap-3 h-16 text-gray-400 text-sm">
            <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            Aguarde um instante até a geração terminar...
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">⚠️ {error}</div>
      )}

      {list.length > 0 && (
        <>
          {stats && (
            <p className="text-xs text-gray-500 px-1">{stats.results.toLocaleString("pt-BR")} rodadas analisadas</p>
          )}
          <div className="flex gap-2">
            <button onClick={copyList}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold"
              style={{ background: "rgba(255,230,0,0.08)", border: "1px solid rgba(255,230,0,0.25)", color: "#FFE600" }}>
              {copied ? "✅ Copiado!" : "📋 Copiar Lista"}
            </button>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-800">
              <span className="text-xs font-semibold text-gray-400">{list.length} horários gerados</span>
            </div>
            <div className="divide-y divide-gray-800/60">
              {list.map((e, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-white font-mono text-sm font-bold">{e.time}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${e.color === 1 ? "bg-red-500" : "bg-blue-500"}`}
                        style={{ width: `${Math.round((e.confidence ?? 0) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right">{Math.round((e.confidence ?? 0) * 100)}%</span>
                    <span className="text-xl">{FORTUNE_COLOR_EMOJI[e.color]}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function FortuneValidarListaTab() {
  const [listText,   setListText]   = useState("")
  const [gales,      setGales]      = useState(1)
  const [protection, setProtection] = useState(false)
  const [validateDate, setValidateDate] = useState(brTodayStr())
  const [loading,    setLoading]    = useState(false)
  const [results,    setResults]    = useState<ValidationEntry[]>([])
  const [copied,     setCopied]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  async function validate() {
    const entries = listText
      .split("\n")
      .map(parseFortuneListLine)
      .filter(Boolean) as { hhmm: string; color: number }[]

    if (!entries.length) return

    setLoading(true)
    setResults([])
    setError(null)

    try {
      // Busca histórico cobrindo a data escolhida (não sempre "hoje") — uma
      // lista colada depois da meia-noite é de ontem, não de hoje.
      const isToday = validateDate === brTodayStr()
      const now   = new Date()
      const start = isToday ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : new Date(`${validateDate}T00:00:00-03:00`)
      const end   = isToday ? now : new Date(`${validateDate}T23:59:59-03:00`)
      const history = await fetchFortunePages(start.toISOString(), end.toISOString(), 60, 200)
      const targetRounds = history
        .filter(r => toBRDate(r.created_at) === validateDate)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

      const validated: ValidationEntry[] = entries.map(({ hhmm, color }) => {
      const startIdx = targetRounds.findIndex(r => toBR(r.created_at).hhmm >= hhmm)

      if (startIdx === -1) {
        if (!isToday) return { time: hhmm, color, result: "LOSS" }
        const { h: brH, m: brM } = brNowHM()
        const nowHHMM = `${String(brH).padStart(2,"0")}:${String(brM).padStart(2,"0")}`
        return { time: hhmm, color, result: hhmm > nowHHMM ? "PENDENTE" : "LOSS" }
      }

      for (let g = 0; g <= gales; g++) {
        const idx = startIdx + g
        if (idx >= targetRounds.length) break
        const round = targetRounds[idx]
        if (round.color === color) {
          return {
            time: hhmm, color,
            result: (g === 0 ? "WIN" : `GALE${g}`) as ValidationEntry["result"],
            actualColor: round.color,
          }
        }
        // Proteção no Amarelo
        if (protection && round.color === 0) {
          return { time: hhmm, color, result: "PROTEGIDO", actualColor: 0 }
        }
      }

      // Gales esgotados sem bater — mostra informativamente onde essa cor
      // bateria depois (não conta como vitória, é só contexto pro cliente)
      const nextHitInfo = findNextHit(targetRounds, startIdx + gales + 1, color, FORTUNE_COLOR_EMOJI)

      if (!isToday) return { time: hhmm, color, result: "LOSS", nextHitInfo }

      const { h: brH, m: brM } = brNowHM()
      const nowHHMM = `${String(brH).padStart(2,"0")}:${String(brM).padStart(2,"0")}`
      if (hhmm > nowHHMM) {
        return { time: hhmm, color, result: "PENDENTE" }
      }
      return { time: hhmm, color, result: "LOSS", nextHitInfo }
    })

      setResults(validated)
    } catch (e: any) {
      setError(e?.message ?? "Erro ao corrigir a lista. Tente novamente.")
    } finally {
      setLoading(false)
    }
  }

  function copyResultsList() {
    const resLabel = (r: ValidationEntry) => {
      if (r.result === "WIN") return "✅ WIN"
      if (r.result.startsWith("GALE")) return `⚡ GALE ${r.result.slice(4)}`
      if (r.result === "PROTEGIDO") return "💛 PROTEGIDO"
      if (r.result === "PENDENTE") return "⏳ PENDENTE"
      return "❌ LOSS"
    }
    const lines: string[] = [
      "⚡ AUTOWIN — Fortune Double",
      `Gales: ${gales}   |   Proteção no Amarelo: ${protection ? "✅ Sim" : "❌ Não"}`,
      "",
    ]
    for (const r of results.filter(x => x.result !== "PENDENTE")) {
      const extra = r.result === "LOSS" && r.nextHitInfo ? `  (bateria ${r.nextHitInfo})` : ""
      lines.push(`${r.time} ${FORTUNE_COLOR_EMOJI[r.color]}  →  ${resLabel(r)}${extra}`)
    }
    const pending = results.filter(x => x.result === "PENDENTE")
    if (pending.length) {
      lines.push("", "⏳ PENDENTES (copie para usar):")
      for (const r of pending) lines.push(`${r.time} ${FORTUNE_COLOR_EMOJI[r.color]}`)
    }
    const assertividade = total > 0 ? ((wins / total) * 100).toFixed(1) : "0.0"
    lines.push(
      "",
      `📊  WIN: ${wins}  |  LOSS: ${loss}`,
      `🎯  Assertividade: ${assertividade}%`,
    )
    navigator.clipboard.writeText(lines.join("\n")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500) })
  }

  function downloadImage() {
    const display = results.filter(r => r.result !== "PENDENTE")
    const pending = results.filter(r => r.result === "PENDENTE")

    const W   = 500
    const ROW = 40
    const H   = 130 + 80 + 48 + display.length * ROW + (pending.length ? 28 + pending.length * 32 : 0) + 80

    const canvas = document.createElement("canvas")
    canvas.width  = W * 2; canvas.height = H * 2
    const ctx = canvas.getContext("2d")!
    ctx.scale(2, 2)

    // BG
    ctx.fillStyle = "#0d1117"; ctx.fillRect(0, 0, W, H)
    // top border gradient Fortune colors
    const grad = ctx.createLinearGradient(0,0,W,0)
    grad.addColorStop(0,"#FFE600"); grad.addColorStop(1,"#39FF14")
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, 3)

    let y = 22
    ctx.textAlign = "center"
    ctx.font = "bold 26px Arial"
    ctx.fillStyle = "#FFE600"
    ctx.shadowColor = "#FFE600"; ctx.shadowBlur = 18
    ctx.fillText("⚡ AUTOWIN", W/2, y + 26)
    ctx.shadowBlur = 0
    y += 44
    ctx.font = "12px Arial"; ctx.fillStyle = "#6b7280"
    ctx.fillText("Fortune Double — Validação de Lista", W/2, y)
    y += 22
    ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(20,y); ctx.lineTo(W-20,y); ctx.stroke()
    y += 14

    // Config pill
    ctx.fillStyle = "#161b22"
    rrect(ctx, 20, y, W-40, 28, 6); ctx.fill()
    ctx.font = "11px Arial"; ctx.fillStyle = "#9ca3af"; ctx.textAlign = "center"
    ctx.fillText(`Gales: ${gales}     Proteção no Amarelo: ${protection ? "✅ Sim" : "❌ Não"}`, W/2, y + 19)
    y += 38

    // Stats boxes
    const statItems: { label:string; count:number; color:string }[] = [
      { label:"WIN",  count:wins, color:"#4ade80" },
      { label:"LOSS", count:loss, color:"#f87171" },
    ]
    const cols = statItems.length
    const boxW = (W - 40 - (cols-1)*6) / cols
    const boxH = 58
    for (let i = 0; i < cols; i++) {
      const s = statItems[i], bx = 20 + i*(boxW+6)
      ctx.fillStyle = s.color + "18"
      rrect(ctx, bx, y, boxW, boxH, 8); ctx.fill()
      ctx.strokeStyle = s.color + "50"; ctx.lineWidth = 1
      rrect(ctx, bx, y, boxW, boxH, 8); ctx.stroke()
      ctx.font = "bold 20px Arial"; ctx.fillStyle = s.color; ctx.textAlign = "center"
      ctx.fillText(String(s.count), bx+boxW/2, y+30)
      ctx.font = "9px Arial"; ctx.fillStyle = s.color+"bb"
      ctx.fillText(s.label, bx+boxW/2, y+47)
    }
    y += boxH + 14

    // Result rows
    const RESULT_CLR: Record<string,string> = { WIN:"#4ade80", PROTEGIDO:"#fbbf24", LOSS:"#f87171" }
    const RESULT_LBL: Record<string,string> = { WIN:"WIN", PROTEGIDO:"💛 PROT.", LOSS:"LOSS" }
    const getC = (r: string) => r.startsWith("GALE") ? "#fbbf24" : (RESULT_CLR[r] ?? "#9ca3af")
    const getL = (r: string) => r.startsWith("GALE") ? `GALE ${r.slice(4)}` : (RESULT_LBL[r] ?? r)
    for (let i = 0; i < display.length; i++) {
      const r = display[i]
      ctx.fillStyle = i%2===0 ? "#161b22" : "#0d1117"
      ctx.fillRect(20, y, W-40, ROW-2)
      ctx.font = "bold 13px monospace"; ctx.fillStyle = "#f9fafb"; ctx.textAlign = "left"
      ctx.fillText(r.time, 32, y+25)
      ctx.font = "15px Arial"
      ctx.fillText(FORTUNE_COLOR_EMOJI[r.color] ?? "?", 92, y+25)
      const c   = getC(r.result)
      const lbl = getL(r.result)
      const bw  = 72, bh = 24, bx = W-20-bw, by = y+8
      ctx.fillStyle = c+"25"; rrect(ctx,bx,by,bw,bh,10); ctx.fill()
      ctx.strokeStyle = c+"60"; ctx.lineWidth = 1; rrect(ctx,bx,by,bw,bh,10); ctx.stroke()
      ctx.font = "bold 11px Arial"; ctx.fillStyle = c; ctx.textAlign = "center"
      ctx.fillText(lbl, bx+bw/2, by+16)
      y += ROW
    }

    // Pending
    if (pending.length) {
      y += 8
      ctx.font = "11px Arial"; ctx.fillStyle = "#6b7280"; ctx.textAlign = "left"
      ctx.fillText("⏳  Pendentes:", 20, y+14)
      y += 26
      for (const r of pending) {
        ctx.font = "12px monospace"; ctx.fillStyle = "#4b5563"
        ctx.fillText(`${r.time}  ${FORTUNE_COLOR_EMOJI[r.color] ?? "?"}`, 32, y+14)
        y += 30
      }
    }

    // Footer
    y += 8
    ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(20,y); ctx.lineTo(W-20,y); ctx.stroke()
    y += 18
    const assertividade = total > 0 ? ((wins/total)*100).toFixed(1) : "0.0"
    ctx.font = "bold 14px Arial"; ctx.fillStyle = "#FFE600"
    ctx.shadowColor = "#FFE600"; ctx.shadowBlur = 10; ctx.textAlign = "center"
    ctx.fillText(`${assertividade}% assertividade`, W/2, y+16)
    ctx.shadowBlur = 0
    y += 34
    ctx.font = "10px Arial"; ctx.fillStyle = "#374151"
    const dateStr = new Date().toLocaleDateString("pt-BR")+" "+new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})
    ctx.fillText(`AUTOWIN • ${dateStr}`, W/2, y)

    const link = document.createElement("a")
    link.download = `autowin-fortune-lista-${Date.now()}.png`
    link.href = canvas.toDataURL("image/png")
    link.click()
  }

  const RESULT_STYLE: Record<string, string> = {
    WIN:       "bg-green-500/20 text-green-400 border-green-500/30",
    PROTEGIDO: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    LOSS:      "bg-red-500/20 text-red-400 border-red-500/30",
    PENDENTE:  "bg-gray-700/50 text-gray-400 border-gray-600",
  }
  const getStyle = (r: string) => r.startsWith("GALE") ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" : (RESULT_STYLE[r] ?? "")

  const wins      = results.filter(r => r.result === "WIN" || r.result.startsWith("GALE") || (protection && r.result === "PROTEGIDO")).length
  const protegido = results.filter(r => r.result === "PROTEGIDO").length
  const loss      = results.filter(r => r.result === "LOSS").length
  const total     = results.filter(r => r.result !== "PENDENTE").length

  return (
    <div className="space-y-4">
      {/* Input */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div>
          <p className="text-xs text-gray-500 mb-1.5 font-medium">Cole sua lista (formato: HH:MM ❤️)</p>
          <textarea
            value={listText}
            onChange={(e) => setListText(e.target.value)}
            rows={8}
            placeholder={"15:00 ❤️\n15:04 ❤️\n15:19 💙\n15:27 ❤️"}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500/50 resize-none"
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Data da lista</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setValidateDate(brTodayStr())}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${validateDate === brTodayStr() ? "bg-green-500 text-black" : "bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700"}`}>
                Hoje
              </button>
              <button type="button" onClick={() => setValidateDate(brYesterdayStr())}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${validateDate === brYesterdayStr() ? "bg-green-500 text-black" : "bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700"}`}>
                Ontem
              </button>
            </div>
          </div>
          <div className="flex-1">
            <p className="text-xs text-gray-500 mb-1.5 font-medium">Gales a validar</p>
            <NumberField min={0} max={5} value={gales}
              onChange={(n) => setGales(n)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50" />
          </div>
        </div>
        <button onClick={validate} disabled={loading || !listText.trim()}
          className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold py-2.5 rounded-xl text-sm transition-colors">
          {loading ? "Corrigindo..." : "Corrigir Lista"}
        </button>
        {loading && (
          <div className="flex items-center justify-center gap-3 h-16 text-gray-400 text-sm">
            <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            Aguarde um instante até a correção terminar...
          </div>
        )}
        {!loading && error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
            ⚠️ {error}
          </div>
        )}
        <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
          <div
            onClick={() => setProtection(p => !p)}
            className={`w-10 h-5 rounded-full transition-colors relative ${protection ? "bg-yellow-500" : "bg-gray-600"}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${protection ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
          <span className="text-xs text-gray-400">Proteção no Amarelo 💛</span>
        </label>
      </div>

      {/* Resumo */}
      {results.length > 0 && total > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-green-500/15 border border-green-500/30 text-green-400 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold">{wins}</p>
            <p className="text-xs opacity-80 mt-0.5">WIN</p>
          </div>
          <div className="bg-red-500/15 border border-red-500/30 text-red-400 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold">{loss}</p>
            <p className="text-xs opacity-80 mt-0.5">LOSS</p>
          </div>
        </div>
      )}

      {/* Botões de exportar */}
      {results.length > 0 && (
        <div className="flex gap-2">
          <button
            onClick={downloadImage}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all"
            style={{ background: "rgba(57,255,20,0.1)", border: "1px solid rgba(57,255,20,0.3)", color: "#39FF14" }}
          >
            📸 Baixar Imagem
          </button>
          <button
            onClick={copyResultsList}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all"
            style={{ background: "rgba(255,230,0,0.08)", border: "1px solid rgba(255,230,0,0.25)", color: "#FFE600" }}
          >
            {copied ? "✅ Copiado!" : "📋 Copiar Resultados"}
          </button>
        </div>
      )}

      {/* Resultados linha a linha */}
      {results.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="divide-y divide-gray-800/60">
            {results.map((r, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-white font-mono text-sm font-bold">{r.time}</span>
                  <span className="text-xl">{FORTUNE_COLOR_EMOJI[r.color]}</span>
                  {r.result === "LOSS" && r.nextHitInfo && (
                    <span className="text-[11px] text-gray-500">bateria {r.nextHitInfo}</span>
                  )}
                </div>
                <span className={`text-xs font-bold px-3 py-1 rounded-full border ${getStyle(r.result)}`}>
                  {r.result.startsWith("GALE") ? `GALE ${r.result.slice(4)}` : r.result === "PROTEGIDO" ? "💛 PROT." : r.result}
                </span>
              </div>
            ))}
          </div>
          {total > 0 && (
            <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
              <span className="text-xs text-gray-500">{total} entradas verificadas</span>
              <span className="text-sm font-bold text-white">
                {((wins / total) * 100).toFixed(1)}% assertividade
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PÁGINA PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════
const FORTUNE_TABS: { id: SubTab; label: string; icon: string }[] = [
  { id: "historico", label: "Histórico",        icon: "📊" },
  { id: "gerador",   label: "Gerador de Lista",  icon: "📋" },
  { id: "buscar",    label: "Buscar Padrão",     icon: "🔍" },
  { id: "validar",   label: "Corrigir Lista",     icon: "✅" },
]

export default function PremiumPage() {
  const [game, setGame]       = useState<"double" | "fortune">("double")
  const [tab,  setTab]        = useState<SubTab>("historico")
  const [licensed, setLicensed] = useState(true)
  const [checking, setChecking] = useState(true)
  const [hiddenGames, setHiddenGames] = useState<string[]>([])

  useEffect(() => {
    fetch("/api/user/me").then((r) => r.json()).then((data) => {
      const isPaid = data.paymentStatus === "PAID" && (!data.expireIn || new Date(data.expireIn) > new Date())
      setLicensed(isPaid || !!data.isTesting || !!data.isAdminAccount)
      
      const hidden = (data.hiddenGamesPremiumBlaze ?? "").split(",").filter(Boolean)
      setHiddenGames(hidden)
      if (hidden.includes("DOUBLE") && !hidden.includes("FORTUNE")) {
        setGame("fortune")
      }

      setChecking(false)
    }).catch(() => setChecking(false))
  }, [])

  const activeTabs = game === "fortune" ? FORTUNE_TABS : TABS

  if (checking) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-gray-600 border-t-green-400 rounded-full animate-spin" />
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-3xl">💎</span>
          <div>
            <h1 className="text-xl font-bold text-white">Premium</h1>
            <p className="text-xs text-gray-500">
              Análise avançada de {game === "double" ? "Double" : "Fortune Double"}
            </p>
          </div>
        </div>
        {/* Seletor Double / Fortune */}
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
          {!hiddenGames.includes("DOUBLE") && (
            <button onClick={() => { setGame("double");  setTab("historico") }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                game === "double" ? "bg-green-500 text-black" : "text-gray-500 hover:text-white"
              }`}>🎯 Double</button>
          )}
          {!hiddenGames.includes("DOUBLE") && !hiddenGames.includes("FORTUNE") && (
            <button onClick={() => { setGame("fortune"); setTab("historico") }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                game === "fortune" ? "bg-yellow-400 text-black" : "text-gray-500 hover:text-white"
              }`}>💛 Fortune</button>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-gray-900/80 border border-gray-800 rounded-xl p-1">
        {activeTabs.map((t) => (
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
        {game === "double" ? (
          <>
            {tab === "historico" && <HistoricoTab />}
            {tab === "gerador"   && <GeradorListaTab />}
            {tab === "buscar"    && <BuscarPadraoTab />}
            {tab === "validar"   && <ValidarListaTab />}
          </>
        ) : (
          <>
            {tab === "historico" && <FortuneHistoricoTab />}
            {tab === "gerador"   && <FortuneGeradorListaTab />}
            {tab === "buscar"    && <FortuneBuscarPadraoTab />}
            {tab === "validar"   && <FortuneValidarListaTab />}
          </>
        )}
      </div>
    </div>
  )
}
