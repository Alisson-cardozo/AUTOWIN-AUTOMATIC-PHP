"use client"

import { useEffect, useState } from "react"

function composeUrl(scheme: string, host: string, port: string, user: string, pass: string): string {
  if (!host || !port) return ""
  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : ""
  return `${scheme}://${auth}${host}:${port}`
}

function parseUrl(url: string): { scheme: string; host: string; port: string; user: string; pass: string } | null {
  try {
    const u = new URL(url)
    return {
      scheme: u.protocol.replace(":", ""),
      host: u.hostname,
      port: u.port,
      user: decodeURIComponent(u.username || ""),
      pass: decodeURIComponent(u.password || ""),
    }
  } catch {
    return null
  }
}

type Verdict = { ok: boolean; blocked: boolean | null; message: string }

export default function ProxyPage() {
  const [scheme, setScheme] = useState("http")
  const [host, setHost] = useState("")
  const [port, setPort] = useState("")
  const [user, setUser] = useState("")
  const [pass, setPass] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [verdict, setVerdict] = useState<Verdict | null>(null)

  useEffect(() => {
    fetch("/api/admin/config")
      .then((r) => r.json())
      .then((data) => {
        const parsed = parseUrl(data?.BACBO_PROXY_URL || "")
        if (parsed) {
          setScheme(parsed.scheme)
          setHost(parsed.host)
          setPort(parsed.port)
          setUser(parsed.user)
          setPass(parsed.pass)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    const url = composeUrl(scheme, host.trim(), port.trim(), user.trim(), pass)
    try {
      await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BACBO_PROXY_URL: url }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    setSaving(true)
    try {
      await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BACBO_PROXY_URL: "" }),
      })
      setHost("")
      setPort("")
      setUser("")
      setPass("")
      setLog([])
      setVerdict(null)
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setVerdict(null)
    setLog(["$ conectando ao proxy..."])
    try {
      const url = composeUrl(scheme, host.trim(), port.trim(), user.trim(), pass)
      const res = await fetch("/api/admin/bacbo-proxy-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      setLog(Array.isArray(data.log) ? data.log : [])
      setVerdict({ ok: !!data.ok, blocked: data.blocked ?? null, message: data.message || "" })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLog((l) => [...l, "✗ erro: " + msg])
      setVerdict({ ok: false, blocked: null, message: "Falha ao testar." })
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <div className="text-gray-400 py-8">Carregando...</div>

  const isConfigured = Boolean(host.trim() && port.trim())

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Proxy (Bac Bo REAL)</h1>
        <p className="text-gray-400 text-sm mt-1">
          A Evolution bloqueia (Akamai) IP de datacenter/VPS ao abrir sessão de aposta REAL no Bac Bo. Configure aqui
          um proxy residencial ou 4G pra contornar — sem isso, as apostas REAL ficam travadas em "verificando janela
          de apostas".
        </p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Tipo</label>
            <select
              value={scheme}
              onChange={(e) => setScheme(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="http">HTTP</option>
              <option value="socks5">SOCKS5</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Porta</label>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="6361"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Host</label>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="198.23.243.226"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Usuário</label>
            <input
              type="text"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Senha</label>
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2 flex-wrap">
          <button
            onClick={handleSave}
            disabled={saving || !isConfigured}
            className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-semibold px-5 py-2.5 rounded-lg transition-colors"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || !isConfigured}
            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg transition-colors border border-gray-700"
          >
            {testing ? "Testando..." : "Testar conexão"}
          </button>
          <button
            onClick={handleClear}
            disabled={saving}
            className="ml-auto text-sm text-gray-500 hover:text-red-400 transition-colors"
          >
            Remover proxy
          </button>
        </div>
        {saved && <p className="text-xs text-green-400">✓ Proxy salvo</p>}
      </div>

      {(log.length > 0 || testing) && (
        <div className="bg-black border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-4 py-2 bg-gray-900 border-b border-gray-800 text-xs text-gray-400 font-mono uppercase tracking-widest">
            Teste de conexão
          </div>
          <div className="p-4 font-mono text-xs space-y-1 max-h-72 overflow-y-auto">
            {log.map((line, i) => (
              <p
                key={i}
                className={
                  line.startsWith("✓")
                    ? "text-green-400"
                    : line.startsWith("✗")
                      ? "text-red-400"
                      : line.startsWith("△")
                        ? "text-yellow-400"
                        : "text-gray-400"
                }
              >
                {line}
              </p>
            ))}
            {testing && <p className="text-gray-500 animate-pulse">$ _</p>}
          </div>
          {verdict && (
            <div
              className={`px-4 py-3 border-t text-sm ${
                verdict.blocked === true
                  ? "border-red-500/30 bg-red-500/10 text-red-400"
                  : verdict.blocked === false
                    ? "border-green-500/30 bg-green-500/10 text-green-400"
                    : "border-gray-800 bg-gray-900 text-gray-400"
              }`}
            >
              {verdict.message}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
