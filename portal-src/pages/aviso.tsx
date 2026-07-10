import { useEffect, useState } from "react"

interface Announcement {
  id: number
  message: string
  createdAt: string
}

const SEEN_KEY = "aviso_seen_id"

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso))
}

export default function AvisoPage() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/user/announcement")
      .then((r) => r.json())
      .then((d) => {
        setAnnouncement(d.announcement ?? null)
        if (d.announcement) {
          try { localStorage.setItem(SEEN_KEY, String(d.announcement.id)) } catch {}
          window.dispatchEvent(new Event("aviso-seen"))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">📢 Aviso Importante</h1>
        <p className="text-gray-400 text-sm mt-1">Comunicados enviados pela administração.</p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        {loading ? (
          <p className="text-gray-500 text-sm">Carregando...</p>
        ) : !announcement ? (
          <p className="text-gray-600 text-sm text-center py-6">Nenhum aviso no momento.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-white text-sm leading-relaxed whitespace-pre-wrap">{announcement.message}</p>
            <p className="text-gray-500 text-xs">Enviado em {formatDate(announcement.createdAt)}</p>
          </div>
        )}
      </div>
    </div>
  )
}
