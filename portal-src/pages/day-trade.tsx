import { useEffect, useState, useCallback, useRef } from "react"

type Tab = "conta" | "estrategias" | "config" | "bot"
type AccountType = "DEMO" | "REAL"

interface DtSettings {
  strategyType: string
  enterType: string
  /** number | string — string vazia enquanto digita (igual Blaze) */
  enterValue: number | string
  enterPercent: number
  stopType: string
  stopGain: string
  stopLoss: string
  martingale: number | string
  martingaleMultiplier: number | string
  expirationMinutes: number
  minPayout: number
  defaultAsset: string
  /** Ativos selecionados (multi) */
  selectedAssets: string[]
  quantityCycles: number | string
  skipFirstEntry?: boolean
  skipEntryAfterLoss?: boolean
}

/** Campo numérico igual Blaze: select no foco, digita livre, min só no blur */
function numInputProps(opts: {
  value: number | string
  onChange: (raw: string | number) => void
  onBlurClamp?: (n: number) => number
  min?: number
  step?: string
  className?: string
}) {
  const { value, onChange, onBlurClamp, min, step = "any", className } = opts
  return {
    type: "text" as const,
    inputMode: "decimal" as const,
    step,
    min,
    // text + inputMode decimal: digita 100 sem o browser “prender” no min
    value: value === undefined || value === null ? "" : String(value),
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => e.target.select(),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      // só dígitos, vírgula e ponto (e vazio)
      const raw = e.target.value.replace(/[^\d.,\-]/g, "")
      onChange(raw)
    },
    onBlur: () => {
      let n = parseFloat(String(value).replace(",", "."))
      if (!Number.isFinite(n)) n = min != null ? min : 0
      if (onBlurClamp) n = onBlurClamp(n)
      else if (min != null && n < min) n = min
      onChange(n)
    },
    className,
  }
}

interface DtVars {
  balance: number
  profit: number
  countWin: number
  countLoss: number
  countMartingale: number
  isGale: boolean
}

interface Strategy {
  id: number
  sequence: string
  color: string
  asset: string
  expirationMinutes: number
  strategyType: string
}

interface Entry {
  id: number
  type: string
  asset?: string
  direction?: string
  amount?: number
  result?: string
  profit?: number
  pattern?: string
  mode?: string
  createdAt?: string
}

/** Card de histórico no padrão Blaze/Jonbet */
interface LogEntry {
  id: string
  time: string
  type: "ENTRADA" | "GALE" | "OBSERVING" | "INFO" | "STOP_WIN" | "STOP_LOSS" | "STOP_SALDO" | string
  color?: string | null
  amount?: number | null
  initialAmount?: number | null
  pattern?: string | null
  strategyType?: string | null
  mode?: string
  asset?: string
  resolved?: boolean
  resultWin?: boolean | null
  resultColor?: string | null
  resultProfit?: number | null
  gale?: number
  maxGale?: number
  profit?: number | null
  statusLabel?: string | null
  obsOnly?: boolean
}

function fmtMoney(v: unknown, digits = 2): string {
  if (v == null || v === "") return "—"
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."))
  if (!Number.isFinite(n)) return "—"
  return n.toFixed(digits)
}

