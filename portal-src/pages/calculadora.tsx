import { useEffect, useMemo, useState } from "react"
import { NumberField } from "@/components/ui/NumberField"

type Platform = "BLAZE" | "JONBET"
type Game = "CRASH" | "DOUBLE" | "FORTUNE"
type ModeKey = "CONTROLADO" | "ANALITICO" | "ARRISCADO"

interface ModeConfig {
  key: ModeKey
  label: string
  icon: string
  accent: string
  crashTarget: number
  galeMultiplier: number
  bancaPercentCap: number
  stopLossCeilingPercent: number
  riskRewardMultiplier: number
  cycleTarget: number
  protectionOn: boolean
  management: "SKIP_FIRST" | "AFTER_LOSS"
  detailed: boolean
  blurb: string
}

const MODES: ModeConfig[] = [
  {
    key: "CONTROLADO",
    label: "Controlado",
    icon: "🛡️",
    accent: "emerald",
    crashTarget: 1.5,
    galeMultiplier: 1.8,
    bancaPercentCap: 0.03,
    stopLossCeilingPercent: 0.40,
    riskRewardMultiplier: 2.5,
    cycleTarget: 3,
    protectionOn: true,
    management: "AFTER_LOSS",
    detailed: false,
    blurb: "Alvo baixo e aposta pequena — prioriza não perder a banca, mesmo que demore mais pra bater a meta.",
  },
  {
    key: "ANALITICO",
    label: "Analítico",
    icon: "📊",
    accent: "sky",
    crashTarget: 2.0,
    galeMultiplier: 2.0,
    bancaPercentCap: 0.05,
    stopLossCeilingPercent: 0.60,
    riskRewardMultiplier: 4,
    cycleTarget: 2,
    protectionOn: true,
    management: "AFTER_LOSS",
    detailed: true,
    blurb: "Equilíbrio entre risco e velocidade — mostra o detalhamento gale a gale pra você entender exatamente de onde vem cada número.",
  },
  {
    key: "ARRISCADO",
    label: "Arriscado",
    icon: "🔥",
    accent: "rose",
    crashTarget: 3.0,
    galeMultiplier: 2.5,
    bancaPercentCap: 0.10,
    stopLossCeilingPercent: 0.85,
    riskRewardMultiplier: 8,
    cycleTarget: 1,
    protectionOn: false,
    management: "SKIP_FIRST",
    detailed: false,
    blurb: "Alvo alto e aposta maior — bate a meta em menos entradas, mas arrisca uma fatia bem maior da banca por ciclo.",
  },
]

const ACCENT_CLASSES: Record<string, { border: string; text: string; bg: string; solidBg: string }> = {
  emerald: { border: "border-emerald-500/30", text: "text-emerald-400", bg: "bg-emerald-500/10", solidBg: "bg-emerald-600 hover:bg-emerald-500" },
  sky:     { border: "border-sky-500/30",     text: "text-sky-400",     bg: "bg-sky-500/10",     solidBg: "bg-sky-600 hover:bg-sky-500" },
  rose:    { border: "border-rose-500/30",    text: "text-rose-400",    bg: "bg-rose-500/10",    solidBg: "bg-rose-600 hover:bg-rose-500" },
}

function money(v: number) {
  return `R$ ${v.toFixed(2)}`
}

interface CalcInputs {
  banca: number
  gales: number
  metaDoDia: number
}

interface CalcResult {
  base: number
  target: number
  targetLabel: string
  entradasNecessarias: number
  gales: number
  maxPerdas: number
  ciclosSustentaveis: number
  perdaMaximaPorCiclo: number
  perdaMaximaTotal: number
  lucroProjetado: number
  aviso: string | null
  maxPerdasFonte: "banca" | "meta"
  galeBreakdown: { nivel: number; valor: number; perdaAcumulada: number }[]
  cicloBreakdown: { ciclo: number; entrada: number; perdaCiclo: number; perdaAcumulada: number; restante: number }[]
}

