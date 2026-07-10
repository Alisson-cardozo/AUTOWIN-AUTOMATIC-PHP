import { useEffect, useState } from "react"

interface Announcement {
  id: number
  message: string
  createdAt: string
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso))
}

export default function ComunicacaoPage() {
  const [current, setCurrent] = useState<Announcement | null>(null)
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/admin/announcement")
      .then((r) => r.json())
      .then((d) => setCurrent(d.announcement ?? null))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSend() {
    if (!message.trim()) { setError("Escreva uma mensagem antes de enviar."); return }
    if (!confirm("Enviar esse aviso pra TODOS os clientes agora (com notificação push)?")) return

    setSending(true); setError(""); setSent(false)
    try {
      const res = await fetch("/api/admin/announcement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Erro ao enviar"); return }
      setCurrent(data.announcement)
      setMessage("")
      setSent(true)
      setTimeout(() => setSent(false), 3000)
    } catch {
      setError("Erro ao conectar")
    } finally {
      setSending(false)
    }
  }

  async function handleDelete() {
    if (!confirm("Tem certeza que deseja apagar o aviso atual? Os clientes não verão mais nenhum aviso.")) return

    setDeleting(true)
    try {
      const res = await fetch("/api/admin/announcement", { method: "DELETE" })
      if (res.ok) {
        setCurrent(null)
      } else {
        setError("Erro ao apagar aviso")
      }
    } catch {
      setError("Erro ao conectar")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Comunicação</h1>
        <p className="text-gray-400 text-sm mt-1">
          Envie um aviso importante pra todos os clientes — aparece na aba "Aviso Importante" do
          portal deles, com notificação de novo (badge) e push no navegador.
        </p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest">
          Mensagem
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          placeholder="Ex: Manutenção programada hoje às 22h, o bot pode ficar indisponível por alguns minutos."
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
        />
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button
          onClick={handleSend}
          disabled={sending}
          className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors"
        >
          {sending ? "Enviando..." : sent ? "✓ Enviado!" : "Enviar pra todos os clientes"}
        </button>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Aviso atual
        </h2>
        {loading ? (
          <p className="text-gray-500 text-sm">Carregando...</p>
        ) : !current ? (
          <p className="text-gray-600 text-sm">Nenhum aviso enviado ainda.</p>
        ) : (
          <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 space-y-4 flex flex-col items-start">
            <div className="space-y-2 w-full">
              <p className="text-white text-sm whitespace-pre-wrap">{current.message}</p>
              <p className="text-gray-500 text-xs">Enviado em {formatDate(current.createdAt)}</p>
            </div>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs bg-red-500/20 hover:bg-red-500/35 border border-red-500/40 text-red-300 font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {deleting ? "Apagando..." : "Apagar Aviso"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
