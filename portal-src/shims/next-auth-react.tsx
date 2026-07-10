import { useEffect, useState } from "react"

/** Shim de next-auth/react useSession → carrega /api/admin/profile */
export function useSession() {
  const [data, setData] = useState<{ user?: { name?: string; email?: string } } | null>(null)
  const [status, setStatus] = useState<"loading" | "authenticated" | "unauthenticated">("loading")

  useEffect(() => {
    fetch("/api/admin/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) {
          setStatus("unauthenticated")
          return
        }
        setData({ user: { name: d.username, email: d.email } })
        setStatus("authenticated")
      })
      .catch(() => setStatus("unauthenticated"))
  }, [])

  return { data, status, update: async () => data }
}

export function signOut(opts?: { callbackUrl?: string }) {
  return fetch("/api/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).finally(() => {
    window.location.href = opts?.callbackUrl || "/login"
  })
}

export default { useSession, signOut }
