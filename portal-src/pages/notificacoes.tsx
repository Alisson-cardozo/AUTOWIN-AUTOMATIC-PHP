import { useEffect, useState } from "react"

type NotifyEvent = "entrada" | "win" | "loss" | "stopWin" | "stopLoss"

const EVENTS: { key: NotifyEvent; label: string }[] = [
  { key: "entrada", label: "Entrada feita" },
  { key: "win", label: "Win" },
  { key: "loss", label: "Loss" },
  { key: "stopWin", label: "Stop Win" },
  { key: "stopLoss", label: "Stop Loss" },
]

type Prefs = {
  browser: Partial<Record<NotifyEvent, boolean>>
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

export default function NotificacoesPage() {
  const [prefs, setPrefs] = useState<Prefs>({ browser: {} })
  const [browserSubscribed, setBrowserSubscribed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [pushSupported, setPushSupported] = useState(true)

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushSupported(false)
    }

    fetch("/api/user/notifications")
      .then((r) => r.json())
      .then((data) => {
        setPrefs({ browser: data.prefs?.browser ?? {} })
      })
      .finally(() => setLoading(false))

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration()
        .then((reg) => reg?.pushManager.getSubscription())
        .then((sub) => setBrowserSubscribed(!!sub))
        .catch(() => {})
    }
  }, [])

  function toggle(event: NotifyEvent) {
    setPrefs((prev) => ({
      browser: { ...prev.browser, [event]: !prev.browser[event] },
    }))
  }

  async function enableBrowserPush() {
    setMessage("")
    try {
      const permission = await Notification.requestPermission()
      if (permission !== "granted") {
        setMessage("Permissão de notificação negada pelo navegador.")
        return
      }

      const keyRes = await fetch("/api/vapid-public-key")
      const { publicKey } = await keyRes.json()
      if (!publicKey) {
        setMessage("Notificações push ainda não configuradas no servidor.")
        return
      }

      await navigator.serviceWorker.register("/sw.js")
      const reg = await navigator.serviceWorker.ready
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })

      await fetch("/api/user/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      })

      setBrowserSubscribed(true)
      setMessage("Notificações do navegador ativadas!")
    } catch {
      setMessage("Não foi possível ativar as notificações do navegador.")
    }
  }

  async function disableBrowserPush() {
    setMessage("")
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = await reg?.pushManager.getSubscription()
        if (sub) {
          const endpoint = sub.endpoint
          await sub.unsubscribe()
          await fetch("/api/user/push-subscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint }),
          })
        }
      }
      setBrowserSubscribed(false)
      setMessage("Notificações do navegador desativadas!")
    } catch {
      setMessage("Não foi possível desativar as notificações do navegador.")
    }
  }

  async function save() {
    setSaving(true)
    setMessage("")
    try {
      const res = await fetch("/api/user/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setMessage(data.error || "Erro ao salvar.")
        return
      }
      setMessage("Preferências salvas!")
    } finally {
      setSaving(false)
      setTimeout(() => setMessage(""), 3000)
    }
  }

  async function sendTest() {
    setMessage("")
    await fetch("/api/user/notifications/test", { method: "POST" })
    setMessage("Notificação de teste enviada — confira o navegador.")
  }

  if (loading) return <div className="text-gray-400">Carregando...</div>

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Notificações</h1>
        <p className="text-gray-400 text-sm mt-1">
          Escolha como quer ser avisado sobre a atividade do bot, evento por evento.
        </p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <h2 className="text-white font-semibold">Navegador (push)</h2>
        {!pushSupported ? (
          <p className="text-gray-500 text-sm">Seu navegador não suporta notificações push.</p>
        ) : browserSubscribed ? (
          <div className="flex flex-col gap-3 items-start">
            <p className="text-green-400 text-sm">✓ Este navegador está inscrito para receber notificações.</p>
            <button
              onClick={disableBrowserPush}
              className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 font-semibold px-4 py-2 rounded-lg transition-colors text-sm"
            >
              Desativar notificações no navegador
            </button>
          </div>
        ) : (
          <button
            onClick={enableBrowserPush}
            className="bg-green-500 hover:bg-green-400 text-black font-semibold px-4 py-2 rounded-lg transition-colors text-sm"
          >
            Ativar notificações no navegador
          </button>
        )}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <h2 className="text-white font-semibold">Eventos</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-left">
                <th className="py-2 font-medium">Evento</th>
                <th className="py-2 font-medium text-center">Navegador</th>
              </tr>
            </thead>
            <tbody>
              {EVENTS.map(({ key, label }) => (
                <tr key={key} className="border-t border-gray-800">
                  <td className="py-3 text-gray-200">{label}</td>
                  <td className="py-3 text-center">
                    <input
                      type="checkbox"
                      checked={!!prefs.browser[key]}
                      onChange={() => toggle(key)}
                      className="w-4 h-4 accent-green-500"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {message && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 text-green-400 text-sm">
            {message}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 bg-green-500 hover:bg-green-400 disabled:bg-green-500/50 text-black font-semibold py-2.5 rounded-lg transition-colors"
          >
            {saving ? "Salvando..." : "Salvar Preferências"}
          </button>
          <button
            onClick={sendTest}
            className="px-4 py-2.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors text-sm"
          >
            Enviar teste
          </button>
        </div>
      </div>
    </div>
  )
}
