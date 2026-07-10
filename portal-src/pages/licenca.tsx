import { useEffect, useState } from "react"
import { FEATURES } from "@/lib/features"

type Plan    = { title: string; days: number; amount: number; features?: string[] }
type QRData  = { qrCode: string; qrCodeBase64: string | null; amount: number; days: number; title: string }

// Dias quando sobra tempo de sobra, mas hora/minuto quando falta menos de
// um dia — importante pro trial, que costuma ser medido em horas.
function formatTimeLeft(ms: number): string {
  if (ms <= 0) return "0 minutos"
  const totalMinutes = Math.floor(ms / 60000)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `${days} dia${days !== 1 ? "s" : ""}${hours > 0 ? ` e ${hours}h` : ""}`
  if (hours > 0) return `${hours} hora${hours !== 1 ? "s" : ""}${minutes > 0 ? ` e ${minutes}min` : ""}`
  return `${minutes} minuto${minutes !== 1 ? "s" : ""}`
}

export default function LicencaPage() {
  const [paymentStatus,  setPaymentStatus]  = useState("")
  const [expireIn,       setExpireIn]       = useState<string | null>(null)
  const [isTesting,      setIsTesting]      = useState(false)
  const [alreadyTested,  setAlreadyTested]  = useState(true)
  const [trialHours,     setTrialHours]     = useState(0)
  const [loadingUser,    setLoadingUser]    = useState(true)

  const [plans,          setPlans]          = useState<Plan[]>([])
  const [loadingPlans,   setLoadingPlans]   = useState(true)

  const [selectedPlan,   setSelectedPlan]   = useState<number | null>(null)
  const [paying,         setPaying]         = useState(false)
  const [payErr,         setPayErr]         = useState("")
  const [qr,             setQr]             = useState<QRData | null>(null)
  const [copied,         setCopied]         = useState(false)
  const [checking,       setChecking]       = useState(false)
  const [trialLoading,   setTrialLoading]   = useState(false)
  const [trialErr,       setTrialErr]       = useState("")

  useEffect(() => {
    fetch("/api/user/me").then((r) => r.json()).then((d) => {
      setPaymentStatus(d.paymentStatus ?? "PENDING")
      setExpireIn(d.expireIn ?? null)
      setIsTesting(!!d.isTesting)
      setAlreadyTested(!!d.alreadyTested)
      setLoadingUser(false)
    }).catch(() => setLoadingUser(false))

    fetch("/api/plans", { cache: "no-store" }).then((r) => r.json()).then((d) => {
      setPlans(d.plans ?? [])
      setTrialHours(d.trialHours ?? 0)
      setLoadingPlans(false)
    }).catch(() => setLoadingPlans(false))
  }, [])

  // Poll for payment confirmation
  useEffect(() => {
    if (!qr) return
    const iv = setInterval(async () => {
      try {
        setChecking(true)
        const me = await fetch("/api/user/me").then((r) => r.json())
        if (me.paymentStatus === "PAID" && me.expireIn && new Date(me.expireIn) > new Date()) {
          clearInterval(iv)
          setPaymentStatus("PAID")
          setExpireIn(me.expireIn)
          setQr(null)
          setSelectedPlan(null)
        }
      } catch {} finally { setChecking(false) }
    }, 5000)
    return () => clearInterval(iv)
  }, [qr])

  async function activateTrial() {
    setTrialLoading(true)
    setTrialErr("")
    try {
      const res = await fetch("/api/trial/start", { method: "POST" })
      const data = await res.json()
      if (!res.ok) { setTrialErr(data.error ?? "Erro ao ativar trial"); return }
      setIsTesting(true)
      setAlreadyTested(true)
      setPaymentStatus("PAID")
      setExpireIn(data.expireIn)
    } catch { setTrialErr("Erro ao conectar") }
    finally { setTrialLoading(false) }
  }

  async function handleSelectPlan(index: number) {
    setSelectedPlan(index)
    setPaying(true)
    setPayErr("")
    setQr(null)
    try {
      const res = await fetch("/api/payment/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planIndex: index }),
      })
      const data = await res.json()
      if (!res.ok) { setPayErr(data.error ?? "Erro ao gerar pagamento"); setPaying(false); return }
      setQr(data)
    } catch { setPayErr("Erro ao conectar") }
    setPaying(false)
  }

  function copyCode() {
    if (!qr?.qrCode) return
    navigator.clipboard.writeText(qr.qrCode).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  const expireDate = expireIn ? new Date(expireIn) : null
  const isExpired  = expireDate ? expireDate < new Date() : true
  const timeLeftLabel = expireDate && !isExpired ? formatTimeLeft(expireDate.getTime() - Date.now()) : ""
  const isPaid     = paymentStatus === "PAID" && !isExpired
  const isActive   = isPaid || (isTesting && !isExpired)

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Licença</h1>
        <p className="text-gray-400 text-sm mt-1">Seu plano e validade de acesso</p>
      </div>

      {/* Status atual */}
      {!loadingUser && (
        <div className={`border rounded-xl p-5 ${
          isActive
            ? "bg-green-500/5 border-green-500/30"
            : "bg-red-500/5 border-red-500/20"
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full flex-shrink-0 ${isActive ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
            <div>
              <p className={`font-semibold text-sm ${isActive ? "text-green-400" : "text-red-400"}`}>
                {isPaid ? "Licença Ativa" : isTesting && !isExpired ? "Trial Ativo" : "Licença Expirada / Pendente"}
              </p>
              {expireDate && !isExpired && (
                <p className="text-gray-400 text-xs mt-0.5">
                  Expira em <span className="text-white">{expireDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</span>
                  {" · "}<span className="text-white font-semibold">{timeLeftLabel} restantes</span>
                </p>
              )}
              {(!expireDate || isExpired) && (
                <p className="text-gray-500 text-xs mt-0.5">Nenhuma licença ativa no momento.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Trial grátis */}
      {!loadingUser && !loadingPlans && !isActive && !alreadyTested && trialHours > 0 && (
        <div className="bg-gray-900 border border-green-500/30 rounded-xl p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-green-500/15 flex items-center justify-center text-xl flex-shrink-0">🎁</div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm">Teste Grátis por {trialHours}h</p>
              <p className="text-gray-400 text-xs mt-0.5">
                Acesso completo ao bot por {trialHours} {trialHours === 1 ? "hora" : "horas"}, sem precisar pagar. Disponível uma vez por conta.
              </p>
              {trialErr && <p className="text-red-400 text-xs mt-2">{trialErr}</p>}
              <button
                onClick={activateTrial}
                disabled={trialLoading}
                className="mt-3 w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold py-2.5 rounded-xl text-sm transition-colors"
              >
                {trialLoading ? "Ativando..." : "Começar Teste Grátis"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Planos */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-white">
            {isActive ? "Renovar / Trocar Plano" : "Planos Disponíveis"}
          </h2>
          <p className="text-gray-500 text-xs mt-0.5">Pagamento via Pix — liberação automática após confirmação</p>
        </div>

        {loadingPlans ? (
          <div className="flex justify-center py-6">
            <div className="w-5 h-5 border-2 border-gray-600 border-t-green-400 rounded-full animate-spin" />
          </div>
        ) : plans.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">Nenhum plano disponível. Contate o suporte.</p>
        ) : (
          <div className="space-y-2">
            {plans.map((plan, i) => {
              const isSelected = selectedPlan === i
              return (
                <button key={i} onClick={() => handleSelectPlan(i)} disabled={paying}
                  className={`w-full text-left rounded-xl px-4 py-4 border transition-all disabled:opacity-50 ${
                    isSelected
                      ? "bg-green-500/10 border-green-500/40 ring-1 ring-green-500/20"
                      : "bg-gray-800 border-gray-700 hover:border-gray-500 hover:bg-gray-700/60"
                  }`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-semibold text-sm">{plan.title}</p>
                      <p className="text-gray-500 text-xs mt-0.5">{plan.days} dias de acesso</p>
                    </div>
                    <div className="text-right">
                      <p className="text-green-400 font-bold text-lg">R$ {plan.amount.toFixed(2)}</p>
                      {isSelected && paying && <p className="text-xs text-gray-400">Gerando QR...</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(plan.features?.length ?? 0) === 0
                      ? <span className="text-[10px] text-gray-600 italic">Sem abas incluídas</span>
                      : plan.features!.map((key) => {
                          const f = FEATURES.find((x) => x.key === key)
                          return (
                            <span key={key} className="text-[10px] bg-blue-500/15 text-blue-300 px-1.5 py-0.5 rounded">
                              ✓ {f?.label ?? key}
                            </span>
                          )
                        })}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {payErr && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
            {payErr}
          </div>
        )}
      </div>

      {/* QR Code */}
      {qr && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <div className="text-center">
            <p className="text-white font-semibold">Pague via Pix</p>
            <p className="text-gray-500 text-xs mt-0.5">{qr.title} · R$ {qr.amount.toFixed(2)}</p>
          </div>

          {qr.qrCodeBase64 && (
            <div className="flex justify-center">
              <div className="bg-white p-3 rounded-xl">
                <img src={`data:image/png;base64,${qr.qrCodeBase64}`} alt="QR Code Pix" className="w-52 h-52" />
              </div>
            </div>
          )}

          {qr.qrCode && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 text-center">Ou copie o código Pix:</p>
              <div className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2">
                <p className="text-gray-300 text-xs font-mono break-all leading-relaxed line-clamp-3">{qr.qrCode}</p>
              </div>
              <button onClick={copyCode}
                className={`w-full font-semibold py-2.5 rounded-xl text-sm transition-colors ${
                  copied ? "bg-green-500 text-black" : "bg-gray-700 hover:bg-gray-600 text-white"
                }`}>
                {copied ? "✅ Copiado!" : "Copiar código Pix"}
              </button>
            </div>
          )}

          <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
            {checking
              ? <><div className="w-3 h-3 border border-gray-500 border-t-green-400 rounded-full animate-spin" /> Verificando pagamento...</>
              : <><div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" /> Aguardando confirmação automática...</>
            }
          </div>

          <button onClick={() => { setQr(null); setSelectedPlan(null) }}
            className="w-full text-gray-500 hover:text-white text-xs py-1 transition-colors">
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}
