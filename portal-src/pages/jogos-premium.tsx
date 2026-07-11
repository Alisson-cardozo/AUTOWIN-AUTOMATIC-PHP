import Link from "next/link"

const PREMIUM_GAMES = [
  {
    id: "bacbo",
    title: "Bac Bo Ao Vivo",
    description: "Análise avançada de padrões e tendências da mesa de Bac Bo.",
    icon: "🎲",
    href: "/premium-bacbo",
    // Mesma arte da aba Conta Blaze
    image: "/imagem-jogos/blaze/bacbo.png" as string | null,
    color: "from-blue-600/20 to-blue-900/40",
    border: "border-blue-500/30",
    hoverBorder: "hover:border-blue-400",
    overlay: "from-blue-950/90 via-blue-950/55 to-transparent",
    status: "Ativo",
  },
  {
    id: "futebol",
    title: "Futebol Studio",
    description: "Estatísticas em tempo real e detecção de padrões do Top Card.",
    icon: "⚽",
    href: "/premium-futebol",
    image: null as string | null,
    color: "from-green-600/20 to-green-900/40",
    border: "border-green-500/30",
    hoverBorder: "hover:border-green-400",
    overlay: "from-green-950/90 via-green-950/55 to-transparent",
    status: "Beta",
  },
  {
    id: "roletas",
    title: "Roletas Ao Vivo",
    description: "Monitoramento de terminais e mapeamento de zonas quentes e frias.",
    icon: "🎰",
    href: "/premium-roletas",
    image: null as string | null,
    color: "from-purple-600/20 to-purple-900/40",
    border: "border-purple-500/30",
    hoverBorder: "hover:border-purple-400",
    overlay: "from-purple-950/90 via-purple-950/55 to-transparent",
    status: "Em Breve",
  },
]

export default function JogosPremiumHub() {
  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col items-center justify-center text-center space-y-3 py-6">
        <span className="text-5xl drop-shadow-[0_0_15px_rgba(57,255,20,0.5)]">💎</span>
        <h1 className="text-3xl font-black text-white tracking-tight">Jogos Ao Vivo</h1>
        <p className="text-gray-400 max-w-xl text-sm leading-relaxed">
          Tenha acesso ao arsenal completo de análises em tempo real para as mesas ao vivo.
          Nossos algoritmos monitoram as rodadas 24 horas por dia para entregar os melhores sinais.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {PREMIUM_GAMES.map((game) => (
          <Link
            key={game.id}
            href={game.href}
            className={`group relative flex flex-col min-h-[220px] rounded-3xl bg-gradient-to-br ${game.color} border ${game.border} ${game.hoverBorder} transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-white/5 overflow-hidden`}
          >
            {/* Imagem só quando existir (ex.: Bac Bo); Futebol/Roletas ficam só no gradiente */}
            {game.image ? (
              <>
                <div
                  className="absolute inset-0 z-0 bg-cover bg-center transition-all duration-500 group-hover:scale-105"
                  style={{
                    backgroundImage: `url(${game.image})`,
                    filter: "brightness(0.75) contrast(1.05) saturate(1.1)",
                  }}
                />
                <div className={`absolute inset-0 z-10 bg-gradient-to-t ${game.overlay}`} />
              </>
            ) : (
              <div className={`absolute inset-0 z-0 bg-gradient-to-br ${game.color}`} />
            )}

            <div className="relative z-20 flex flex-col flex-1 p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 flex items-center justify-center bg-gray-950/60 backdrop-blur-md rounded-2xl border border-white/10 shadow-inner">
                  <span className="text-2xl group-hover:scale-110 transition-transform duration-300">{game.icon}</span>
                </div>
                <span
                  className={`text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full border bg-gray-950/80 shadow-sm backdrop-blur-sm
                  ${
                    game.status === "Ativo"
                      ? "text-green-400 border-green-500/30"
                      : game.status === "Beta"
                      ? "text-yellow-400 border-yellow-500/30"
                      : "text-purple-400 border-purple-500/30"
                  }`}
                >
                  {game.status}
                </span>
              </div>

              <div className="mt-auto space-y-2">
                <h3
                  className="text-xl font-bold text-white"
                  style={{ textShadow: "0 2px 8px rgba(0,0,0,0.85)" }}
                >
                  {game.title}
                </h3>
                <p
                  className="text-sm text-gray-200/90 leading-relaxed"
                  style={{ textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}
                >
                  {game.description}
                </p>
              </div>

              <div className="mt-5 pt-4 border-t border-white/15 flex items-center justify-between text-xs font-semibold text-gray-200 group-hover:text-white transition-colors">
                <span>Acessar Painel</span>
                <span className="group-hover:translate-x-1 transition-transform">→</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
