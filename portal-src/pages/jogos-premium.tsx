import Link from "next/link"

const PREMIUM_GAMES = [
  {
    id: "bacbo",
    title: "Bac Bo Ao Vivo",
    description: "Análise avançada de padrões e tendências da mesa de Bac Bo.",
    icon: "🎲",
    href: "/premium-bacbo",
    color: "from-blue-600/20 to-blue-900/40",
    border: "border-blue-500/30",
    hoverBorder: "hover:border-blue-400",
    status: "Ativo"
  },
  {
    id: "futebol",
    title: "Futebol Studio",
    description: "Estatísticas em tempo real e detecção de padrões do Top Card.",
    icon: "⚽",
    href: "/premium-futebol",
    color: "from-green-600/20 to-green-900/40",
    border: "border-green-500/30",
    hoverBorder: "hover:border-green-400",
    status: "Beta"
  },
  {
    id: "roletas",
    title: "Roletas Ao Vivo",
    description: "Monitoramento de terminais e mapeamento de zonas quentes e frias.",
    icon: "🎰",
    href: "/premium-roletas",
    color: "from-purple-600/20 to-purple-900/40",
    border: "border-purple-500/30",
    hoverBorder: "hover:border-purple-400",
    status: "Em Breve"
  }
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
            className={`group relative flex flex-col p-6 rounded-3xl bg-gradient-to-br ${game.color} border ${game.border} ${game.hoverBorder} transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-white/5 overflow-hidden`}
          >
            {/* Glow effect on hover */}
            <div className="absolute inset-0 bg-gradient-to-t from-white/0 to-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            
            <div className="flex items-start justify-between mb-4 relative z-10">
              <div className="w-14 h-14 flex items-center justify-center bg-gray-950/50 rounded-2xl border border-gray-800/50 shadow-inner">
                <span className="text-3xl group-hover:scale-110 transition-transform duration-300">{game.icon}</span>
              </div>
              <span className={`text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full border bg-gray-950/80 shadow-sm
                ${game.status === 'Ativo' ? 'text-green-400 border-green-500/30' : 
                  game.status === 'Beta' ? 'text-yellow-400 border-yellow-500/30' : 
                  'text-purple-400 border-purple-500/30'}`}
              >
                {game.status}
              </span>
            </div>

            <div className="space-y-2 relative z-10">
              <h3 className="text-xl font-bold text-white group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-gray-400 transition-all">
                {game.title}
              </h3>
              <p className="text-sm text-gray-400 leading-relaxed group-hover:text-gray-300 transition-colors">
                {game.description}
              </p>
            </div>

            <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-xs font-semibold text-gray-500 group-hover:text-white transition-colors relative z-10">
              <span>Acessar Painel</span>
              <span className="group-hover:translate-x-1 transition-transform">→</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
