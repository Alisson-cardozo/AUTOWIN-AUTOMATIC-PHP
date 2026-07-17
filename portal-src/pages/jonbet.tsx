import { useEffect, useState, useRef } from "react"
import { NumberField } from "@/components/ui/NumberField"

/* ─── Types ─────────────────────────────────────────────────── */
interface DoubleResult  { id: string; created_at: string; color: number; roll: number }
interface FortuneResult { id: string; created_at: string; color: number; roll: number; multiplier?: number }
interface CrashResult   { id: string; crash_point: string; is_bonus_round: boolean }
interface Strategy      { id: number; sequence: string; color: string }
interface Settings {
  strategyType: string; enterType: string; enterValue: number; enterPercent: number
  stopType: string; stopGain: string; stopLoss: string; protectionHand: string
  protectionValue: number; martingale: number; whiteMartingale: string
  martingaleMultiplier: number; whiteMultiplier: number; quantityCycles: number; skipFirstEntry: boolean
  whiteEntryGaleEnabled: boolean; whiteEntryGale: number; whiteEntryGaleMultiplier: number
  whiteEntryType: string; whiteEntryValue: number; whiteEntryPercent: number
  skipEntryAfterLoss: boolean
}
interface Variables {
  countLoss: number; countWin: number; countMartingale: number
  profit: number; balance: number; firstBalance: number; isGale: boolean
}
interface LogEntry {
  id: string; time: string
  type: "ENTRADA" | "GALE" | "WIN" | "LOSS" | "STOP_WIN" | "STOP_LOSS" | "STOP_SALDO" | "AGUARDANDO" | "INFO"
  color?: string; amount?: number; initialAmount?: number; protectionValue?: number; gale?: number; maxGale?: number
  strategyType?: string; pattern?: string; accuracy?: number; resolved?: boolean; resultColor?: string
  resultWin?: boolean; resultProfit?: number; profit?: number
}

/* ─── Visual helpers ─────────────────────────────────────────── */
function ColorBall({ color, roll, size = "md" }: { color: number; roll: number; size?: "sm" | "md" | "lg" }) {
  const sz = size === "sm" ? "w-7 h-7 text-xs" : size === "lg" ? "w-11 h-11 text-base" : "w-9 h-9 text-sm"
  const bg = color === 0 ? "bg-white text-gray-900" : color === 1 ? "bg-green-400 text-gray-900" : "bg-gray-800 border border-gray-600 text-white"
  return <div className={`${sz} ${bg} rounded-full flex items-center justify-center font-bold flex-shrink-0`}>{roll}</div>
}

function CrashBadge({ value, size = "md" }: { value: string; size?: "sm" | "md" }) {
  const cp = parseFloat(value)
  const sz = size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
  const color = cp >= 10 ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-300"
    : cp >= 2 ? "bg-green-500/20 border-green-500/30 text-green-400"
    : "bg-red-500/10 border-red-500/20 text-red-400"
  return <div className={`${sz} ${color} border rounded-lg font-bold font-mono whitespace-nowrap`}>{cp.toFixed(2)}x</div>
}

function FortuneBall({ color, size = "md" }: { color: number; size?: "sm" | "md" | "lg" }) {
  const sz = size === "sm" ? "w-7 h-7 text-base" : size === "lg" ? "w-11 h-11 text-xl" : "w-9 h-9 text-lg"
  const bg = color === 0 ? "bg-yellow-400 text-gray-900" : color === 1 ? "bg-red-600 text-white" : "bg-blue-600 text-white"
  const emoji = color === 0 ? "💛" : color === 1 ? "❤️" : "💙"
  return <div className={`${sz} ${bg} rounded-full flex items-center justify-center font-bold flex-shrink-0`}>{emoji}</div>
}

function SeqBall({ item }: { item: string }) {
  if (item === "X") return <div className="w-7 h-7 rounded-full bg-gray-600/60 border border-gray-500 flex items-center justify-center text-gray-300 text-xs font-bold flex-shrink-0">X</div>
  const num = Number(item)
  if (!isNaN(num) && /^\d+$/.test(item)) {
    const cls = num === 0 ? "bg-white text-gray-900" : num <= 7 ? "bg-green-400 text-gray-900" : "bg-gray-700 border border-gray-600 text-white"
    return <div className={`w-7 h-7 rounded-full ${cls} flex items-center justify-center text-xs font-bold flex-shrink-0`}>{item}</div>
  }
  if (item === "VERMELHO") return <div className="w-7 h-7 rounded-full bg-green-400 flex items-center justify-center text-gray-900 text-xs font-bold flex-shrink-0">V</div>
  if (item === "PRETO")    return <div className="w-7 h-7 rounded-full bg-gray-700 border border-gray-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">P</div>
  if (item === "BRANCO")   return <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center text-gray-900 text-xs font-bold flex-shrink-0">B</div>
  if (item === "AZUL")     return <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-base flex-shrink-0">💙</div>
  if (item === "AMARELO")  return <div className="w-7 h-7 rounded-full bg-yellow-400 flex items-center justify-center text-gray-900 text-base flex-shrink-0">💛</div>
  if (item === "V") return <div className="w-7 h-7 rounded-full bg-green-500 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">V</div>
  if (item === "R") return <div className="w-7 h-7 rounded-full bg-red-500 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">R</div>
  return <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center text-gray-200 text-xs font-mono flex-shrink-0">{item}</div>
}

function EntryColorDot({ color }: { color?: string }) {
  if (!color) return null
  const cls = color === "VERMELHO" ? "bg-green-400" : color === "PRETO" ? "bg-gray-700 border border-gray-500" : color === "BRANCO" ? "bg-white" : color === "AZUL" ? "bg-blue-600" : color === "AMARELO" ? "bg-yellow-400" : "bg-green-400"
  return <div className={`w-3 h-3 rounded-full flex-shrink-0 ${cls}`} />
}

