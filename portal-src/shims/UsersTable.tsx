"use client"

import { formatDate } from "@/lib/utils"
import { useState, useEffect } from "react"

interface User {
  id: number
  userBot: string | null
  name: string | null
  email: string | null
  accountType: string
  gameType: string
  paymentStatus: string
  paymentExpireIn: number | null
  isActive: boolean
  isTesting: boolean
  expireIn: Date | null
  createdAt: Date
  isAdminAccount?: boolean
}

type Plan = { title: string; days: number; amount: number }

interface UsersTableProps {
  users: User[]
  plans?: Plan[]
  showActions?: boolean
}

// Nenhum pagamento grava qual plano foi comprado diretamente — só
// paymentExpireIn (dias do plano). Casa com o "days" de LICENSE_OPTIONS
// pra mostrar o nome do plano; sem match e sem trial, mostra só "—".
function planLabel(user: User, plans: Plan[], isPaid: boolean): string {
  if (user.isAdminAccount) return "Vitalício"
  if (isPaid) {
    const plan = plans.find((p) => p.days === user.paymentExpireIn)
    if (plan) return plan.title
  }
  if (user.isTesting) return "Teste Grátis"
  return "—"
}

function LicenseModal({ user, onClose, onDone }: { user: User; onClose: () => void; onDone: () => void }) {
  const [plans, setPlans]       = useState<Plan[]>([])
  const [customDays, setCustomDays] = useState("")
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState("")

  useEffect(() => {
    fetch("/api/admin/config")
      .then((r) => r.json())
      .then((data) => {
        try { setPlans(JSON.parse(data.LICENSE_OPTIONS ?? "[]")) } catch {}
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function grant(days: number) {
    if (!days || days < 1) { setErr("Dias inválido"); return }
    setBusy(true); setErr("")
    const res = await fetch("/api/licenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, days }),
    })
    setBusy(false)
    if (!res.ok) { setErr("Erro ao liberar"); return }
    onDone()
  }

  async function revoke() {
    if (!confirm(`Revogar licença de ${user.name ?? user.email}?`)) return
    setBusy(true); setErr("")
    const res = await fetch("/api/licenses", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    })
    setBusy(false)
    if (!res.ok) { setErr("Erro ao revogar"); return }
    onDone()
  }

  const isExpired = user.expireIn ? new Date(user.expireIn) < new Date() : true
  const isPaid    = user.paymentStatus === "PAID" && !isExpired

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-sm space-y-5" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div>
          <h2 className="text-white font-bold text-lg">{user.name ?? user.email ?? "Usuário"}</h2>
          <p className="text-gray-500 text-xs mt-0.5">{user.email}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              user.isAdminAccount
                ? "bg-purple-500/15 text-purple-400"
                : isPaid
                ? "bg-green-500/15 text-green-400"
                : "bg-yellow-500/15 text-yellow-400"
            }`}>
              {user.isAdminAccount ? "VITALÍCIO" : isPaid ? "ATIVO" : user.paymentStatus}
            </span>
            {user.expireIn && !user.isAdminAccount && (
              <span className="text-xs text-gray-500">{isExpired ? "Expirou" : "Expira"} {formatDate(user.expireIn)}</span>
            )}
          </div>
        </div>

        {/* Plans */}
        <div>
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-widest mb-2">Liberar plano</p>
          {loading ? (
            <p className="text-gray-600 text-sm text-center py-3">Carregando...</p>
          ) : plans.length === 0 ? (
            <p className="text-gray-600 text-xs text-center py-2">Nenhum plano cadastrado em Sistema.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {plans.map((p, i) => (
                <button key={i} onClick={() => grant(p.days)} disabled={busy}
                  className="bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-green-500/40 rounded-xl px-3 py-3 text-left transition-colors disabled:opacity-50">
                  <p className="text-white text-sm font-semibold">{p.days} dias</p>
                  <p className="text-green-400 text-xs font-bold mt-0.5">R$ {p.amount.toFixed(2)}</p>
                  <p className="text-gray-500 text-[11px] mt-0.5 truncate">{p.title}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Custom days */}
        <div>
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-widest mb-2">Dias customizados</p>
          <div className="flex gap-2">
            <input type="number" inputMode="decimal" onFocus={(e) => e.target.select()} min="1" value={customDays} onChange={(e) => setCustomDays(e.target.value)}
              placeholder="Ex: 30"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500" />
            <button onClick={() => grant(Number(customDays))} disabled={busy || !customDays}
              className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors">
              {busy ? "..." : "Liberar"}
            </button>
          </div>
        </div>

        {err && <p className="text-red-400 text-xs">{err}</p>}

        {/* Revoke */}
        {isPaid && !user.isAdminAccount && (
          <button onClick={revoke} disabled={busy}
            className="w-full bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-semibold py-2 rounded-xl text-sm transition-colors disabled:opacity-50">
            Revogar Licença
          </button>
        )}

        <button onClick={onClose} className="w-full text-gray-500 hover:text-white text-sm py-1 transition-colors">
          Fechar
        </button>
      </div>
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = { PENDING: "Pendente", PAID: "Pago" }

export function UsersTable({ users, plans = [], showActions = false }: UsersTableProps) {
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [stoppingId, setStoppingId] = useState<number | null>(null)
  const [revokingId, setRevokingId] = useState<number | null>(null)
  const [modalUser, setModalUser]   = useState<User | null>(null)

  async function handleDelete(id: number) {
    if (!confirm("Deletar este usuário?")) return
    setDeletingId(id)
    await fetch(`/api/users?id=${id}`, { method: "DELETE" })
    window.location.reload()
  }

  async function handleStopBot(id: number, name: string | null) {
    if (!confirm(`Parar as apostas de ${name ?? "esse usuário"} agora?`)) return
    setStoppingId(id)
    await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "stop-bot" }),
    })
    setStoppingId(null)
    window.location.reload()
  }

  async function handleRevokeAccess(id: number, name: string | null) {
    if (!confirm(`Tirar o acesso de ${name ?? "esse usuário"} ao sistema?`)) return
    setRevokingId(id)
    await fetch("/api/licenses", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: id }),
    })
    setRevokingId(null)
    window.location.reload()
  }

  if (users.length === 0) {
    return <p className="text-gray-500 text-sm text-center py-8">Nenhum usuário encontrado.</p>
  }

  return (
    <>
      {modalUser && (
        <LicenseModal
          user={modalUser}
          onClose={() => setModalUser(null)}
          onDone={() => { setModalUser(null); window.location.reload() }}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left text-gray-400 font-medium pb-3 pr-4">Nome/Email</th>
              <th className="text-left text-gray-400 font-medium pb-3 pr-4">Cadastro</th>
              <th className="text-left text-gray-400 font-medium pb-3 pr-4">Jogo</th>
              <th className="text-left text-gray-400 font-medium pb-3 pr-4">Status</th>
              <th className="text-left text-gray-400 font-medium pb-3 pr-4">Licença</th>
              <th className="text-left text-gray-400 font-medium pb-3 pr-4">Plano</th>
              <th className="text-left text-gray-400 font-medium pb-3 pr-4">Vencimento</th>
              {showActions && <th className="text-left text-gray-400 font-medium pb-3">Ações</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {users.map((user) => {
              const isExpired = user.expireIn ? new Date(user.expireIn) < new Date() : true
              const isPaid    = user.paymentStatus === "PAID" && !isExpired
              
              // Define License label and badge styling
              let licLabel = ""
              let licClass = ""
              if (user.isAdminAccount) {
                licLabel = "Vitalício"
                licClass = "bg-purple-500/10 text-purple-400 border border-purple-500/20 shadow-[0_0_10px_rgba(168,85,247,0.15)]"
              } else if (isExpired && (user.paymentStatus === "PAID" || user.isTesting)) {
                licLabel = "Expirado"
                licClass = "bg-red-500/10 text-red-400 border border-red-500/20"
              } else {
                if (isPaid) {
                  licLabel = "Pago"
                  licClass = "bg-green-500/10 text-green-400 border border-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.1)]"
                } else if (user.isTesting) {
                  licLabel = "Teste Ativo"
                  licClass = "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                } else {
                  licLabel = STATUS_LABEL[user.paymentStatus] ?? user.paymentStatus
                  licClass = "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                }
              }

              return (
                <tr key={user.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="py-3 pr-4">
                    <p className="text-white font-medium">{user.name || "—"}</p>
                    <p className="text-gray-500 text-xs">{user.email || "—"}</p>
                  </td>
                  <td className="py-3 pr-4 text-gray-400 text-xs">{formatDate(user.createdAt)}</td>
                  <td className="py-3 pr-4">
                    <span className="text-xs font-medium text-gray-300">
                      {user.gameType} / {user.accountType}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex flex-col gap-1">
                      {user.isActive ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />Ativo
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">Inativo</span>
                      )}
                      {user.isTesting && (
                        <span className={`text-xs ${isExpired ? "text-red-400 font-bold" : "text-yellow-400"}`}>
                          {isExpired ? "Teste Expirado" : "Teste Grátis"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${licClass}`}>
                      {licLabel}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-gray-300 text-xs">{planLabel(user, plans, isPaid)}</td>
                  <td className="py-3 pr-4 text-gray-400 text-xs">
                    {user.isAdminAccount ? "Nunca" : formatDate(user.expireIn)}
                  </td>
                  {showActions && (
                    <td className="py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => setModalUser(user)}
                          className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 hover:border-blue-400/40 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all duration-300"
                        >
                          Licença
                        </button>
                        
                        {!user.isAdminAccount && (
                          <>
                            <button
                              onClick={() => handleStopBot(user.id, user.name)}
                              disabled={stoppingId === user.id}
                              className="bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/20 hover:border-orange-400/40 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all duration-300 disabled:opacity-50"
                            >
                              {stoppingId === user.id ? "..." : "Parar Apostas"}
                            </button>
                            <button
                              onClick={() => handleRevokeAccess(user.id, user.name)}
                              disabled={revokingId === user.id}
                              className="bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/20 hover:border-yellow-400/40 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all duration-300 disabled:opacity-50"
                            >
                              Tirar Acesso
                            </button>
                            <button
                              onClick={() => handleDelete(user.id)}
                              disabled={deletingId === user.id}
                              className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-400/40 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all duration-300 disabled:opacity-50"
                            >
                              Deletar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
