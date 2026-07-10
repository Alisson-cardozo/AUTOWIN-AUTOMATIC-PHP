import { useEffect, useState } from "react"

interface Strategy {
  id: number
  sequence: string
  color: string
  wins?: number
  losses?: number
  assertividade?: number | null
}

const TYPES_DOUBLE  = ["SEQUÊNCIA", "HORÁRIOS", "NÚMEROS", "COPIAR SALA DE SINAL"]
const TYPES_FORTUNE = ["SEQUÊNCIA", "HORÁRIOS"]
const TYPES_CRASH   = ["SEQUÊNCIA", "HORÁRIOS", "NÚMEROS", "COPIAR SALA DE SINAL"]

const DOUBLE_COLORS = [
  { value: "vermelho", label: "🔴 Vermelho" },
  { value: "preto",    label: "⚫ Preto"    },
  { value: "branco",   label: "⚪ Branco"   },
]

const FORTUNE_COLORS = [
  { value: "vermelho", label: "❤️ Vermelho" },
  { value: "azul",     label: "💙 Azul"     },
  { value: "amarelo",  label: "💛 Amarelo"  },
]

function colorLabel(c: string) {
  if (c === "vermelho") return "🔴 Vermelho"
  if (c === "preto")    return "⚫ Preto"
  if (c === "branco")   return "⚪ Branco"
  return c
}

function fortuneColorLabel(c: string) {
  if (c === "vermelho") return "❤️ Vermelho"
  if (c === "azul")     return "💙 Azul"
  if (c === "amarelo")  return "💛 Amarelo"
  return c
}