function ResultColorDot({ color }: { color?: string }) {
  if (!color) return null
  const cls = color === "VERMELHO" ? "bg-green-400" : color === "PRETO" ? "bg-gray-700 border border-gray-500" : color === "BRANCO" ? "bg-white" : color === "AZUL" ? "bg-blue-600" : color === "AMARELO" ? "bg-yellow-400" : "bg-green-400"
  return <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cls}`} />
}

/* ─── Live Panels ────────────────────────────────────────────── */
function LiveDoublePanel() {
  const [results, setResults] = useState<DoubleResult[]>([])
  const [current, setCurrent] = useState<DoubleResult | null>(null)
  const [pulse, setPulse] = useState(false)
  const [apiDown, setApiDown] = useState(false)
  const prevIdRef = useRef<string | null>(null)

  async function fetchRecent() {
    try {
      const res = await fetch("/api/jonbet/double/recent", { cache: "no-store" })
      if (!res.ok) { setApiDown(true); return }
      const data = await res.json()
      if (!Array.isArray(data.results)) return
      setApiDown(data.apiDown ?? false)
      if (!data.results.length) return
      const newest = data.results[0]
      if (newest.id !== prevIdRef.current) { prevIdRef.current = newest.id; setPulse(true); setTimeout(() => setPulse(false), 800) }
      setCurrent(newest)
      setResults(data.results.slice(1, 51))
    } catch { setApiDown(true) }
  }

  useEffect(() => { fetchRecent(); const iv = setInterval(fetchRecent, 5000); return () => clearInterval(iv) }, [])

  const colorName  = current ? (current.color === 0 ? "BRANCO" : current.color === 1 ? "VERDE" : "PRETO") : null
  const colorStyle = current
    ? current.color === 0 ? "text-white bg-white/10 border-white/20"
    : current.color === 1 ? "text-green-400 bg-green-500/10 border-green-500/20"
    : "text-gray-300 bg-gray-700/30 border-gray-600/30" : ""
  const stats = results.reduce((acc, r) => { if (r.color === 0) acc.white++; else if (r.color === 1) acc.verde++; else acc.black++; return acc }, { verde: 0, black: 0, white: 0 })

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex flex-col gap-6 h-full">
      <div className="flex items-center justify-between">
        <div><h2 className="text-base font-semibold text-white">Double — Ao Vivo</h2><p className="text-xs text-gray-500 mt-0.5">Jonbet</p></div>
        {apiDown
          ? <span className="flex items-center gap-1.5 text-xs text-red-400"><span className="w-2 h-2 rounded-full bg-red-400" />Offline</span>
          : <span className="flex items-center gap-1.5 text-xs text-green-400"><span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />Ao vivo</span>}
      </div>
      {current ? (
        <div className={`rounded-xl border p-4 flex flex-col items-center gap-2 transition-all duration-300 ${colorStyle} ${pulse ? "scale-105" : "scale-100"}`}>
          <p className="text-xs font-medium opacity-70 uppercase tracking-widest">Último resultado</p>
          <ColorBall color={current.color} roll={current.roll} size="lg" />
          <p className="text-lg font-bold tracking-wide">{colorName}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 p-4 flex items-center justify-center h-32">
          <div className="w-5 h-5 border-2 border-gray-600 border-t-green-400 rounded-full animate-spin" />
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2"><p className="text-green-400 text-lg font-bold">{stats.verde}</p><p className="text-xs text-gray-500">Verde</p></div>
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-2"><p className="text-gray-300 text-lg font-bold">{stats.black}</p><p className="text-xs text-gray-500">Preto</p></div>
        <div className="bg-white/5 border border-white/10 rounded-lg p-2"><p className="text-white text-lg font-bold">{stats.white}</p><p className="text-xs text-gray-500">Branco</p></div>
      </div>
      <div>
        <p className="text-xs text-gray-500 mb-3 uppercase tracking-widest">Histórico recente</p>
        <div className="flex flex-wrap gap-1.5">
          {results.map((r) => <ColorBall key={r.id} color={r.color} roll={r.roll} size="sm" />)}
          {!results.length && <p className="text-xs text-gray-600">Carregando histórico...</p>}
        </div>
      </div>
    </div>
  )
}

function LiveCrashPanel() {
  const [results, setResults] = useState<CrashResult[]>([])
  const [current, setCurrent] = useState<CrashResult | null>(null)
  const [pulse, setPulse] = useState(false)
  const [apiDown, setApiDown] = useState(false)
  const prevIdRef = useRef<string | null>(null)

  async function fetchRecent() {
    try {
      const res = await fetch("/api/jonbet/crash/recent", { cache: "no-store" })
      if (!res.ok) { setApiDown(true); return }
      const data = await res.json()
      if (!Array.isArray(data.results)) return
      setApiDown(data.apiDown ?? false)
      if (!data.results.length) return
      const newest = data.results[0]
      if (newest.id !== prevIdRef.current) { prevIdRef.current = newest.id; setPulse(true); setTimeout(() => setPulse(false), 800) }
      setCurrent(newest)
      setResults(data.results.slice(1))
    } catch { setApiDown(true) }
  }

  useEffect(() => { fetchRecent(); const iv = setInterval(fetchRecent, 5000); return () => clearInterval(iv) }, [])

  const cp = current ? parseFloat(current.crash_point) : 0
  const currentStyle = cp >= 10 ? "text-yellow-300 bg-yellow-500/10 border-yellow-500/20" : cp >= 2 ? "text-green-400 bg-green-500/10 border-green-500/20" : "text-red-400 bg-red-500/10 border-red-500/20"
  const stats = results.reduce((acc, r) => { const v = parseFloat(r.crash_point); if (v < 2) acc.low++; else if (v < 10) acc.mid++; else acc.high++; return acc }, { low: 0, mid: 0, high: 0 })
  const avg = results.length ? (results.reduce((s, r) => s + parseFloat(r.crash_point), 0) / results.length).toFixed(2) : "—"

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex flex-col gap-6 h-full">
      <div className="flex items-center justify-between">
        <div><h2 className="text-base font-semibold text-white">Crash — Ao Vivo</h2><p className="text-xs text-gray-500 mt-0.5">Jonbet</p></div>
        {apiDown
          ? <span className="flex items-center gap-1.5 text-xs text-red-400"><span className="w-2 h-2 rounded-full bg-red-400" />Offline</span>
          : <span className="flex items-center gap-1.5 text-xs text-green-400"><span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />Ao vivo</span>}
      </div>
      {current ? (
        <div className={`rounded-xl border p-4 flex flex-col items-center gap-2 transition-all duration-300 ${currentStyle} ${pulse ? "scale-105" : "scale-100"}`}>
          <p className="text-xs font-medium opacity-70 uppercase tracking-widest">Último resultado</p>
          <p className="text-4xl font-black font-mono tracking-tight">{cp.toFixed(2)}x</p>
          <p className="text-xs opacity-50">{cp >= 10 ? "🔥 Grande" : cp >= 2 ? "✅ Normal" : "💥 Baixo"}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 p-4 flex items-center justify-center h-32">
          <div className="w-5 h-5 border-2 border-gray-600 border-t-purple-400 rounded-full animate-spin" />
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2"><p className="text-red-400 text-lg font-bold">{stats.low}</p><p className="text-xs text-gray-500">&lt; 2x</p></div>
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2"><p className="text-green-400 text-lg font-bold">{stats.mid}</p><p className="text-xs text-gray-500">2x — 10x</p></div>
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2"><p className="text-yellow-300 text-lg font-bold">{stats.high}</p><p className="text-xs text-gray-500">&gt; 10x</p></div>
      </div>
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg px-4 py-2 flex items-center justify-between">
        <p className="text-xs text-gray-400">Média</p><p className="text-white font-bold font-mono">{avg}x</p>
      </div>
      <div>
        <p className="text-xs text-gray-500 mb-3 uppercase tracking-widest">Histórico recente</p>
        <div className="flex flex-wrap gap-1.5">
          {results.map((r) => <CrashBadge key={r.id} value={r.crash_point} size="sm" />)}
          {!results.length && <p className="text-xs text-gray-600">Carregando histórico...</p>}
        </div>
      </div>
    </div>
  )
}

function LiveFortunePanel() {
  const [results, setResults] = useState<FortuneResult[]>([])
  const [current, setCurrent] = useState<FortuneResult | null>(null)
  const [pulse, setPulse] = useState(false)
  const [apiDown, setApiDown] = useState(false)
  const prevIdRef = useRef<string | null>(null)

  async function fetchRecent() {
    try {
      const res = await fetch("/api/jonbet/fortune/recent", { cache: "no-store" })
      if (!res.ok) { setApiDown(true); return }
      const data = await res.json()
      if (!Array.isArray(data.results)) return
      setApiDown(data.apiDown ?? false)
      if (!data.results.length) return
      const newest = data.results[0]
      if (newest.id !== prevIdRef.current) { prevIdRef.current = newest.id; setPulse(true); setTimeout(() => setPulse(false), 800) }
      setCurrent(newest)
      setResults(data.results.slice(1, 51))
    } catch { setApiDown(true) }
  }

  useEffect(() => { fetchRecent(); const iv = setInterval(fetchRecent, 5000); return () => clearInterval(iv) }, [])

  const colorName  = current ? (current.color === 0 ? "AMARELO" : current.color === 1 ? "VERMELHO" : "AZUL") : null
  const colorStyle = current
    ? current.color === 0 ? "text-yellow-400 bg-yellow-400/10 border-yellow-400/20"
    : current.color === 1 ? "text-red-400 bg-red-500/10 border-red-500/20"
    : "text-blue-400 bg-blue-500/10 border-blue-500/20" : ""
  const stats = results.reduce((acc, r) => { if (r.color === 0) acc.yellow++; else if (r.color === 1) acc.red++; else acc.blue++; return acc }, { red: 0, blue: 0, yellow: 0 })

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex flex-col gap-6 h-full">
      <div className="flex items-center justify-between">
        <div><h2 className="text-base font-semibold text-white">Fortune Double — Ao Vivo</h2><p className="text-xs text-gray-500 mt-0.5">Jonbet</p></div>
        {apiDown
          ? <span className="flex items-center gap-1.5 text-xs text-red-400"><span className="w-2 h-2 rounded-full bg-red-400" />Offline</span>
          : <span className="flex items-center gap-1.5 text-xs text-green-400"><span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />Ao vivo</span>}
      </div>
      {current ? (
        <div className={`rounded-xl border p-4 flex flex-col items-center gap-2 transition-all duration-300 ${colorStyle} ${pulse ? "scale-105" : "scale-100"}`}>
          <p className="text-xs font-medium opacity-70 uppercase tracking-widest">Último resultado</p>
          <FortuneBall color={current.color} size="lg" />
          <p className="text-lg font-bold tracking-wide">{colorName}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 p-4 flex items-center justify-center h-32">
          <div className="w-5 h-5 border-2 border-gray-600 border-t-yellow-400 rounded-full animate-spin" />
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2"><p className="text-red-400 text-lg font-bold">{stats.red}</p><p className="text-xs text-gray-500">❤️ Verm.</p></div>
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2"><p className="text-blue-400 text-lg font-bold">{stats.blue}</p><p className="text-xs text-gray-500">💙 Azul</p></div>
        <div className="bg-yellow-400/10 border border-yellow-400/20 rounded-lg p-2"><p className="text-yellow-400 text-lg font-bold">{stats.yellow}</p><p className="text-xs text-gray-500">💛 Amar.</p></div>
      </div>
      <div>
        <p className="text-xs text-gray-500 mb-3 uppercase tracking-widest">Histórico recente</p>
        <div className="flex flex-wrap gap-1.5">
          {results.map((r) => <FortuneBall key={r.id} color={r.color} size="sm" />)}
          {!results.length && <p className="text-xs text-gray-600">Carregando histórico...</p>}
        </div>
      </div>
    </div>
  )
}

function LiveGamePanel({ gameType }: { gameType: string }) {
  return (
    <>
      <div className={gameType === "DOUBLE"  ? "" : "hidden"}><LiveDoublePanel /></div>

      <div className={gameType === "FORTUNE" ? "" : "hidden"}><LiveFortunePanel /></div>
    </>
  )
}

/* ─── Conta Jonbet Tab ───────────────────────────────────────── */
function ContaJonbetTab({
  jonbetAccountType, jonbetGameType, hasJonbetToken, jonbetEmail: initialEmail,
  onDisconnect, onConnect,
}: {
  jonbetAccountType: string; jonbetGameType: string; hasJonbetToken: boolean
  jonbetEmail: string | null; onDisconnect: () => void
  onConnect: (name: string, balance: number | null) => void
}) {
  const [email, setEmail]           = useState(initialEmail ?? "")
  const [password, setPassword]     = useState("")
  const [connecting, setConnecting] = useState(false)
  const [error, setError]             = useState("")
  const [success, setSuccess]         = useState("")
  const [name, setName]               = useState("")
  const [balance, setBalance]         = useState<number | null>(null)
  const [saving, setSaving]           = useState(false)
  const [hiddenGames, setHiddenGames] = useState<string[]>([])

  useEffect(() => {
    if (hasJonbetToken) return
    fetch("/api/user/me", { cache: "no-store" }).then((r) => r.json()).then((data) => {
      if (data.jonbetConnectPending && !data.hasJonbetToken) {
        setConnecting(true)
        setTimeout(() => pollConnectStatus(Date.now()), 1000)
      }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetch("/api/user/me", { cache: "no-store" }).then((r) => r.json()).then((data) => {
      const hidden = typeof data.hiddenGamesContaJonbet === "string"
        ? data.hiddenGamesContaJonbet.split(",").map((g: string) => g.trim()).filter(Boolean)
        : []
      if (!hidden.includes("CRASH")) hidden.push("CRASH")
      setHiddenGames(hidden)
    }).catch(() => {})
  }, [])

  // Atualiza saldo ao vivo na aba Conta Jonbet (igual a Blaze)
  useEffect(() => {
    if (!hasJonbetToken) return
    async function refreshBalance() {
      try {
        const res = await fetch("/api/user/jonbet/balance", { cache: "no-store" })
        if (res.ok) {
          const data = await res.json()
          setBalance(data.balance)
        }
      } catch {}
    }
    refreshBalance()
    const iv = setInterval(refreshBalance, 30000)
    return () => clearInterval(iv)
  }, [hasJonbetToken])

  async function saveToggle(field: "jonbetAccountType" | "jonbetGameType", value: string) {
    setSaving(true)
    await fetch("/api/user/jonbet/conta", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) })
    setSaving(false)
  }

  function toggleAccountType() {
    const next = jonbetAccountType === "DEMO" ? "REAL" : "DEMO"
    saveToggle("jonbetAccountType", next)
    window.location.reload()
  }

  function toggleGameType() {
    const next = jonbetGameType === "DOUBLE" ? "FORTUNE" : "DOUBLE"
    saveToggle("jonbetGameType", next)
    window.location.reload()
  }

  function handleSelectGame(selected: "DOUBLE" | "FORTUNE") {
    saveToggle("jonbetGameType", selected)
    window.location.reload()
  }

  async function pollConnectStatus(startedAt: number) {
    const res = await fetch("/api/user/me", { cache: "no-store" })
    const data = await res.json()

    if (data.hasJonbetToken) {
      const bal = await fetch("/api/user/jonbet/balance", { cache: "no-store" }).then((r) => r.json()).catch(() => null)
      setConnecting(false)
      setBalance(bal?.balance ?? null)
      setPassword("")
      setSuccess("Conta Jonbet conectada com sucesso!")
      onConnect("", bal?.balance ?? null)
      return
    }
    if (data.jonbetConnectError) {
      setConnecting(false)
      setError(data.jonbetConnectError)
      return
    }
    if (Date.now() - startedAt > 150000) {
      setConnecting(false)
      setError("A conexão está demorando mais que o esperado. Tente novamente em instantes.")
      return
    }
    setTimeout(() => pollConnectStatus(startedAt), 3000)
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    setError(""); setSuccess(""); setConnecting(true)
    const res = await fetch("/api/user/jonbet/conta", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json()
    if (!res.ok) { setConnecting(false); setError(data.error ?? "Erro ao conectar"); return }
    setTimeout(() => pollConnectStatus(Date.now()), 3000)
  }

  async function handleDisconnect() {
    if (!confirm("Tem certeza que deseja desconectar sua conta da Jonbet?")) return
    setConnecting(true)
    await fetch("/api/user/jonbet/conta", { method: "DELETE" })
    setConnecting(false)
    setName(""); setBalance(null); setEmail(""); setPassword("")
    setSuccess("Conta desconectada com sucesso.")
    onDisconnect()
  }

  return (
    <div className="space-y-5">
      {/* Banner Jonbet */}
      <div className="relative w-full h-20 rounded-xl overflow-hidden border border-green-500/20 bg-gradient-to-r from-green-600/10 via-green-950/20 to-gray-950 flex items-center px-6 shadow-md shadow-green-950/5">
        <div className="absolute -right-6 -bottom-10 opacity-10 select-none pointer-events-none transform rotate-12">
          <span className="text-8xl font-black italic tracking-widest text-green-500 font-sans">JONBET</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-500 flex items-center justify-center shadow-lg shadow-green-500/30">
            <span className="text-black text-xl font-bold">J</span>
          </div>
          <div>
            <h1 className="text-white text-lg font-black tracking-widest uppercase text-green-400">PLATAFORMA JONBET</h1>
            <p className="text-gray-400 text-[10px] uppercase font-bold tracking-wider">Configurações Ativas do Robô</p>
          </div>
        </div>
      </div>

      {/* Tipo de conta e jogo */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white text-sm font-medium">Tipo de Conta</p>
            <p className="text-gray-400 text-xs">{jonbetAccountType === "REAL" ? "Apostando com dinheiro real" : "Modo demonstração"}</p>
          </div>
          <button onClick={toggleAccountType} disabled={saving}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${jonbetAccountType === "REAL" ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-gray-700 text-gray-300 border border-gray-600"}`}>
            {jonbetAccountType}
          </button>
        </div>

        <div className="border-t border-gray-800/60 my-2" />

        <div className="space-y-3">
          <p className="text-white text-sm font-medium">Selecione o Jogo Ativo</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                key: "DOUBLE",
                label: "Double",
                icon: "💎",
                selectedStyle: "border-red-500 shadow-lg shadow-red-500/20 bg-red-500/5 scale-[1.02]",
                overlayColor: "from-red-600/30",
                glowColor: "bg-red-500/20 text-red-400 border-red-500/30",
                labelColor: "text-red-400"
              },
              {
                key: "FORTUNE",
                label: "Fortune Double",
                icon: "🍀",
                selectedStyle: "border-yellow-400 shadow-lg shadow-yellow-400/20 bg-yellow-400/5 scale-[1.02]",
                overlayColor: "from-yellow-600/30",
                glowColor: "bg-yellow-400/20 text-yellow-400 border-yellow-400/30",
                labelColor: "text-yellow-400"
              }
            ].filter((g) => !hiddenGames.includes(g.key)).map((g) => {
              const isSelected = jonbetGameType === g.key
              const imgPath = `/imagem-jogos/jonbet/${g.key.toLowerCase()}.png`
              return (
                <div
                  key={g.key}
                  onClick={() => { if (!saving) handleSelectGame(g.key as any) }}
                  className={`relative rounded-xl overflow-hidden border cursor-pointer transition-all duration-300 group flex flex-col justify-between h-28 sm:h-32 ${
                    isSelected 
                      ? g.selectedStyle 
                      : "border-gray-800 bg-gray-950/60 hover:border-gray-700 hover:bg-gray-900/40 hover:-translate-y-0.5"
                  }`}
                >
                  {/* Game Image Background with high saturation/brightness on select */}
                  <div className="absolute inset-0 z-0 bg-cover bg-center transition-all duration-500 group-hover:scale-105"
                    style={{ 
                      backgroundImage: `url(${imgPath})`,
                      filter: isSelected 
                        ? "brightness(1.1) contrast(1.1) saturate(1.15)" 
                        : "brightness(0.5) contrast(0.9) saturate(0.6)",
                      opacity: isSelected ? 0.95 : 0.45
                    }}
                  />
                  
                  {/* Gradient overlay to darken bottom for text contrast but not block the game image */}
                  <div className={`absolute inset-0 bg-gradient-to-t ${isSelected ? g.overlayColor : "from-black/70"} via-transparent to-transparent opacity-90 z-10`} />

                  {/* Top bar containing Selection indicator or Game icon */}
                  <div className="relative z-20 p-3 flex items-start justify-between">
                    <span className={`text-base p-1.5 rounded-lg flex items-center justify-center backdrop-blur-md border ${
                      isSelected ? g.glowColor : "bg-gray-900/80 text-gray-400 border-gray-800"
                    }`}>{g.icon}</span>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center border border-black/40 text-black font-bold text-[10px] shadow-[0_0_8px_#22c55e]">
                        ✓
                      </div>
                    )}
                  </div>

                  {/* Label with dark text-shadow for readability */}
                  <div className="relative z-20 p-3 pt-6">
                    <p 
                      className={`text-xs font-black uppercase tracking-wide transition-colors ${isSelected ? g.labelColor : "text-gray-400 group-hover:text-white"}`}
                      style={{ textShadow: "0 2px 4px rgba(0,0,0,0.9)" }}
                    >
                      {g.label}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Credenciais */}
      {jonbetAccountType === "DEMO" ? (
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-yellow-400 text-sm font-bold">!</span>
            </div>
            <div>
              <p className="text-yellow-400 font-semibold text-sm">Modo Demonstração ativo</p>
              <p className="text-gray-400 text-xs mt-1 leading-relaxed">
                No modo DEMO o bot roda como simulação — nenhuma conta Jonbet é necessária.
                Mude para <strong className="text-gray-300">REAL</strong> acima para conectar sua conta e apostar.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-base font-semibold text-white">Credenciais Jonbet</h2>
            {hasJonbetToken && (
              <span className="text-xs bg-green-500/20 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">Conectado</span>
            )}
          </div>

          {hasJonbetToken ? (
            <div className="bg-gray-800 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-gray-700">
              <div>
                <p className="text-white font-medium">{name || "Conta Jonbet"}</p>
                {email && <p className="text-gray-400 text-xs mt-0.5">{email}</p>}
                {balance !== null && <p className="text-green-400 text-sm mt-1">Saldo: R$ {balance.toFixed(2)}</p>}
              </div>
              <button onClick={handleDisconnect} disabled={connecting}
                className="px-4 py-2 bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-sm font-semibold transition whitespace-nowrap">
                Desconectar
              </button>
            </div>
          ) : (
            <form onSubmit={handleConnect} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Email da Jonbet</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 transition text-sm"
                  placeholder="email@jonbet.com" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Senha da Jonbet</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 transition text-sm"
                  placeholder="••••••••" />
              </div>
              {error   && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">{error}</div>}
              {success && <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 text-green-400 text-sm">{success}</div>}
              <button type="submit" disabled={connecting}
                className="w-full bg-green-500 hover:bg-green-400 disabled:bg-green-500/50 text-black font-semibold py-2.5 rounded-lg transition-colors">
                {connecting ? "Conectando..." : "Conectar à Jonbet"}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── Estratégias Tab ────────────────────────────────────────── */
const TYPES_DOUBLE  = ["SEQUÊNCIA", "HORÁRIOS", "NÚMEROS", "COPIAR SALA DE SINAL"]
const TYPES_CRASH   = ["SEQUÊNCIA", "HORÁRIOS", "NÚMEROS", "COPIAR SALA DE SINAL"]
const TYPES_FORTUNE = ["SEQUÊNCIA", "HORÁRIOS"]

// Padrão de Número (Premium) tem pelo menos um token numérico (roll exato)
// misturado com cor curinga — usado pra separar dos padrões de Sequência
// (só cor) no painel "Padrões Premium Selecionados".
function isNumeroPattern(sequence: string): boolean {
  return sequence.split(",").some(t => /^\d+$/.test(t))
}

function colorLabel(c: string, gt?: string) {
  if (gt === "FORTUNE") {
    if (c === "VERMELHO") return "❤️ Vermelho"
    if (c === "AZUL")     return "💙 Azul"
    if (c === "AMARELO")  return "💛 Amarelo"
    return c
  }
  if (c === "VERMELHO") return "🟢 Verde"
  if (c === "PRETO")    return "⚫ Preto"
  if (c === "BRANCO")   return "⚪ Branco"
  return c
}

// ─── Recalculo ao vivo das % dos Padrões Premium salvos ────────────────────
const LIVE_COLOR_NAME: Record<number, string> = { 0: "BRANCO", 1: "VERMELHO", 2: "PRETO" }

async function fetchAggregate(kind: "double" | "crash" | "fortune", days: number, maxPages: number): Promise<any[]> {
  const res = await fetch(`/api/premium/${kind}-aggregate?days=${days}&maxPages=${maxPages}`)
  if (!res.ok) return []
  const d = await res.json()
  return d.records ?? []
}

// Fortune trata AMARELO (proteção) como neutro — não quebra a sequência de
// gale, igual o BRANCO no Double — por isso não reaproveita recomputeDoublePattern.
function recomputeFortunePattern(sorted: FortuneResult[], sequence: string, betColor: string, gales: number) {
  const F_COLOR: Record<number, string> = { 0: "AMARELO", 1: "VERMELHO", 2: "AZUL" }
  const seqLen = sequence.split(",").length
  let occurrences = 0, wins = 0
  const galeWins = new Array(gales).fill(0)
  for (let i = seqLen; i < sorted.length - gales; i++) {
    const seq = sorted.slice(i - seqLen, i).map(r => F_COLOR[r.color] ?? "AMARELO").join(",")
    if (seq !== sequence) continue
    occurrences++
    const nextColor = F_COLOR[sorted[i].color] ?? "AMARELO"
    if (nextColor === betColor) {
      wins++
    } else if (nextColor !== "AMARELO") {
      for (let g = 1; g <= gales; g++) {
        if (i + g >= sorted.length) break
        const gc = F_COLOR[sorted[i + g].color] ?? "AMARELO"
        if (gc === betColor) { galeWins[g - 1]++; break }
        if (gc !== "AMARELO") break
      }
    }
  }
  const totalWins = wins + galeWins.reduce((a, b) => a + b, 0)
  return { occurrences, wins, galeWins, hitRate: occurrences > 0 ? totalWins / occurrences : 0 }
}

function recomputeDoublePattern(sorted: DoubleResult[], sequence: string, betColor: string, gales: number) {
  const seqColors = sequence.split(",")
  const seqLen = seqColors.length
  const matchesToken = (token: string, r: DoubleResult) =>
    /^\d+$/.test(token) ? r.roll === parseInt(token, 10) : LIVE_COLOR_NAME[r.color] === token
  let occurrences = 0, wins = 0
  const galeWins = new Array(gales).fill(0)
  for (let i = seqLen; i < sorted.length - gales; i++) {
    const window = sorted.slice(i - seqLen, i)
    if (!window.every((r, j) => matchesToken(seqColors[j], r))) continue
    occurrences++
    const nextColor = LIVE_COLOR_NAME[sorted[i].color]
    if (nextColor === betColor) {
      wins++
    } else {
      for (let g = 1; g <= gales; g++) {
        if (i + g < sorted.length && LIVE_COLOR_NAME[sorted[i + g].color] === betColor) { galeWins[g - 1]++; break }
      }
    }
  }
  const totalWins = wins + galeWins.reduce((a, b) => a + b, 0)
  return { occurrences, wins, galeWins, hitRate: occurrences > 0 ? totalWins / occurrences : 0 }
}

function recomputeCrashPattern(sorted: CrashResult[], label: string, target: number, gales: number) {
  const seqLen = label.split(",").length
  let occurrences = 0, wins = 0
  const galeWins = new Array(gales).fill(0)
  for (let i = seqLen; i < sorted.length - gales; i++) {
    const seq = sorted.slice(i - seqLen, i).map(r => parseFloat(r.crash_point) >= target ? "H" : "L").join(",")
    if (seq !== label) continue
    occurrences++
    if (parseFloat(sorted[i].crash_point) >= target) {
      wins++
    } else {
      for (let g = 1; g <= gales; g++) {
        if (i + g < sorted.length && parseFloat(sorted[i + g].crash_point) >= target) { galeWins[g - 1]++; break }
      }
    }
  }
  const totalHits = wins + galeWins.reduce((a, b) => a + b, 0)
  return { occurrences, wins, galeWins, hitRate: occurrences > 0 ? totalHits / occurrences : 0 }
}

type TgState = { isConnected: boolean; phone: string | null; groupId: string | null; groupName: string | null; keywords: string[]; signalKeyword: string | null; signalKeywordVerified: boolean }
type TgGroup = { id: string; name: string; type?: string }
type TgMsg   = { id: string; text: string }

function detectColorFront(text: string): "VERMELHO" | "PRETO" | "BRANCO" | null {
  const t = text.toUpperCase()
  const m = t.match(/(?:ENTRADA|ENTRAR|APOSTAR|SINAL|BET)\s*[^A-Z]*?(VERMELHO|PRETO|BRANCO|🔴|⚫|⬛|⚪)/)
  if (m) {
    if (m[1] === "VERMELHO" || m[1] === "🔴") return "VERMELHO"
    if (m[1] === "PRETO"   || m[1] === "⚫" || m[1] === "⬛") return "PRETO"
    if (m[1] === "BRANCO"  || m[1] === "⚪") return "BRANCO"
  }
  if (t.includes("VERMELHO") || t.includes("🔴")) return "VERMELHO"
  if (t.includes("PRETO")   || t.includes("⚫") || t.includes("⬛")) return "PRETO"
  if (t.includes("BRANCO")  || t.includes("⚪")) return "BRANCO"
  return null
}

function CopiarSalaInline() {
  const [tg, setTg]         = useState<TgState | null>(null)
  const [step, setStep]     = useState<"idle" | "code" | "group" | "done">("idle")
  const [phone, setPhone]   = useState("")
  const [code, setCode]     = useState("")
  const [search, setSearch] = useState("")
  const [groups, setGroups] = useState<TgGroup[]>([])
  const [picked, setPicked] = useState<TgGroup | null>(null)
  const [msgs, setMsgs]     = useState<TgMsg[]>([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [keywords, setKeywords]           = useState("")
  const [signalKeyword, setSignalKeyword] = useState("")
  const [selectedMsg, setSelectedMsg]     = useState<TgMsg | null>(null)
  const [busy, setBusy]                   = useState(false)
  const [err, setErr]                     = useState("")

  useEffect(() => {
    fetch("/api/user/telegram-userbot").then((r) => r.json()).then((d) => {
      setTg(d)
      if (d.isConnected) {
        setStep(d.groupId ? "done" : "group")
        setSignalKeyword(d.signalKeyword ?? "")
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (step !== "group") return
    setBusy(true); setErr("")
    fetch("/api/user/telegram-userbot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "search-groups", query: "" }) })
      .then((r) => r.json()).then((d) => { if (Array.isArray(d)) setGroups(d) }).catch(() => {}).finally(() => setBusy(false))
  }, [step])

  useEffect(() => {
    if (!picked) { setMsgs([]); return }
    setLoadingMsgs(true)
    fetch("/api/user/telegram-userbot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "fetch-messages", groupId: picked.id }) })
      .then((r) => r.json()).then((d) => { if (Array.isArray(d)) setMsgs(d) }).catch(() => {}).finally(() => setLoadingMsgs(false))
  }, [picked])

  async function api(body: object) {
    setErr(""); setBusy(true)
    try {
      const res = await fetch("/api/user/telegram-userbot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erro")
      return data
    } catch (e: any) { setErr(e.message); return null }
    finally { setBusy(false) }
  }

  const inp = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
  const btn = "w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-semibold py-2.5 rounded-lg text-sm transition-colors"

  return (
    <div className="space-y-4">
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 text-xs text-gray-400">
        O bot lê mensagens do grupo de sinais e aposta automaticamente quando identifica VERDE / PRETO / BRANCO.
      </div>
      {step === "idle" && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-white">Conectar Conta Telegram</h3>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+5511999999999" className={inp} />
          {err && <p className="text-red-400 text-xs">{err}</p>}
          <button onClick={async () => { const ok = await api({ action: "send-code", phone }); if (ok) setStep("code") }} disabled={busy || !phone} className={btn}>
            {busy ? "Enviando..." : "Enviar Código"}
          </button>
        </div>
      )}
      {step === "code" && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-white">Código de Verificação</h3>
          <p className="text-xs text-gray-500">Digite apenas os dígitos recebidos no Telegram.</p>
          <input type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="12345" maxLength={10} className={inp + " tracking-widest text-center text-lg font-mono"} />
          {err && <p className="text-red-400 text-xs">{err}</p>}
          <button onClick={async () => { const ok = await api({ action: "verify-code", code: code.replace(/\D/g, "") }); if (ok) { setStep("group"); setTg((p) => p ? { ...p, isConnected: true } : p) } }} disabled={busy || !code} className={btn}>
            {busy ? "Verificando..." : "Confirmar"}
          </button>
          <button onClick={() => setStep("idle")} className="w-full text-gray-500 hover:text-white text-xs py-1">Voltar</button>
        </div>
      )}
      {step === "group" && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-white">Selecionar Grupo</h3>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filtrar grupos..." className={inp} />
          {busy && groups.length === 0 && <p className="text-gray-500 text-xs text-center py-2">Carregando grupos...</p>}
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {groups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase())).map((g) => (
              <button key={g.id} onClick={() => setPicked(g)} className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between ${picked?.id === g.id ? "bg-green-500/15 border border-green-500/40 text-green-400" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>
                <span>{g.name}</span>
                <span className="text-xs opacity-50 flex-shrink-0 ml-2">{g.type === "grupo" ? "👥 grupo" : "📢 canal"}</span>
              </button>
            ))}
          </div>
          {picked && (
            <div className="space-y-3 pt-2 border-t border-gray-700">
              <p className="text-xs text-gray-400">Grupo: <span className="text-white">{picked.name}</span></p>
              {/* Passo 1: Selecionar mensagem de entrada */}
              <div>
                <p className="text-xs text-gray-400 font-medium mb-1">1. Selecione uma mensagem de entrada:</p>
                {loadingMsgs && <p className="text-xs text-gray-500 text-center py-3">Carregando mensagens...</p>}
                {!loadingMsgs && msgs.length === 0 && <p className="text-xs text-gray-600 text-center py-3">Nenhuma mensagem encontrada</p>}
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {msgs.map((m) => {
                    const isSelected = selectedMsg?.id === m.id
                    const cor = detectColorFront(m.text)
                    const corBadge = cor === "VERMELHO" ? "bg-green-500/20 text-green-400 border-green-500/30"
                                   : cor === "PRETO"   ? "bg-gray-700/50 text-gray-300 border-gray-600"
                                   : cor === "BRANCO"  ? "bg-white/10 text-white border-white/20" : null
                    return (
                      <button key={m.id} onClick={() => { setSelectedMsg(m); setSignalKeyword("") }}
                        className={`w-full text-left border rounded-lg px-3 py-2 text-xs transition-colors ${isSelected ? "bg-green-500/10 border-green-500/50 text-green-300" : "bg-gray-800 border-gray-700 hover:bg-gray-700 hover:border-green-500/40 text-gray-300"}`}>
                        <span className="block truncate leading-relaxed">{m.text}</span>
                        {corBadge && (
                          <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] border ${corBadge}`}>
                            {cor === "VERMELHO" ? "🟢 VERDE" : cor === "PRETO" ? "⚫ PRETO" : "⚪ BRANCO"}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Passo 2: Linha da mensagem-chave */}
              {selectedMsg && (
                <div className="space-y-2 bg-gray-800/60 rounded-lg p-3">
                  <p className="text-xs text-gray-400 font-medium">2. Clique na linha que mostra o valor da entrada:</p>
                  <p className="text-[11px] text-gray-500">Ex: clique em "🎯 Sair em 1.5x" — o número varia a cada sinal e será extraído automaticamente</p>
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                    <p className="text-[11px] text-amber-400 font-medium">⚙️ Calibração automática</p>
                    <p className="text-[11px] text-amber-400/80 mt-0.5">A primeira mensagem detectada não gerará entrada — o sistema irá calibrar e confirmar que o valor está sendo extraído corretamente. A partir da segunda mensagem as entradas serão feitas normalmente.</p>
                  </div>
                  <div className="space-y-1">
                    {selectedMsg.text.split("\n").filter((l) => l.trim()).map((line, i) => {
                      const isKw = signalKeyword === line.trim()
                      return (
                        <button key={i} onClick={() => setSignalKeyword(line.trim())}
                          className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${isKw ? "bg-green-500/20 border border-green-500/50 text-green-300" : "bg-gray-700/50 border border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-white"}`}>
                          {line.trim()}
                          {isKw && <span className="ml-2 text-[10px] text-green-500">✓ selecionada</span>}
                        </button>
                      )
                    })}
                  </div>
                  <input value={signalKeyword} onChange={(e) => setSignalKeyword(e.target.value)}
                    placeholder="Ou digite a linha-chave manualmente..." className={inp} />
                  {signalKeyword && (
                    <p className="text-[11px] text-green-500/80">
                      Template salvo: <span className="font-mono">{signalKeyword.replace(/\d+[.,]?\d*\s*[xX]\b/gi, "{valor}x")}</span>
                    </p>
                  )}
                </div>
              )}

              <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="Filtro adicional (opcional) — ex: ENTRADA CONFIRMADA" className={inp} />
              {err && <p className="text-red-400 text-xs">{err}</p>}
              <button onClick={async () => {
                const kw = keywords.split(",").map((k) => k.trim()).filter(Boolean)
                const sk = signalKeyword.trim() || null
                const ok = await api({ action: "select-group", groupId: picked.id, groupName: picked.name, keywords: kw, signalKeyword: sk })
                if (ok) { setStep("done"); setTg((p) => p ? { ...p, groupId: picked.id, groupName: picked.name, keywords: kw, signalKeyword: sk } : p) }
              }} disabled={busy} className={btn}>
                {busy ? "Salvando..." : "Confirmar Grupo"}
              </button>
            </div>
          )}
        </div>
      )}
      {step === "done" && tg && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /><span className="text-sm font-semibold text-white">Conectado</span></div>
          <div className="text-xs text-gray-400 space-y-0.5">
            <p>Telefone: <span className="text-white">{tg.phone}</span></p>
            <p>Grupo: <span className="text-white">{tg.groupName ?? "—"}</span></p>
            {tg.signalKeyword && (
              <div className="space-y-1.5">
                <div className="flex items-start gap-2 flex-wrap">
                  <p>Mensagem-chave: <span className="text-green-400 font-mono text-[11px]">{tg.signalKeyword}</span></p>
                  <button onClick={async () => {
                    const ok = await api({ action: "select-group", groupId: tg.groupId, groupName: tg.groupName, keywords: tg.keywords, signalKeyword: null })
                    if (ok) setTg((p) => p ? { ...p, signalKeyword: null, signalKeywordVerified: false } : p)
                  }} className="text-[10px] text-red-400 hover:text-red-300 underline flex-shrink-0">{busy ? "..." : "limpar"}</button>
                </div>
                {!tg.signalKeywordVerified ? (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-2">
                    <p className="text-[11px] text-amber-400">⚙️ <span className="font-medium">Aguardando calibração</span> — a primeira entrada detectada será pulada para confirmar a extração do valor. A partir da segunda entrada o bot apostará normalmente.</p>
                  </div>
                ) : (
                  <p className="text-[11px] text-green-500/70">✅ Mensagem-chave calibrada</p>
                )}
              </div>
            )}
            {tg.keywords.length > 0 ? (
              <div className="flex items-center gap-2 flex-wrap">
                <p>Filtros: <span className="text-white font-mono text-[11px]">{tg.keywords.join(", ")}</span></p>
                <button onClick={async () => {
                  const ok = await api({ action: "select-group", groupId: tg.groupId, groupName: tg.groupName, keywords: [], signalKeyword: tg.signalKeyword ?? null })
                  if (ok) setTg((p) => p ? { ...p, keywords: [] } : p)
                }} className="text-[10px] text-red-400 hover:text-red-300 underline">{busy ? "..." : "limpar"}</button>
              </div>
            ) : (
              !tg.signalKeyword && <p className="text-green-500/70 text-[11px]">Detecção automática ativa</p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep("group")} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm py-2 rounded-lg">Trocar Grupo</button>
            <button onClick={async () => { const ok = await api({ action: "disconnect" }); if (ok) { setStep("idle"); setTg((p) => p ? { ...p, isConnected: false, groupId: null, groupName: null } : p) } }} disabled={busy} className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm py-2 rounded-lg">{busy ? "..." : "Desconectar"}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function EstrategiasTab({ gameType }: { gameType: string }) {
  const [strategyType, setStrategyType] = useState("SEQUÊNCIA")
  const [strategies, setStrategies]     = useState<Strategy[]>([])
  const [betColor, setBetColor]         = useState("VERMELHO")
  const [crashTarget, setCrashTarget]   = useState("")
  const [crashNumInput, setCrashNumInput] = useState("")
  const [seqItems, setSeqItems]         = useState<string[]>([])
  const [startTime, setStartTime]       = useState("")
  const [horarioBetColor, setHorarioBetColor]       = useState("VERMELHO")
  const [horarioCrashTarget, setHorarioCrashTarget] = useState("")
  const [showImport, setShowImport]     = useState(false)
  const [importText, setImportText]     = useState("")
  const [importing, setImporting]       = useState(false)
  const [importError, setImportError]   = useState("")
  const [adding, setAdding]             = useState(false)
  const [savingType, setSavingType]     = useState(false)
  const [addError, setAddError]         = useState("")
  const [loaded, setLoaded]             = useState(false)
  const [copiedList, setCopiedList]     = useState(false)
  const [hiddenTypes, setHiddenTypes]   = useState<string[]>([])
  type PremiumCrashPattern = { label: string; target: number; gales: number; hitRate: number; occurrences: number; wins: number; galeWins: number[] }
  type PremiumDoublePattern = { sequence: string; betColor: string; betColorNum: number; occurrences: number; wins: number; galeWins: number[]; hitRate: number }
  const [premiumCrashPatterns, setPremiumCrashPatterns]   = useState<PremiumCrashPattern[]>([])
  const [premiumDoublePatterns, setPremiumDoublePatterns] = useState<PremiumDoublePattern[]>([])
  const [premiumFortunePatterns, setPremiumFortunePatterns] = useState<PremiumDoublePattern[]>([])
  const [martingale, setMartingale] = useState(1)
  type StrategyStat = { occurrences: number; wins: number; galeWins: number[]; hitRate: number }
  const [strategyStats, setStrategyStats] = useState<Record<number, StrategyStat>>({})

  useEffect(() => {
    fetch("/api/user/public-config").then(r => r.json()).then(d => {
      if (Array.isArray(d.hiddenStrategyTypes)) setHiddenTypes(d.hiddenStrategyTypes)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    try {
      const rc = localStorage.getItem("jonbet_premium_crash_active_patterns")
      if (rc) setPremiumCrashPatterns(JSON.parse(rc))
      const rd = localStorage.getItem("jonbet_premium_double_active_patterns")
      if (rd) setPremiumDoublePatterns(JSON.parse(rd))
      const rf = localStorage.getItem("jonbet_premium_fortune_active_patterns")
      if (rf) setPremiumFortunePatterns(JSON.parse(rf))
    } catch {}
  }, [])

  // Recalcula as % dos Padrões Premium salvos com o histórico mais recente
  // — sem isso a % ficava congelada no valor de quando foi salva na
  // ferramenta Premium, sem nunca refletir rodadas novas.
  useEffect(() => {
    if (gameType !== "CRASH" && gameType !== "DOUBLE" && gameType !== "FORTUNE") return

    async function refreshPremiumPatterns() {
      if (gameType === "CRASH") {
        const raw = localStorage.getItem("jonbet_premium_crash_active_patterns")
        const saved: PremiumCrashPattern[] = raw ? JSON.parse(raw) : []
        if (!saved.length) return
        const results = await fetchAggregate("crash", 1, 4)
        if (!results.length) return
        const sorted = [...results].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        const updated = saved.map((p) => ({ ...p, ...recomputeCrashPattern(sorted, p.label, p.target, p.gales) }))
        setPremiumCrashPatterns(updated)
        try { localStorage.setItem("jonbet_premium_crash_active_patterns", JSON.stringify(updated)) } catch {}
      } else if (gameType === "DOUBLE") {
        const raw = localStorage.getItem("jonbet_premium_double_active_patterns")
        const saved: PremiumDoublePattern[] = raw ? JSON.parse(raw) : []
        if (!saved.length) return
        const results = await fetchAggregate("double", 1, 4)
        if (!results.length) return
        const sorted = [...results].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        const updated = saved.map((p) => ({ ...p, ...recomputeDoublePattern(sorted, p.sequence, p.betColor, p.galeWins.length) }))
        setPremiumDoublePatterns(updated)
        try { localStorage.setItem("jonbet_premium_double_active_patterns", JSON.stringify(updated)) } catch {}
      } else {
        const raw = localStorage.getItem("jonbet_premium_fortune_active_patterns")
        const saved: PremiumDoublePattern[] = raw ? JSON.parse(raw) : []
        if (!saved.length) return
        const results = await fetchAggregate("fortune", 1, 4)
        if (!results.length) return
        const sorted = [...results].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        const updated = saved.map((p) => ({ ...p, ...recomputeFortunePattern(sorted, p.sequence, p.betColor, p.galeWins.length) }))
        setPremiumFortunePatterns(updated)
        try { localStorage.setItem("jonbet_premium_fortune_active_patterns", JSON.stringify(updated)) } catch {}
      }
    }

    refreshPremiumPatterns()
    const interval = setInterval(refreshPremiumPatterns, 30000)
    return () => clearInterval(interval)
  }, [gameType])

  useEffect(() => {
    fetch("/api/user/jonbet/configuracoes").then((r) => r.json()).then((settings) => {
      const validTypes = gameType === "CRASH" ? TYPES_CRASH : gameType === "FORTUNE" ? TYPES_FORTUNE : TYPES_DOUBLE
      const st: string = settings.strategyType ?? "SEQUÊNCIA"
      const resolved = validTypes.includes(st) ? st : "SEQUÊNCIA"
      if (typeof settings.martingale === "number") setMartingale(settings.martingale)
      setStrategyType(resolved)
      fetch(`/api/user/estrategias?gameType=${gameType}&strategyType=${encodeURIComponent(resolved)}&platform=JONBET`)
        .then((r) => r.json()).then((strats) => { setStrategies(Array.isArray(strats) ? strats : []); setLoaded(true) })
    })
  }, [gameType])

  // Mesma ideia da % dos Padrões Premium, mas pras sequências que o próprio
  // cliente cadastrou (não vêm com estatística nenhuma por padrão) — simula
  // contra o histórico de 7 dias usando o Qtd. de Gales configurado.
  useEffect(() => {
    if (strategyType !== "SEQUÊNCIA" || strategies.length === 0) { setStrategyStats({}); return }
    if (gameType !== "CRASH" && gameType !== "DOUBLE" && gameType !== "FORTUNE") return

    async function refreshStrategyStats() {
      const kind = gameType === "CRASH" ? "crash" : gameType === "FORTUNE" ? "fortune" : "double"
      const results = await fetchAggregate(kind as any, 1, 4)
      if (!results.length) return
      const sorted = [...results].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

      const next: Record<number, StrategyStat> = {}
      for (const s of strategies) {
        if (gameType === "CRASH") {
          const label = s.sequence.split(",").map((v) => (v.trim().toUpperCase() === "V" ? "H" : "L")).join(",")
          next[s.id] = recomputeCrashPattern(sorted, label, parseFloat(s.color), martingale)
        } else if (gameType === "FORTUNE") {
          next[s.id] = recomputeFortunePattern(sorted, s.sequence, s.color, martingale)
        } else {
          next[s.id] = recomputeDoublePattern(sorted, s.sequence, s.color, martingale)
        }
      }
      setStrategyStats(next)
    }

    refreshStrategyStats()
    const interval = setInterval(refreshStrategyStats, 30000)
    return () => clearInterval(interval)
  }, [gameType, strategyType, strategies, martingale])

  function addSeqItem(item: string) { setSeqItems((p) => [...p, item]) }
  function removeLastSeqItem() { setSeqItems((p) => p.slice(0, -1)) }

  async function changeType(next: string) {
    setStrategyType(next); setSeqItems([]); setAddError(""); setSavingType(true)
    await fetch("/api/user/jonbet/configuracoes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ strategyType: next }) })
    setSavingType(false)
    const strats = await fetch(`/api/user/estrategias?gameType=${gameType}&strategyType=${encodeURIComponent(next)}&platform=JONBET`).then((r) => r.json())
    setStrategies(Array.isArray(strats) ? strats : [])
  }

  async function addStrategy(e: React.FormEvent) {
    e.preventDefault(); setAddError("")
    if (!seqItems.length) { setAddError("Adicione ao menos um item."); return }
    if (gameType === "CRASH") { const t = parseFloat(crashTarget); if (isNaN(t) || t < 1.01) { setAddError("Alvo inválido. Ex: 2.00"); return } }
    setAdding(true)
    const col = gameType === "CRASH" ? String(parseFloat(crashTarget).toFixed(2)) : betColor
    const res = await fetch("/api/user/estrategias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sequence: seqItems.join(","), color: col, gameType, strategyType, platform: "JONBET" }) })
    const data = await res.json(); setAdding(false)
    if (!res.ok) { setAddError(data.error ?? "Erro ao adicionar"); return }
    setStrategies((p) => [...p, data]); setSeqItems([]); setBetColor("VERMELHO"); setCrashTarget("")
  }

  async function addHorario(e: React.FormEvent) {
    e.preventDefault(); setAddError(""); setAdding(true)
    const col = gameType === "CRASH" ? horarioCrashTarget : horarioBetColor
    const res = await fetch("/api/user/estrategias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sequence: startTime, color: col, gameType, strategyType, platform: "JONBET" }) })
    const data = await res.json(); setAdding(false)
    if (!res.ok) { setAddError(data.error ?? "Erro ao adicionar"); return }
    setStrategies((p) => [...p, data]); setStartTime(""); setHorarioBetColor("VERMELHO"); setHorarioCrashTarget("")
  }

  function parseHorarioLine(line: string, crash = false, fortune = false): { time: string; color: string } | null {
    const m = line.trim().match(/(\d{1,2}:\d{2})/); if (!m) return null
    const [h, mn] = m[1].split(":").map(Number)
    const time = `${String(h).padStart(2,"0")}:${String(mn).padStart(2,"0")}`
    if (crash) {
      const nm = line.replace(m[1], "").match(/(\d+\.?\d*)/)
      const t = nm ? parseFloat(nm[1]) : 2.0; return { time, color: (isNaN(t) || t < 1.01 ? 2.0 : t).toFixed(2) }
    }
    if (fortune) {
      let color = "VERMELHO"
      if (line.includes("💙") || /\bazul\b/i.test(line)) color = "AZUL"
      else if (line.includes("💛") || /\bamarelo\b/i.test(line)) color = "AMARELO"
      return { time, color }
    }
    let color = "VERMELHO"
    if (/\bpreto\b/i.test(line)) color = "PRETO"
    else if (/\bbranco\b/i.test(line)) color = "BRANCO"
    return { time, color }
  }

  async function importHorarios(e: React.FormEvent) {
    e.preventDefault(); setImportError("")
    const lines = importText.split("\n").map((l) => l.trim()).filter(Boolean)
    const parsed = lines.map((l) => parseHorarioLine(l, gameType === "CRASH", gameType === "FORTUNE")).filter(Boolean) as { time: string; color: string }[]
    if (!parsed.length) { setImportError("Nenhum horário válido encontrado."); return }
    setImporting(true)
    const added: any[] = []
    for (const entry of parsed) {
      const res = await fetch("/api/user/estrategias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sequence: entry.time, color: entry.color, gameType, strategyType, platform: "JONBET" }) })
      if (res.ok) added.push(await res.json())
    }
    setStrategies((p) => [...p, ...added]); setImportText(""); setShowImport(false); setImporting(false)
  }

  async function addNumero(e: React.FormEvent) {
    e.preventDefault()
    if (!seqItems.length) { setAddError("Adicione ao menos um item."); return }
    if (gameType === "CRASH") { const t = parseFloat(crashTarget); if (isNaN(t) || t < 1.01) { setAddError("Alvo inválido. Ex: 2.00"); return } }
    setAddError(""); setAdding(true)
    const color = gameType === "CRASH" ? String(parseFloat(crashTarget).toFixed(2)) : betColor
    const res = await fetch("/api/user/estrategias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sequence: seqItems.join(","), color, gameType, strategyType, platform: "JONBET" }) })
    const data = await res.json(); setAdding(false)
    if (!res.ok) { setAddError(data.error ?? "Erro ao adicionar"); return }
    setStrategies((p) => [...p, data]); setSeqItems([]); setBetColor("VERMELHO"); setCrashTarget(""); setCrashNumInput("")
  }

  function deleteStrategy(id: number) {
    fetch(`/api/user/estrategias?id=${id}`, { method: "DELETE" })
    setStrategies((p) => p.filter((s) => s.id !== id))
  }

  async function deleteAllStrategies() {
    await fetch(`/api/user/estrategias?gameType=${gameType}&strategyType=${encodeURIComponent(strategyType)}&platform=JONBET`, { method: "DELETE" })
    setStrategies([])
  }

  if (!loaded) return <div className="text-gray-400 text-sm py-4">Carregando...</div>

  const allTypes = gameType === "CRASH" ? TYPES_CRASH : gameType === "FORTUNE" ? TYPES_FORTUNE : TYPES_DOUBLE
  const availableTypes = allTypes.filter((t) => !hiddenTypes.includes(t))
  const isDouble  = gameType === "DOUBLE"
  const isFortune = gameType === "FORTUNE"
  const isCrash   = gameType === "CRASH"

  return (
    <div className="space-y-5">
      {/* ── Tipo de Estratégia ── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Tipo de Estratégia</h2>
          {savingType && <span className="text-xs text-gray-500">Salvando...</span>}
        </div>
        <div className="grid grid-cols-1 gap-2">
          {availableTypes.map((t) => (
            <button key={t} onClick={() => changeType(t)}
              className={`w-full text-left px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${strategyType === t ? "bg-green-500/15 border-green-500/40 text-green-400" : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white"}`}>
              {t}{strategyType === t && <span className="ml-2 text-xs opacity-60">✓ ativo</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ── SEQUÊNCIA ── */}
      {strategyType === "SEQUÊNCIA" && (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-3">Nova Sequência</h2>
            <form onSubmit={addStrategy} className="space-y-4">
              <div className="min-h-[44px] bg-gray-800 rounded-lg px-3 py-2 flex flex-wrap gap-1.5 items-center">
                {seqItems.length === 0
                  ? <span className="text-gray-600 text-xs">Clique nos botões abaixo para montar a sequência...</span>
                  : seqItems.map((item, i) => <SeqBall key={i} item={item} />)}
              </div>
              {isFortune ? (
                <div className="grid grid-cols-4 gap-2">
                  {[["VERMELHO","❤️","Vermelho","bg-red-600/20 border-red-500/40 text-red-400 hover:bg-red-600/30","bg-red-600 text-base"],["AZUL","💙","Azul","bg-blue-600/20 border-blue-500/40 text-blue-400 hover:bg-blue-600/30","bg-blue-600 text-base"],["AMARELO","💛","Amarelo","bg-yellow-400/20 border-yellow-400/40 text-yellow-400 hover:bg-yellow-400/30","bg-yellow-400 text-base"]].map(([val, emoji, label, cls, dotCls]) => (
                    <button key={val} type="button" onClick={() => addSeqItem(val)}
                      className={`flex flex-col items-center justify-center gap-1 py-2.5 border rounded-lg text-xs font-medium transition ${cls}`}>
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${dotCls}`}>{emoji}</div>{label}
                    </button>
                  ))}
                  <button type="button" onClick={removeLastSeqItem} disabled={!seqItems.length}
                    className="flex flex-col items-center justify-center gap-1 py-2.5 bg-orange-500/10 border border-orange-500/30 text-orange-400 rounded-lg text-xs font-medium hover:bg-orange-500/20 disabled:opacity-30 transition">
                    <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-sm">←</div>Apagar
                  </button>
                </div>
              ) : isCrash ? (
                <div className="grid grid-cols-3 gap-2">
                  {[["V","≥2x","bg-green-500/20 border-green-500/40 text-green-400 hover:bg-green-500/30","bg-green-500 text-white"],["R","<2x","bg-red-600/20 border-red-500/40 text-red-400 hover:bg-red-600/30","bg-red-500 text-white"]].map(([val, label, cls, dotCls]) => (
                    <button key={val} type="button" onClick={() => addSeqItem(val)}
                      className={`flex flex-col items-center justify-center gap-1 py-2.5 border rounded-lg text-xs font-medium transition ${cls}`}>
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${dotCls}`}>{val}</div>{label}
                    </button>
                  ))}
                  <button type="button" onClick={removeLastSeqItem} disabled={!seqItems.length}
                    className="flex flex-col items-center justify-center gap-1 py-2.5 bg-orange-500/10 border border-orange-500/30 text-orange-400 rounded-lg text-xs font-medium hover:bg-orange-500/20 disabled:opacity-30 transition">
                    <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-sm">←</div>Apagar
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {[["VERMELHO","V","Verde","bg-green-400/20 border-green-400/40 text-green-400 hover:bg-green-400/30","bg-green-400 text-gray-900"],["PRETO","P","Preto","bg-gray-700/30 border-gray-600 text-gray-300 hover:bg-gray-700/50","bg-gray-700 border border-gray-500 text-white"],["BRANCO","B","Branco","bg-white/5 border-white/20 text-white hover:bg-white/10","bg-white text-gray-900"]].map(([val, abbr, label, cls, dotCls]) => (
                    <button key={val} type="button" onClick={() => addSeqItem(val)}
                      className={`flex flex-col items-center justify-center gap-1 py-2.5 border rounded-lg text-xs font-medium transition ${cls}`}>
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${dotCls}`}>{abbr}</div>{label}
                    </button>
                  ))}
                  <button type="button" onClick={removeLastSeqItem} disabled={!seqItems.length}
                    className="flex flex-col items-center justify-center gap-1 py-2.5 bg-orange-500/10 border border-orange-500/30 text-orange-400 rounded-lg text-xs font-medium hover:bg-orange-500/20 disabled:opacity-30 transition">
                    <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-sm">←</div>Apagar
                  </button>
                </div>
              )}
              {!isCrash && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Cor apostada</label>
                  <select value={betColor} onChange={(e) => setBetColor(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                    {isFortune ? <><option value="VERMELHO">❤️ Vermelho</option><option value="AZUL">💙 Azul</option><option value="AMARELO">💛 Amarelo</option></>
                    : <><option value="VERMELHO">🟢 Verde</option><option value="PRETO">⚫ Preto</option><option value="BRANCO">⚪ Branco</option></>}
                  </select>
                </div>
              )}
              {isCrash && (
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Alvo da aposta</label>
                  <input type="number" inputMode="decimal" onFocus={(e) => e.target.select()} min="1.01" step="0.01" value={crashTarget} onChange={(e) => setCrashTarget(e.target.value)} required placeholder="2.00"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              )}
              {addError && <p className="text-red-400 text-xs">{addError}</p>}
              <button type="submit" disabled={adding || !seqItems.length}
                className="w-full bg-green-500 hover:bg-green-400 disabled:bg-green-500/50 text-black font-semibold py-2 rounded-lg text-sm transition-colors">
                {adding ? "Adicionando..." : "Adicionar Sequência"}
              </button>
            </form>
          </div>

          {/* Premium crash patterns */}
          {gameType === "CRASH" && premiumCrashPatterns.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-yellow-400 text-xs font-bold uppercase tracking-wide">👑 Padrões Premium Selecionados</p>
                <button onClick={() => { try { localStorage.removeItem("jonbet_premium_crash_active_patterns") } catch {} setPremiumCrashPatterns([]) }}
                  className="text-gray-600 hover:text-red-400 text-xs transition-colors">Limpar todos</button>
              </div>
              {premiumCrashPatterns.map((p, i) => (
                <div key={i} className="bg-yellow-500/5 border border-yellow-500/30 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-mono font-semibold">
                        {p.label.split(",").map((v: string) => v === "H" ? `≥${p.target}x` : `<${p.target}x`).join(", ")} → ≥{p.target}x
                      </p>
                      <div className="flex gap-3 text-xs mt-1">
                        <span className="text-green-400">{p.wins} direto</span>
                        {(p.galeWins ?? []).map((g: number, gi: number) => <span key={gi} className="text-yellow-400">G{gi+1}: {g}</span>)}
                        <span className="text-gray-500">{p.occurrences} ocorr.</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <button onClick={() => {
                        const next = premiumCrashPatterns.filter((_, idx) => idx !== i)
                        try { localStorage.setItem("jonbet_premium_crash_active_patterns", JSON.stringify(next)) } catch {}
                        setPremiumCrashPatterns(next)
                      }} className="text-gray-600 hover:text-red-400 transition-colors text-sm leading-none">✕</button>
                      <p className={`text-sm font-bold ${p.hitRate >= 0.7 ? "text-green-400" : p.hitRate >= 0.5 ? "text-yellow-400" : "text-red-400"}`}>
                        {(p.hitRate * 100).toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Premium double patterns */}
          {isDouble && premiumDoublePatterns.filter((p: any) => isNumeroPattern(p.sequence) === (strategyType === "NÚMEROS")).length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-yellow-400 text-xs font-bold uppercase tracking-wide">👑 Padrões Premium Selecionados</p>
                <button onClick={() => {
                  const remaining = premiumDoublePatterns.filter((p: any) => isNumeroPattern(p.sequence) !== (strategyType === "NÚMEROS"))
                  try { localStorage.setItem("jonbet_premium_double_active_patterns", JSON.stringify(remaining)) } catch {}
                  setPremiumDoublePatterns(remaining)
                }}
                  className="text-gray-600 hover:text-red-400 text-xs transition-colors">Limpar todos</button>
              </div>
              {premiumDoublePatterns.filter((p: any) => isNumeroPattern(p.sequence) === (strategyType === "NÚMEROS")).map((p: any, i: number) => (
                <div key={i} className="bg-yellow-500/5 border border-yellow-500/30 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        {p.sequence.split(",").map((c: string, j: number) => {
                          const n = /^\d+$/.test(c) ? parseInt(c, 10) : null
                          const nColorNum = n === null ? null : n === 0 ? 0 : n <= 7 ? 1 : 2
                          const cls = n !== null
                            ? (nColorNum === 1 ? "bg-green-400/30 text-green-300" : nColorNum === 2 ? "bg-gray-700 text-gray-300" : "bg-white/10 text-gray-200")
                            : (c === "VERMELHO" ? "bg-green-400/30 text-green-300" : c === "PRETO" ? "bg-gray-700 text-gray-300" : "bg-white/10 text-gray-200")
                          return <span key={j} className={`text-xs font-bold px-1.5 py-0.5 rounded ${cls}`}>{n !== null ? n : (c === "VERMELHO" ? "VERDE" : c)}</span>
                        })}
                        <span className="text-gray-600 text-xs">→</span>
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${p.betColorNum === 1 ? "bg-green-400/40 text-green-300" : "bg-gray-700 text-gray-200"}`}>
                          {p.betColor === "VERMELHO" ? "VERDE" : p.betColor}
                        </span>
                      </div>
                      <div className="flex gap-3 text-xs mt-1">
                        <span className="text-green-400">{p.wins}× direto</span>
                        {(p.galeWins ?? []).map((g: number, gi: number) => g > 0 && <span key={gi} className="text-yellow-400">{g}× G{gi+1}</span>)}
                        <span className="text-gray-500">{p.occurrences} ocorr.</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <button onClick={() => {
                        const next = premiumDoublePatterns.filter((o: any) => !(o.sequence === p.sequence && o.betColor === p.betColor))
                        try { localStorage.setItem("jonbet_premium_double_active_patterns", JSON.stringify(next)) } catch {}
                        setPremiumDoublePatterns(next)
                      }} className="text-gray-600 hover:text-red-400 transition-colors text-sm leading-none">✕</button>
                      <p className={`text-sm font-bold ${p.hitRate >= 0.7 ? "text-green-400" : p.hitRate >= 0.5 ? "text-yellow-400" : "text-red-400"}`}>
                        {(p.hitRate * 100).toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Premium fortune patterns */}
          {isFortune && premiumFortunePatterns.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-yellow-400 text-xs font-bold uppercase tracking-wide">👑 Padrões Premium Selecionados</p>
                <button onClick={() => { try { localStorage.removeItem("jonbet_premium_fortune_active_patterns") } catch {} setPremiumFortunePatterns([]) }}
                  className="text-gray-600 hover:text-red-400 text-xs transition-colors">Limpar todos</button>
              </div>
              {premiumFortunePatterns.map((p, i) => (
                <div key={i} className="bg-yellow-500/5 border border-yellow-500/30 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        {p.sequence.split(",").map((c, j) => (
                          <span key={j} className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                            c === "VERMELHO" ? "bg-red-600/30 text-red-300" :
                            c === "AZUL"     ? "bg-blue-600/30 text-blue-300" :
                                              "bg-yellow-500/20 text-yellow-200"
                          }`}>{c}</span>
                        ))}
                        <span className="text-gray-600 text-xs">→</span>
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${p.betColorNum === 1 ? "bg-red-600/40 text-red-300" : "bg-blue-600/40 text-blue-300"}`}>
                          {p.betColor}
                        </span>
                      </div>
                      <div className="flex gap-3 text-xs mt-1">
                        <span className="text-green-400">{p.wins}× direto</span>
                        {(p.galeWins ?? []).map((g, gi) => g > 0 && <span key={gi} className="text-yellow-400">{g}× G{gi+1}</span>)}
                        <span className="text-gray-500">{p.occurrences} ocorr.</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <button onClick={() => {
                        const next = premiumFortunePatterns.filter((_, idx) => idx !== i)
                        try { localStorage.setItem("jonbet_premium_fortune_active_patterns", JSON.stringify(next)) } catch {}
                        setPremiumFortunePatterns(next)
                      }} className="text-gray-600 hover:text-red-400 transition-colors text-sm leading-none">✕</button>
                      <p className={`text-sm font-bold ${p.hitRate >= 0.7 ? "text-green-400" : p.hitRate >= 0.5 ? "text-yellow-400" : "text-red-400"}`}>
                        {(p.hitRate * 100).toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Sequências cadastradas */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-3">Sequências Cadastradas ({strategies.length})</h2>
            {strategies.length === 0 ? (
              <p className="text-gray-500 text-xs">Nenhuma sequência cadastrada.</p>
            ) : (
              <div className="space-y-2">
                {strategies.map((s) => {
                  const stat = strategyStats[s.id]
                  return (
                  <div key={s.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2.5">
                    <div>
                      <div className="flex gap-1 flex-wrap mb-1">
                        {s.sequence.split(",").map((item, i) => {
                          const v = item.trim().toUpperCase()
                          if (!isDouble && (v === "V" || v === "R" || v === "X")) {
                            return <div key={i} className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${v === "V" ? "bg-green-500 text-white" : v === "R" ? "bg-red-500 text-white" : "bg-gray-600 text-gray-200"}`}>{v}</div>
                          }
                          return <SeqBall key={i} item={v} />
                        })}
                      </div>
                      <p className="text-gray-400 text-xs">{(isDouble || isFortune) ? "Aposta:" : "Alvo:"} {(isDouble || isFortune) ? colorLabel(s.color, gameType) : `${parseFloat(s.color)}x`}</p>
                      {stat && (
                        <div className="flex gap-3 text-xs mt-1">
                          <span className="text-green-400">{stat.wins} direto</span>
                          {stat.galeWins.map((g, gi) => g > 0 && <span key={gi} className="text-yellow-400">{g}× G{gi + 1}</span>)}
                          <span className="text-gray-500">{stat.occurrences} ocorr. (7d)</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-3">
                      <button onClick={() => deleteStrategy(s.id)} className="text-gray-500 hover:text-red-400 transition-colors text-base leading-none">✕</button>
                      {stat && stat.occurrences > 0 && (
                        <p className={`text-sm font-bold ${stat.hitRate >= 0.7 ? "text-green-400" : stat.hitRate >= 0.5 ? "text-yellow-400" : "text-red-400"}`}>
                          {(stat.hitRate * 100).toFixed(1)}%
                        </p>
                      )}
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── NÚMEROS — Double ── */}
      {strategyType === "NÚMEROS" && isDouble && (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-3">Nova Estratégia de Números</h2>
            <form onSubmit={addNumero} className="space-y-4">
              <p className="text-xs text-gray-500">
                Monte a sequência combinando números específicos, cores e X (qualquer). Ex: <span className="font-mono text-gray-300">7, V, V, V, X</span>
              </p>
              <div className="min-h-[44px] bg-gray-800 rounded-lg px-3 py-2 flex flex-wrap gap-1.5 items-center">
                {seqItems.length === 0
                  ? <span className="text-gray-600 text-xs">Clique nos botões abaixo para montar a sequência...</span>
                  : seqItems.map((item, i) => <SeqBall key={i} item={item} />)}
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-2">Números: <span className="text-white">0</span> = branco · <span className="text-green-400">1–7</span> = verde · <span className="text-gray-400">8–14</span> = preto</p>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: 15 }, (_, n) => (
                    <button key={n} type="button" onClick={() => addSeqItem(String(n))}
                      className={`w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center transition hover:scale-110 ${
                        n === 0 ? "bg-white text-gray-900" : n <= 7 ? "bg-green-400 text-gray-900" : "bg-gray-700 border border-gray-600 text-white"
                      }`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-5 gap-2">
                <button type="button" onClick={() => addSeqItem("VERMELHO")}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 bg-green-400/20 border border-green-400/40 text-green-400 rounded-lg text-xs font-medium hover:bg-green-400/30 transition">
                  <div className="w-6 h-6 rounded-full bg-green-400 flex items-center justify-center text-gray-900 font-bold text-xs">V</div>
                  Verde
                </button>
                <button type="button" onClick={() => addSeqItem("PRETO")}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 bg-gray-700/30 border border-gray-600 text-gray-300 rounded-lg text-xs font-medium hover:bg-gray-700/50 transition">
                  <div className="w-6 h-6 rounded-full bg-gray-700 border border-gray-500 flex items-center justify-center text-white font-bold text-xs">P</div>
                  Preto
                </button>
                <button type="button" onClick={() => addSeqItem("BRANCO")}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 bg-white/5 border border-white/20 text-white rounded-lg text-xs font-medium hover:bg-white/10 transition">
                  <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-gray-900 font-bold text-xs">B</div>
                  Branco
                </button>
                <button type="button" onClick={() => addSeqItem("X")}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 bg-gray-600/20 border border-gray-500/40 text-gray-400 rounded-lg text-xs font-medium hover:bg-gray-600/30 transition">
                  <div className="w-6 h-6 rounded-full bg-gray-600/60 border border-gray-500 flex items-center justify-center text-gray-300 font-bold text-xs">X</div>
                  Qualquer
                </button>
                <button type="button" onClick={removeLastSeqItem} disabled={seqItems.length === 0}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 bg-orange-500/10 border border-orange-500/30 text-orange-400 rounded-lg text-xs font-medium hover:bg-orange-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition">
                  <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-sm">←</div>
                  Apagar
                </button>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Cor apostada quando a sequência bater</label>
                <select value={betColor} onChange={(e) => setBetColor(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500 transition">
                  <option value="VERMELHO">🟢 Verde</option>
                  <option value="PRETO">⚫ Preto</option>
                  <option value="BRANCO">⚪ Branco</option>
                </select>
              </div>
              {addError && <p className="text-red-400 text-xs">{addError}</p>}
              <button type="submit" disabled={adding || seqItems.length === 0}
                className="w-full bg-green-500 hover:bg-green-400 disabled:bg-green-500/50 text-black font-semibold py-2 rounded-lg text-sm transition-colors">
                {adding ? "Adicionando..." : "Adicionar Estratégia"}
              </button>
            </form>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-3">Estratégias Cadastradas ({strategies.length})</h2>
            {strategies.length === 0 ? (
              <p className="text-gray-500 text-xs">Nenhuma estratégia cadastrada.</p>
            ) : (
              <div className="space-y-2">
                {strategies.map((s) => (
                  <div key={s.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2.5">
                    <div>
                      <div className="flex gap-1 flex-wrap mb-1">
                        {s.sequence.split(",").map((item, i) => <SeqBall key={i} item={item.trim()} />)}
                      </div>
                      <p className="text-gray-400 text-xs">Aposta: {colorLabel(s.color, gameType)}</p>
                    </div>
                    <button onClick={() => deleteStrategy(s.id)} className="text-gray-500 hover:text-red-400 transition-colors text-base leading-none ml-3 flex-shrink-0">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── NÚMEROS — Crash ── */}
      {strategyType === "NÚMEROS" && isCrash && (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-3">Nova Estratégia de Números</h2>
            <form onSubmit={addNumero} className="space-y-4">
              <p className="text-xs text-gray-500">
                Clique nos crash points e V/R/X para montar a sequência. Número = crash caiu em ≤ esse valor.
              </p>
              <div className="min-h-[44px] bg-gray-800 rounded-lg px-3 py-2 flex flex-wrap gap-1.5 items-center">
                {seqItems.length === 0
                  ? <span className="text-gray-600 text-xs">Clique nos botões abaixo para montar a sequência...</span>
                  : seqItems.map((item, i) => {
                      const v = item.trim().toUpperCase()
                      if (v === "V" || v === "R" || v === "X") {
                        return <div key={i} className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${v === "V" ? "bg-green-500 text-white" : v === "R" ? "bg-red-500 text-white" : "bg-gray-600 text-gray-200"}`}>{v}</div>
                      }
                      return <div key={i} className="h-7 px-2 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold font-mono flex-shrink-0">{item}x</div>
                    })
                }
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-2">Crash points <span className="text-gray-600">(≤ valor)</span></p>
                <div className="flex flex-wrap gap-1.5">
                  {["1.10","1.20","1.30","1.50","1.80","2.00","3.00","5.00","10.00"].map((n) => (
                    <button key={n} type="button" onClick={() => addSeqItem(n)}
                      className="h-9 px-3 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold font-mono transition hover:scale-105">
                      {n}x
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <input type="number" inputMode="decimal" onFocus={(e) => e.target.select()} min="1.01" step="0.01" value={crashNumInput} onChange={(e) => setCrashNumInput(e.target.value)}
                  placeholder="Outro valor (ex: 1.75)"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition" />
                <button type="button" onClick={() => { const v = parseFloat(crashNumInput); if (!isNaN(v) && v >= 1.01) { addSeqItem(String(v.toFixed(2))); setCrashNumInput("") } }}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 rounded-lg transition">
                  + Adicionar
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <button type="button" onClick={() => addSeqItem("V")}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 bg-green-500/20 border border-green-500/40 text-green-400 rounded-lg text-xs font-medium hover:bg-green-500/30 transition">
                  <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white font-bold text-xs">V</div>
                  ≥2x
                </button>
                <button type="button" onClick={() => addSeqItem("R")}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 bg-red-600/20 border border-red-500/40 text-red-400 rounded-lg text-xs font-medium hover:bg-red-600/30 transition">
                  <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center text-white font-bold text-xs">R</div>
                  &lt;2x
                </button>
                <button type="button" onClick={() => addSeqItem("X")}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 bg-gray-600/20 border border-gray-500/40 text-gray-400 rounded-lg text-xs font-medium hover:bg-gray-600/30 transition">
                  <div className="w-6 h-6 rounded-full bg-gray-600/60 border border-gray-500 flex items-center justify-center text-gray-300 font-bold text-xs">X</div>
                  Any
                </button>
                <button type="button" onClick={removeLastSeqItem} disabled={seqItems.length === 0}
                  className="flex flex-col items-center justify-center gap-1 py-2.5 bg-orange-500/10 border border-orange-500/30 text-orange-400 rounded-lg text-xs font-medium hover:bg-orange-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition">
                  <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-sm">←</div>
                  Apagar
                </button>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Alvo da aposta <span className="text-gray-600">(ex: 2.00)</span></label>
                <input type="number" inputMode="decimal" onFocus={(e) => e.target.select()} min="1.01" step="0.01" value={crashTarget} onChange={(e) => setCrashTarget(e.target.value)} required placeholder="2.00"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 transition" />
              </div>
              {addError && <p className="text-red-400 text-xs">{addError}</p>}
              <button type="submit" disabled={adding || seqItems.length === 0}
                className="w-full bg-green-500 hover:bg-green-400 disabled:bg-green-500/50 text-black font-semibold py-2 rounded-lg text-sm transition-colors">
                {adding ? "Adicionando..." : "Adicionar Estratégia"}
              </button>
            </form>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-3">Estratégias Cadastradas ({strategies.length})</h2>
            {strategies.length === 0 ? (
              <p className="text-gray-500 text-xs">Nenhuma estratégia cadastrada.</p>
            ) : (
              <div className="space-y-2">
                {strategies.map((s) => (
                  <div key={s.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2.5">
                    <div>
                      <div className="flex gap-1 flex-wrap mb-1">
                        {s.sequence.split(",").map((item, i) => {
                          const v = item.trim().toUpperCase()
                          if (v === "V" || v === "R" || v === "X") {
                            return <div key={i} className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${v === "V" ? "bg-green-500 text-white" : v === "R" ? "bg-red-500 text-white" : "bg-gray-600 text-gray-200"}`}>{v}</div>
                          }
                          return <div key={i} className="h-7 px-2 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-300 text-xs font-bold font-mono flex-shrink-0">{item.trim()}</div>
                        })}
                      </div>
                      <p className="text-gray-400 text-xs">Alvo: {s.color}x</p>
                    </div>
                    <button onClick={() => deleteStrategy(s.id)} className="text-gray-500 hover:text-red-400 transition-colors text-base leading-none ml-3 flex-shrink-0">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── COPIAR SALA DE SINAL ── */}
      {strategyType === "COPIAR SALA DE SINAL" && (
        <CopiarSalaInline />
      )}

      {/* ── HORÁRIOS ── */}
      {strategyType === "HORÁRIOS" && (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-white">Novo Horário</h2>
              <button type="button" onClick={() => { setShowImport((v) => !v); setImportError("") }}
                className="text-xs text-green-400 hover:text-green-300 transition-colors border border-green-500/30 rounded-lg px-2.5 py-1">
                {showImport ? "Cancelar" : "Importar Lista"}
              </button>
            </div>

            {showImport ? (
              <form onSubmit={importHorarios} className="space-y-3 mt-3">
                <p className="text-xs text-gray-500">
                  {isFortune
                    ? "Cole a lista abaixo. Cada linha deve ter o horário e opcionalmente a cor (❤️/💙/💛)."
                    : isDouble
                    ? "Cole a lista abaixo. Cada linha deve ter o horário e opcionalmente a cor (🟢/⚫/⚪)."
                    : "Cole a lista abaixo. Cada linha deve ter o horário e opcionalmente o multiplicador alvo (ex: 2.00)."}
                </p>
                <p className="text-xs text-gray-600">
                  {isFortune
                    ? <><span className="text-gray-400 font-mono">15:00 ❤️</span> · <span className="text-gray-400 font-mono">15:19 💙</span> · <span className="text-gray-400 font-mono">15:30 vermelho</span></>
                    : isDouble
                    ? <><span className="text-gray-400 font-mono">15:00 🟢</span> · <span className="text-gray-400 font-mono">15:19 ⚫</span> · <span className="text-gray-400 font-mono">15:30 verde</span></>
                    : <><span className="text-gray-400 font-mono">11:05</span> · <span className="text-gray-400 font-mono">11:05 2.00</span> · <span className="text-gray-400 font-mono">14:30 1.50</span></>}
                </p>
                <textarea value={importText} onChange={(e) => setImportText(e.target.value)} required rows={8}
                  placeholder={isFortune ? "15:00 ❤️\n15:04 ❤️\n15:19 💙\n15:27 💛" : isDouble ? "15:00 🟢\n15:04 🟢\n15:19 ⚫\n15:27 ⚪" : "11:05 2.00\n11:15 2.00\n14:30 2.00"}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500 transition resize-none" />
                {importError && <p className="text-red-400 text-xs">{importError}</p>}
                <button type="submit" disabled={importing}
                  className="w-full bg-green-500 hover:bg-green-400 disabled:bg-green-500/50 text-black font-semibold py-2 rounded-lg text-sm transition-colors">
                  {importing ? "Importando..." : "Importar Horários"}
                </button>
              </form>
            ) : (
              <>
                <p className="text-xs text-gray-500 mt-1 mb-1">
                  Cadastre o horário exato em que o resultado da rodada sai na Jonbet e a cor que quer apostar na próxima rodada.
                </p>
                {isDouble && <p className="text-xs text-gray-600 mb-4">⚪ Proteção no branco é controlada pelas Config. do Bot.</p>}
                {isFortune && <p className="text-xs text-gray-600 mb-4">💛 Proteção no amarelo é controlada pelas Config. do Bot.</p>}
                <form onSubmit={addHorario} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Horário (HH:MM)</label>
                      <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500 transition" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">
                        {(isDouble || isFortune) ? "Cor apostada" : "Ponto alvo"}
                      </label>
                      {isFortune ? (
                        <select value={horarioBetColor} onChange={(e) => setHorarioBetColor(e.target.value)}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500 transition">
                          <option value="VERMELHO">❤️ Vermelho</option>
                          <option value="AZUL">💙 Azul</option>
                          <option value="AMARELO">💛 Amarelo</option>
                        </select>
                      ) : isDouble ? (
                        <select value={horarioBetColor} onChange={(e) => setHorarioBetColor(e.target.value)}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500 transition">
                          <option value="VERMELHO">🟢 Verde</option>
                          <option value="PRETO">⚫ Preto</option>
                          <option value="BRANCO">⚪ Branco</option>
                        </select>
                      ) : (
                        <input type="text" value={horarioCrashTarget} onChange={(e) => setHorarioCrashTarget(e.target.value)} required placeholder="2.00"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 transition" />
                      )}
                    </div>
                  </div>
                  {addError && <p className="text-red-400 text-xs">{addError}</p>}
                  <button type="submit" disabled={adding}
                    className="w-full bg-green-500 hover:bg-green-400 disabled:bg-green-500/50 text-black font-semibold py-2 rounded-lg text-sm transition-colors">
                    {adding ? "Adicionando..." : "Adicionar Horário"}
                  </button>
                </form>
              </>
            )}
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white">Horários Cadastrados ({strategies.length})</h2>
              {strategies.length > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={deleteAllStrategies}
                    className="text-xs px-3 py-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    🗑️ Limpar todos
                  </button>
                  <button
                    onClick={() => {
                      const fmt = (s: { sequence: string; color: string }) => {
                        if (!isDouble && !isFortune) return `${s.sequence} ${parseFloat(s.color)}`
                        const l = s.color.toLowerCase()
                        if (isFortune) {
                          const em = l === "vermelho" ? "❤️" : l === "azul" ? "💙" : "💛"
                          return `${s.sequence} ${em}`
                        }
                        const em = l === "vermelho" ? "🟢" : l === "preto" ? "⚫" : "⚪"
                        return `${s.sequence} ${em}`
                      }
                      const text = strategies
                        .slice().sort((a, b) => a.sequence.localeCompare(b.sequence))
                        .map(fmt).join("\n")
                      navigator.clipboard.writeText(text).then(() => { setCopiedList(true); setTimeout(() => setCopiedList(false), 2000) })
                    }}
                    className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
                  >
                    {copiedList ? "✅ Copiado!" : "📋 Copiar Lista"}
                  </button>
                </div>
              )}
            </div>
            {strategies.length === 0 ? (
              <p className="text-gray-500 text-xs">Nenhum horário cadastrado.</p>
            ) : (
              <div className="space-y-1.5">
                {strategies
                  .slice()
                  .sort((a, b) => a.sequence.localeCompare(b.sequence))
                  .map((s) => (
                  <div key={s.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="text-white font-mono text-sm font-semibold">{s.sequence}</span>
                      <span className="text-sm">
                        {isFortune
                          ? s.color === "VERMELHO" ? "❤️" : s.color === "AZUL" ? "💙" : "💛"
                          : isDouble
                          ? s.color === "VERMELHO" ? "🟢" : s.color === "PRETO" ? "⚫" : "⚪"
                          : `${parseFloat(s.color)}x`}
                      </span>
                      {isDouble && <span className="text-xs text-gray-600">⚪</span>}
                    </div>
                    <button onClick={() => deleteStrategy(s.id)} className="text-gray-500 hover:text-red-400 transition-colors text-base leading-none ml-2">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/* ─── Config Bot Tab ─────────────────────────────────────────── */
function ConfigBotTab({ gameType }: { gameType: string }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saving, setSaving]     = useState(false)
  const [success, setSuccess]   = useState("")

  const [collapsedEntrada, setCollapsedEntrada] = useState(true)
  const [collapsedStop, setCollapsedStop] = useState(true)
  const [collapsedGale, setCollapsedGale] = useState(true)
  const [collapsedAvançado, setCollapsedAvançado] = useState(true)

  useEffect(() => { fetch("/api/user/jonbet/configuracoes").then((r) => r.json()).then(setSettings) }, [])

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((p) => p ? { ...p, [key]: value } : null)
  }

  async function save() {
    if (!settings) return
    setSaving(true); setSuccess("")
    await fetch("/api/user/jonbet/configuracoes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) })
    setSaving(false); setSuccess("Salvo!"); setTimeout(() => setSuccess(""), 3000)
  }

  if (!settings) return <div className="text-gray-400 text-sm py-4">Carregando...</div>

  const inp = "w-full bg-[#0d1117] border border-gray-700/60 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500/60 transition placeholder-gray-600"
  const Toggle = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
    <button type="button" onClick={onToggle}
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 overflow-hidden ${on ? "bg-green-500" : "bg-gray-700"}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 ${on ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  )
  const Pill = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
    <button type="button" onClick={onClick}
      className={`flex-1 py-2 text-xs font-bold tracking-wide rounded-md transition-all ${active ? "bg-green-500 text-black shadow-lg shadow-green-500/20" : "text-gray-500 hover:text-gray-300"}`}>
      {label}
    </button>
  )
  const SectionHeader = ({ icon, title, collapsed, onToggle }: { icon: string; title: string; collapsed?: boolean; onToggle?: () => void }) => (
    <div 
      onClick={onToggle}
      className={`flex items-center gap-2 mb-3 ${onToggle ? "cursor-pointer select-none" : ""}`}
    >
      <span className="text-base">{icon}</span>
      <span className="text-xs font-bold tracking-widest text-gray-500 uppercase">{title}</span>
      <div className="flex-1 h-px bg-gray-800" />
      {onToggle && (
        <span className="text-gray-500 text-[9px] font-extrabold ml-1 bg-gray-950 border border-gray-800 px-2 py-0.5 rounded hover:text-white transition-colors">
          {collapsed ? "ABRIR ▼" : "FECHAR ▲"}
        </span>
      )}
    </div>
  )

  return (
    <div className="space-y-3">

      {/* ── ENTRADA ─────────────────────────────────────── */}
      <div className="bg-[#0a0f1a] border border-gray-800/70 rounded-xl p-4">
        <SectionHeader icon="💰" title="Entrada" collapsed={collapsedEntrada} onToggle={() => setCollapsedEntrada(!collapsedEntrada)} />
        {!collapsedEntrada && (
          <div className="mt-3">
            <div className="flex gap-1 bg-gray-900 rounded-lg p-1 mb-3">
              <Pill label="VALOR FIXO" active={settings.enterType === "VALOR"} onClick={() => update("enterType", "VALOR")} />
              <Pill label="PORCENTAGEM" active={settings.enterType === "PORCENTAGEM"} onClick={() => update("enterType", "PORCENTAGEM")} />
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-green-400 text-xs font-bold select-none">
                {settings.enterType === "PORCENTAGEM" ? "%" : "R$"}
              </span>
              <NumberField step="0.01" min={settings.enterType === "PORCENTAGEM" ? undefined : "0.10"}
                value={settings.enterType === "PORCENTAGEM" ? settings.enterPercent : settings.enterValue}
                onChange={(n) => update(settings.enterType === "PORCENTAGEM" ? "enterPercent" : "enterValue", n)}
                className={`${inp} pl-9`} />
            </div>
          </div>
        )}
      </div>

      {/* ── STOP ────────────────────────────────────────── */}
      <div className="bg-[#0a0f1a] border border-gray-800/70 rounded-xl p-4">
        <SectionHeader icon="🛑" title="Stop" collapsed={collapsedStop} onToggle={() => setCollapsedStop(!collapsedStop)} />
        {!collapsedStop && (
          <div className="mt-3">
            <div className="flex gap-1 bg-gray-900 rounded-lg p-1 mb-3">
              <Pill label="VALOR (R$)" active={settings.stopType === "VALOR"} onClick={() => update("stopType", "VALOR")} />
              <Pill label="QUANTIDADE" active={settings.stopType === "QUANTIDADE"} onClick={() => update("stopType", "QUANTIDADE")} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs text-gray-500 mb-1.5 font-medium">Stop Win</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-green-400 text-xs font-bold select-none">
                    {settings.stopType === "VALOR" ? "R$" : "#"}
                  </span>
                  <input type="number" inputMode="decimal" onFocus={(e) => e.target.select()} step="0.01" value={settings.stopGain}
                    onChange={(e) => update("stopGain", e.target.value)}
                    className={`${inp} pl-9 border-green-900/60 focus:ring-green-500/60`} />
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1.5 font-medium">Stop Loss</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-red-400 text-xs font-bold select-none">
                    {settings.stopType === "VALOR" ? "R$" : "#"}
                  </span>
                  <input type="number" inputMode="decimal" onFocus={(e) => e.target.select()} step="0.01" value={settings.stopLoss}
                    onChange={(e) => update("stopLoss", e.target.value)}
                    className={`${inp} pl-9 border-red-900/60 focus:ring-red-500/60`} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── GALE ────────────────────────────────────────── */}
      <div className="bg-[#0a0f1a] border border-gray-800/70 rounded-xl p-4">
        <SectionHeader icon="🔄" title="Gale" collapsed={collapsedGale} onToggle={() => setCollapsedGale(!collapsedGale)} />
        {!collapsedGale && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <p className="text-xs text-gray-500 mb-1.5 font-medium">Qtd. de Gales</p>
                <NumberField min="0" value={settings.martingale}
                  onChange={(n) => update("martingale", n)}
                  className={inp} />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1.5 font-medium">Multiplicador</p>
                <div className="relative">
                  <NumberField step="0.1" value={settings.martingaleMultiplier}
                    onChange={(n) => update("martingaleMultiplier", n)}
                    className={`${inp} pr-8`} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs font-bold select-none">×</span>
                </div>
              </div>
            </div>

            {(gameType === "DOUBLE" || gameType === "FORTUNE") && (
              <div className="flex items-center justify-between pt-3 border-t border-gray-800/60 mt-3">
                <div>
                  <p className="text-sm text-gray-300 font-medium">
                    {gameType === "FORTUNE" ? "Proteção no Amarelo 💛" : "Proteção no Branco"}
                  </p>
                  <p className="text-xs text-gray-600">
                    {gameType === "FORTUNE" ? "Aposta extra no amarelo por rodada" : "Aposta extra no branco por rodada"}
                  </p>
                </div>
                <Toggle on={settings.protectionHand === "SIM"}
                  onToggle={() => update("protectionHand", settings.protectionHand === "SIM" ? "NÃO" : "SIM")} />
              </div>
            )}
            {(gameType === "DOUBLE" || gameType === "FORTUNE") && settings.protectionHand === "SIM" && (
              <div className="mt-2 space-y-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1.5 font-medium">Valor da Proteção (R$)</p>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400 text-xs font-bold select-none">R$</span>
                    <NumberField step="0.01" value={settings.protectionValue}
                      onChange={(n) => update("protectionValue", n)}
                      className={`${inp} pl-9`} />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1.5 font-medium">
                    {gameType === "FORTUNE" ? "Multiplicador Amarelo" : "Multiplicador Branco"}
                  </p>
                  <div className="relative">
                    <NumberField step="0.1" min="1" value={settings.whiteMultiplier}
                      onChange={(n) => update("whiteMultiplier", n)}
                      className={`${inp} pr-8`} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs font-bold select-none">×</span>
                  </div>
                </div>
              </div>
            )}

            {(gameType === "DOUBLE" || gameType === "FORTUNE") && (
              <div className="flex items-center justify-between pt-3 border-t border-gray-800/60 mt-3">
                <div>
                  <p className="text-sm text-gray-300 font-medium">
                    Gale diferente no {gameType === "FORTUNE" ? "Amarelo 💛" : "Branco"}
                  </p>
                  <p className="text-xs text-gray-600">
                    Usa outro valor de entrada, qtd. de gales e multiplicador quando a entrada principal for {gameType === "FORTUNE" ? "amarelo" : "branco"}
                  </p>
                </div>
                <Toggle on={settings.whiteEntryGaleEnabled}
                  onToggle={() => update("whiteEntryGaleEnabled", !settings.whiteEntryGaleEnabled)} />
              </div>
            )}
            {(gameType === "DOUBLE" || gameType === "FORTUNE") && settings.whiteEntryGaleEnabled && (
              <div className="mt-2 space-y-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1.5 font-medium">
                    Valor de Entrada ({gameType === "FORTUNE" ? "Amarelo" : "Branco"})
                  </p>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-green-400 text-xs font-bold select-none">
                      R$
                    </span>
                    <NumberField step="0.01" min="0.10"
                      value={settings.whiteEntryValue}
                      onChange={(n) => update("whiteEntryValue", n)}
                      className={`${inp} pl-9`} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5 font-medium">
                      Qtd. de Gales ({gameType === "FORTUNE" ? "Amarelo" : "Branco"})
                    </p>
                    <NumberField min="0" value={settings.whiteEntryGale}
                      onChange={(n) => update("whiteEntryGale", n)}
                      className={inp} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5 font-medium">
                      Multiplicador ({gameType === "FORTUNE" ? "Amarelo" : "Branco"})
                    </p>
                    <div className="relative">
                      <NumberField step="0.1" value={settings.whiteEntryGaleMultiplier}
                        onChange={(n) => update("whiteEntryGaleMultiplier", n)}
                        className={`${inp} pr-8`} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs font-bold select-none">×</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── AVANÇADO ────────────────────────────────────── */}
      <div className="bg-[#0a0f1a] border border-gray-800/70 rounded-xl p-4">
        <SectionHeader icon="⚙️" title="Avançado" collapsed={collapsedAvançado} onToggle={() => setCollapsedAvançado(!collapsedAvançado)} />
        {!collapsedAvançado && (
          <div className="mt-3 space-y-4">
            <div>
              <p className="text-xs text-gray-500 mb-1.5 font-medium">Quantidade de Ciclos</p>
              <NumberField min="1" value={settings.quantityCycles}
                onChange={(n) => update("quantityCycles", n)}
                className={inp} />
            </div>

            <div className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
              settings.skipFirstEntry ? "bg-amber-500/8 border-amber-500/30" : "bg-gray-900/60 border-gray-800"
            }`}>
              <div>
                <p className={`text-sm font-semibold ${settings.skipFirstEntry ? "text-amber-300" : "text-gray-300"}`}>
                  Pular Primeira Entrada
                </p>
                <p className="text-xs text-gray-600 mt-0.5">
                  {settings.skipFirstEntry ? "Observa 1ª rodada antes de apostar" : "Entra direto ao detectar o sinal"}
                </p>
              </div>
              <Toggle on={settings.skipFirstEntry}
                onToggle={() => setSettings((prev) => prev ? { ...prev, skipFirstEntry: !prev.skipFirstEntry, ...(!prev.skipFirstEntry ? { skipEntryAfterLoss: false } : {}) } : null)} />
            </div>

            <div className={`flex items-center justify-between p-3 rounded-lg border transition-all mt-3 ${
              settings.skipEntryAfterLoss ? "bg-amber-500/8 border-amber-500/30" : "bg-gray-900/60 border-gray-800"
            }`}>
              <div>
                <p className={`text-sm font-semibold ${settings.skipEntryAfterLoss ? "text-amber-300" : "text-gray-300"}`}>
                  Entrada Após Loss
                </p>
                <p className="text-xs text-gray-600 mt-0.5">
                  Em toda entrada, simula a sequência de gale antes de entrar de verdade
                </p>
              </div>
              <Toggle on={settings.skipEntryAfterLoss}
                onToggle={() => setSettings((prev) => prev ? { ...prev, skipEntryAfterLoss: !prev.skipEntryAfterLoss, ...(!prev.skipEntryAfterLoss ? { skipFirstEntry: false } : {}) } : null)} />
            </div>
          </div>
        )}
      </div>

      {success && (
        <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-green-400 text-sm">
          <span className="text-base">✅</span> Configurações salvas com sucesso!
        </div>
      )}

      <button onClick={save} disabled={saving}
        className="w-full bg-green-500 hover:bg-green-400 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold py-3 rounded-xl transition-all text-sm tracking-wide shadow-lg shadow-green-500/20">
        {saving ? "Salvando..." : "Salvar Configurações"}
      </button>
    </div>
  )
}

/* ─── Bot Tab ────────────────────────────────────────────────── */
// Acha a % de acerto salva na ferramenta Premium pro padrão que gerou essa
// entrada, se o cliente tiver esse padrão específico salvo lá.
function findEntryHitRate(entry: LogEntry, isCrash: boolean, gameType?: string): number | null {
  if (!entry.pattern || entry.strategyType !== "SEQUÊNCIA") return null
  try {
    if (isCrash) {
      const raw = localStorage.getItem("jonbet_premium_crash_active_patterns")
      if (!raw) return null
      const saved: Array<{ label: string; target: number; hitRate: number }> = JSON.parse(raw)
      const target = parseFloat((entry.color ?? "").replace(/x$/i, ""))
      const match = saved.find((p) => {
        const converted = p.label.split(",").map((v) => (v === "H" ? "V" : "R")).join(",")
        return converted === entry.pattern && Math.abs(p.target - target) < 0.001
      })
      return match ? match.hitRate : null
    } else {
      const key = gameType === "FORTUNE" ? "jonbet_premium_fortune_active_patterns" : "jonbet_premium_double_active_patterns"
      const raw = localStorage.getItem(key)
      if (!raw) return null
      const saved: Array<{ sequence: string; betColor: string; hitRate: number }> = JSON.parse(raw)
      const match = saved.find((p) => p.sequence === entry.pattern && p.betColor === entry.color)
      return match ? match.hitRate : null
    }
  } catch {
    return null
  }
}

function EntryCard({ entry, gameType }: { entry: LogEntry; gameType?: string }) {
  const resolved = entry.resolved
  const gale     = entry.gale ?? 0
  const maxGale  = entry.maxGale ?? 0
  const isGale   = gale > 0
  const isWin    = resolved && !!entry.resultWin
  const isCrash  = /^\d+([.,]\d+)?[xX]$/.test(entry.color ?? "")
  const hitRate  = findEntryHitRate(entry, isCrash, gameType)

  const borderCls = !resolved
    ? isGale
      ? "border-orange-500/25 bg-orange-500/5"
      : "border-blue-500/20 bg-blue-500/5"
    : isWin
    ? "border-emerald-500/30 bg-emerald-500/5"
    : "border-red-500/25 bg-red-500/5"

  const galeDots = maxGale > 0 ? (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      {Array.from({ length: maxGale }, (_, i) => {
        const n = i + 1
        const cls =
          n < gale                  ? "bg-red-500/60"
          : n === gale && !resolved ? "bg-orange-400 animate-pulse"
          : n === gale && isWin     ? "bg-emerald-400"
          : n === gale              ? "bg-red-500/80"
          : "bg-gray-700"
        return <span key={i} className={`inline-block w-1.5 h-1.5 rounded-full ${cls}`} />
      })}
    </div>
  ) : null

  return (
    <div className={`flex flex-col gap-1.5 py-2.5 px-3 border rounded-xl ${borderCls}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 font-mono w-16 flex-shrink-0">{entry.time}</span>

        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded leading-tight flex-shrink-0 ${
          isGale ? "text-orange-400 bg-orange-500/20" : "text-blue-400 bg-blue-500/15"
        }`}>
          {isGale ? `G${gale}/${maxGale}` : "ENTRADA"}
        </span>

        {isCrash ? (
          <span className="text-xs font-bold text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded flex-shrink-0">
            🚀 {entry.color}
          </span>
        ) : (
          <>
            <EntryColorDot color={entry.color} />
            <span className="text-xs text-white font-semibold">{entry.color}</span>
          </>
        )}

        <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
          R$ {(entry.initialAmount ?? entry.amount)?.toFixed(2) ?? "—"}
          {(entry.protectionValue ?? 0) > 0 && (
            <span className="text-gray-500"> + 🛡️ R$ {entry.protectionValue!.toFixed(2)}</span>
          )}
        </span>
      </div>

      {entry.pattern && (
        <div className="ml-16 flex items-center gap-1 flex-wrap">
          <span className="text-xs text-gray-600">📋</span>
          {/^\d{1,2}:\d{2}$/.test(entry.pattern.trim())
            ? <span className="text-xs text-gray-400 font-mono">{entry.pattern}</span>
            : entry.pattern.split(",").map((item, i) => (
                <SeqBall key={i} item={item.trim()} />
              ))
          }
          {entry.strategyType && (
            <span className="text-xs text-gray-700 ml-1">({entry.strategyType})</span>
          )}
          {hitRate != null && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ml-1 ${
              hitRate >= 0.7 ? "text-green-400 bg-green-500/10" : hitRate >= 0.5 ? "text-yellow-400 bg-yellow-500/10" : "text-red-400 bg-red-500/10"
            }`}>
              👑 {(hitRate * 100).toFixed(1)}%
            </span>
          )}
          {entry.accuracy != null && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ml-1 ${
              entry.accuracy >= 70 ? "text-green-400 bg-green-500/10" : entry.accuracy >= 50 ? "text-yellow-400 bg-yellow-500/10" : "text-red-400 bg-red-500/10"
            }`} title="Taxa de acerto desse padrão nas últimas 24h">
              🎯 {entry.accuracy.toFixed(1)}%
            </span>
          )}
        </div>
      )}

      {resolved ? (
        <div className="ml-16 flex items-center gap-2">
          {galeDots}
          {entry.resultColor === "cancelado" ? (
            <span className="text-xs font-bold text-gray-400 bg-gray-500/15 px-1.5 py-0.5 rounded">CANCELADO</span>
          ) : (
            <>
              {isCrash ? (
                <span className="text-xs font-semibold text-gray-300">{entry.resultColor}</span>
              ) : (
                <>
                  <ResultColorDot color={entry.resultColor} />
                  <span className="text-xs text-gray-400">{entry.resultColor}</span>
                </>
              )}
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                isWin ? "text-emerald-400 bg-emerald-500/15" : "text-red-400 bg-red-500/15"
              }`}>
                {isWin ? "✓ WIN" : "✗ LOSS"}
              </span>
              {entry.resultProfit != null && Number.isFinite(Number(entry.resultProfit)) && (
                <span className={`text-xs font-bold ml-auto flex-shrink-0 ${isWin ? "text-emerald-400" : "text-red-400"}`}>
                  {isWin ? "+" : ""}R$ {Number(entry.resultProfit).toFixed(2)}
                </span>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="ml-16 flex items-center gap-1.5">
          {galeDots && <div className="mr-1">{galeDots}</div>}
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-xs text-blue-400/70">apostando...</span>
          {isGale && entry.amount !== undefined && (
            <span className="text-xs text-gray-500 ml-auto">R$ {Number(entry.amount ?? 0).toFixed(2)}</span>
          )}
        </div>
      )}
    </div>
  )
}

function LogRow({ entry, gameType }: { entry: LogEntry; gameType?: string }) {
  if (entry.type === "AGUARDANDO") return null
  if (entry.type === "INFO") return (
    <div className="flex items-start gap-2.5 py-2 px-3 bg-gray-500/5 border border-gray-700/40 rounded-lg">
      <span className="text-xs text-gray-500 font-mono w-16 flex-shrink-0 pt-0.5">{entry.time}</span>
      <span className="text-xs text-gray-400 leading-relaxed">{entry.pattern}</span>
    </div>
  )
  if (entry.type === "ENTRADA" || entry.type === "GALE") return <EntryCard entry={entry} gameType={gameType} />
  if (entry.type === "WIN" || entry.type === "LOSS") return null
  if (entry.type === "STOP_WIN") return (
    <div className="flex items-center gap-2.5 py-2.5 px-3 bg-yellow-500/5 border border-yellow-500/30 rounded-lg">
      <span className="text-xs text-gray-500 font-mono w-16 flex-shrink-0">{entry.time}</span>
      <span className="text-xs font-bold text-yellow-300 bg-yellow-500/20 px-2 py-0.5 rounded flex-shrink-0">🏆 STOP WIN</span>
      {entry.profit != null && Number.isFinite(Number(entry.profit)) && <span className="text-xs font-bold text-yellow-300 ml-auto">+R$ {Number(entry.profit).toFixed(2)}</span>}
    </div>
  )
  if (entry.type === "STOP_LOSS") return (
    <div className="flex items-center gap-2.5 py-2.5 px-3 bg-orange-500/5 border border-orange-500/30 rounded-lg">
      <span className="text-xs text-gray-500 font-mono w-16 flex-shrink-0">{entry.time}</span>
      <span className="text-xs font-bold text-orange-400 bg-orange-500/20 px-2 py-0.5 rounded flex-shrink-0">🛑 STOP LOSS</span>
      {entry.profit != null && Number.isFinite(Number(entry.profit)) && <span className="text-xs font-bold text-orange-400 ml-auto">-R$ {Number(entry.profit).toFixed(2)}</span>}
    </div>
  )
  if (entry.type === "STOP_SALDO") return (
    <div className="flex items-center gap-2.5 py-2.5 px-3 bg-red-500/5 border border-red-500/30 rounded-lg">
      <span className="text-xs text-gray-500 font-mono w-16 flex-shrink-0">{entry.time}</span>
      <span className="text-xs font-bold text-red-400 bg-red-500/20 px-2 py-0.5 rounded flex-shrink-0">⚠️ SALDO INSUFICIENTE</span>
      <span className="text-xs text-red-400 ml-auto flex-shrink-0">Bot parado</span>
    </div>
  )
  return null
}

function IniciaBotTab({ jonbetAccountType, gameType, onBotStateChange }: { jonbetAccountType: string; gameType: string; onBotStateChange?: (active: boolean) => void }) {
  const [isActive, setIsActive]     = useState(false)
  const [isBetting, setIsBetting]   = useState(false)
  const [settings, setSettings]     = useState<Settings | null>(null)
  const [variables, setVariables]   = useState<Variables | null>(null)
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const [loading, setLoading]       = useState(true)
  const [acting, setActing]         = useState(false)
  const [botError, setBotError]     = useState("")
  const [stopPending, setStopPending] = useState(false)

  async function fetchState() {
    try {
      const [meRes, histRes, cfgRes] = await Promise.all([
        fetch("/api/user/me", { cache: "no-store" }),
        fetch("/api/user/jonbet", { cache: "no-store" }),
        fetch("/api/user/jonbet/configuracoes", { cache: "no-store" }),
      ])
      if (meRes.ok) {
        const data = await meRes.json()
        const active = !!data.jonbetIsActive
        setIsActive(active)
        onBotStateChange?.(active)
        setIsBetting(!!data.jonbetIsBetting)
        // Só libera o botão quando o bot realmente parou no servidor
        if (!active) setStopPending(false)
      }
      if (histRes.ok) {
        const h = await histRes.json()
        if (Array.isArray(h.history)) setLogEntries(h.history)
        setVariables(h.variables ?? null)
      }
      if (cfgRes.ok) {
        const cfg = await cfgRes.json()
        setSettings(cfg)
      }
    } catch {}
    setLoading(false)
  }

  useEffect(() => { fetchState() }, [])
  // Poll enquanto bot ativo OU finalizando entrada (botão bloqueado)
  useEffect(() => {
    if (!isActive && !stopPending) return
    const iv = setInterval(fetchState, 2000)
    return () => clearInterval(iv)
  }, [isActive, stopPending])

  // Refresh real-time balance from Jonbet API (same as Blaze does)
  useEffect(() => {
    async function refreshBalance() {
      try {
        const res = await fetch("/api/user/jonbet/balance", { cache: "no-store" })
        if (res.ok) {
          const data = await res.json()
          setVariables((prev) => prev ? { ...prev, balance: data.balance } : null)
        }
      } catch {}
    }
    if (jonbetAccountType !== "DEMO") {
      refreshBalance()
      const iv = setInterval(refreshBalance, 30000)
      return () => clearInterval(iv)
    }
  }, [jonbetAccountType])

  async function handleStart() {
    setBotError(""); setActing(true)
    try {
      const res = await fetch("/api/user/jonbet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }), signal: AbortSignal.timeout(15000) })
      const data = await res.json()
      if (!res.ok) { setBotError(data.error ?? "Erro ao iniciar o bot"); return }
      setIsActive(true)
      onBotStateChange?.(true)
      setStopPending(false)
      setIsBetting(false)
      // Painel da sessão zera; relatório do mês fica na tela Início
      setLogEntries([])
      setVariables((prev) => prev ? {
        ...prev,
        countWin: 0,
        countLoss: 0,
        countMartingale: 0,
        isGale: false,
        profit: 0,
      } : prev)
      await fetchState()
    } catch {
      setBotError("Sem resposta do servidor. Tente novamente em instantes.")
    } finally {
      setActing(false)
    }
  }

  async function handleStop() {
    setBotError(""); setActing(true)

    const openEntry = logEntries.some(
      (e) => (e.type === "ENTRADA" || e.type === "GALE") && !e.resolved
    )
    const midEntry = isBetting || openEntry

    // Bloqueia na hora se há entrada em andamento
    if (midEntry) {
      setStopPending(true)
      setIsActive(true)
      onBotStateChange?.(true)
    }

    try {
      const res = await fetch("/api/user/jonbet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
        signal: AbortSignal.timeout(15000),
      })
      const data = await res.json().catch(() => null)
      if (data?.pendingStop || midEntry || data?.isActive) {
        if (data?.pendingStop || midEntry) setStopPending(true)
        setIsActive(true)
        onBotStateChange?.(true)
        await fetchState()
        return
      }
    } catch {
      if (midEntry || stopPending) {
        setStopPending(true)
        setIsActive(true)
        onBotStateChange?.(true)
        return
      }
      setBotError("Sem resposta do servidor ao parar — verifique se o bot realmente parou.")
    } finally {
      setActing(false)
    }
    setIsActive(false); onBotStateChange?.(false); setIsBetting(false); setStopPending(false)
    await fetchState()
  }

  async function handleResetHistory() {
    await fetch("/api/user/jonbet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset-history" }) })
    setLogEntries([])
  }

  if (loading) return <div className="text-gray-400 text-sm py-4">Carregando...</div>

  const s = settings
  const entryDisplay = s ? (s.enterType === "PORCENTAGEM" ? `${s.enterPercent}% da banca` : `R$ ${Number(s.enterValue).toFixed(2)}`) : "—"
  const actualBalance = Number(variables?.balance ?? 0)
  const hasData = actualBalance > 0 || (variables && Number(variables.firstBalance) > 0)
  const balanceDisplay = hasData ? `R$ ${actualBalance.toFixed(2)}` : jonbetAccountType === "DEMO" ? "R$ 1.000,00" : "—"
  const profitColor = (variables?.profit ?? 0) >= 0 ? "text-green-400" : "text-red-400"

  return (
    <div className="space-y-5">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Resumo da Configuração</h2>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Tipo de Estratégia</span>
            <span className="text-xs font-semibold text-white">{s?.strategyType ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Jogo</span>
            <span className="text-xs font-semibold text-white">{gameType}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Modo de Operação</span>
            <span className={`text-xs font-semibold ${jonbetAccountType === "REAL" ? "text-green-400" : "text-yellow-400"}`}>
              {jonbetAccountType === "REAL" ? "CONTA REAL" : "CONTA DEMO"}
            </span>
          </div>
          <div className="h-px bg-gray-800" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Valor de Entrada</span>
            <span className="text-xs font-semibold text-white">{entryDisplay}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Qtd. de Gales</span>
            <span className="text-xs font-semibold text-white">
              {s?.martingale ?? 0} {s?.martingale ? `(Mult. ${Number(s.martingaleMultiplier).toFixed(1)}x)` : ""}
            </span>
          </div>
          {(gameType === "DOUBLE" || gameType === "FORTUNE") && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {gameType === "FORTUNE" ? "Proteção no Amarelo 💛" : "Proteção no Branco"}
              </span>
              <span className="text-xs font-semibold text-white">
                {s?.protectionHand === "SIM" ? "SIM" : "NÃO"}
                {s?.protectionHand === "SIM" && s.protectionValue > 0 && (
                  <span className="text-gray-400 font-normal ml-1">
                    (R$ {Number(s.protectionValue).toFixed(2)} - Mult. {Number(s.whiteMultiplier).toFixed(1)}x)
                  </span>
                )}
              </span>
            </div>
          )}
          {(gameType === "DOUBLE" || gameType === "FORTUNE") && s?.whiteEntryGaleEnabled && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">
                Gale no {gameType === "FORTUNE" ? "Amarelo 💛" : "Branco"}
              </span>
              <span className="text-xs font-semibold text-white">
                R$ {Number(s.whiteEntryValue).toFixed(2)} | {s.whiteEntryGale} Gales | Mult. {Number(s.whiteEntryGaleMultiplier).toFixed(1)}x
              </span>
            </div>
          )}
          <div className="h-px bg-gray-800" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Ciclos do Robô</span>
            <span className="text-xs font-semibold text-white">{s?.quantityCycles ?? 1}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Pular 1ª Entrada</span>
            <span className={`text-xs font-semibold ${s?.skipFirstEntry ? "text-green-400" : "text-gray-500"}`}>
              {s?.skipFirstEntry ? "ATIVADO" : "DESATIVADO"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Entrada Após Loss</span>
            <span className={`text-xs font-semibold ${s?.skipEntryAfterLoss ? "text-green-400" : "text-gray-500"}`}>
              {s?.skipEntryAfterLoss ? "ATIVADO" : "DESATIVADO"}
            </span>
          </div>
          <div className="h-px bg-gray-800" />
          {s?.stopType === "QUANTIDADE" ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Stop Win (Quantidade)</span>
                <span className="text-xs font-semibold text-green-400">
                  {variables?.countWin ?? 0}/{s?.stopGain ?? "—"}
                  <span className="text-gray-500 font-normal ml-1">
                    (faltam {Math.max(0, Number(s?.stopGain ?? 0) - (variables?.countWin ?? 0))})
                  </span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Stop Loss (Quantidade)</span>
                <span className="text-xs font-semibold text-red-400">
                  {variables?.countLoss ?? 0}/{s?.stopLoss ?? "—"}
                  <span className="text-gray-500 font-normal ml-1">
                    (faltam {Math.max(0, Number(s?.stopLoss ?? 0) - (variables?.countLoss ?? 0))})
                  </span>
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Stop Win (Meta de Lucro)</span>
                <span className="text-xs font-semibold text-green-400">R$ {Number(s?.stopGain ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Stop Loss (Limite de Perda)</span>
                <span className="text-xs font-semibold text-red-400">R$ {Number(s?.stopLoss ?? 0).toFixed(2)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {variables && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Sessão Atual</h2>
            {(isActive || stopPending) ? (
              <span className="flex items-center gap-1.5 text-xs text-green-400"><span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />{stopPending ? "Finalizando entrada..." : isBetting ? "Apostando..." : "Aguardando..."}</span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-gray-500"><span className="w-2 h-2 rounded-full bg-gray-600" />Parado</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 bg-gray-800 rounded-lg p-3"><p className="text-xs text-gray-400 mb-0.5">Banca</p><p className="text-white font-bold text-base">{balanceDisplay}</p></div>
            <div className="col-span-2 bg-gray-800 rounded-lg p-3"><p className="text-xs text-gray-400 mb-0.5">Lucro</p><p className={`font-bold text-base ${profitColor}`}>{Number(variables.profit) >= 0 ? "+" : ""}R$ {Number(variables.profit).toFixed(2)}</p></div>
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3"><p className="text-xs text-gray-400 mb-0.5">Vitórias</p><p className="text-green-400 font-bold text-base">{variables.countWin}</p></div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3"><p className="text-xs text-gray-400 mb-0.5">Derrotas</p><p className="text-red-400 font-bold text-base">{variables.countLoss}</p></div>
          </div>
          {variables.isGale && (
            <div className="mt-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-yellow-400 text-xs font-medium">Em Gale</span>
              <span className="text-yellow-300 text-xs font-bold">{variables.countMartingale}/{s?.martingale ?? "?"}</span>
            </div>
          )}
        </div>
      )}

      {botError && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">{botError}</div>}

      {stopPending && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 text-yellow-400 text-sm">
          ⏸️ Estou no meio de uma entrada — assim que sair o resultado (WIN ou LOSS), vou parar o sistema e todas as operações.
        </div>
      )}

      {(isActive || stopPending) ? (
        <button onClick={handleStop} disabled={acting || stopPending}
          className="w-full bg-red-500 hover:bg-red-400 disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none text-white font-bold py-3 rounded-xl text-sm transition-colors">
          {stopPending ? "Finalizando entrada..." : acting ? "Parando..." : "Parar Bot Jonbet"}
        </button>
      ) : (
        <button onClick={handleStart} disabled={acting || stopPending}
          className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none text-black font-bold py-3 rounded-xl text-sm transition-colors">
          {acting ? "Iniciando..." : "Iniciar Bot Jonbet"}
        </button>
      )}

      {/* Histórico */}
      {logEntries.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Histórico</h2>
            <button onClick={handleResetHistory} className="text-xs text-gray-500 hover:text-red-400 transition-colors">Limpar</button>
          </div>
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {logEntries.map((entry) => <LogRow key={entry.id} entry={entry} gameType={gameType} />)}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Main Page ──────────────────────────────────────────────── */
type Tab = "conta" | "estrategias" | "config" | "bot"

export default function JonbetPage() {
  const [activeTab, setActiveTab]           = useState<Tab>("conta")
  const [botActive, setBotActive]           = useState(false)
  const [jonbetAccountType, setJonbetAccountType] = useState("DEMO")
  const [jonbetGameType, setJonbetGameType]       = useState("DOUBLE")
  const [hasJonbetToken, setHasJonbetToken] = useState(false)
  const [jonbetEmail, setJonbetEmail]       = useState<string | null>(null)
  const [loading, setLoading]               = useState(true)
  const [licensed, setLicensed]             = useState(true)

  useEffect(() => {
    fetch("/api/user/me").then((r) => r.json()).then((data) => {
      setJonbetAccountType(data.jonbetAccountType ?? "DEMO")
      setJonbetGameType(data.jonbetGameType ?? "DOUBLE")
      setHasJonbetToken(!!data.hasJonbetToken)
      setJonbetEmail(data.jonbetEmail ?? null)
      setBotActive(!!data.jonbetIsActive)
      if (data.jonbetIsActive) setActiveTab("bot")
      const isPaid = data.paymentStatus === "PAID" && (!data.expireIn || new Date(data.expireIn) > new Date())
      setLicensed(isPaid || !!data.isTesting || !!data.isAdminAccount)
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-gray-400">Carregando...</div>

  if (!licensed) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="text-4xl">🔒</div>
          <h2 className="text-xl font-bold text-white">Assinatura Necessária</h2>
          <p className="text-gray-400 text-sm">Ative sua licença na aba <a href="/licenca" className="text-green-400 underline">Licença</a> para usar o bot Jonbet.</p>
        </div>
      </div>
    )
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "conta",       label: "Conta Jonbet"  },
    { key: "estrategias", label: "Estratégias"   },
    { key: "config",      label: "Config. Bot"   },
    { key: "bot",         label: "Iniciar Bot"   },
  ]

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
      <div className="space-y-4">
        {/* Tab nav */}
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
          {tabs.map((t) => {
            const locked = botActive && t.key !== "bot"
            return (
              <button key={t.key} onClick={() => { if (!locked) setActiveTab(t.key) }}
                title={locked ? "Pare o bot para acessar esta aba" : undefined}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === t.key ? "bg-green-500 text-black"
                  : locked ? "text-gray-600 cursor-not-allowed opacity-40"
                  : "text-gray-400 hover:text-white hover:bg-gray-800"
                }`}>
                {t.label}
              </button>
            )
          })}
        </div>

        {activeTab === "conta" && (
          <ContaJonbetTab
            jonbetAccountType={jonbetAccountType}
            jonbetGameType={jonbetGameType}
            hasJonbetToken={hasJonbetToken}
            jonbetEmail={jonbetEmail}
            onDisconnect={() => setHasJonbetToken(false)}
            onConnect={() => setHasJonbetToken(true)}
          />
        )}
        {activeTab === "estrategias" && <EstrategiasTab gameType={jonbetGameType} />}
        {activeTab === "config"      && <ConfigBotTab gameType={jonbetGameType} />}
        {activeTab === "bot"         && <IniciaBotTab jonbetAccountType={jonbetAccountType} gameType={jonbetGameType} onBotStateChange={setBotActive} />}
      </div>

      {/* Live panel */}
      <LiveGamePanel gameType={jonbetGameType} />
    </div>
  )
}
