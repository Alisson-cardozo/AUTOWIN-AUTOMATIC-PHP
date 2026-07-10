interface StatsCardDelta {
  text: string
  tone: "up" | "down" | "neutral"
}

interface StatsCardProps {
  label: string
  value: string
  delta?: StatsCardDelta
}

const toneClasses: Record<StatsCardDelta["tone"], string> = {
  up: "text-emerald-400",
  down: "text-red-400",
  neutral: "text-gray-500",
}

export function StatsCard({ label, value, delta }: StatsCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <p className="text-sm text-gray-400">{label}</p>
      <p className="text-3xl font-semibold text-white mt-2">{value}</p>
      {delta && <p className={`text-xs font-medium mt-2 ${toneClasses[delta.tone]}`}>{delta.text}</p>}
    </div>
  )
}