function computeResult(mode: ModeConfig, game: Game, inputs: CalcInputs): CalcResult {
  const target = game === "CRASH" ? mode.crashTarget : 2.0
  const targetLabel = game === "CRASH" ? `${target.toFixed(1)}x` : "cor simples (~2x)"

  const banca = Math.max(0, inputs.banca)
  const gales = Math.max(0, Math.floor(inputs.gales))
  const metaDoDia = Math.max(0, inputs.metaDoDia)

  // Cada modo já define seu próprio teto de risco por entrada (% da banca)
  // — o sistema monta essa parte sozinho, o cliente só informa banca/
  // gales/meta. O Stop Loss NÃO é só % da banca: se fosse só isso, banca
  // some da conta de quantos ciclos cabem (base e stop loss cresceriam na
  // mesma proporção e se cancelariam) — por isso ele é o MENOR entre o
  // teto de risco da banca e um múltiplo da meta do dia (não faz sentido
  // arriscar muito mais do que o cliente quer ganhar). Assim banca, meta
  // E gales realmente mudam o resultado, não só a aparência dele.
  const baseFinal = Number((banca * mode.bancaPercentCap).toFixed(2))
  const bancaCap = Number((banca * mode.stopLossCeilingPercent).toFixed(2))
  const metaCap = metaDoDia > 0 ? Number((metaDoDia * mode.riskRewardMultiplier).toFixed(2)) : bancaCap
  const maxPerdas = Math.min(bancaCap, metaCap)
  const maxPerdasFonte: "banca" | "meta" = bancaCap <= metaCap ? "banca" : "meta"

  const profitPerWin = baseFinal * (target - 1)
  const entradasNecessarias = profitPerWin > 0 ? Math.ceil(metaDoDia / profitPerWin) : 0

  const m = mode.galeMultiplier
  const galeBreakdown: { nivel: number; valor: number; perdaAcumulada: number }[] = []
  let acumulado = 0
  for (let i = 0; i <= gales; i++) {
    const valor = Number((baseFinal * Math.pow(m, i)).toFixed(2))
    acumulado = Number((acumulado + valor).toFixed(2))
    galeBreakdown.push({ nivel: i, valor, perdaAcumulada: acumulado })
  }
  const perdaMaximaPorCiclo = galeBreakdown.length ? galeBreakdown[galeBreakdown.length - 1].perdaAcumulada : 0

  // O bot real não reinicia cada ciclo do zero: quando um ciclo esgota os
  // gales, o próximo ciclo entra direto com o valor da ÚLTIMA aposta
  // perdida (cycleBaseAmount = currentBetAmount), não com a entrada base
  // de novo. Isso escala por m^gales a cada ciclo perdido seguido — por
  // isso a perda soma muito mais rápido do que "N x perda do ciclo 1".
  //
  // Cada modo tem uma meta de ciclos (cycleTarget) que reflete o perfil
  // dele — Controlado tenta sustentar mais ciclos seguidos de perda,
  // Arriscado só 1 (vai tudo ou nada mais rápido). O sistema só entrega
  // essa meta cheia se ela realmente couber no Stop Loss calculado; se a
  // quantidade de gales escolhida tornar isso caro demais, reduz e avisa
  // — assim gales vira o fator que o cliente sente mexer no resultado.
  const escalada = Math.pow(m, gales)
  const cicloBreakdown: { ciclo: number; entrada: number; perdaCiclo: number; perdaAcumulada: number; restante: number }[] = []
  let entradaCiclo = baseFinal
  let acumuladoCiclos = 0
  const fatorSerie = baseFinal > 0 ? perdaMaximaPorCiclo / baseFinal : 0
  for (let i = 1; i <= mode.cycleTarget; i++) {
    const perdaCiclo = Number((entradaCiclo * fatorSerie).toFixed(2))
    const novoAcumulado = Number((acumuladoCiclos + perdaCiclo).toFixed(2))
    if (novoAcumulado > maxPerdas && cicloBreakdown.length > 0) break
    acumuladoCiclos = novoAcumulado
    cicloBreakdown.push({ ciclo: i, entrada: entradaCiclo, perdaCiclo, perdaAcumulada: acumuladoCiclos, restante: Number((maxPerdas - acumuladoCiclos).toFixed(2)) })
    entradaCiclo = Number((entradaCiclo * escalada).toFixed(2))
    if (acumuladoCiclos >= maxPerdas || perdaCiclo <= 0) break
  }
  const ciclosSustentaveis = Math.max(1, cicloBreakdown.length)
  const perdaMaximaTotal = cicloBreakdown.length ? cicloBreakdown[cicloBreakdown.length - 1].perdaAcumulada : perdaMaximaPorCiclo
  const metaFonteLabel = maxPerdasFonte === "banca" ? "o teto de risco da banca" : "a meta do dia"

  const aviso = baseFinal <= 0
    ? "Informe o valor da banca para o sistema calcular a configuração."
    : ciclosSustentaveis < mode.cycleTarget
      ? `Esse modo mira em ${mode.cycleTarget} ciclo(s) seguidos de perda, mas com ${gales} gale(s) o Stop Loss (limitado por ${metaFonteLabel}) só sustenta ${ciclosSustentaveis}. Reduza a quantidade de gales pra chegar aos ${mode.cycleTarget} completos.`
      : null

  return {
    base: baseFinal,
    target,
    targetLabel,
    entradasNecessarias,
    gales,
    maxPerdas,
    ciclosSustentaveis,
    perdaMaximaPorCiclo: Number(perdaMaximaPorCiclo.toFixed(2)),
    perdaMaximaTotal,
    lucroProjetado: metaDoDia,
    aviso,
    maxPerdasFonte,
    galeBreakdown,
    cicloBreakdown,
  }
}

