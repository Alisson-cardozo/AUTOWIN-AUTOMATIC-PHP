export const FEATURES = [
  { key: "conta_blaze", label: "Conta Blaze", path: "/conta" },
  { key: "conta_jonbet", label: "Conta Jonbet", path: "/jonbet" },
  { key: "premium_bacbo", label: "Jogos Ao Vivo", path: "/jogos-premium" },
  { key: "premium_blaze", label: "Premium Blaze", path: "/premium" },
  { key: "premium_jonbet", label: "Premium Jonbet", path: "/premium-jonbet" },
] as const

export type FeatureKey = (typeof FEATURES)[number]["key"]

export function hasFeature(
  user: { isTesting: boolean; features: string | null; isAdminAccount?: boolean },
  key: FeatureKey
): boolean {
  if (user.isAdminAccount) return true
  if (user.isTesting) return true
  if (!user.features) return true
  try {
    return (JSON.parse(user.features) as string[]).includes(key)
  } catch {
    return true
  }
}

export function featureForPath(pathname: string): FeatureKey | null {
  const match = FEATURES.find((f) => pathname.startsWith(f.path))
  return match?.key ?? null
}