/* ---------- lista de sequências ---------- */
function StrategyList({
  strategies,
  onDelete,
  seqLabel = "Sequência",
  colorLabelFn = colorLabel,
}: {
  strategies: Strategy[]
  onDelete: (id: number) => void
  seqLabel?: string
  colorLabelFn?: (c: string) => string
}) {
  if (strategies.length === 0)
    return <p className="text-gray-500 text-sm">Nenhuma sequência cadastrada.</p>
  return (
    <div className="space-y-2">
      {strategies.map((s) => {
        const hasStats = s.assertividade !== undefined && s.assertividade !== null
        return (
          <div key={s.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
            <div className="space-y-1">
              <p className="text-white text-sm font-semibold font-mono">{s.sequence}</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-gray-400 text-xs">{seqLabel}: {colorLabelFn(s.color)}</span>
                <span className="text-gray-600 text-xs">·</span>
                {hasStats ? (
                  <span className="text-[10px] bg-blue-500/10 border border-blue-500/25 text-blue-400 font-bold px-2 py-0.5 rounded-full">
                    📈 Assertividade: {s.assertividade}% ({s.wins}W / {s.losses}L)
                  </span>
                ) : (
                  <span className="text-[10px] bg-gray-500/10 border border-gray-500/25 text-gray-500 font-medium px-2 py-0.5 rounded-full">
                    Sem entradas hoje
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => onDelete(s.id)}
              className="text-gray-500 hover:text-red-400 transition-colors text-lg leading-none ml-2"
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}

/* ---------- SEQUÊNCIA — Double ---------- */
function DoubleSequenceSection({
  strategies,
  onAdd,
  onDelete,
}: {
  strategies: Strategy[]
  onAdd: (seq: string, color: string) => Promise<void>
  onDelete: (id: number) => void
}) {
  const [sequence, setSequence] = useState("")
  const [color, setColor] = useState("vermelho")
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState("")

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setAdding(true)
    try { await onAdd(sequence, color); setSequence(""); setColor("vermelho") }
    catch { setError("Erro ao adicionar sequência.") }
    finally { setAdding(false) }
  }

  return (
    <div className="space-y-5">
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 text-sm text-gray-400 space-y-1">
        <p>O bot analisa o histórico recente e aposta quando identifica a sequência cadastrada.</p>
        <p>Abreviações: <span className="text-white font-mono">v</span> = vermelho · <span className="text-white font-mono">p</span> = preto · <span className="text-white font-mono">b</span> = branco</p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Nova Sequência</h3>
        <form onSubmit={handleAdd} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Sequência <span className="text-gray-500 font-normal">(ex: v,v,p)</span>
            </label>
            <input
              type="text"
              value={sequence}
              onChange={(e) => setSequence(e.target.value)}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 transition"
              placeholder="v,v,p"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Cor Apostada</label>
            <select
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-green-500 transition"
            >
              {DOUBLE_COLORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={adding}
            className="w-full bg-green-500 hover:bg-green-400 disabled:bg-green-500/50 text-black font-semibold py-2.5 rounded-lg transition-colors"
          >
            {adding ? "Adicionando..." : "Adicionar Sequência"}
          </button>
        </form>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">
          Sequências Cadastradas ({strategies.length})
        </h3>
        <StrategyList strategies={strategies} onDelete={onDelete} seqLabel="Aposta" />
      </div>
    </div>
  )
}

/* ---------- SEQUÊNCIA — Crash (V/R/X) ---------- */
const CRASH_BALLS = [
  { key: "V", label: "🟢 ≥2x",  title: "Verde — crash ≥ 2.00x" },
  { key: "R", label: "🔴 <2x",  title: "Vermelho — crash < 2.00x" },
  { key: "X", label: "✖️ Any",  title: "Qualquer resultado" },
]

function crashSeqLabel(item: string) {
  if (item === "V") return "🟢"
  if (item === "R") return "🔴"
  if (item === "X") return "✖️"
  return item
}

function CrashSequenceSection({
  strategies,
  onAdd,
  onDelete,
}: {
  strategies: Strategy[]
  onAdd: (seq: string, color: string) => Promise<void>
  onDelete: (id: number) => void
}) {
  const [items, setItems] = useState<string[]>([])
  const [target, setTarget] = useState("")
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState("")

  function addItem(key: string) { setItems((p) => [...p, key]) }
  function removeLastItem() { setItems((p) => p.slice(0, -1)) }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (items.length === 0) { setError("Adicione ao menos um item à sequência."); return }
    const t = parseFloat(target)
    if (isNaN(t) || t < 1.01) { setError("Alvo inválido. Ex: 2.00"); return }
    setError("")
    setAdding(true)
    try {
      await onAdd(items.join(","), String(t.toFixed(2)))
      setItems([])
      setTarget("")
    } catch { setError("Erro ao adicionar sequência.") }
    finally { setAdding(false) }
  }

  return (
    <div className="space-y-5">
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 text-sm text-gray-400 space-y-1">
        <p>Monte a sequência de resultados e defina o alvo. O bot aposta quando o histórico bater.</p>
        <p><span className="text-green-400 font-mono">🟢 V</span> = crash ≥ 2x · <span className="text-red-400 font-mono">🔴 R</span> = crash &lt; 2x · <span className="text-gray-300 font-mono">✖ X</span> = qualquer</p>
        <p className="text-xs">Ordem: da esquerda (mais antigo) para direita (mais recente).</p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Nova Sequência</h3>
        <form onSubmit={handleAdd} className="space-y-4">
          {/* Botões V / R / X */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2">Adicionar à sequência</label>
            <div className="flex gap-2">
              {CRASH_BALLS.map((b) => (
                <button key={b.key} type="button" title={b.title}
                  onClick={() => addItem(b.key)}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 text-white font-semibold py-2 rounded-lg transition-colors text-sm">
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {/* Preview da sequência */}
          <div className="min-h-[2.5rem] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 flex items-center gap-1.5 flex-wrap">
            {items.length === 0
              ? <span className="text-gray-600 text-xs">sequência vazia — clique nos botões acima</span>
              : items.map((it, i) => (
                <span key={i} className="bg-gray-700 rounded px-2 py-0.5 text-sm font-mono text-white">{crashSeqLabel(it)}</span>
              ))
            }
            {items.length > 0 && (
              <button type="button" onClick={removeLastItem}
                className="ml-auto text-gray-500 hover:text-red-400 text-xs transition-colors">
                ← apagar
              </button>
            )}
          </div>

          {/* Alvo */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Alvo da aposta <span className="text-gray-600">(ex: 2.00)</span>
            </label>
            <input
              type="number" inputMode="decimal" onFocus={(e) => e.target.select()} min="1.01" step="0.01"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 transition text-sm"
              placeholder="2.00"
            />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" disabled={adding}
            className="w-full bg-green-500 hover:bg-green-400 disabled:bg-green-500/50 text-black font-semibold py-2.5 rounded-lg transition-colors text-sm">
            {adding ? "Adicionando..." : "Adicionar Sequência"}
          </button>
        </form>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Sequências Cadastradas ({strategies.length})</h3>
        {strategies.length === 0
          ? <p className="text-gray-500 text-sm">Nenhuma sequência cadastrada.</p>
          : <div className="space-y-2">
              {strategies.map((s) => (
                <div key={s.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                  <div>
                    <p className="text-white text-sm font-medium font-mono flex gap-1">
                      {s.sequence.split(",").map((it, i) => (
                        <span key={i} className="bg-gray-700 rounded px-1.5 py-0.5 text-xs">{crashSeqLabel(it.trim().toUpperCase())}</span>
                      ))}
                    </p>
                    <p className="text-gray-400 text-xs mt-1">Alvo: {s.color}x</p>
                  </div>
                  <button onClick={() => onDelete(s.id)} className="text-gray-500 hover:text-red-400 transition-colors text-lg leading-none">✕</button>
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  )
}

/* ---------- HORÁRIOS — Crash ---------- */
function CrashHorariosSection({
  strategies,
  onAdd,
  onDelete,
}: {
  strategies: Strategy[]
  onAdd: (seq: string, color: string) => Promise<void>
  onDelete: (id: number) => void
}) {
  const [time, setTime] = useState("")
  const [target, setTarget] = useState("")
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState("")

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const hhmm = time.trim()
    const t = parseFloat(target)
    if (!/^\d{2}:\d{2}$/.test(hhmm)) { setError("Horário inválido. Use HH:MM (ex: 19:57)"); return }
    if (isNaN(t) || t < 1.01) { setError("Alvo inválido. Ex: 2.00"); return }
    setError("")
    setAdding(true)
    try { await onAdd(hhmm, String(t.toFixed(2))); setTime(""); setTarget("") }
    catch { setError("Erro ao adicionar horário.") }
    finally { setAdding(false) }
  }

  return (
    <div className="space-y-5">
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 text-sm text-gray-400 space-y-1">
        <p>Configure horários específicos e o alvo de crash para cada momento. O bot aposta automaticamente no minuto configurado.</p>
        <p className="text-xs">Horário no fuso de Brasília (UTC-3). Ex: <span className="text-white font-mono">19:57 → 2.00x</span></p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Novo Horário</h3>
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Horário <span className="text-gray-600">(HH:MM)</span></label>
              <input type="text" value={time} onChange={(e) => setTime(e.target.value)} placeholder="19:57" maxLength={5}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 text-sm" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Alvo <span className="text-gray-600">(ex: 2.00)</span></label>
              <input type="number" inputMode="decimal" onFocus={(e) => e.target.select()} min="1.01" step="0.01" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="2.00"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 text-sm" />
            </div>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" disabled={adding}
            className="w-full bg-green-500 hover:bg-green-400 disabled:bg-green-500/50 text-black font-semibold py-2.5 rounded-lg transition-colors text-sm">
            {adding ? "Adicionando..." : "Adicionar Horário"}
          </button>
        </form>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Horários Cadastrados ({strategies.length})</h3>
        {strategies.length === 0
          ? <p className="text-gray-500 text-sm">Nenhum horário cadastrado.</p>
          : <div className="space-y-2">
              {strategies.map((s) => (
                <div key={s.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                  <div>
                    <p className="text-white text-sm font-semibold font-mono">{s.sequence}</p>
                    <p className="text-gray-400 text-xs mt-0.5">Alvo: {s.color}x</p>
                  </div>
                  <button onClick={() => onDelete(s.id)} className="text-gray-500 hover:text-red-400 transition-colors text-lg leading-none">✕</button>
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  )
}

/* ---------- NÚMEROS — Crash ---------- */
function CrashNumerosSection({
  strategies,
  onAdd,
  onDelete,
}: {
  strategies: Strategy[]
  onAdd: (seq: string, color: string) => Promise<void>
  onDelete: (id: number) => void
}) {
  const [items, setItems] = useState<string[]>([])
  const [numInput, setNumInput] = useState("")
  const [target, setTarget] = useState("")
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState("")

  function addItem(key: string) { setItems((p) => [...p, key]) }
  function removeLastItem() { setItems((p) => p.slice(0, -1)) }

  function addNumItem() {
    const v = parseFloat(numInput)
    if (!isNaN(v) && v >= 1.01) { addItem(String(v.toFixed(2))); setNumInput("") }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (items.length === 0) { setError("Adicione ao menos um item."); return }
    const t = parseFloat(target)
    if (isNaN(t) || t < 1.01) { setError("Alvo inválido. Ex: 2.00"); return }
    setError("")
    setAdding(true)
    try {
      await onAdd(items.join(","), String(t.toFixed(2)))
      setItems([])
      setTarget("")
      setNumInput("")
    } catch { setError("Erro ao adicionar.") }
    finally { setAdding(false) }
  }

  function renderItem(item: string, i: number) {
    const v = item.trim().toUpperCase()
    if (v === "V" || v === "R" || v === "X") {
      return <span key={i} className={`inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-bold ${v === "V" ? "bg-green-500 text-white" : v === "R" ? "bg-red-500 text-white" : "bg-gray-600 text-gray-200"}`}>{v}</span>
    }
    return <span key={i} className="h-7 px-2 inline-flex items-center rounded-full bg-blue-600 text-white text-xs font-bold font-mono">{item}x</span>
  }

  return (
    <div className="space-y-5">
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 text-sm text-gray-400 space-y-1">
        <p>Combine pontos específicos do Crash com V/R/X para criar sequências mais precisas.</p>
        <p className="text-xs"><span className="text-green-400 font-mono">V</span> ≥2x · <span className="text-red-400 font-mono">R</span> &lt;2x · <span className="text-gray-300 font-mono">X</span> qualquer · <span className="text-blue-300 font-mono">1.50</span> crash bateu em ≤ 1.50x</p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Nova Estratégia</h3>
        <form onSubmit={handleAdd} className="space-y-4">
          {/* Preview */}
          <div className="min-h-[2.5rem] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 flex items-center gap-1.5 flex-wrap">
            {items.length === 0
              ? <span className="text-gray-600 text-xs">sequência vazia</span>
              : items.map((it, i) => renderItem(it, i))
            }
            {items.length > 0 && (
              <button type="button" onClick={removeLastItem} className="ml-auto text-gray-500 hover:text-red-400 text-xs transition-colors">← apagar</button>
            )}
          </div>

          {/* Crash point buttons */}
          <div>
            <p className="text-xs text-gray-500 mb-2">Crash points <span className="text-gray-600">(≤ valor)</span></p>
            <div className="flex flex-wrap gap-1.5">
              {["1.10","1.20","1.30","1.50","1.80","2.00","3.00","5.00","10.00"].map((n) => (
                <button key={n} type="button" onClick={() => addItem(n)}
                  className="h-9 px-3 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold font-mono transition hover:scale-105">
                  {n}x
                </button>
              ))}
            </div>
          </div>

          {/* Custom number input */}
          <div className="flex gap-2">
            <input type="number" inputMode="decimal" onFocus={(e) => e.target.select()} min="1.01" step="0.01" value={numInput} onChange={(e) => setNumInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addNumItem())}
              placeholder="Outro valor (ex: 1.75)"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button type="button" onClick={addNumItem}
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 rounded-lg transition">
              + Adicionar
            </button>
          </div>

          {/* V / R / X */}
          <div className="grid grid-cols-4 gap-2">
            {[["V","≥2x","bg-green-500/20 border-green-500/40 text-green-400","bg-green-500"],
              ["R","<2x","bg-red-600/20 border-red-500/40 text-red-400","bg-red-500"],
              ["X","Any","bg-gray-600/20 border-gray-500/40 text-gray-400","bg-gray-600/60 border border-gray-500"]
            ].map(([key, lbl, cls, ballCls]) => (
              <button key={key} type="button" onClick={() => addItem(key)}
                className={`flex flex-col items-center justify-center gap-1 py-2.5 border rounded-lg text-xs font-medium hover:opacity-80 transition ${cls}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white font-bold text-xs ${ballCls}`}>{key}</div>
                {lbl}
              </button>
            ))}
            <button type="button" onClick={removeLastItem} disabled={items.length === 0}
              className="flex flex-col items-center justify-center gap-1 py-2.5 bg-orange-500/10 border border-orange-500/30 text-orange-400 rounded-lg text-xs font-medium hover:bg-orange-500/20 disabled:opacity-30 transition">
              <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-sm">←</div>
              Apagar
            </button>
          </div>

          {/* Alvo */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Alvo da aposta <span className="text-gray-600">(ex: 2.00)</span></label>
            <input type="number" inputMode="decimal" onFocus={(e) => e.target.select()} min="1.01" step="0.01" value={target} onChange={(e) => setTarget(e.target.value)} required placeholder="2.00"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" disabled={adding}
            className="w-full bg-green-500 hover:bg-green-400 disabled:bg-green-500/50 text-black font-semibold py-2.5 rounded-lg transition-colors text-sm">
            {adding ? "Adicionando..." : "Adicionar Estratégia"}
          </button>
        </form>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Estratégias Cadastradas ({strategies.length})</h3>
        {strategies.length === 0
          ? <p className="text-gray-500 text-sm">Nenhuma estratégia cadastrada.</p>
          : <div className="space-y-2">
              {strategies.map((s) => (
                <div key={s.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                  <div>
                    <div className="flex gap-1.5 flex-wrap mb-1">
                      {s.sequence.split(",").map((it, i) => renderItem(it, i))}
                    </div>
                    <p className="text-gray-400 text-xs">Alvo: {s.color}x</p>
                  </div>
                  <button onClick={() => onDelete(s.id)} className="text-gray-500 hover:text-red-400 transition-colors text-lg leading-none">✕</button>
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  )
}

/* ---------- COPIAR SALA DE SINAL ---------- */
type TgState = {
  isConnected: boolean
  phone: string | null
  groupId: string | null
  groupName: string | null
  keywords: string[]
}
type Group = { id: string; name: string }

function CopiarSalaSection() {
  const [tg, setTg] = useState<TgState | null>(null)
  const [step, setStep] = useState<"idle" | "phone" | "code" | "group" | "done">("idle")
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [search, setSearch] = useState("")
  const [groups, setGroups] = useState<Group[]>([])
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [keywords, setKeywords] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/user/telegram-userbot")
      .then((r) => r.json())
      .then((data) => {
        setTg(data)
        if (data.isConnected) setStep(data.groupId ? "done" : "group")
      })
      .catch(() => {})
  }, [])

  async function call(body: object) {
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/user/telegram-userbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erro")
      return data
    } catch (e: any) {
      setError(e.message)
      return null
    } finally {
      setLoading(false)
    }
  }

  async function sendCode() {
    const ok = await call({ action: "send-code", phone })
    if (ok) setStep("code")
  }

  async function verifyCode() {
    const digits = code.replace(/\D/g, "")
    const ok = await call({ action: "verify-code", code: digits })
    if (ok) { setStep("group"); setTg((p) => p ? { ...p, isConnected: true } : p) }
  }

  async function searchGroups() {
    const data = await call({ action: "search-groups", query: search })
    if (data) setGroups(Array.isArray(data) ? data : [])
  }

  async function selectGroup() {
    if (!selectedGroup) return
    const kw = keywords.split(",").map((k) => k.trim()).filter(Boolean)
    const ok = await call({ action: "select-group", groupId: selectedGroup.id, groupName: selectedGroup.name, keywords: kw })
    if (ok) { setStep("done"); setTg((p) => p ? { ...p, groupId: selectedGroup.id, groupName: selectedGroup.name, keywords: kw } : p) }
  }

  async function disconnect() {
    const ok = await call({ action: "disconnect" })
    if (ok) { setStep("idle"); setTg((p) => p ? { ...p, isConnected: false, groupId: null, groupName: null } : p) }
  }

  const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
  const btnCls   = "w-full bg-green-500 hover:bg-green-400 disabled:bg-green-500/50 text-black font-semibold py-2.5 rounded-lg transition-colors text-sm"

  return (
    <div className="space-y-5">
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 text-sm text-gray-400">
        <p>Conecte sua conta Telegram. O bot lê as mensagens do grupo selecionado e aposta automaticamente quando identificar um sinal.</p>
      </div>

      {/* STEP: idle → conectar */}
      {step === "idle" && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Conectar Conta Telegram</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Número de Telefone</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+5511999999999" className={inputCls} />
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button onClick={sendCode} disabled={loading || !phone} className={btnCls}>
              {loading ? "Enviando..." : "Enviar Código"}
            </button>
          </div>
        </div>
      )}

      {/* STEP: code */}
      {step === "code" && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-1">Código de Verificação</h3>
          <p className="text-xs text-gray-500 mb-4">Digite apenas os dígitos do código recebido no Telegram.</p>
          <div className="space-y-3">
            <input type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="12345" maxLength={10} className={inputCls + " tracking-widest text-center text-lg font-mono"} />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button onClick={verifyCode} disabled={loading || !code} className={btnCls}>
              {loading ? "Verificando..." : "Confirmar"}
            </button>
            <button onClick={() => setStep("idle")} className="w-full text-gray-400 hover:text-white text-xs py-1">Voltar</button>
          </div>
        </div>
      )}

      {/* STEP: selecionar grupo */}
      {step === "group" && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">Selecionar Grupo de Sinais</h3>
          <div className="flex gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchGroups()} placeholder="Nome do grupo..." className={inputCls} />
            <button onClick={searchGroups} disabled={loading} className="bg-gray-700 hover:bg-gray-600 text-white px-4 rounded-lg text-sm flex-shrink-0">
              {loading ? "..." : "Buscar"}
            </button>
          </div>

          {groups.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {groups.map((g) => (
                <button key={g.id} onClick={() => setSelectedGroup(g)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedGroup?.id === g.id ? "bg-green-500/15 border border-green-500/40 text-green-400" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>
                  {g.name}
                </button>
              ))}
            </div>
          )}

          {selectedGroup && (
            <div className="space-y-3 pt-2 border-t border-gray-700">
              <p className="text-xs text-gray-400">Grupo: <span className="text-white">{selectedGroup.name}</span></p>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Palavras-chave de sinal <span className="text-gray-600">(separe por vírgula — deixe vazio para detectar automaticamente)</span></label>
                <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="ENTRADA, 🎯, Apostar" className={inputCls} />
              </div>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <button onClick={selectGroup} disabled={loading} className={btnCls}>
                {loading ? "Salvando..." : "Confirmar Grupo"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* STEP: done */}
      {step === "done" && tg && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-semibold text-white">Conectado</span>
          </div>
          <div className="space-y-1 text-sm text-gray-400">
            <p>Telefone: <span className="text-white">{tg.phone}</span></p>
            <p>Grupo: <span className="text-white">{tg.groupName ?? "—"}</span></p>
            {tg.keywords.length > 0 && <p>Filtros: <span className="text-white font-mono">{tg.keywords.join(", ")}</span></p>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep("group")} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm py-2 rounded-lg transition-colors">
              Trocar Grupo
            </button>
            <button onClick={disconnect} disabled={loading} className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm py-2 rounded-lg transition-colors">
              {loading ? "..." : "Desconectar"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- HORÁRIOS — Double ---------- */
interface BotEntryResult {
  id: number
  type: string       // WIN | LOSS | GALE | OBS_WIN | OBS_LOSS
  pattern: string | null
  galeLevel: number | null
  createdAt: string
}

function DoubleHorariosSection({
  strategies,
  onAdd,
  onDelete,
}: {
  strategies: Strategy[]
  onAdd: (seq: string, color: string) => Promise<void>
  onDelete: (id: number) => void
}) {
  const [time,    setTime]    = useState("")
  const [color,   setColor]   = useState("vermelho")
  const [adding,  setAdding]  = useState(false)
  const [error,   setError]   = useState("")
  const [results, setResults] = useState<BotEntryResult[]>(() => {
    try { const s = localStorage.getItem("estrategias_bot_results"); return s ? JSON.parse(s) : [] } catch { return [] }
  })
  const [importing, setImporting] = useState(false)
  const [copied,    setCopied]    = useState(false)

  useEffect(() => {
    fetchResults()
    const iv = setInterval(fetchResults, 5000)
    return () => clearInterval(iv)
  }, [])

  async function fetchResults() {
    try {
      const res = await fetch("/api/user/bot-entries")
      if (res.ok) {
        const data = await res.json()
        setResults(data)
        try { localStorage.setItem("estrategias_bot_results", JSON.stringify(data)) } catch {}
      }
    } catch {}
  }

  function getEntryResult(hhmm: string): BotEntryResult | null {
    const matches = results.filter(e =>
      (e.type === "WIN" || e.type === "LOSS" || e.type === "GALE") &&
      e.pattern === hhmm
    )
    return matches[0] ?? null
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const hhmm = time.trim()
    if (!/^\d{2}:\d{2}$/.test(hhmm)) { setError("Horário inválido. Use HH:MM (ex: 19:57)"); return }
    setError("")
    setAdding(true)
    try { await onAdd(hhmm, color); setTime("") }
    catch { setError("Erro ao adicionar horário.") }
    finally { setAdding(false) }
  }

  async function importFromPremium() {
    try {
      setImporting(true)
      const raw = localStorage.getItem("premium_gerador_list")
      if (!raw) { alert("Gere a lista no Premium primeiro."); return }
      const list: { time: string; color: number }[] = JSON.parse(raw)
      const COLOR_NAME: Record<number, string> = { 0: "branco", 1: "vermelho", 2: "preto" }
      for (const entry of list) {
        const seq = entry.time
        const col = COLOR_NAME[entry.color] ?? "vermelho"
        if (strategies.some(s => s.sequence === seq)) continue
        await onAdd(seq, col)
      }
    } catch { alert("Erro ao importar lista.") }
    finally { setImporting(false) }
  }

  function ResultBadge({ hhmm }: { hhmm: string }) {
    const r = getEntryResult(hhmm)
    if (!r) return <span className="text-gray-700 text-xs px-2 py-0.5 rounded bg-gray-800/60 border border-gray-700/40">aguardando</span>
    if (r.type === "WIN")  return <span className="text-green-400 font-bold text-xs px-2 py-0.5 rounded bg-green-500/10 border border-green-500/30">✅ WIN</span>
    if (r.type === "GALE") return <span className="text-yellow-400 font-bold text-xs px-2 py-0.5 rounded bg-yellow-500/10 border border-yellow-500/30">⚡ G{r.galeLevel ?? 1}</span>
    return <span className="text-red-400 font-bold text-xs px-2 py-0.5 rounded bg-red-500/10 border border-red-500/30">❌ LOSS</span>
  }

  return (
    <div className="space-y-5">
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 text-sm text-gray-400">
        <p>Configure horários e a cor de entrada. O bot aposta automaticamente no minuto configurado.</p>
        <p className="text-xs mt-1">Horário no fuso de Brasília (UTC-3). Ex: <span className="text-white font-mono">19:57 → Vermelho</span></p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Novo Horário</h3>
          <button
            onClick={importFromPremium}
            disabled={importing}
            className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors disabled:opacity-50"
          >
            {importing ? "Importando..." : "📋 Importar Lista"}
          </button>
        </div>
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Horário <span className="text-gray-600">(HH:MM)</span></label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-green-500 text-sm" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Cor apostada</label>
              <select value={color} onChange={(e) => setColor(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-green-500 text-sm">
                {DOUBLE_COLORS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" disabled={adding}
            className="w-full bg-green-500 hover:bg-green-400 disabled:bg-green-500/50 text-black font-semibold py-2.5 rounded-lg transition-colors text-sm">
            {adding ? "Adicionando..." : "Adicionar Horário"}
          </button>
        </form>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Horários Cadastrados ({strategies.length})</h3>
          {strategies.length > 0 && (
            <button
              onClick={() => {
                const text = strategies.map(s => `${s.sequence} ${colorLabel(s.color)}`).join("\n")
                navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
              }}
              className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
            >
              {copied ? "✅ Copiado!" : "📋 Copiar Lista"}
            </button>
          )}
        </div>
        {strategies.length === 0
          ? <p className="text-gray-500 text-sm">Nenhum horário cadastrado.</p>
          : <div className="space-y-2">
              {strategies.map((s) => (
                <div key={s.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-3">
                    <p className="text-white text-sm font-semibold font-mono w-12">{s.sequence}</p>
                    <span className="text-gray-400 text-xs">{colorLabel(s.color)}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <ResultBadge hhmm={s.sequence} />
                    <button onClick={() => onDelete(s.id)} className="text-gray-500 hover:text-red-400 transition-colors text-lg leading-none">✕</button>
                  </div>
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  )
}

/* ---------- HORÁRIOS — Fortune ---------- */
function FortuneHorariosSection({
  strategies,
  onAdd,
  onDelete,
}: {
  strategies: Strategy[]
  onAdd: (seq: string, color: string) => Promise<void>
  onDelete: (id: number) => void
}) {
  const [time,      setTime]      = useState("")
  const [color,     setColor]     = useState("vermelho")
  const [adding,    setAdding]    = useState(false)
  const [importing, setImporting] = useState(false)
  const [copied,    setCopied]    = useState(false)
  const [error,     setError]     = useState("")

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!time) { setError("Selecione um horário"); return }
    setError(""); setAdding(true)
    try { await onAdd(time, color); setTime(""); setColor("vermelho") }
    catch { setError("Erro ao adicionar horário.") }
    finally { setAdding(false) }
  }

  async function importFromPremium() {
    try {
      setImporting(true)
      const raw = localStorage.getItem("premium_fortune_gerador_full")
      if (!raw) { alert("Gere a lista no Premium (Fortune) primeiro."); return }
      const list: { time: string; color: number }[] = JSON.parse(raw)
      const COLOR_NAME: Record<number, string> = { 0: "amarelo", 1: "vermelho", 2: "azul" }
      for (const entry of list) {
        const seq = entry.time
        const col = COLOR_NAME[entry.color] ?? "vermelho"
        if (strategies.some(s => s.sequence === seq)) continue
        await onAdd(seq, col)
      }
    } catch { alert("Erro ao importar lista.") }
    finally { setImporting(false) }
  }

  return (
    <div className="space-y-5">
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 text-sm text-gray-400">
        <p>Configure horários e a cor de entrada no Fortune Double. O bot aposta automaticamente no minuto configurado.</p>
        <p className="text-xs mt-1">Horário no fuso de Brasília (UTC-3). Ex: <span className="text-white font-mono">19:57 → ❤️ Vermelho</span></p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Novo Horário</h3>
          <button onClick={importFromPremium} disabled={importing}
            className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors disabled:opacity-50">
            {importing ? "Importando..." : "📋 Importar Lista"}
          </button>
        </div>
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Horário <span className="text-gray-600">(HH:MM)</span></label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500 text-sm" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Cor apostada</label>
              <select value={color} onChange={(e) => setColor(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500 text-sm">
                {FORTUNE_COLORS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" disabled={adding}
            className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:bg-yellow-400/50 text-black font-semibold py-2.5 rounded-lg transition-colors text-sm">
            {adding ? "Adicionando..." : "Adicionar Horário"}
          </button>
        </form>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Horários Cadastrados ({strategies.length})</h3>
          {strategies.length > 0 && (
            <button onClick={() => {
              const text = strategies.map(s => `${s.sequence} ${fortuneColorLabel(s.color)}`).join("\n")
              navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
            }} className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors">
              {copied ? "✅ Copiado!" : "📋 Copiar Lista"}
            </button>
          )}
        </div>
        {strategies.length === 0
          ? <p className="text-gray-500 text-sm">Nenhum horário cadastrado.</p>
          : <div className="space-y-2">
              {strategies.map((s) => (
                <div key={s.id} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-3">
                    <p className="text-white text-sm font-semibold font-mono w-12">{s.sequence}</p>
                    <span className="text-gray-400 text-xs">{fortuneColorLabel(s.color)}</span>
                  </div>
                  <button onClick={() => onDelete(s.id)} className="text-gray-500 hover:text-red-400 transition-colors text-lg leading-none">✕</button>
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  )
}

/* ---------- cards informativos ---------- */
function InfoCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
      <p className="text-gray-400 text-sm leading-relaxed">{description}</p>
    </div>
  )
}

/* ---------- página principal ---------- */
export default function EstrategiasPage() {
  const [gameType, setGameType] = useState<string | null>(null)
  const [strategyType, setStrategyType] = useState("SEQUÊNCIA")
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [loading, setLoading] = useState(true)
  const [savingType, setSavingType] = useState(false)
  const [hiddenStrategies, setHiddenStrategies] = useState<string[]>([])

  async function loadStrategies(gt: string, st: string) {
    const strats = await fetch(`/api/user/estrategias?gameType=${gt}&strategyType=${encodeURIComponent(st)}`).then((r) => r.json())
    setStrategies(Array.isArray(strats) ? strats : [])
  }

  useEffect(() => {
    fetch("/api/user/me").then((r) => r.json()).then(async (user) => {
      const gt: string = user.gameType ?? "DOUBLE"
      const hidden = (user.hiddenStrategies ?? "").split(",").filter(Boolean)
      setHiddenStrategies(hidden)
      
      const settings = await fetch("/api/user/configuracoes").then((r) => r.json())
      const st: string = settings.strategyType ?? "SEQUÊNCIA"
      
      const allTypes = gt === "CRASH" ? TYPES_CRASH : gt === "FORTUNE" ? TYPES_FORTUNE : TYPES_DOUBLE
      const validTypes = allTypes.filter(t => !hidden.map((s: string) => s.toUpperCase()).includes(t.toUpperCase()))
      
      const resolved = validTypes.includes(st) ? st : (validTypes[0] ?? "SEQUÊNCIA")
      setGameType(gt)
      setStrategyType(resolved)
      await loadStrategies(gt, resolved)
      setLoading(false)
    })
  }, [])

  async function changeStrategyType(next: string) {
    setStrategyType(next)
    setSavingType(true)
    await fetch("/api/user/configuracoes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategyType: next }),
    })
    setSavingType(false)
    if (gameType) await loadStrategies(gameType, next)
  }

  async function addStrategy(sequence: string, color: string) {
    const res = await fetch("/api/user/estrategias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequence, color, gameType: gameType ?? "DOUBLE", strategyType }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? "Erro")
    setStrategies((prev) => [...prev, data])
  }

  function deleteStrategy(id: number) {
    fetch(`/api/user/estrategias?id=${id}`, { method: "DELETE" })
    setStrategies((prev) => prev.filter((s) => s.id !== id))
  }

  if (loading || !gameType) return <div className="text-gray-400">Carregando...</div>

  const rawAvailableTypes = gameType === "CRASH"
    ? TYPES_CRASH
    : gameType === "FORTUNE"
      ? TYPES_FORTUNE
      : TYPES_DOUBLE

  const availableTypes = rawAvailableTypes.filter(
    (t) => !hiddenStrategies.map((s: string) => s.toUpperCase()).includes(t.toUpperCase())
  )

  function renderDynamic() {
    if (strategyType === "SEQUÊNCIA") {
      return gameType === "CRASH"
        ? <CrashSequenceSection strategies={strategies} onAdd={addStrategy} onDelete={deleteStrategy} />
        : <DoubleSequenceSection strategies={strategies} onAdd={addStrategy} onDelete={deleteStrategy} />
    }
    if (strategyType === "HORÁRIOS") {
      if (gameType === "CRASH")   return <CrashHorariosSection   strategies={strategies} onAdd={addStrategy} onDelete={deleteStrategy} />
      if (gameType === "FORTUNE") return <FortuneHorariosSection strategies={strategies} onAdd={addStrategy} onDelete={deleteStrategy} />
      return <DoubleHorariosSection strategies={strategies} onAdd={addStrategy} onDelete={deleteStrategy} />
    }
    if (strategyType === "NÚMEROS") {
      return gameType === "CRASH"
        ? <CrashNumerosSection strategies={strategies} onAdd={addStrategy} onDelete={deleteStrategy} />
        : <InfoCard
            title="Números"
            description="Estratégia baseada em números específicos do Double (1–14). O bot aposta quando determinados números ou faixas de números são identificados no histórico. A configuração de números será disponibilizada em breve."
          />
    }
    if (strategyType === "COPIAR SALA DE SINAL") {
      return <CopiarSalaSection />
    }
    return null
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-white">Estratégias</h1>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
            gameType === "CRASH"   ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
            gameType === "FORTUNE" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
                                     "bg-red-500/20 text-red-400 border-red-500/30"
          }`}>
            {gameType}
          </span>
        </div>
        <p className="text-gray-400 text-sm mt-1">Defina como o bot detecta sinais de entrada</p>
      </div>

      {/* Tipo de Estratégia */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-semibold text-white">Tipo de Estratégia</label>
          {savingType && <span className="text-xs text-gray-500">Salvando...</span>}
        </div>
        <div className="grid grid-cols-1 gap-2">
          {availableTypes.map((t) => (
            <button
              key={t}
              onClick={() => changeStrategyType(t)}
              className={`w-full text-left px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${
                strategyType === t
                  ? "bg-green-500/15 border-green-500/40 text-green-400"
                  : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white"
              }`}
            >
              {t}
              {strategyType === t && <span className="ml-2 text-xs opacity-70">✓ selecionado</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Seção dinâmica */}
      {renderDynamic()}
    </div>
  )
}
