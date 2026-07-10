import { useEffect, useState } from "react"
import { FEATURES, type FeatureKey } from "@/lib/features"

type LicenseOption = { title: string; days: number; amount: number; features?: FeatureKey[] }

const TRIAL_PRESETS = [1, 6, 12, 24, 48, 72]

function LicenseOptionsEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [options, setOptions] = useState<LicenseOption[]>([])
  const [newTitle,  setNewTitle]  = useState("")
  const [newDays,   setNewDays]   = useState("")
  const [newAmount, setNewAmount] = useState("")
  const [newFeatures, setNewFeatures] = useState<FeatureKey[]>([])
  const [err, setErr]     = useState("")
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  useEffect(() => {
    try { setOptions(JSON.parse(value) ?? []) } catch { setOptions([]) }
  }, [value])

  async function sync(opts: LicenseOption[]) {
    setOptions(opts)
    const json = JSON.stringify(opts)
    onChange(json)
    setSaving(true); setSaved(false)
    try {
      await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ LICENSE_OPTIONS: json }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  function add() {
    const days   = parseInt(newDays)
    const amount = parseFloat(newAmount)
    if (!newTitle.trim())             { setErr("Digite o título"); return }
    if (isNaN(days) || days < 1)      { setErr("Dias inválido"); return }
    if (isNaN(amount) || amount <= 0) { setErr("Valor inválido"); return }
    sync([...options, { title: newTitle.trim(), days, amount, features: newFeatures }])
    setNewTitle(""); setNewDays(""); setNewAmount(""); setNewFeatures([]); setErr("")
  }

  function toggleNewFeature(key: FeatureKey) {
    setNewFeatures((prev) => (prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]))
  }

  function remove(i: number) { sync(options.filter((_, idx) => idx !== i)) }

  return (
    <div className="space-y-3">
      {(saving || saved) && (
        <p className={`text-xs text-right transition-colors ${saved ? "text-green-400" : "text-gray-400"}`}>
          {saved ? "✓ Planos salvos" : "Salvando..."}
        </p>
      )}
      {options.length === 0
        ? <p className="text-gray-600 text-sm text-center py-3 border border-dashed border-gray-700 rounded-xl">Nenhuma opção cadastrada.</p>
        : (
          <div className="space-y-2">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center justify-between bg-gray-850/60 border border-gray-800 rounded-xl px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="bg-green-500/20 text-green-400 text-sm font-bold px-2.5 py-1 rounded-lg min-w-[3rem] text-center">
                    {opt.days}d
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">{opt.title}</p>
                    <p className="text-gray-500 text-xs">R$ {opt.amount.toFixed(2)} · {opt.days} dias</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(opt.features?.length ?? 0) === 0
                        ? <span className="text-[10px] text-gray-600 italic">Nenhuma aba incluída</span>
                        : opt.features!.map((key) => {
                            const f = FEATURES.find((x) => x.key === key)
                            return (
                              <span key={key} className="text-[10px] bg-blue-500/15 text-blue-300 px-1.5 py-0.5 rounded">
                                {f?.label ?? key}
                              </span>
                            )
                          })}
                    </div>
                  </div>
                </div>
                <button onClick={() => remove(i)}
                  className="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-500/10 transition-colors flex-shrink-0">
                  Remover
                </button>
              </div>
            ))}
          </div>
        )
      }

      {/* Add form */}
      <div className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-4 space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Nova opção</p>
        <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Título (ex: 30 dias - R$ 100)"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500" />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Dias</label>
            <input type="number" inputMode="decimal" onFocus={(e) => e.target.select()} min="1" value={newDays} onChange={(e) => setNewDays(e.target.value)}
              placeholder="30"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Valor (R$)</label>
            <input type="number" inputMode="decimal" onFocus={(e) => e.target.select()} min="0.01" step="0.01" value={newAmount} onChange={(e) => setNewAmount(e.target.value)}
              placeholder="100"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Abas incluídas nesse plano</label>
          <div className="flex flex-wrap gap-2">
            {FEATURES.map((f) => (
              <label key={f.key}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                  newFeatures.includes(f.key)
                    ? "bg-green-500/20 border-green-500/50 text-green-300"
                    : "bg-gray-800 border-gray-700 text-gray-400"
                }`}>
                <input type="checkbox" className="hidden"
                  checked={newFeatures.includes(f.key)}
                  onChange={() => toggleNewFeature(f.key)} />
                {f.label}
              </label>
            ))}
          </div>
        </div>
        {err && <p className="text-red-400 text-xs">{err}</p>}
        <button onClick={add}
          className="w-full bg-green-500 hover:bg-green-400 text-black font-semibold py-2 rounded-lg text-sm transition-colors">
          + Adicionar Opção
        </button>
      </div>
    </div>
  )
}

type Config = {
  PAYMENT_ENGINE: string
  MERCADOPAGO_ACCESS_TOKEN: string
  TRIAL_HOURS: string
  LICENSE_OPTIONS: string
}

const DEFAULT_CONFIG: Config = {
  PAYMENT_ENGINE: "mercadopago",
  MERCADOPAGO_ACCESS_TOKEN: "",
  TRIAL_HOURS: "1",
  LICENSE_OPTIONS: '[{"title":"30 dias - R$100","days":30,"amount":100}]',
}

export default function FinanceiroPage() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/admin/config")
      .then((r) => r.json())
      .then((data) => {
        setConfig((prev) => ({
          ...prev,
          PAYMENT_ENGINE: data.PAYMENT_ENGINE ?? "mercadopago",
          MERCADOPAGO_ACCESS_TOKEN: data.MERCADOPAGO_ACCESS_TOKEN ?? "",
          TRIAL_HOURS: data.TRIAL_HOURS ?? "1",
          LICENSE_OPTIONS: data.LICENSE_OPTIONS ?? '[{"title":"30 dias - R$100","days":30,"amount":100}]',
        }))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function handleChange(key: keyof Config, value: string) {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setSuccess(false)
    setError("")

    const res = await fetch("/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    })

    setSaving(false)
    if (res.ok) {
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } else {
      setError("Erro ao salvar configurações.")
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Carregando...</div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Planos e Gateway</h1>
        <p className="text-gray-400 text-sm mt-1">
          Gerencie as opções de licenças, planos de trial e credenciais do gateway de pagamentos.
        </p>
      </div>

      {/* Pagamentos */}
      <Section title="Pagamentos" icon="💳">
        <Field label="Motor de Pagamento">
          <select
            value={config.PAYMENT_ENGINE}
            onChange={(e) => handleChange("PAYMENT_ENGINE", e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="mercadopago">Mercado Pago</option>
          </select>
        </Field>

        <Field label="Access Token — Mercado Pago">
          <input
            type="text"
            value={config.MERCADOPAGO_ACCESS_TOKEN}
            onChange={(e) => handleChange("MERCADOPAGO_ACCESS_TOKEN", e.target.value)}
            placeholder="APP_USR-..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 font-mono text-sm"
          />
        </Field>
      </Section>

      {/* Licenças / Trial */}
      <Section title="Trial e Licenças" icon="🎟️">
        <Field label="Horas de Trial Gratuito">
          <div className="space-y-2">
            <div className="flex gap-2 flex-wrap">
              {TRIAL_PRESETS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => handleChange("TRIAL_HOURS", String(h))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    config.TRIAL_HOURS === String(h)
                      ? "bg-green-500 text-black"
                      : "bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500"
                  }`}
                >
                  {h}h
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number" inputMode="decimal" onFocus={(e) => e.target.select()}
                min="0"
                value={config.TRIAL_HOURS}
                onChange={(e) => handleChange("TRIAL_HOURS", e.target.value)}
                className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <span className="text-gray-500 text-sm">horas</span>
            </div>
          </div>
        </Field>

        <Field label="Opções de Licença">
          <LicenseOptionsEditor
            value={config.LICENSE_OPTIONS}
            onChange={(v) => handleChange("LICENSE_OPTIONS", v)}
          />
        </Field>
      </Section>

      {/* Feedback */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 text-green-400 text-sm">
          Configurações salvas com sucesso!
        </div>
      )}

      <div className="flex justify-end pb-8">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-green-500 hover:bg-green-400 disabled:bg-green-500/50 text-black font-semibold px-6 py-2.5 rounded-lg transition-colors"
        >
          {saving ? "Salvando..." : "Salvar Configurações"}
        </button>
      </div>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest flex items-center gap-2">
        <span>{icon}</span> {title}
      </h2>
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1.5">{label}</label>
      {hint && <p className="text-xs text-gray-500 mb-1.5">{hint}</p>}
      {children}
    </div>
  )
}
