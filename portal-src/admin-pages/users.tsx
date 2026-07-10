"use client"

import { useEffect, useState } from "react"
import { UsersTable } from "../shims/UsersTable"

type Plan = { title: string; days: number; amount: number }

export default function AdminUsersPage() {
  const [users, setUsers] = useState<any[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch("/api/users").then((r) => r.json()),
      fetch("/api/admin/config").then((r) => r.json()),
    ])
      .then(([u, cfg]) => {
        setUsers(Array.isArray(u) ? u : [])
        try {
          setPlans(JSON.parse(cfg.LICENSE_OPTIONS ?? "[]"))
        } catch {
          setPlans([])
        }
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="text-gray-400 py-8">Carregando usuários...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Usuários</h1>
          <p className="text-gray-400 text-sm mt-1">{users.length} usuários cadastrados</p>
        </div>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <UsersTable users={users} plans={plans} showActions />
      </div>
    </div>
  )
}