function ModeCard({
  mode, game, platform, inputs,
}: { mode: ModeConfig; game: Game; platform: Platform; inputs: CalcInputs }) {
  const result = useMemo(() => computeResult(mode, game, inputs), [mode, game, inputs])
  const accent = ACCENT_CLASSES[mode.accent]
  const [showDetail, setShowDetail] = useState(mode.detailed)
  const [showCiclos, setShowCiclos] = useState(false)
  const [applyState, setApplyState] = useState<"idle" | "loading" | "ok" | "error">("idle")

  const managementLabel = mode.management === "SKIP_FIRST" ? "Pular Primeira Entrada" : "Entrada Após Loss"
  const managementExplain =
    mode.management === "SKIP_FIRST"
      ? "Confirma o padrão observando 1 rodada antes de apostar de verdade — prioriza velocidade."
      : "Simula a sequência de gale inteira antes de confirmar — só entra de verdade se o padrão já teria perdido, prioriza segurança."

  async function handleApply() {
    setApplyState("loading")
    try {
      const payload: Record<string, any> = {
        enterType: "VALOR",
        enterValue: result.base,
        martingale: result.gales,
        martingaleMultiplier: mode.galeMultiplier,
        quantityCycles: result.ciclosSustentaveis,
        stopType: "VALOR",
        stopGain: String(inputs.metaDoDia),
        stopLoss: String(result.maxPerdas),
        skipFirstEntry: mode.management === "SKIP_FIRST",
        skipEntryAfterLoss: mode.management === "AFTER_LOSS",
      }
      if (game !== "CRASH") {
        payload.protectionHand = mode.protectionOn ? "SIM" : "NÃO"
        payload.protectionValue = mode.protectionOn ? result.base : 0
      }
      const url = platform === "BLAZE" ? "/api/user/configuracoes" : "/api/user/jonbet/configuracoes"
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      setApplyState(res.ok ? "ok" : "error")
    } catch {
      setApplyState("error")
    }
    setTimeout(() => setApplyState("idle"), 4000)
  }

  return (
    <div className={`bg-gray-900 border ${accent.border} rounded-xl p-5 flex flex-col gap-4`}>
      <div>
        <div className="flex items-center gap-2">
          <span className="text-xl">{mode.icon}</span>
          <h3 className={`text-lg font-bold ${accent.text}`}>{mode.label}</h3>
        </div>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">{mode.blurb}</p>
      </div>

      {result.aviso && (
        <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
          ⚠️ {result.aviso}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-gray-500 text-[11px]">Valor de entrada</p>
          <p className="text-white font-semibold">{money(result.base)}</p>
        </div>
        <div>
          <p className="text-gray-500 text-[11px]">Alvo</p>
          <p className="text-white font-semibold">{result.targetLabel}</p>
        </div>
        <div>
          <p className="text-gray-500 text-[11px]">Gales</p>
          <p className="text-white font-semibold">{result.gales}</p>
        </div>
        <div>
          <p className="text-gray-500 text-[11px]">Entradas necessárias</p>
          <p className="text-white font-semibold">{result.entradasNecessarias || "—"}</p>
        </div>
        <div>
          <p className="text-gray-500 text-[11px]">Ciclos recomendados</p>
          <p className="text-white font-semibold">{result.ciclosSustentaveis}</p>
        </div>
        {game !== "CRASH" && (
          <div>
            <p className="text-gray-500 text-[11px]">Proteção Branco/Amarelo</p>
            <p className="text-white font-semibold">{mode.protectionOn ? `Sim — ${money(result.base)}` : "Não"}</p>
          </div>
        )}
        <div>
          <p className="text-gray-500 text-[11px]">Stop Win</p>
          <p className="text-green-400 font-semibold">{money(inputs.metaDoDia)}</p>
        </div>
        <div>
          <p className="text-gray-500 text-[11px]">
            Stop Loss <span className="text-gray-600">({result.maxPerdasFonte === "banca" ? "limitado pela banca" : "limitado pela meta"})</span>
          </p>
          <p className="text-red-400 font-semibold">{money(result.maxPerdas)}</p>
        </div>
      </div>

      <div className="bg-gray-950/60 border border-gray-800 rounded-lg p-3">
        <p className="text-[11px] text-gray-500 mb-1">Gestão recomendada</p>
        <p className={`text-sm font-semibold ${accent.text}`}>{managementLabel}</p>
        <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{managementExplain}</p>
      </div>

      <div className="bg-gray-950/60 border border-gray-800 rounded-lg p-3 space-y-1">
        <p className="text-[11px] text-gray-500 mb-1">Se bater tudo (cenário completo)</p>
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Lucro projetado</span>
          <span className="text-green-400 font-semibold">+{money(result.lucroProjetado)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Perda máxima por ciclo</span>
          <span className="text-red-400 font-semibold">-{money(result.perdaMaximaPorCiclo)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Perda máxima total ({result.ciclosSustentaveis} ciclo(s))</span>
          <span className="text-red-400 font-semibold">-{money(result.perdaMaximaTotal)}</span>
        </div>
      </div>

      <button
        onClick={() => setShowDetail((v) => !v)}
        className="text-[11px] text-gray-500 hover:text-gray-300 text-left"
      >
        {showDetail ? "▲ esconder detalhamento gale a gale" : "▼ ver detalhamento gale a gale"}
      </button>
      {showDetail && (
        <div className="bg-gray-950/60 border border-gray-800 rounded-lg p-3 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-gray-500 text-left">
                <th className="pb-1">Gale</th>
                <th className="pb-1">Valor da aposta</th>
                <th className="pb-1">Perda acumulada se falhar</th>
              </tr>
            </thead>
            <tbody>
              {result.galeBreakdown.map((g) => (
                <tr key={g.nivel} className="border-t border-gray-900">
                  <td className="py-1 text-gray-300">{g.nivel === 0 ? "Entrada" : `Gale ${g.nivel}`}</td>
                  <td className="py-1 text-white">{money(g.valor)}</td>
                  <td className="py-1 text-red-400">{money(g.perdaAcumulada)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        onClick={() => setShowCiclos((v) => !v)}
        className="text-[11px] text-gray-500 hover:text-gray-300 text-left"
      >
        {showCiclos ? "▲ esconder detalhamento por ciclo" : `▼ ver como ficam os ${result.ciclosSustentaveis} ciclo(s) até o Stop Loss`}
      </button>
      {showCiclos && (
        <div className="bg-gray-950/60 border border-gray-800 rounded-lg p-3 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-gray-500 text-left">
                <th className="pb-1">Ciclo</th>
                <th className="pb-1">Entrada do ciclo</th>
                <th className="pb-1">Perda se esse ciclo falhar</th>
                <th className="pb-1">Perda acumulada</th>
                <th className="pb-1">Resta até o Stop Loss</th>
              </tr>
            </thead>
            <tbody>
              {result.cicloBreakdown.map((c) => (
                <tr key={c.ciclo} className="border-t border-gray-900">
                  <td className="py-1 text-gray-300">Ciclo {c.ciclo}</td>
                  <td className="py-1 text-white">{money(c.entrada)}</td>
                  <td className="py-1 text-red-400">{money(c.perdaCiclo)}</td>
                  <td className="py-1 text-red-400">{money(c.perdaAcumulada)}</td>
                  <td className="py-1 text-white">{money(c.restante)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        onClick={handleApply}
        disabled={applyState === "loading"}
        className={`w-full ${accent.solidBg} disabled:opacity-50 text-white font-bold py-2.5 rounded-lg text-sm transition-colors`}
      >
        {applyState === "loading" ? "Aplicando..." : applyState === "ok" ? "✅ Aplicado!" : applyState === "error" ? "❌ Erro — tente de novo" : "Aplicar essa configuração"}
      </button>
      {applyState === "ok" && (
        <p className="text-[11px] text-green-400 text-center -mt-2">
          Configuração salva — ative o bot na aba Conta {platform === "BLAZE" ? "Blaze" : "Jonbet"} pra começar.
        </p>
      )}
    </div>
  )
}

export default function CalculadoraPage() {
  const [platform, setPlatform] = useState<Platform>("BLAZE")
  const [game, setGame] = useState<Game>("CRASH")
  const [banca, setBanca] = useState(100)
  const [gales, setGales] = useState(2)
  const [metaDoDia, setMetaDoDia] = useState(20)
  const [bancaLoading, setBancaLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadBalance() {
      setBancaLoading(true)
      try {
        const url = platform === "BLAZE" ? "/api/user/balance" : "/api/user/jonbet/balance"
        const res = await fetch(url)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && typeof data.balance === "number") setBanca(data.balance)
      } catch {
        // mantém o valor atual se a consulta de saldo falhar
      } finally {
        if (!cancelled) setBancaLoading(false)
      }
    }
    loadBalance()
    return () => { cancelled = true }
  }, [platform])

  const inputs: CalcInputs = { banca, gales, metaDoDia }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">🧮 Calculadora Premium</h1>
        <p className="text-gray-400 text-sm mt-1">
          Informe sua banca e seus limites — o sistema calcula 3 perfis de configuração prontos pra usar.
        </p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="col-span-1">
            <label className="text-gray-500 text-[11px]">Plataforma</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as Platform)}
              className="w-full mt-1 bg-gray-950 border border-gray-800 rounded-lg px-2 py-2 text-sm text-white"
            >
              <option value="BLAZE">Blaze</option>
              <option value="JONBET">Jonbet</option>
            </select>
          </div>
          <div className="col-span-1">
            <label className="text-gray-500 text-[11px]">Jogo</label>
            <select
              value={game}
              onChange={(e) => setGame(e.target.value as Game)}
              className="w-full mt-1 bg-gray-950 border border-gray-800 rounded-lg px-2 py-2 text-sm text-white"
            >
              <option value="CRASH">Crash</option>
              <option value="DOUBLE">Double</option>
              <option value="FORTUNE">Fortune</option>
            </select>
          </div>
          <div className="col-span-1">
            <label className="text-gray-500 text-[11px]">
              Valor da banca (R$){bancaLoading ? " — buscando saldo..." : ""}
            </label>
            <NumberField
              value={banca}
              onChange={setBanca}
              className="w-full mt-1 bg-gray-950 border border-gray-800 rounded-lg px-2 py-2 text-sm text-white"
            />
            <p className="text-[10px] text-gray-600 mt-1">Preenchido com seu saldo atual — edite se quiser.</p>
          </div>
          <div className="col-span-1">
            <label className="text-gray-500 text-[11px]">Quantidade de gales</label>
            <NumberField
              value={gales}
              onChange={setGales}
              className="w-full mt-1 bg-gray-950 border border-gray-800 rounded-lg px-2 py-2 text-sm text-white"
            />
          </div>
          <div className="col-span-1">
            <label className="text-gray-500 text-[11px]">Meta do dia (R$)</label>
            <NumberField
              value={metaDoDia}
              onChange={setMetaDoDia}
              className="w-full mt-1 bg-gray-950 border border-gray-800 rounded-lg px-2 py-2 text-sm text-white"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {MODES.map((mode) => (
          <ModeCard key={mode.key} mode={mode} game={game} platform={platform} inputs={inputs} />
        ))}
      </div>
    </div>
  )
}