function DayTradeEntryCard({ entry }: { entry: LogEntry }) {
  const resolved = !!entry.resolved
  const isObs = entry.type === "OBSERVING" || !!entry.obsOnly
  const isWin = resolved && !!entry.resultWin
  const isDraw = resolved && String(entry.resultColor || "").toUpperCase() === "EMPATE"
  const dir = String(entry.color || "").toUpperCase()
  const isCall = dir === "CALL"
  const isPut = dir === "PUT"
  const gale = entry.gale ?? 0
  const maxGale = entry.maxGale ?? 0
  const isGale = gale > 0 || entry.type === "GALE"

  const borderCls = !resolved
    ? isObs
      ? "border-violet-500/25 bg-violet-500/5"
      : isGale
        ? "border-orange-500/25 bg-orange-500/5"
        : "border-blue-500/20 bg-blue-500/5"
    : isObs
      ? isWin
        ? "border-gray-600/40 bg-gray-800/40"
        : "border-violet-500/20 bg-violet-500/5"
      : isDraw
        ? "border-gray-500/30 bg-gray-500/5"
        : isWin
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-red-500/25 bg-red-500/5"

  const badge = isObs
    ? { text: "SINAL", cls: "text-violet-300 bg-violet-500/20" }
    : isGale
      ? { text: maxGale > 0 ? `G${gale}/${maxGale}` : "GALE", cls: "text-orange-400 bg-orange-500/20" }
      : { text: "ENTRADA", cls: "text-blue-400 bg-blue-500/15" }

  // bolinhas de gale (igual Blaze)
  const galeDots =
    maxGale > 0 ? (
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {Array.from({ length: maxGale }, (_, i) => {
          const n = i + 1
          const cls =
            n < gale
              ? "bg-red-500/60"
              : n === gale && !resolved
                ? "bg-orange-400 animate-pulse"
                : n === gale && isWin
                  ? "bg-emerald-400"
                  : n === gale
                    ? "bg-red-500/80"
                    : "bg-gray-700"
          return <span key={i} className={`inline-block w-1.5 h-1.5 rounded-full ${cls}`} />
        })}
      </div>
    ) : null

  return (
    <div className={`flex flex-col gap-1.5 py-2.5 px-3 border rounded-xl ${borderCls}`}>
      {/* Linha 1: horário + badge + CALL/PUT + valor */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 font-mono w-16 flex-shrink-0">
          {entry.time || "--:--:--"}
        </span>
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded leading-tight flex-shrink-0 ${badge.cls}`}
        >
          {badge.text}
        </span>
        <span
          className={`text-xs font-bold px-2 py-0.5 rounded flex-shrink-0 ${
            isCall
              ? "text-emerald-400 bg-emerald-500/15"
              : isPut
                ? "text-red-400 bg-red-500/15"
                : "text-white bg-gray-700"
          }`}
        >
          {dir || "—"}
        </span>
        {entry.mode && (
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
              entry.mode === "REAL"
                ? "text-red-400 bg-red-500/10"
                : "text-amber-300 bg-amber-500/10"
            }`}
          >
            {entry.mode}
          </span>
        )}
        <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
          {entry.amount != null || entry.initialAmount != null
            ? `$ ${fmtMoney(entry.amount ?? entry.initialAmount)}`
            : isObs
              ? "sem aposta"
              : "—"}
        </span>
      </div>

      {/* Linha 2: padrão / ativo */}
      {entry.pattern && (
        <div className="ml-16 flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-600">📋</span>
          <span className="text-xs text-gray-400 font-mono break-all">{entry.pattern}</span>
        </div>
      )}

      {/* Linha 3: status / resultado */}
      {resolved ? (
        <div className="ml-16 flex items-center gap-2">
          {galeDots}
          {isObs ? (
            <span className="text-xs font-bold text-gray-400 bg-gray-500/15 px-1.5 py-0.5 rounded">
              {isWin ? "obs. teria WIN — reset" : "obs. encerrada"}
            </span>
          ) : entry.resultColor === "cancelado" ? (
            <span className="text-xs font-bold text-gray-400 bg-gray-500/15 px-1.5 py-0.5 rounded">
              ENCERRADO
            </span>
          ) : (
            <>
              <span
                className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                  isDraw
                    ? "text-gray-300 bg-gray-500/15"
                    : isWin
                      ? "text-emerald-400 bg-emerald-500/15"
                      : "text-red-400 bg-red-500/15"
                }`}
              >
                {isDraw ? "EMPATE" : isWin ? "✓ WIN" : "✗ LOSS"}
              </span>
              {entry.resultProfit != null && Number.isFinite(Number(entry.resultProfit)) && (
                <span
                  className={`text-xs font-bold ml-auto flex-shrink-0 ${
                    Number(entry.resultProfit) >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {Number(entry.resultProfit) >= 0 ? "+" : ""}
                  $ {Number(entry.resultProfit).toFixed(2)}
                </span>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="ml-16 flex items-center gap-1.5">
          {galeDots && <div className="mr-1">{galeDots}</div>}
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full animate-pulse ${
              isObs ? "bg-violet-400" : isGale ? "bg-orange-400" : "bg-blue-400"
            }`}
          />
          <span
            className={`text-xs ${
              isObs ? "text-violet-300/80" : isGale ? "text-orange-300/80" : "text-blue-400/70"
            }`}
          >
            {entry.statusLabel ||
              (isObs ? "observando (sem aposta)…" : "aguardando resultado...")}
          </span>
        </div>
      )}
    </div>
  )
}

function DayTradeLogRow({ entry }: { entry: LogEntry }) {
  if (entry.type === "INFO") {
    return (
      <div className="flex items-start gap-2.5 py-2 px-3 bg-gray-500/5 border border-gray-700/40 rounded-lg">
        <span className="text-xs text-gray-500 font-mono w-16 flex-shrink-0 pt-0.5">
          {entry.time || "--:--:--"}
        </span>
        <span className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">
          {entry.pattern}
        </span>
      </div>
    )
  }
  if (entry.type === "ENTRADA" || entry.type === "GALE" || entry.type === "OBSERVING") {
    return <DayTradeEntryCard entry={entry} />
  }
  if (entry.type === "STOP_WIN") {
    return (
      <div className="flex items-center gap-2.5 py-2.5 px-3 bg-yellow-500/5 border border-yellow-500/30 rounded-lg">
        <span className="text-xs text-gray-500 font-mono w-16 flex-shrink-0">{entry.time}</span>
        <span className="text-xs font-bold text-yellow-300 bg-yellow-500/20 px-2 py-0.5 rounded">
          🏆 STOP WIN
        </span>
      </div>
    )
  }
  if (entry.type === "STOP_LOSS") {
    return (
      <div className="flex items-center gap-2.5 py-2.5 px-3 bg-orange-500/5 border border-orange-500/30 rounded-lg">
        <span className="text-xs text-gray-500 font-mono w-16 flex-shrink-0">{entry.time}</span>
        <span className="text-xs font-bold text-orange-300 bg-orange-500/20 px-2 py-0.5 rounded">
          🛑 STOP LOSS
        </span>
      </div>
    )
  }
  return null
}

/** Ativos disponíveis (1 estratégia = N ativos em 1 card; bot analisa um a um) */
const ASSETS: string[] = [
  "EURUSD-OTC", "GBPUSD-OTC", "USDJPY-OTC", "AUDUSD-OTC", "EURGBP-OTC", "EURJPY-OTC",
  "USDCAD-OTC", "USDCHF-OTC", "NZDUSD-OTC", "GBPJPY-OTC", "AUDCAD-OTC",
  "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "EURJPY", "EURGBP",
  "XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD", "USOUSD", "UKOUSD",
  "US30", "USNDAQ100", "USSPX500", "GERMANY30", "UK100",
].sort((a, b) => a.localeCompare(b))

/**
 * 10 estratégias técnicas — cliente escolhe modelo + quais ativos.
 * Direção e expiração vêm do modelo / sinal.
 */
const PRESET_MODELS: {
  id: string
  name: string
  desc: string
  asset: string
  expirationMinutes: number
  icon: string
}[] = [
  { id: "SMA_CROSS", name: "Cruzamento de Médias (SMA 8/21)", desc: "Call: SMA rápida cruza p/ cima · Put: p/ baixo · Exp 3m", asset: "EURUSD-OTC", expirationMinutes: 3, icon: "📈" },
  { id: "SUPPORT_RES", name: "Suporte e Resistência + Velas", desc: "Call no suporte · Put na resistência · Exp 3m", asset: "EURUSD-OTC", expirationMinutes: 3, icon: "🧱" },
  { id: "RSI_DIV", name: "RSI + Momentum", desc: "Call: sai de oversold · Put: sai de overbought · Exp 3m", asset: "EURUSD-OTC", expirationMinutes: 3, icon: "📊" },
  { id: "BOLLINGER", name: "Bollinger Bands", desc: "Banda inferior + alta → Call · superior + baixa → Put", asset: "EURUSD-OTC", expirationMinutes: 3, icon: "🎀" },
  { id: "TREND_ADX", name: "Tendência (Trend Following)", desc: "Opera a favor da tendência EMA 21/55 · Exp 5m", asset: "GBPUSD-OTC", expirationMinutes: 5, icon: "🚀" },
  { id: "CANDLE_PATTERN", name: "Padrões de Velas (T5)", desc: "Hammer / shooting star / engulfing · Exp 2m", asset: "EURUSD-OTC", expirationMinutes: 2, icon: "🕯️" },
  { id: "BREAKOUT", name: "Breakout de Canal", desc: "Rompe topo → Call · fundo → Put · Exp 3m", asset: "USDJPY-OTC", expirationMinutes: 3, icon: "💥" },
  { id: "PSAR_EMA", name: "Parabolic SAR + EMA", desc: "SAR inverte + EMA confirma · Exp 3m", asset: "EURUSD-OTC", expirationMinutes: 3, icon: "🔵" },
  { id: "HEDGING", name: "Hedging (Proteção)", desc: "Após loss com gales, entra na direção oposta · Exp 5m", asset: "EURUSD-OTC", expirationMinutes: 5, icon: "🛡️" },
  { id: "NEWS_SR", name: "Notícias + Suporte/Resistência", desc: "Evita janelas de notícia · opera S/R · Exp 3m", asset: "EURUSD-OTC", expirationMinutes: 3, icon: "📰" },
]

function parseAssetsCsv(raw: string | undefined | null): string[] {
  if (!raw) return []
  return raw.split(",").map((x) => x.trim()).filter(Boolean)
}

const inpClass =
  "w-full bg-[#0d1117] border border-gray-700/60 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500/60 transition placeholder-gray-600"

export default function DayTradePage() {
  const [tab, setTab] = useState<Tab>("conta")
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [iqEmail, setIqEmail] = useState("")
  const [iqAccountType, setIqAccountType] = useState<AccountType>("DEMO")
  const [connectPending, setConnectPending] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [settings, setSettings] = useState<DtSettings | null>(null)
  const [variables, setVariables] = useState<DtVars | null>(null)
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [isActive, setIsActive] = useState(false)
  const [messages, setMessages] = useState<{ message: string; createdAt?: string }[]>([])
  const [history, setHistory] = useState<LogEntry[]>([])
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [acting, setActing] = useState(false)
  const [savingType, setSavingType] = useState(false)
  const [currency, setCurrency] = useState("USD")
  const [refreshingBal, setRefreshingBal] = useState(false)
  const [balanceSynced, setBalanceSynced] = useState(false)
  const [stopPending, setStopPending] = useState(false)
  const [isBetting, setIsBetting] = useState(false)
  const balanceInFlight = useRef(false)
  /** Após start, segura zeros na UI por alguns segundos (evita poll trazer contadores velhos) */
  const sessionZeroHoldUntil = useRef(0)
  /** Restaura tipo de estratégia (Padrões/Horários) só 1× a partir do servidor */
  const estrategiaTipoHydrated = useRef(false)
  /**
   * Settings só hidratam 1× (igual Conta Blaze).
   * Poll de status NÃO pode sobrescrever o que o usuário está digitando na aba Config.
   */
  const settingsHydrated = useRef(false)
  const settingsDirty = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** sempre o último settings (evita auto-save com state stale) */
  const settingsRef = useRef<DtSettings | null>(null)

  // form connect
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  // form strategy: modelo + lista de ativos (1 card, N moedas)
  const [selectedModelId, setSelectedModelId] = useState<string | null>("SMA_CROSS")
  const [formAssets, setFormAssets] = useState<string[]>(["EURUSD-OTC", "GBPUSD-OTC", "USDJPY-OTC"])
  const [assetSearch, setAssetSearch] = useState("")
  // padrão personalizado
  const [customName, setCustomName] = useState("")
  const [customType, setCustomType] = useState("SMA_CROSS")
  const [customExp, setCustomExp] = useState(3)
  const [showCustom, setShowCustom] = useState(false)
  /** Tipo de estratégia — igual Blaze: MODELOS | HORARIOS (persistido em settings + localStorage) */
  const [estrategiaTipo, setEstrategiaTipo] = useState<"MODELOS" | "HORARIOS">(() => {
    try {
      const ls = localStorage.getItem("daytrade_estrategia_tipo")
      if (ls === "HORARIOS" || ls === "MODELOS") return ls
    } catch {
      /* ignore */
    }
    return "MODELOS"
  })
  // Horários (igual Double)
  const [horarioTime, setHorarioTime] = useState("12:00")
  const [horarioDir, setHorarioDir] = useState<"CALL" | "PUT">("CALL")
  const [horarioAsset, setHorarioAsset] = useState("EURUSD-OTC")
  const [horarioExp, setHorarioExp] = useState(3)
  const [showImportHorarios, setShowImportHorarios] = useState(false)
  const [importHorariosText, setImportHorariosText] = useState("")
  const [importingHorarios, setImportingHorarios] = useState(false)
  // config sections collapse (igual Conta Blaze) — avançado aberto p/ ver toggles
  const [collapsedEntrada, setCollapsedEntrada] = useState(false)
  const [collapsedStop, setCollapsedStop] = useState(false)
  const [collapsedGale, setCollapsedGale] = useState(false)
  const [collapsedAvancado, setCollapsedAvancado] = useState(false)

  const refreshBalance = useCallback(async () => {
    // evita empilhar várias chamadas lentas (travava o PHP-FPM / a UI)
    if (balanceInFlight.current) return false
    balanceInFlight.current = true
    try {
      setRefreshingBal(true)
      const res = await fetch("/api/daytrade/balance", { cache: "no-store" })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setBalanceSynced(false)
        if (d.error) setConnectError(String(d.error))
        return false
      }
      if (d.balance != null) {
        setVariables((v) =>
          v
            ? { ...v, balance: Number(d.balance) }
            : {
                balance: Number(d.balance),
                profit: 0,
                countWin: 0,
                countLoss: 0,
                countMartingale: 0,
                isGale: false,
              }
        )
      }
      if (d.currency) setCurrency(String(d.currency))
      if (d.iqAccountType === "REAL" || d.iqAccountType === "DEMO") {
        setIqAccountType(d.iqAccountType)
      }
      setBalanceSynced(!!d.synced || Number(d.balanceId || 0) > 0)
      if (d.error) setConnectError(String(d.error))
      else setConnectError(null)
      return true
    } catch {
      setBalanceSynced(false)
      return false
    } finally {
      setRefreshingBal(false)
      balanceInFlight.current = false
    }
  }, [])

  async function loadStatus() {
    try {
      const res = await fetch("/api/daytrade/status", { cache: "no-store" })
      if (!res.ok) return null
      const d = await res.json()
      setConnected(!!d.connected)
      setIqEmail(d.iqEmail || "")
      setIqAccountType(d.iqAccountType === "REAL" ? "REAL" : "DEMO")
      setConnectPending(!!d.daytradeConnectPending)
      setConnectError(d.daytradeConnectError || null)
      setIsBetting(!!d.daytradeIsBetting)
      if (!d.daytradeIsActive) setStopPending(false)
      if (d.settings) {
        const selected = Array.isArray(d.settings.selectedAssets)
          ? d.settings.selectedAssets.map(String)
          : String(d.settings.defaultAsset || "EURUSD-OTC")
              .split(",")
              .map((x: string) => x.trim())
              .filter(Boolean)
        const assetsList = selected.length ? selected : ["EURUSD-OTC"]
        // restore tipo de UI 1× (cliente deixa em Horários e volta na mesma)
        let hydratedTipo: "MODELOS" | "HORARIOS" | null = null
        if (!estrategiaTipoHydrated.current) {
          const rawSt = String(d.settings.strategyType || "").toUpperCase()
          const restoredTipo: "MODELOS" | "HORARIOS" = [
            "HORARIO",
            "HORÁRIOS",
            "HORARIOS",
            "PREMIUM_LIST",
          ].includes(rawSt)
            ? "HORARIOS"
            : rawSt === "MODELOS" ||
                rawSt === "MODELO" ||
                rawSt === "PARAMETROS" ||
                rawSt === "PADROES" ||
                rawSt === "PADRÕES"
              ? "MODELOS"
              : (() => {
                  try {
                    const ls = localStorage.getItem("daytrade_estrategia_tipo")
                    if (ls === "HORARIOS" || ls === "MODELOS") return ls
                  } catch {
                    /* ignore */
                  }
                  return "MODELOS"
                })()
          setEstrategiaTipo(restoredTipo)
          hydratedTipo = restoredTipo
          estrategiaTipoHydrated.current = true
          try {
            localStorage.setItem("daytrade_estrategia_tipo", restoredTipo)
          } catch {
            /* ignore */
          }
        }
        // Só aplica settings do servidor na 1ª carga (ou se ainda não hidratou).
        // Poll a cada 2–10s NÃO pode apagar o que o cliente está editando.
        if (!settingsHydrated.current) {
          const initial: DtSettings = {
            ...d.settings,
            strategyType:
              hydratedTipo || String(d.settings.strategyType || "MODELOS"),
            enterValue: Math.max(2, Number(d.settings.enterValue) || 2),
            enterPercent: Number(d.settings.enterPercent) || 1,
            enterType: d.settings.enterType || "VALOR",
            quantityCycles: Math.max(1, Number(d.settings.quantityCycles) || 1),
            martingale: Number(d.settings.martingale) || 0,
            martingaleMultiplier: Number(d.settings.martingaleMultiplier) || 2,
            expirationMinutes: Number(d.settings.expirationMinutes) || 1,
            minPayout: Number(d.settings.minPayout) || 70,
            stopType: d.settings.stopType || "VALOR",
            stopGain: String(d.settings.stopGain ?? "20"),
            stopLoss: String(d.settings.stopLoss ?? "10"),
            skipFirstEntry: !!d.settings.skipFirstEntry,
            skipEntryAfterLoss: !!d.settings.skipEntryAfterLoss,
            selectedAssets: assetsList,
            defaultAsset: assetsList[0],
          }
          settingsRef.current = initial
          setSettings(initial)
          settingsHydrated.current = true
          settingsDirty.current = false
        }
      } else if (!settingsHydrated.current) {
        setSettings(null)
      }
      // Estratégias SEMPRE atualizam (não dependem do hold de sessão)
      setStrategies(Array.isArray(d.strategies) ? d.strategies : [])
      // Se acabou de iniciar, não deixa o poll/status repor contadores antigos
      const hold = sessionZeroHoldUntil.current > Date.now()
      if (!hold) {
        setVariables(d.variables)
        setEntries(Array.isArray(d.entries) ? d.entries : [])
      } else if (d.variables) {
        setVariables((prev) => ({
          balance: Number(d.variables.balance ?? prev?.balance ?? 0),
          profit: 0,
          countWin: 0,
          countLoss: 0,
          countMartingale: 0,
          isGale: false,
        }))
        setEntries([])
      }
      const active = !!d.daytradeIsActive
      setIsActive(active)
      // Igual Blaze/Jonbet: com bot online trava nas outras abas e fica em Iniciar Bot
      if (active) setTab("bot")
      // 10000 sem balanceId = placeholder antigo, não é saldo real
      const hasBalId = !!d.iqBalanceId && Number(d.iqBalanceId) > 0
      if (!d.connected) setBalanceSynced(false)
      else if (hasBalId) setBalanceSynced(true)
      if (d.iqEmail && !email) setEmail(d.iqEmail)
      return d
    } finally {
      setLoading(false)
    }
  }

  async function loadBotLog() {
    try {
      const res = await fetch("/api/daytrade/bot", { cache: "no-store" })
      if (!res.ok) return
      const d = await res.json()
      const active = !!d.isActive
      setIsActive(active)
      if (active) setTab("bot")
      if (d.isBetting != null) setIsBetting(!!d.isBetting || !!d.daytradeIsBetting)
      const msgs = Array.isArray(d.messages) ? d.messages : []
      setMessages(
        msgs.map((m: any) => ({
          message: m.message || m.msg || String(m),
          createdAt: m.createdAt || m.created_at,
        }))
      )
      if (Array.isArray(d.entries)) {
        setEntries(d.entries)
      }
      if (Array.isArray(d.history)) {
        setHistory(d.history as LogEntry[])
      }
    } catch {
      /* */
    }
  }

  // carga inicial + retoma login pendente (1x só)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const d = await loadStatus()
      if (cancelled) return
      await loadBotLog()
      if (d?.daytradeConnectPending && !d.connected) {
        setConnectPending(true)
        setTimeout(() => pollConnect(Date.now()), 1000)
      } else if (d?.connected) {
        // um único refresh de saldo ao abrir — sem loop agressivo
        await refreshBalance()
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // polling: mais rápido na aba bot quando rodando / finalizando (igual outras plataformas)
  useEffect(() => {
    const ms = tab === "bot" && (isActive || stopPending) ? 2000 : 10000
    const iv = setInterval(() => {
      loadStatus()
      if (tab === "bot" || isActive || stopPending) loadBotLog()
    }, ms)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isActive, stopPending])

  // Força aba Iniciar Bot enquanto online (não deixa ficar em Conta/Config/Estratégias)
  useEffect(() => {
    if (isActive || stopPending) {
      setTab("bot")
    }
  }, [isActive, stopPending])

  async function pollConnect(started: number) {
    try {
      const res = await fetch("/api/daytrade/status", { cache: "no-store" })
      const d = await res.json()
      if (d.connected && !d.daytradeConnectPending) {
        setConnectPending(false)
        setConnected(true)
        setIqEmail(d.iqEmail || email)
        setIqAccountType(d.iqAccountType === "REAL" ? "REAL" : "DEMO")
        setConnectError(null)
        setSuccess(
          `IQ Option conectada · conta ${d.iqAccountType === "REAL" ? "REAL" : "DEMO"}`
        )
        setPassword("")
        await loadStatus()
        await refreshBalance()
        return
      }
      if (d.daytradeConnectError) {
        setConnectPending(false)
        setConnectError(d.daytradeConnectError)
        setConnected(false)
        return
      }
      if (Date.now() - started > 90000) {
        setConnectPending(false)
        setConnectError("Timeout na conexão. Verifique email/senha e tente novamente.")
        return
      }
      setTimeout(() => pollConnect(started), 2000)
    } catch {
      if (Date.now() - started > 90000) {
        setConnectPending(false)
        setConnectError("Falha de rede ao verificar conexão.")
        return
      }
      setTimeout(() => pollConnect(started), 2500)
    }
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSuccess("")
    setConnectPending(true)
    setConnectError(null)
    try {
      const res = await fetch("/api/daytrade/conta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          iqAccountType,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setConnectPending(false)
        setError(d.error || "Falha ao conectar")
        return
      }
      setTimeout(() => pollConnect(Date.now()), 1500)
    } catch {
      setConnectPending(false)
      setError("Erro de rede ao conectar. Tente novamente.")
    }
  }

  async function handleDisconnect() {
    if (!confirm("Desconectar IQ Option?")) return
    await fetch("/api/daytrade/conta", { method: "DELETE" })
    setConnected(false)
    setIqEmail("")
    setPassword("")
    setSuccess("Desconectado.")
    setConnectError(null)
  }

  async function setAccountType(next: AccountType) {
    if (next === iqAccountType || savingType) return
    setSavingType(true)
    setError("")
    setSuccess("")
    setIqAccountType(next)
    try {
      const res = await fetch("/api/daytrade/conta", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iqAccountType: next }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error || "Não foi possível trocar o tipo de conta")
        // reverte
        setIqAccountType(next === "DEMO" ? "REAL" : "DEMO")
        return
      }
      if (d.balance != null) {
        setVariables((v) => (v ? { ...v, balance: Number(d.balance) } : v))
      }
      if (d.currency) setCurrency(String(d.currency))
      if (d.synced != null) setBalanceSynced(!!d.synced)
      if (d.error) {
        setConnectError(String(d.error))
        setBalanceSynced(false)
      }
      if (connected) {
        await refreshBalance()
        setSuccess(next === "REAL" ? "Conta REAL selecionada" : "Conta DEMO selecionada")
      }
    } finally {
      setSavingType(false)
    }
  }

  function updateSetting<K extends keyof DtSettings>(key: K, value: DtSettings[K]) {
    settingsDirty.current = true
    setSettings((prev) => {
      if (!prev) return null
      const next = { ...prev, [key]: value }
      settingsRef.current = next
      return next
    })
  }

  /** Auto-save após blur / toggle (não a cada tecla — evita clamp no meio da digitação) */
  function scheduleAutoSave(delayMs = 80) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void saveSettings({ silent: true })
    }, delayMs)
  }

  // mantém ref sincronizada
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  /** Troca Padrões ↔ Horários e grava (igual Conta changeType) */
  async function changeEstrategiaTipo(next: "MODELOS" | "HORARIOS") {
    if (next === estrategiaTipo) return
    setEstrategiaTipo(next)
    try {
      localStorage.setItem("daytrade_estrategia_tipo", next)
    } catch {
      /* ignore */
    }
    setSettings((prev) => (prev ? { ...prev, strategyType: next } : prev))
    try {
      await fetch("/api/daytrade/configuracoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategyType: next }),
      })
    } catch {
      /* offline: localStorage já guarda */
    }
  }

  function toggleFormAsset(a: string) {
    setFormAssets((prev) => {
      if (prev.includes(a)) {
        const next = prev.filter((x) => x !== a)
        return next
      }
      return [...prev, a]
    })
  }

  function selectAllFormAssets() {
    const q = assetSearch.trim().toUpperCase()
    const pool = q ? ASSETS.filter((a) => a.toUpperCase().includes(q)) : [...ASSETS]
    if (!pool.length) return
    setFormAssets(pool)
    setSuccess(q ? `${pool.length} ativos do filtro` : `Todos os ${pool.length} ativos selecionados`)
    setTimeout(() => setSuccess(""), 2000)
  }

  async function saveSettings(opts?: { silent?: boolean }) {
    const silent = !!opts?.silent
    const s = settingsRef.current || settings
    if (!s) return
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (!silent) {
      setActing(true)
      setError("")
      setSuccess("")
    }
    const skipFirst = !!s.skipFirstEntry
    const skipAfter = !!s.skipEntryAfterLoss && !skipFirst
    // clampa só ao salvar (mín. R$ 2)
    const enterVal = Math.max(2, parseFloat(String(s.enterValue).replace(",", ".")) || 2)
    const gale = Math.max(0, Math.min(10, parseInt(String(s.martingale), 10) || 0))
    const mult = Math.max(1, parseFloat(String(s.martingaleMultiplier).replace(",", ".")) || 2)
    const cycles = Math.max(1, parseInt(String(s.quantityCycles), 10) || 1)
    const payload = {
      enterType: "VALOR",
      enterValue: enterVal,
      enterPercent: Number(s.enterPercent) || 1,
      stopType: s.stopType === "QUANTIDADE" ? "QUANTIDADE" : "VALOR",
      stopGain: String(s.stopGain ?? "20"),
      stopLoss: String(s.stopLoss ?? "10"),
      martingale: gale,
      martingaleMultiplier: mult,
      expirationMinutes: Math.max(1, Math.min(60, Number(s.expirationMinutes) || 3)),
      minPayout: Number(s.minPayout) || 70,
      quantityCycles: cycles,
      skipFirstEntry: skipFirst ? 1 : 0,
      skipEntryAfterLoss: skipAfter ? 1 : 0,
      // mantém tipo de estratégia junto (Padrões/Horários)
      strategyType: s.strategyType || estrategiaTipo,
    }
    // sincroniza UI com valores clampados (sem re-agendar auto-save)
    const clamped: DtSettings = {
      ...s,
      enterValue: enterVal,
      martingale: gale,
      martingaleMultiplier: mult,
      quantityCycles: cycles,
    }
    settingsRef.current = clamped
    setSettings(clamped)
    try {
      // POST (mais confiável que PATCH em alguns proxies)
      const res = await fetch("/api/daytrade/configuracoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (!silent) setError(d.error || "Falha ao salvar configurações")
        return
      }
      // aplica o que o servidor devolveu (fonte da verdade)
      if (d && typeof d === "object") {
        const next: DtSettings = {
          ...clamped,
          enterType: d.enterType || "VALOR",
          enterValue: Math.max(2, Number(d.enterValue) || 2),
          enterPercent: Number(d.enterPercent) || 1,
          stopType: d.stopType || "VALOR",
          stopGain: String(d.stopGain ?? "20"),
          stopLoss: String(d.stopLoss ?? "10"),
          martingale: Number(d.martingale) || 0,
          martingaleMultiplier: Number(d.martingaleMultiplier) || 2,
          expirationMinutes: Number(d.expirationMinutes) || 3,
          minPayout: Number(d.minPayout) || 70,
          quantityCycles: Math.max(1, Number(d.quantityCycles) || 1),
          skipFirstEntry: !!d.skipFirstEntry,
          skipEntryAfterLoss: !!d.skipEntryAfterLoss,
          strategyType: String(d.strategyType || clamped.strategyType || estrategiaTipo),
          selectedAssets: clamped.selectedAssets,
          defaultAsset: clamped.defaultAsset,
        }
        settingsRef.current = next
        setSettings(next)
      }
      settingsDirty.current = false
      settingsHydrated.current = true
      if (!silent) {
        setSuccess("Configurações salvas!")
        setTimeout(() => setSuccess(""), 3000)
      }
    } catch {
      if (!silent) setError("Erro de rede ao salvar. Tente de novo.")
    } finally {
      if (!silent) setActing(false)
    }
  }

  function applyModel(modelId: string) {
    setSelectedModelId(modelId)
  }

  async function addStrategy(e?: React.FormEvent) {
    if (e) e.preventDefault()
    setError("")
    setSuccess("")
    const m = PRESET_MODELS.find((x) => x.id === selectedModelId)
    if (!m) {
      setError("Selecione uma estratégia na lista.")
      return
    }
    if (!formAssets.length) {
      setError("Selecione ao menos um ativo.")
      return
    }
    const assets = formAssets
    setActing(true)
    try {
      const res = await fetch("/api/daytrade/estrategias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyType: m.id,
          name: m.name,
          sequence: m.name,
          assets,
          expirationMinutes: m.expirationMinutes,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error || d.message || "Erro ao salvar estratégia")
        return
      }
      // Atualiza lista na hora (não depende só do status)
      if (d && d.id) {
        setStrategies((prev) => {
          const rest = prev.filter((s) => s.id !== d.id)
          return [
            {
              id: Number(d.id),
              sequence: String(d.sequence || m.name),
              color: String(d.color || "AUTO"),
              asset: String(d.asset || assets.join(",")),
              expirationMinutes: Number(d.expirationMinutes || m.expirationMinutes),
              strategyType: String(d.strategyType || m.id),
            },
            ...rest,
          ]
        })
      }
      setSuccess(`1 card: ${m.name} · ${assets.length} ativo(s) · exp ${m.expirationMinutes}m`)
      setTimeout(() => setSuccess(""), 3500)
      await loadStatus()
    } catch {
      setError("Erro de rede ao salvar estratégia. Tente de novo.")
    } finally {
      setActing(false)
    }
  }

  async function deleteStrategy(id: number) {
    await fetch(`/api/daytrade/estrategias?id=${id}`, { method: "DELETE" })
    loadStatus()
  }

  async function clearStrategies() {
    if (!confirm("Remover todas as estratégias cadastradas?")) return
    await fetch("/api/daytrade/estrategias", { method: "DELETE" })
    loadStatus()
  }

  async function startBot() {
    setError("")
    setSuccess("")
    if (!connected) {
      setError("Conecte a IQ Option antes de iniciar.")
      return
    }
    if (strategies.length === 0) {
      setError("Cadastre ao menos uma estratégia.")
      return
    }
    setActing(true)
    try {
      const res = await fetch("/api/daytrade/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error || "Falha ao iniciar")
        return
      }
      setIsActive(true)
      setStopPending(false)
      setIsBetting(false)
      setTab("bot")
      // Segura zeros ~4s — igual Blaze: painel da sessão reinicia no start
      sessionZeroHoldUntil.current = Date.now() + 4000
      const bal = Number(d.variables?.balance ?? variables?.balance ?? 0)
      setVariables({
        balance: bal,
        profit: 0,
        countWin: 0,
        countLoss: 0,
        countMartingale: 0,
        isGale: false,
      })
      setMessages([])
      setEntries([])
      setHistory([])
      await loadBotLog()
      // re-aplica zeros depois do status (evita contadores da sessão anterior)
      setVariables((prev) => ({
        balance: Number(d.variables?.balance ?? prev?.balance ?? 0),
        profit: 0,
        countWin: 0,
        countLoss: 0,
        countMartingale: 0,
        isGale: false,
      }))
      setEntries([])
      setIsActive(true)
      setTab("bot")
    } finally {
      setActing(false)
    }
  }

  async function stopBot() {
    setError("")
    setActing(true)
    const midEntry = isBetting || entries.some(
      (e) => (e.type === "ENTRADA" || e.type === "GALE") && !e.result
    )
    // igual Blaze/Jonbet: se está no meio da entrada, trava o botão
    if (midEntry) {
      setStopPending(true)
      setIsActive(true)
    }
    try {
      const res = await fetch("/api/daytrade/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      })
      const d = await res.json().catch(() => ({}))
      if (d?.pendingStop || midEntry || d?.isActive) {
        setStopPending(true)
        setIsActive(true)
        await loadBotLog()
        await loadStatus()
        return
      }
      setIsActive(false)
      setStopPending(false)
      setIsBetting(false)
      await loadBotLog()
      await loadStatus()
    } catch {
      if (midEntry || stopPending) {
        setStopPending(true)
        setIsActive(true)
        return
      }
      setError("Sem resposta ao parar — confira se o bot realmente parou.")
    } finally {
      setActing(false)
    }
  }

  async function addHorario(e?: React.FormEvent) {
    if (e) e.preventDefault()
    setError("")
    setSuccess("")
    const t = horarioTime.trim()
    if (!/^\d{1,2}:\d{2}$/.test(t)) {
      setError("Horário inválido. Use HH:MM.")
      return
    }
    if (!horarioAsset.trim()) {
      setError("Selecione um ativo.")
      return
    }
    setActing(true)
    try {
      const res = await fetch("/api/daytrade/estrategias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyType: "HORARIO",
          sequence: t,
          color: horarioDir,
          direction: horarioDir,
          assets: [horarioAsset],
          expirationMinutes: Math.max(1, Math.min(60, horarioExp)),
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error || "Erro ao adicionar horário")
        return
      }
      if (d?.id) {
        setStrategies((prev) => {
          const rest = prev.filter((s) => s.id !== Number(d.id))
          return [
            {
              id: Number(d.id),
              sequence: String(d.sequence || t),
              color: String(d.color || horarioDir),
              asset: String(d.asset || horarioAsset),
              expirationMinutes: Number(d.expirationMinutes || horarioExp),
              strategyType: "HORARIO",
            },
            ...rest,
          ]
        })
      }
      setSuccess(`Horário ${t} ${horarioDir} ${horarioAsset} adicionado`)
      setTimeout(() => setSuccess(""), 3000)
      await loadStatus()
    } catch {
      setError("Erro de rede ao adicionar horário")
    } finally {
      setActing(false)
    }
  }

  async function importHorariosList(e?: React.FormEvent) {
    if (e) e.preventDefault()
    setError("")
    setSuccess("")
    const lines = importHorariosText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (!lines.length) {
      setError("Cole ao menos uma linha de horário.")
      return
    }
    setImportingHorarios(true)
    let ok = 0
    let fail = 0
    try {
      for (const line of lines) {
        // formatos: "14:30 CALL EURUSD-OTC" | "14:30 PUT" | "14:30 🟢" | "14:30 🔴 CALL GBPUSD-OTC"
        const m = line.match(
          /^(\d{1,2}:\d{2})\s*(?:(CALL|PUT|call|put|🟢|🔴|compra|venda))?\s*([A-Za-z0-9\-]+)?/i
        )
        if (!m) {
          fail++
          continue
        }
        let dir: "CALL" | "PUT" = "CALL"
        const dRaw = (m[2] || "").toUpperCase()
        if (dRaw === "PUT" || dRaw === "🔴" || dRaw === "VENDA" || dRaw.includes("PUT")) {
          dir = "PUT"
        } else if (dRaw === "🟢" || dRaw === "CALL" || dRaw === "COMPRA") {
          dir = "CALL"
        } else if (/put|🔴|venda/i.test(line)) {
          dir = "PUT"
        }
        const asset = (m[3] || horarioAsset || "EURUSD-OTC").toUpperCase()
        const res = await fetch("/api/daytrade/estrategias", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategyType: "HORARIO",
            sequence: m[1],
            color: dir,
            assets: [asset],
            expirationMinutes: horarioExp,
          }),
        })
        if (res.ok) ok++
        else fail++
      }
      if (ok === 0) {
        setError(fail ? "Nenhum horário válido importado." : "Falha ao importar.")
      } else {
        setSuccess(`${ok} horário(s) importado(s)${fail ? ` · ${fail} ignorado(s)` : ""}`)
        setImportHorariosText("")
        setShowImportHorarios(false)
        setTimeout(() => setSuccess(""), 4000)
        await loadStatus()
      }
    } catch {
      setError("Erro de rede na importação")
    } finally {
      setImportingHorarios(false)
    }
  }

  async function clearHorariosOnly() {
    const horas = strategies.filter((s) =>
      ["HORARIO", "HORÁRIOS", "HORARIOS", "PREMIUM_LIST"].includes(
        String(s.strategyType || "").toUpperCase()
      )
    )
    if (!horas.length) return
    if (!confirm(`Remover ${horas.length} horário(s) cadastrado(s)?`)) return
    for (const h of horas) {
      await fetch(`/api/daytrade/estrategias?id=${h.id}`, { method: "DELETE" })
    }
    loadStatus()
  }

  async function addCustomPattern() {
    setError("")
    setSuccess("")
    const name = customName.trim()
    if (!name) {
      setError("Informe o nome do padrão.")
      return
    }
    if (!formAssets.length) {
      setError("Selecione ao menos um ativo.")
      return
    }
    const typeOk = PRESET_MODELS.some((m) => m.id === customType)
    if (!typeOk) {
      setError("Escolha um tipo de análise válido.")
      return
    }
    setActing(true)
    try {
      const res = await fetch("/api/daytrade/estrategias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyType: customType,
          name,
          sequence: name,
          assets: formAssets,
          expirationMinutes: Math.max(1, Math.min(60, customExp)),
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error || "Erro ao criar padrão")
        return
      }
      if (d && d.id) {
        setStrategies((prev) => [
          {
            id: Number(d.id),
            sequence: String(d.sequence || name),
            color: String(d.color || "AUTO"),
            asset: String(d.asset || formAssets.join(",")),
            expirationMinutes: Number(d.expirationMinutes || customExp),
            strategyType: String(d.strategyType || customType),
          },
          ...prev.filter((s) => s.id !== Number(d.id)),
        ])
      }
      setSuccess(`Padrão "${name}" criado · ${formAssets.length} ativo(s)`)
      setCustomName("")
      setTimeout(() => setSuccess(""), 3000)
      await loadStatus()
    } catch {
      setError("Erro de rede ao criar padrão.")
    } finally {
      setActing(false)
    }
  }

  async function testEntry(direction: "CALL" | "PUT") {
    setError("")
    setActing(true)
    const res = await fetch("/api/daytrade/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "test-entry",
        direction,
        asset: settings?.defaultAsset || asset,
        amount: Math.max(2, Number(settings?.enterValue) || 2),
        expirationMinutes: settings?.expirationMinutes || 1,
      }),
    })
    const d = await res.json().catch(() => ({}))
    setActing(false)
    if (!res.ok) {
      setError(d.error || "Ordem falhou")
      return
    }
    setSuccess(`Ordem teste ${direction} enviada (${iqAccountType}).`)
    loadStatus()
    loadBotLog()
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "conta", label: "Conta IQ" },
    { key: "estrategias", label: "Estratégias" },
    { key: "config", label: "Config. Bot" },
    { key: "bot", label: "Iniciar Bot" },
  ]

  const SectionHeader = ({
    icon,
    title,
    collapsed,
    onToggle,
  }: {
    icon: string
    title: string
    collapsed?: boolean
    onToggle?: () => void
  }) => (
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

  const balLabel = `${currency === "BRL" ? "R$" : currency === "USD" ? "$" : currency + " "} ${Number(
    variables?.balance ?? 0
  ).toFixed(2)}`

  if (loading) {
    return <div className="text-gray-400 text-sm py-8 text-center">Carregando Day Trade…</div>
  }

  return (
    <div className="space-y-4">
      {/* Banner estilo outras plataformas */}
      <div className="relative w-full h-20 rounded-xl overflow-hidden border border-green-500/20 bg-gradient-to-r from-green-600/10 via-emerald-950/20 to-gray-950 flex items-center px-6 shadow-md shadow-green-950/5">
        <div className="absolute -right-6 -bottom-10 opacity-10 select-none pointer-events-none transform rotate-12">
          <span className="text-8xl font-black italic tracking-widest text-green-500 font-sans">IQ</span>
        </div>
        <div className="flex items-center justify-between w-full relative z-10 gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-600 flex items-center justify-center shadow-lg shadow-green-600/30">
              <span className="text-white text-xl">📈</span>
            </div>
            <div>
              <h1 className="text-white text-lg font-black tracking-widest uppercase">Day Trade · IQ Option</h1>
              <p className="text-gray-400 text-[10px] uppercase font-bold tracking-wider">
                Configurações ativas do robô
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center justify-end">
            <span
              className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full border ${
                connected
                  ? "bg-green-500/15 text-green-400 border-green-500/30"
                  : connectPending
                    ? "bg-amber-500/15 text-amber-300 border-amber-500/30 animate-pulse"
                    : "bg-gray-800 text-gray-400 border-gray-700"
              }`}
            >
              {connected ? "Conectado" : connectPending ? "Conectando…" : "Desconectado"}
            </span>
            <span
              className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full border ${
                iqAccountType === "REAL"
                  ? "bg-red-500/15 text-red-400 border-red-500/30"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/30"
              }`}
            >
              {iqAccountType === "REAL" ? "CONTA REAL" : "CONTA DEMO"}
            </span>
            {connected && (
              <span className="text-sm font-bold text-green-400 tabular-nums hidden sm:inline">
                {balanceSynced ? balLabel : "Saldo: —"}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
        {tabs.map((t) => {
          // Igual Blaze/Jonbet: com bot online só a aba "Iniciar Bot" fica liberada
          const locked = (isActive || stopPending) && t.key !== "bot"
          return (
            <button
              key={t.key}
              type="button"
              disabled={locked}
              onClick={() => {
                if (locked) return
                // ao sair da config, força salvar o que ficou pendente
                if (tab === "config" && t.key !== "config" && settingsDirty.current) {
                  void saveSettings({ silent: true })
                }
                setTab(t.key)
              }}
              title={locked ? "Pare o bot para acessar esta aba" : undefined}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-green-500 text-black"
                  : locked
                    ? "text-gray-600 cursor-not-allowed opacity-40 pointer-events-none"
                    : "text-gray-400 hover:text-white hover:bg-gray-800"
              }`}
            >
              {locked && t.key !== "bot" ? `🔒 ${t.label}` : t.label}
            </button>
          )
        })}
      </div>

      {(error || connectError) && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          {error || connectError}
        </div>
      )}
      {success && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm">
          {success}
        </div>
      )}

      {/* CONTA */}
      {tab === "conta" && (
        <div className="space-y-4">
          {/* Tipo de conta DEMO / REAL */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-white text-sm font-medium">Tipo de conta IQ Option</p>
                <p className="text-gray-500 text-xs mt-0.5">
                  {iqAccountType === "REAL"
                    ? "Operações com saldo real (dinheiro de verdade)"
                    : "Operações na conta de prática (demo) da IQ Option"}
                </p>
              </div>
              <div className="inline-flex rounded-xl border border-gray-700 bg-gray-950 p-1 gap-1">
                <button
                  type="button"
                  disabled={savingType || connectPending}
                  onClick={() => setAccountType("DEMO")}
                  className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wide transition ${
                    iqAccountType === "DEMO"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow"
                      : "text-gray-500 hover:text-gray-300 border border-transparent"
                  }`}
                >
                  DEMO
                </button>
                <button
                  type="button"
                  disabled={savingType || connectPending}
                  onClick={() => setAccountType("REAL")}
                  className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wide transition ${
                    iqAccountType === "REAL"
                      ? "bg-red-500/20 text-red-400 border border-red-500/40 shadow"
                      : "text-gray-500 hover:text-gray-300 border border-transparent"
                  }`}
                >
                  REAL
                </button>
              </div>
            </div>

            {iqAccountType === "REAL" && (
              <div className="bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2.5 text-xs text-red-300/90 leading-relaxed">
                ⚠️ Conta <strong>REAL</strong>: o bot opera com dinheiro real. Confira valor de entrada e stop loss antes de iniciar.
              </div>
            )}
            {iqAccountType === "DEMO" && (
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2.5 text-xs text-amber-200/80 leading-relaxed">
                Conta <strong>DEMO</strong>: usa o saldo de prática da IQ Option. Ideal para testar estratégias com segurança.
              </div>
            )}
          </div>

          {/* Login / conta conectada */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-white">Credenciais IQ Option</h2>
              {connected && (
                <span className="text-xs bg-green-500/20 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">
                  Conectado
                </span>
              )}
              {connectPending && (
                <span className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/20 px-2 py-0.5 rounded-full animate-pulse">
                  Conectando…
                </span>
              )}
            </div>

            {connected ? (
              <div className="bg-gray-800/70 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-gray-700">
                <div className="space-y-1">
                  <p className="text-white font-medium text-sm">{iqEmail || "Conta IQ Option"}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                        iqAccountType === "REAL"
                          ? "bg-red-500/15 text-red-400 border-red-500/30"
                          : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                      }`}
                    >
                      {iqAccountType === "REAL" ? "CONTA REAL" : "CONTA DEMO"}
                    </span>
                    <p className="text-cyan-300 text-sm font-bold tabular-nums">
                      {balanceSynced ? (
                        <>Saldo: {balLabel}</>
                      ) : (
                        <span className="text-amber-300">Saldo não sincronizado</span>
                      )}
                      {refreshingBal && (
                        <span className="ml-2 text-[10px] text-gray-500 font-normal">atualizando…</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => refreshBalance()}
                    disabled={refreshingBal}
                    className="px-4 py-2 bg-green-500/10 text-green-400 border border-green-500/25 hover:bg-green-500/20 rounded-lg text-sm font-semibold disabled:opacity-50"
                  >
                    Atualizar saldo
                  </button>
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 rounded-lg text-sm font-semibold"
                  >
                    Desconectar
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleConnect} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Email IQ Option</label>
                  <input
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={connectPending}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-60"
                    placeholder="seu@email.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Senha</label>
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={connectPending}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-60"
                    placeholder="••••••••"
                  />
                </div>

                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>Vai conectar como:</span>
                  <span
                    className={`font-bold uppercase ${
                      iqAccountType === "REAL" ? "text-red-400" : "text-amber-300"
                    }`}
                  >
                    {iqAccountType}
                  </span>
                  <span className="text-gray-600">(troque no seletor acima se quiser)</span>
                </div>

                <button
                  type="submit"
                  disabled={connectPending || !email.trim() || !password}
                  className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold py-2.5 rounded-lg text-sm transition-colors"
                >
                  {connectPending ? "Conectando à IQ Option…" : "Conectar IQ Option"}
                </button>
                <p className="text-[11px] text-gray-600 leading-relaxed">
                  Login na API web da IQ Option (não oficial). Recomendado começar em{" "}
                  <strong className="text-amber-300/80">DEMO</strong>. Se a conta tiver 2FA, desative
                  temporariamente para o bot autenticar.
                </p>
              </form>
            )}
          </div>

        </div>
      )}

      {/* ESTRATÉGIAS — igual outros jogos: tipo → conteúdo */}
      {tab === "estrategias" && (
        <div className="space-y-4">
          {/* Tipo de Estratégia (igual Conta Blaze) */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-3">Tipo de Estratégia</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(
                [
                  { id: "MODELOS" as const, label: "Padrões / Indicadores", desc: "SMA, RSI, Bollinger…" },
                  { id: "HORARIOS" as const, label: "Horários", desc: "Entradas por HH:MM + CALL/PUT" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => changeEstrategiaTipo(t.id)}
                  className={`w-full text-left px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${
                    estrategiaTipo === t.id
                      ? "bg-green-500/15 border-green-500/40 text-green-400"
                      : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white"
                  }`}
                >
                  {t.label}
                  {estrategiaTipo === t.id && (
                    <span className="ml-2 text-xs opacity-60">✓ ativo</span>
                  )}
                  <p
                    className={`text-[11px] mt-0.5 font-normal ${
                      estrategiaTipo === t.id ? "text-green-500/70" : "text-gray-600"
                    }`}
                  >
                    {t.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* ── MODELOS / INDICADORES ── */}
          {estrategiaTipo === "MODELOS" && (
          <>
          <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/40 to-gray-950 px-4 py-3">
            <p className="text-xs text-gray-400 leading-relaxed">
              Escolha a <strong className="text-white">estratégia</strong> e os{" "}
              <strong className="text-emerald-400">ativos</strong>. Fica{" "}
              <strong className="text-white">1 card</strong> com a quantidade de moedas — o bot analisa{" "}
              <strong className="text-white">uma por uma</strong>. Direção e expiração vêm do modelo.
            </p>
          </div>

          <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-5 space-y-4">
            <h2 className="text-sm font-bold text-white">1. Modelo de estratégia</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {PRESET_MODELS.map((m) => {
                const active = selectedModelId === m.id
                const already = strategies.some(
                  (s) => String(s.strategyType).toUpperCase() === m.id
                )
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => applyModel(m.id)}
                    className={`text-left rounded-xl border p-3.5 transition-all ${
                      active
                        ? "border-emerald-400/60 bg-emerald-500/10 shadow-[0_0_20px_rgba(16,185,129,0.12)]"
                        : "border-gray-800/80 bg-[#0b1220] hover:border-gray-700"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-lg w-9 h-9 rounded-xl bg-black/40 border border-gray-800 flex items-center justify-center">
                        {m.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs font-bold truncate ${active ? "text-emerald-300" : "text-white"}`}>
                          {m.name}
                          {already ? (
                            <span className="ml-1.5 text-[9px] text-emerald-500/80 font-semibold">· cadastrada</span>
                          ) : null}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{m.desc}</p>
                      </div>
                      {active && (
                        <span className="w-5 h-5 shrink-0 rounded-full bg-emerald-500 text-black text-[10px] font-black flex items-center justify-center">
                          ✓
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="pt-2 border-t border-gray-800/80">
              <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-white">
                  2. Ativos ({formAssets.length} sel.)
                </h2>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAllFormAssets}
                    className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  >
                    Selecionar todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormAssets(formAssets[0] ? [formAssets[0]] : ["EURUSD-OTC"])}
                    className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-gray-800 text-gray-400 border border-gray-700"
                  >
                    Só 1
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormAssets([])}
                    className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-gray-800 text-red-400/80 border border-gray-700"
                  >
                    Limpar
                  </button>
                </div>
              </div>
              <input
                value={assetSearch}
                onChange={(e) => setAssetSearch(e.target.value)}
                placeholder="Buscar ativo…"
                className={`${inpClass} mb-2`}
              />
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-2 rounded-xl border border-gray-800 bg-black/30">
                {ASSETS.filter((a) => {
                  const q = assetSearch.trim().toUpperCase()
                  return !q || a.toUpperCase().includes(q)
                }).map((a) => {
                  const on = formAssets.includes(a)
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => toggleFormAsset(a)}
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
              onClick={() => addStrategy()}
              disabled={acting || !selectedModelId || formAssets.length === 0}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-bold py-3 rounded-xl text-sm transition-colors"
            >
              {acting
                ? "Salvando…"
                : `Salvar 1 card · ${formAssets.length || 0} ativo(s)`}
            </button>
          </div>

          {/* Criar padrão personalizado */}
          <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-5 space-y-3">
            <button
              type="button"
              onClick={() => setShowCustom(!showCustom)}
              className="w-full flex items-center justify-between text-left"
            >
              <div>
                <h2 className="text-sm font-bold text-white">Criar padrão personalizado</h2>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Mesmos parâmetros dos modelos (tipo de análise + ativos + exp)
                </p>
              </div>
              <span className="text-gray-500 text-xs font-bold">{showCustom ? "FECHAR ▲" : "ABRIR ▼"}</span>
            </button>
            {showCustom && (
              <div className="space-y-3 pt-2 border-t border-gray-800">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block font-medium">Nome do padrão</label>
                  <input
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="Ex: Meu SMA agressivo"
                    className={inpClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block font-medium">Tipo de análise</label>
                  <select
                    value={customType}
                    onChange={(e) => {
                      setCustomType(e.target.value)
                      const m = PRESET_MODELS.find((x) => x.id === e.target.value)
                      if (m) setCustomExp(m.expirationMinutes)
                    }}
                    className={inpClass}
                  >
                    {PRESET_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.icon} {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block font-medium">Expiração (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={customExp}
                    onChange={(e) => setCustomExp(Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 3)))}
                    className={inpClass}
                  />
                </div>
                <p className="text-[11px] text-gray-500">
                  Ativos: usa a seleção acima ({formAssets.length} marcado{formAssets.length === 1 ? "" : "s"}).
                </p>
                <button
                  type="button"
                  onClick={addCustomPattern}
                  disabled={acting || !customName.trim() || formAssets.length === 0}
                  className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black font-bold py-2.5 rounded-xl text-sm"
                >
                  {acting ? "Criando…" : "Criar padrão com ativos selecionados"}
                </button>
              </div>
            )}
          </div>

          {(() => {
            const modelStrats = strategies.filter(
              (s) =>
                !["HORARIO", "HORÁRIOS", "HORARIOS", "PREMIUM_LIST"].includes(
                  String(s.strategyType || "").toUpperCase()
                )
            )
            return (
          <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-white">
                Cadastradas ({modelStrats.length} card{modelStrats.length === 1 ? "" : "s"})
              </h2>
              {modelStrats.length > 0 && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(`Remover ${modelStrats.length} padrão(ões)?`)) return
                    for (const s of modelStrats) {
                      await fetch(`/api/daytrade/estrategias?id=${s.id}`, { method: "DELETE" })
                    }
                    loadStatus()
                  }}
                  className="text-[11px] text-red-400 hover:text-red-300 font-semibold"
                >
                  Limpar padrões
                </button>
              )}
            </div>
            {modelStrats.length === 0 ? (
              <p className="text-gray-500 text-xs">Nenhuma. Escolha modelo + ativos e salve.</p>
            ) : (
              <div className="space-y-3">
                {modelStrats.map((s) => {
                  const st = String(s.strategyType || "").toUpperCase()
                  const meta = PRESET_MODELS.find((m) => m.id === st)
                  const assets = parseAssetsCsv(s.asset)
                  const n = assets.length || 1
                  return (
                    <div
                      key={s.id}
                      className="relative overflow-hidden rounded-2xl border border-gray-800 bg-gradient-to-br from-[#0d1525] to-[#0a0f18] p-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-xl shrink-0">
                          {meta?.icon || "📈"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-white truncate">
                            {s.sequence || s.strategyType || "Estratégia"}
                          </p>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                              {n} ativo{n === 1 ? "" : "s"}
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 border border-gray-700">
                              exp {s.expirationMinutes || meta?.expirationMinutes || 3}m
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
                              dir. automática
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-500 mt-2 font-mono line-clamp-2">
                            {assets.slice(0, 6).join(", ")}
                            {n > 6 ? ` +${n - 6}` : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteStrategy(s.id)}
                          className="text-gray-600 hover:text-red-400 px-2 text-sm"
                          title="Remover"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
            )
          })()}
          </>
          )}

          {/* ── HORÁRIOS (igual Double: só este tipo) ── */}
          {estrategiaTipo === "HORARIOS" && (
          <>
          <div className="rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-950/30 to-gray-950 px-4 py-3">
            <p className="text-xs text-gray-400 leading-relaxed">
              Cadastre o <strong className="text-white">horário</strong> (Brasília), a direção{" "}
              <strong className="text-emerald-400">CALL/PUT</strong> e o{" "}
              <strong className="text-white">ativo</strong>. O bot entra no minuto exato.
            </p>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white">Novo Horário</h2>
              <button
                type="button"
                onClick={() => {
                  setShowImportHorarios((v) => !v)
                  setError("")
                }}
                className="text-xs text-green-400 hover:text-green-300 border border-green-500/30 rounded-lg px-2.5 py-1 shrink-0"
              >
                {showImportHorarios ? "Cancelar" : "Importar Lista"}
              </button>
            </div>

            {showImportHorarios ? (
              <form onSubmit={importHorariosList} className="space-y-3">
                <p className="text-xs text-gray-500">
                  Cole a lista. Cada linha:{" "}
                  <span className="font-mono text-gray-400">HH:MM CALL|PUT ATIVO</span>
                </p>
                <p className="text-xs text-gray-600">
                  Exemplos:{" "}
                  <span className="font-mono text-gray-400">14:30 CALL EURUSD-OTC</span> ·{" "}
                  <span className="font-mono text-gray-400">15:00 PUT</span> ·{" "}
                  <span className="font-mono text-gray-400">15:19 PUT GBPUSD-OTC</span>
                </p>
                <textarea
                  value={importHorariosText}
                  onChange={(e) => setImportHorariosText(e.target.value)}
                  rows={7}
                  required
                  placeholder={"14:30 CALL EURUSD-OTC\n14:45 PUT GBPUSD-OTC\n15:00 CALL USDJPY-OTC"}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                />
                <button
                  type="submit"
                  disabled={importingHorarios}
                  className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-semibold py-2.5 rounded-lg text-sm"
                >
                  {importingHorarios ? "Importando…" : "Importar Horários"}
                </button>
              </form>
            ) : (
              <form onSubmit={addHorario} className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Horário (HH:MM)</label>
                    <input
                      type="time"
                      value={horarioTime}
                      onChange={(e) => setHorarioTime(e.target.value)}
                      required
                      className={inpClass}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Direção</label>
                    <select
                      value={horarioDir}
                      onChange={(e) => setHorarioDir(e.target.value === "PUT" ? "PUT" : "CALL")}
                      className={inpClass}
                    >
                      <option value="CALL">🟢 CALL</option>
                      <option value="PUT">🔴 PUT</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Ativo</label>
                    <select
                      value={horarioAsset}
                      onChange={(e) => setHorarioAsset(e.target.value)}
                      className={inpClass}
                    >
                      {ASSETS.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Exp (min)</label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={horarioExp}
                      onChange={(e) =>
                        setHorarioExp(Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 3)))
                      }
                      className={inpClass}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={acting}
                  className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-semibold py-2.5 rounded-lg text-sm"
                >
                  {acting ? "Adicionando…" : "Adicionar Horário"}
                </button>
              </form>
            )}
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            {(() => {
              const horas = strategies
                .filter((s) =>
                  ["HORARIO", "HORÁRIOS", "HORARIOS", "PREMIUM_LIST"].includes(
                    String(s.strategyType || "").toUpperCase()
                  )
                )
                .slice()
                .sort((a, b) => String(a.sequence).localeCompare(String(b.sequence)))
              return (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-white">
                      Horários Cadastrados ({horas.length})
                    </h2>
                    {horas.length > 0 && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const text = horas
                              .map(
                                (s) =>
                                  `${s.sequence} ${s.color || "CALL"} ${String(s.asset || "").split(",")[0]}`
                              )
                              .join("\n")
                            navigator.clipboard.writeText(text)
                            setSuccess("Lista copiada")
                            setTimeout(() => setSuccess(""), 2000)
                          }}
                          className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg"
                        >
                          📋 Copiar Lista
                        </button>
                        <button
                          type="button"
                          onClick={clearHorariosOnly}
                          className="text-xs px-3 py-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg"
                        >
                          🗑️ Limpar todos
                        </button>
                      </div>
                    )}
                  </div>
                  {horas.length === 0 ? (
                    <p className="text-gray-500 text-xs">Nenhum horário cadastrado.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-96 overflow-y-auto">
                      {horas.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2.5"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-white font-mono text-sm font-semibold w-12 shrink-0">
                              {s.sequence}
                            </span>
                            <span
                              className={`text-[10px] font-black px-2 py-0.5 rounded ${
                                String(s.color).toUpperCase() === "PUT"
                                  ? "bg-red-500/15 text-red-400"
                                  : "bg-emerald-500/15 text-emerald-400"
                              }`}
                            >
                              {String(s.color).toUpperCase() === "PUT" ? "🔴 PUT" : "🟢 CALL"}
                            </span>
                            <span className="text-xs text-gray-400 font-mono truncate">
                              {String(s.asset || "").split(",")[0]}
                            </span>
                            <span className="text-[10px] text-gray-600">
                              {s.expirationMinutes || 3}m
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => deleteStrategy(s.id)}
                            className="text-gray-500 hover:text-red-400 text-base ml-2"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )
            })()}
          </div>
          </>
          )}
        </div>
      )}

      {/* CONFIG — layout igual às outras plataformas */}
      {tab === "config" && settings && (
        <div className="space-y-3">
          {/* ENTRADA */}
          <div className="bg-[#0a0f1a] border border-gray-800/70 rounded-xl p-4">
            <SectionHeader
              icon="💰"
              title="Entrada"
              collapsed={collapsedEntrada}
              onToggle={() => setCollapsedEntrada(!collapsedEntrada)}
            />
            {!collapsedEntrada && (
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1.5 font-medium">
                    Valor de entrada — mínimo <span className="text-green-400 font-semibold">R$ 2,00</span>
                  </p>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-green-400 text-xs font-bold select-none">
                      R$
                    </span>
                    <input
                      {...numInputProps({
                        value: settings.enterValue,
                        min: 2,
                        step: "0.01",
                        onChange: (v) => updateSetting("enterValue", v),
                        onBlurClamp: (n) => {
                          const v = Math.max(2, n)
                          scheduleAutoSave()
                          return v
                        },
                        className: `${inpClass} pl-9`,
                      })}
                    />
                  </div>
                  <p className="text-[11px] text-gray-600 mt-1.5">
                    IQ Option / opções binárias: valor mínimo de entrada R$ 2,00. Ativos ficam na aba{" "}
                    <strong className="text-gray-400">Estratégias</strong>.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* STOP */}
          <div className="bg-[#0a0f1a] border border-gray-800/70 rounded-xl p-4">
            <SectionHeader
              icon="🛑"
              title="Stop"
              collapsed={collapsedStop}
              onToggle={() => setCollapsedStop(!collapsedStop)}
            />
            {!collapsedStop && (
              <div className="mt-3">
                <div className="flex gap-1 bg-gray-900 rounded-lg p-1 mb-3">
                  {(["VALOR", "QUANTIDADE"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        updateSetting("stopType", t)
                        scheduleAutoSave()
                      }}
                      className={`flex-1 py-2 text-xs font-bold tracking-wide rounded-md transition-all ${
                        settings.stopType === t
                          ? "bg-green-500 text-black shadow-lg shadow-green-500/20"
                          : "text-gray-500 hover:text-gray-300"
                      }`}
                    >
                      {t === "VALOR" ? "VALOR (R$)" : "QUANTIDADE"}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5 font-medium">Stop Win</p>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-green-400 text-xs font-bold select-none">
                        {settings.stopType === "VALOR" ? "R$" : "#"}
                      </span>
                      <input
                        {...numInputProps({
                          value: settings.stopGain,
                          step: "0.01",
                          onChange: (v) => updateSetting("stopGain", String(v)),
                          onBlurClamp: (n) => {
                            scheduleAutoSave()
                            return n
                          },
                          className: `${inpClass} pl-9 border-green-900/60 focus:ring-green-500/60`,
                        })}
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5 font-medium">Stop Loss</p>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-red-400 text-xs font-bold select-none">
                        {settings.stopType === "VALOR" ? "R$" : "#"}
                      </span>
                      <input
                        {...numInputProps({
                          value: settings.stopLoss,
                          step: "0.01",
                          onChange: (v) => updateSetting("stopLoss", String(v)),
                          onBlurClamp: (n) => {
                            scheduleAutoSave()
                            return n
                          },
                          className: `${inpClass} pl-9 border-red-900/60 focus:ring-red-500/60`,
                        })}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* GALE */}
          <div className="bg-[#0a0f1a] border border-gray-800/70 rounded-xl p-4">
            <SectionHeader
              icon="🔄"
              title="Gale"
              collapsed={collapsedGale}
              onToggle={() => setCollapsedGale(!collapsedGale)}
            />
            {!collapsedGale && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-gray-500 mb-1.5 font-medium">Qtd. de Gales</p>
                  <input
                    {...numInputProps({
                      value: settings.martingale,
                      min: 0,
                      step: "1",
                      onChange: (v) => updateSetting("martingale", v),
                      onBlurClamp: (n) => {
                        const v = Math.max(0, Math.min(10, Math.floor(n)))
                        scheduleAutoSave()
                        return v
                      },
                      className: inpClass,
                    })}
                  />
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1.5 font-medium">Multiplicador</p>
                  <div className="relative">
                    <input
                      {...numInputProps({
                        value: settings.martingaleMultiplier,
                        min: 1,
                        step: "0.01",
                        onChange: (v) => updateSetting("martingaleMultiplier", v),
                        onBlurClamp: (n) => {
                          const v = Math.max(1, n)
                          scheduleAutoSave()
                          return v
                        },
                        className: `${inpClass} pr-8`,
                      })}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs font-bold select-none">
                      ×
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* AVANÇADO / CICLOS */}
          <div className="bg-[#0a0f1a] border border-gray-800/70 rounded-xl p-4">
            <SectionHeader
              icon="⚙️"
              title="Avançado"
              collapsed={collapsedAvancado}
              onToggle={() => setCollapsedAvancado(!collapsedAvancado)}
            />
            {!collapsedAvancado && (
              <div className="mt-3 space-y-4">
                <div>
                  <p className="text-xs text-gray-500 mb-1.5 font-medium">Quantidade de Ciclos</p>
                  <input
                    {...numInputProps({
                      value: settings.quantityCycles ?? 1,
                      min: 1,
                      step: "1",
                      onChange: (v) => updateSetting("quantityCycles", v),
                      onBlurClamp: (n) => {
                        const v = Math.max(1, Math.floor(n))
                        scheduleAutoSave()
                        return v
                      },
                      className: inpClass,
                    })}
                  />
                  <p className="text-[11px] text-gray-600 mt-1.5">
                    Após quantos <strong className="text-gray-400">LOSS com gales esgotados</strong> o bot para.
                    WIN zera a contagem de ciclos (igual Blaze/Jonbet).
                  </p>
                </div>
                <div
                  className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                    settings.skipFirstEntry
                      ? "bg-amber-500/8 border-amber-500/30"
                      : "bg-gray-900/60 border-gray-800"
                  }`}
                >
                  <div>
                    <p
                      className={`text-sm font-semibold ${
                        settings.skipFirstEntry ? "text-amber-300" : "text-gray-300"
                      }`}
                    >
                      Pular Primeira Entrada
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {settings.skipFirstEntry
                        ? "Igual Double: em TODA oportunidade observa 1 rodada sem apostar; se NÃO bater, entra de verdade no mesmo sinal."
                        : "Entra de verdade assim que o sinal aparece"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      settingsDirty.current = true
                      setSettings((prev) => {
                        if (!prev) return null
                        const next = {
                          ...prev,
                          skipFirstEntry: !prev.skipFirstEntry,
                          ...(!prev.skipFirstEntry ? { skipEntryAfterLoss: false } : {}),
                        }
                        settingsRef.current = next
                        return next
                      })
                      scheduleAutoSave()
                    }}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 overflow-hidden ${
                      settings.skipFirstEntry ? "bg-green-500" : "bg-gray-700"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 ${
                        settings.skipFirstEntry ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                <div
                  className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                    settings.skipEntryAfterLoss
                      ? "bg-amber-500/8 border-amber-500/30"
                      : "bg-gray-900/60 border-gray-800"
                  }`}
                >
                  <div>
                    <p
                      className={`text-sm font-semibold ${
                        settings.skipEntryAfterLoss ? "text-amber-300" : "text-gray-300"
                      }`}
                    >
                      Entrada Após Loss
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {settings.skipEntryAfterLoss
                        ? "Igual Double: em TODA oportunidade simula entrada + gales virtuais; só aposta se a sequência inteira perderia."
                        : "Entra de verdade assim que o sinal aparece"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      settingsDirty.current = true
                      setSettings((prev) => {
                        if (!prev) return null
                        const next = {
                          ...prev,
                          skipEntryAfterLoss: !prev.skipEntryAfterLoss,
                          ...(!prev.skipEntryAfterLoss ? { skipFirstEntry: false } : {}),
                        }
                        settingsRef.current = next
                        return next
                      })
                      scheduleAutoSave()
                    }}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 overflow-hidden ${
                      settings.skipEntryAfterLoss ? "bg-green-500" : "bg-gray-700"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 ${
                        settings.skipEntryAfterLoss ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => void saveSettings()}
            disabled={acting}
            className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold py-2.5 rounded-xl text-sm transition-colors"
          >
            {acting ? "Salvando…" : "Salvar configurações"}
          </button>
          <p className="text-[11px] text-gray-600 text-center -mt-1">
            Também salva sozinho ao sair do campo ou da aba.
          </p>
        </div>
      )}

      {tab === "config" && !settings && (
        <div className="text-gray-400 text-sm py-4">Carregando configurações…</div>
      )}

      {/* INICIAR BOT — layout igual Blaze/Jonbet */}
      {tab === "bot" && (
        <div className="space-y-5">
          {/* Resumo da Configuração */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">Resumo da Configuração</h2>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Tipo de Estratégia</span>
                <span className="text-xs font-semibold text-white">
                  {estrategiaTipo === "HORARIOS"
                    ? "Horários"
                    : "Padrões / Indicadores"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Estratégias ativas</span>
                <span className="text-xs font-semibold text-white">{strategies.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Modo de Operação</span>
                <span
                  className={`text-xs font-semibold ${
                    iqAccountType === "REAL" ? "text-green-400" : "text-yellow-400"
                  }`}
                >
                  {iqAccountType === "REAL" ? "CONTA REAL" : "CONTA DEMO"}
                </span>
              </div>
              <div className="h-px bg-gray-800" />
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Valor de Entrada</span>
                <span className="text-xs font-semibold text-white">
                  R$ {Number(settings?.enterValue ?? 2).toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Qtd. de Gales</span>
                <span className="text-xs font-semibold text-white">
                  {settings?.martingale ?? 0}
                  {(settings?.martingale ?? 0) > 0
                    ? ` (Mult. ${Number(settings?.martingaleMultiplier ?? 2).toFixed(1)}x)`
                    : ""}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Expiração</span>
                <span className="text-xs font-semibold text-white">
                  conforme a estratégia
                </span>
              </div>
              <div className="h-px bg-gray-800" />
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Ciclos do Robô</span>
                <span className="text-xs font-semibold text-white">
                  {settings?.quantityCycles ?? 1}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Pular 1ª Entrada</span>
                <span
                  className={`text-xs font-semibold ${
                    settings?.skipFirstEntry ? "text-green-400" : "text-gray-500"
                  }`}
                >
                  {settings?.skipFirstEntry ? "ATIVADO" : "DESATIVADO"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Entrada Após Loss</span>
                <span
                  className={`text-xs font-semibold ${
                    settings?.skipEntryAfterLoss ? "text-green-400" : "text-gray-500"
                  }`}
                >
                  {settings?.skipEntryAfterLoss ? "ATIVADO" : "DESATIVADO"}
                </span>
              </div>
              <div className="h-px bg-gray-800" />
              {settings?.stopType === "QUANTIDADE" ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">Stop Win (Quantidade)</span>
                    <span className="text-xs font-semibold text-green-400">
                      {variables?.countWin ?? 0}/{settings?.stopGain ?? "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">Stop Loss (Quantidade)</span>
                    <span className="text-xs font-semibold text-red-400">
                      {variables?.countLoss ?? 0}/{settings?.stopLoss ?? "—"}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">Stop Win (Meta de Lucro)</span>
                    <span className="text-xs font-semibold text-green-400">
                      R$ {Number(settings?.stopGain ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">Stop Loss (Limite de Perda)</span>
                    <span className="text-xs font-semibold text-red-400">
                      R$ {Number(settings?.stopLoss ?? 0).toFixed(2)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Sessão Atual */}
          <div className="rounded-2xl border border-gray-800 bg-gradient-to-b from-[#0d1525] to-[#0a0f18] p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Sessão Atual</h2>
              {(isActive || stopPending) ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  {stopPending
                    ? "Finalizando entrada..."
                    : isBetting || variables?.isGale
                      ? "Apostando..."
                      : "Aguardando..."}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="w-2 h-2 rounded-full bg-gray-600" />
                  Parado
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="col-span-2 rounded-xl bg-black/30 border border-gray-800/80 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">Banca</p>
                <p className="text-white font-black text-lg tabular-nums">
                  {connected && balanceSynced ? balLabel : connected ? "—" : "Não conectado"}
                </p>
              </div>
              <div className="col-span-2 rounded-xl bg-black/30 border border-gray-800/80 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">Lucro</p>
                <p
                  className={`font-black text-lg tabular-nums ${
                    Number(variables?.profit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {Number(variables?.profit ?? 0) >= 0 ? "+" : ""}
                  {currency === "BRL" ? "R$" : "$"}{" "}
                  {Number(variables?.profit ?? 0).toFixed(2)}
                </p>
              </div>
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">Vitórias</p>
                <p className="text-emerald-400 font-black text-xl tabular-nums">{variables?.countWin ?? 0}</p>
              </div>
              <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">Derrotas</p>
                <p className="text-red-400 font-black text-xl tabular-nums">{variables?.countLoss ?? 0}</p>
              </div>
            </div>
            {variables?.isGale && (
              <div className="mt-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 flex items-center justify-between">
                <span className="text-amber-400 text-xs font-medium">Em Gale</span>
                <span className="text-amber-300 text-xs font-bold">
                  {variables.countMartingale}/{settings?.martingale ?? "?"}
                </span>
              </div>
            )}
          </div>

          {!connected && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 text-amber-300 text-sm">
              Conecte a IQ Option na aba <strong>Conta IQ</strong> antes de iniciar o bot.
            </div>
          )}

          {strategies.length === 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 text-amber-300 text-sm">
              Cadastre ao menos uma estratégia na aba <strong>Estratégias</strong>.
            </div>
          )}

          {stopPending && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 text-yellow-400 text-sm">
              ⏸️ Estou no meio de uma entrada — assim que sair o resultado (WIN ou LOSS), vou parar o sistema e todas as operações.
            </div>
          )}

          {/* Start / Stop full-width — igual Blaze/Jonbet */}
          {(isActive || stopPending) ? (
            <button
              type="button"
              onClick={stopBot}
              disabled={acting || stopPending}
              className="w-full bg-red-500 hover:bg-red-400 disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none text-white font-bold py-3 rounded-xl text-sm transition-colors"
            >
              {stopPending ? "Finalizando entrada..." : acting ? "Parando..." : "Parar Bot"}
            </button>
          ) : (
            <button
              type="button"
              onClick={startBot}
              disabled={acting || !connected || strategies.length === 0 || stopPending}
              className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-60 disabled:cursor-not-allowed text-black font-bold py-3 rounded-xl text-sm transition-colors"
            >
              {acting ? "Iniciando..." : "Iniciar Bot"}
            </button>
          )}

          {/* Histórico — cards iguais aos outros jogos (com horário) */}
          {(history.length > 0 || messages.length > 0 || entries.length > 0) && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-white">Histórico</h2>
                <button
                  type="button"
                  onClick={() => {
                    setMessages([])
                    setEntries([])
                    setHistory([])
                  }}
                  className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                >
                  Limpar
                </button>
              </div>
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {history.length > 0 ? (
                  history.map((entry) => <DayTradeLogRow key={entry.id} entry={entry} />)
                ) : (
                  <p className="text-xs text-gray-500 py-4 text-center">
                    Sem entradas nesta sessão. Ao encontrar sinal, o card aparece aqui com horário.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


