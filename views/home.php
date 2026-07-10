<!DOCTYPE html>
<html lang="pt-BR" class="h-full overflow-x-hidden">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>AUTOWIN | Painel</title>
<meta name="description" content="AUTOWIN — Double &amp; Crash Bot">
<link rel="icon" href="/logo.jpg?v=2" type="image/jpeg" sizes="any">
<link rel="icon" href="/favicon.ico?v=2" sizes="32x32">
<link rel="icon" href="/icon.svg?v=2" type="image/svg+xml">
<link rel="apple-touch-icon" href="/logo.jpg?v=2">
<link rel="shortcut icon" href="/logo.jpg?v=2">
<link rel="manifest" href="/manifest.json">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="stylesheet" href="/assets/aw-effects.css">
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    theme: {
      extend: {
        spacing: { '4.5': '1.125rem' },
      },
    },
  }
</script>
</head>
<body class="h-full overflow-x-hidden bg-black text-white antialiased font-sans">
<div class="min-h-screen bg-[#030303] text-gray-100 overflow-x-hidden selection:bg-green-500 selection:text-black relative">
  <!-- Background Grid Mesh -->
  <div class="absolute inset-0 bg-[linear-gradient(to_right,#1f293708_1px,transparent_1px),linear-gradient(to_bottom,#1f293708_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none -z-10"></div>

  <!-- Decorative Blur Orbs -->
  <div class="absolute top-[-10%] left-[10%] w-[500px] h-[500px] bg-green-500/10 rounded-full blur-[140px] pointer-events-none -z-10 animate-pulse duration-[8000ms]"></div>
  <div class="absolute top-[20%] right-[10%] w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-[160px] pointer-events-none -z-10"></div>
  <div class="absolute bottom-[20%] left-[-10%] w-[500px] h-[500px] bg-yellow-500/5 rounded-full blur-[130px] pointer-events-none -z-10 animate-pulse duration-[6000ms]"></div>
  <div class="absolute bottom-0 right-0 w-[400px] h-[400px] bg-green-500/10 rounded-full blur-[100px] pointer-events-none -z-10"></div>

  <!-- Header / Navbar -->
  <header class="border-b border-white/[0.04] bg-[#030303]/60 backdrop-blur-xl sticky top-0 z-50 transition-all duration-300">
    <div class="max-w-6xl mx-auto px-4 h-20 flex items-center justify-between">
      <div class="flex items-center gap-3 group cursor-pointer">
        <div class="w-10 h-10 rounded-2xl overflow-hidden border border-green-500/30 shadow-[0_0_20px_rgba(34,197,94,0.2)] bg-black p-0.5 transition-all duration-500 group-hover:border-green-400 group-hover:shadow-[0_0_25px_rgba(34,197,94,0.45)] group-hover:scale-105">
          <img src="/logo.jpg" alt="Logo" class="w-full h-full object-cover rounded-xl">
        </div>
        <div class="flex flex-col">
          <span class="font-black text-base sm:text-lg tracking-widest bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-100 to-green-400 whitespace-nowrap">
            AUTOWIN
          </span>
          <span class="text-[9px] text-gray-500 font-bold tracking-widest uppercase -mt-1 group-hover:text-green-400 transition-colors">
            ROBÔ AUTOMÁTICO
          </span>
        </div>
      </div>

      <div class="flex items-center gap-2 sm:gap-4 shrink-0">
        <a href="/primeiro-acesso" class="hidden md:inline-flex items-center gap-1.5 text-[11px] font-black bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 px-4 py-2.5 rounded-xl transition-all duration-300 hover:border-green-400/40 hover:scale-[1.02]">
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          TESTE GRÁTIS
        </a>
        <a href="/entrar" class="text-xs sm:text-sm font-semibold text-gray-400 hover:text-white px-3 py-2 transition-colors whitespace-nowrap">
          Entrar
        </a>
        <a href="/primeiro-acesso" class="text-xs sm:text-sm font-bold bg-green-500 hover:bg-green-400 text-black px-4 sm:px-6 py-2.5 rounded-xl transition-all duration-300 shadow-[0_4px_20px_rgba(34,197,94,0.25)] hover:shadow-[0_4px_30px_rgba(34,197,94,0.45)] hover:scale-[1.03] active:scale-[0.98] whitespace-nowrap">
          Criar Conta
        </a>
      </div>
    </div>
  </header>

  <!-- Hero Section -->
  <section class="max-w-6xl mx-auto px-4 pt-16 pb-20 md:pt-28 md:pb-32 relative">
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-16 items-center">
      <div class="lg:col-span-7 space-y-8 text-left">
        <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-green-500/20 bg-green-500/5 text-[10px] sm:text-xs text-green-400 font-extrabold uppercase tracking-wider shadow-[0_0_15px_rgba(34,197,94,0.05)]">
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          Robô de Sinais 100% Automático
        </div>

        <h1 class="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black text-white leading-[1.1] tracking-tight">
          Aposte no piloto <br class="hidden sm:inline">
          <span class="bg-clip-text text-transparent bg-gradient-to-r from-green-400 via-emerald-400 to-green-300 drop-shadow-[0_0_15px_rgba(34,197,94,0.15)]">
            automático
          </span>
        </h1>

        <p class="text-gray-400 text-sm sm:text-base md:text-lg leading-relaxed max-w-xl">
          Nossa inteligência artificial conecta diretamente à sua conta e copia sinais de canais ou grupos do Telegram instantaneamente. Suporte completo a estratégias personalizadas, Gales e limites de perda e ganho.
        </p>

        <div class="flex flex-col sm:flex-row gap-4 pt-3">
          <a href="/primeiro-acesso" class="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-black font-black py-4.5 px-8 rounded-xl text-sm sm:text-base shadow-[0_8px_30px_rgba(34,197,94,0.35)] hover:shadow-[0_8px_40px_rgba(34,197,94,0.55)] transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]">
            <span>COMEÇAR TESTE GRÁTIS</span>
            <span class="text-lg">⚡</span>
          </a>
          <a href="#planos" class="inline-flex items-center justify-center border border-white/[0.06] hover:border-green-500/30 bg-white/[0.02] hover:bg-green-500/5 hover:text-green-400 font-bold py-4.5 px-8 rounded-xl text-sm sm:text-base transition-all duration-300">
            Ver Planos Disponíveis
          </a>
        </div>

        <div class="grid grid-cols-3 gap-3 sm:gap-6 pt-10 border-t border-white/[0.04] max-w-md">
          <div class="space-y-1">
            <p class="text-xl sm:text-2xl md:text-3xl font-black text-white tracking-tight">98.4%</p>
            <p class="text-[9px] sm:text-[10px] text-gray-500 font-bold uppercase tracking-wider">Assertividade</p>
          </div>
          <div class="space-y-1">
            <p class="text-xl sm:text-2xl md:text-3xl font-black text-white tracking-tight">Imediato</p>
            <p class="text-[9px] sm:text-[10px] text-gray-500 font-bold uppercase tracking-wider">Copia sem delay</p>
          </div>
          <div class="space-y-1">
            <p class="text-xl sm:text-2xl md:text-3xl font-black text-white tracking-tight">+10k</p>
            <p class="text-[9px] sm:text-[10px] text-gray-500 font-bold uppercase tracking-wider">Apostas</p>
          </div>
        </div>
      </div>

      <!-- Platform Showcase Panel -->
      <div class="lg:col-span-5 relative w-full max-w-md mx-auto lg:max-w-none">
        <div class="absolute inset-0 bg-gradient-to-tr from-green-500/10 to-transparent blur-3xl -z-10"></div>

        <div class="bg-[#0b0c10]/80 backdrop-blur-xl border border-white/[0.05] rounded-3xl p-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)] hover:shadow-[0_20px_50px_rgba(34,197,94,0.15)] hover:border-green-500/20 transition-all duration-500 relative overflow-hidden group">
          <div class="flex items-center justify-between mb-6 pb-4 border-b border-white/[0.04]">
            <div class="flex gap-2">
              <span class="w-3 h-3 rounded-full bg-red-500/40"></span>
              <span class="w-3 h-3 rounded-full bg-yellow-500/40"></span>
              <span class="w-3 h-3 rounded-full bg-green-500/40"></span>
            </div>
            <span class="text-[10px] text-gray-600 font-mono">autowin-hub v1.6.0</span>
          </div>

          <p class="text-[10px] sm:text-xs font-black uppercase tracking-widest text-gray-500 mb-4 text-center">
            Integração Direta e Segura
          </p>

          <div class="space-y-4">
            <div class="rounded-2xl border border-red-500/15 bg-red-500/[0.02] p-5 flex items-center justify-between transition-all duration-300 hover:border-red-500/40 hover:bg-red-500/[0.04] hover:shadow-[0_0_20px_rgba(239,68,68,0.08)] group/item">
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center text-lg font-black text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.1)] group-hover/item:scale-105 transition-transform">B</div>
                <div>
                  <h4 class="text-sm font-black text-white tracking-wider">BLAZE</h4>
                  <p class="text-[10px] text-gray-500">Double / Crash</p>
                </div>
              </div>
              <div class="flex items-center gap-2 bg-red-500/10 border border-red-500/20 px-3 py-1 rounded-full">
                <span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                <span class="text-[9px] font-bold text-red-400 uppercase tracking-widest">Ativo</span>
              </div>
            </div>

            <div class="rounded-2xl border border-yellow-500/15 bg-yellow-500/[0.02] p-5 flex items-center justify-between transition-all duration-300 hover:border-yellow-500/40 hover:bg-yellow-500/[0.04] hover:shadow-[0_0_20px_rgba(234,179,8,0.08)] group/item">
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-xl bg-yellow-500/10 flex items-center justify-center text-lg font-black text-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.1)] group-hover/item:scale-105 transition-transform">J</div>
                <div>
                  <h4 class="text-sm font-black text-white tracking-wider">JONBET</h4>
                  <p class="text-[10px] text-gray-500">Double / Crash</p>
                </div>
              </div>
              <div class="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 px-3 py-1 rounded-full">
                <span class="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse"></span>
                <span class="text-[9px] font-bold text-yellow-400 uppercase tracking-widest">Ativo</span>
              </div>
            </div>
          </div>

          <div class="mt-6 pt-4 border-t border-white/[0.04] space-y-1">
            <div class="flex items-center gap-2 text-[10px] font-mono text-gray-600">
              <span class="text-green-500">&gt;</span>
              <span>[SISTEMA] motor inicializado com sucesso</span>
            </div>
            <div class="flex items-center gap-2 text-[10px] font-mono text-gray-600">
              <span class="text-green-500">&gt;</span>
              <span>[TELEGRAM] monitorando canais configurados</span>
            </div>
            <div class="flex items-center gap-2 text-[10px] font-mono text-green-500/70 font-semibold">
              <span class="text-green-500">&gt;</span>
              <span>[STATUS] aguardando novos sinais...</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Features Grid -->
  <section class="bg-black/40 border-y border-white/[0.03] py-20 md:py-28 relative">
    <div class="max-w-6xl mx-auto px-4">
      <div class="text-center max-w-2xl mx-auto mb-20 space-y-4">
        <span class="text-xs font-black uppercase text-green-400 tracking-widest">Alta Performance</span>
        <h2 class="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight">Funcionalidades do Robô</h2>
        <p class="text-gray-500 text-xs sm:text-sm leading-relaxed">
          Tudo que você precisa para gerenciar suas entradas de forma inteligente e sem cliques manuais.
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <?php
        $features = [
            ['⚡', 'green', 'Copiar Canal de Sinais', 'Integração direta com canais de Telegram. O robô lê e interpreta automaticamente as mensagens de entrada e gale.'],
            ['🔄', 'red', 'Ciclos e Martingales', 'Suporta proteção no branco e multiplicadores automáticos de Gale configurados individualmente para cada ativo.'],
            ['🛑', 'yellow', 'Stop Win / Stop Loss', 'Defina metas diárias de ganho e perda máxima. O robô para instantaneamente quando atinge os seus limites.'],
            ['🧪', 'blue', 'Modo Simulação (DEMO)', 'Teste estratégias e canais inteiros sem apostar dinheiro de verdade. O robô simula as entradas na roleta real.'],
            ['🛡️', 'purple', 'Trailing Loss Guard', 'Proteja seu lucro máximo atingido! Se o saldo recuar a partir do pico, o robô interrompe as apostas no dia.'],
            ['📱', 'pink', 'Totalmente Responsivo', 'Monitore o robô, acompanhe o histórico e altere estratégias de qualquer lugar pelo celular, tablet ou PC.'],
            ['📋', 'teal', 'Gerador de Listas', 'Gera listas prontas de entradas com base nos padrões mais fortes identificados, prontas pra copiar ou usar direto no robô.'],
            ['🔍', 'indigo', 'Caçador de Padrões', 'Varre o histórico de resultados e encontra sequências recorrentes com alta taxa de acerto, prontas pra virar estratégia.'],
            ['✅', 'lime', 'Corrigir Listas', 'Cole sua lista de entradas e o sistema corrige e valida automaticamente contra os resultados reais da mesa.'],
        ];
        $shadow = [
            'green' => 'rgba(34,197,94,0.1)', 'red' => 'rgba(239,68,68,0.1)', 'yellow' => 'rgba(234,179,8,0.1)',
            'blue' => 'rgba(59,130,246,0.1)', 'purple' => 'rgba(168,85,247,0.1)', 'pink' => 'rgba(236,72,153,0.1)',
            'teal' => 'rgba(20,184,166,0.1)', 'indigo' => 'rgba(99,102,241,0.1)', 'lime' => 'rgba(132,204,22,0.1)',
        ];
        foreach ($features as [$icon, $color, $title, $desc]):
        ?>
        <div class="bg-white/[0.01] border border-white/[0.04] hover:border-green-500/30 hover:bg-white/[0.02] p-8 rounded-3xl transition-all duration-500 hover:-translate-y-1.5 hover:shadow-[0_15px_35px_rgba(34,197,94,0.12)] group">
          <div class="w-12 h-12 rounded-2xl bg-<?= $color ?>-500/10 flex items-center justify-center text-xl mb-6 shadow-[0_0_15px_<?= $shadow[$color] ?>] group-hover:scale-110 transition-transform"><?= $icon ?></div>
          <h3 class="text-lg font-bold text-white mb-2"><?= e($title) ?></h3>
          <p class="text-gray-400 text-xs sm:text-sm leading-relaxed"><?= e($desc) ?></p>
        </div>
        <?php endforeach; ?>
      </div>
    </div>
  </section>

  <!-- Smartphone Mockups & App Section -->
  <section class="py-24 md:py-32 bg-gradient-to-b from-[#030303] to-[#07070a] relative overflow-hidden border-t border-white/[0.02]">
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-green-500/5 rounded-full blur-[140px] pointer-events-none -z-10 animate-pulse duration-[10000ms]"></div>

    <div class="max-w-6xl mx-auto px-4">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-16 items-center">

        <div class="lg:col-span-6 flex justify-center items-center relative min-h-[480px] sm:min-h-[560px]">
          <div class="absolute w-[240px] sm:w-[270px] h-[450px] sm:h-[510px] bg-[#0c0d12] border-4 border-white/[0.08] rounded-[42px] shadow-2xl overflow-hidden z-10 aw-animate-float-back transition-all duration-550 hover:opacity-90 hover:scale-[1.02]">
            <div class="w-full h-6 bg-[#08090d] flex items-center justify-center border-b border-white/[0.04]">
              <div class="w-16 h-3.5 bg-black rounded-full"></div>
            </div>
            <div class="p-5 space-y-5 text-xs font-semibold text-gray-500">
              <div class="flex items-center gap-2 pb-4 border-b border-white/[0.04]">
                <div class="w-6 h-6 rounded-lg bg-green-500/10 flex items-center justify-center text-xs">🎯</div>
                <span class="font-black text-white tracking-wider">AUTOWIN</span>
              </div>
              <div class="space-y-2">
                <div class="flex items-center gap-3 bg-green-500/10 border border-green-500/20 text-green-400 px-3 py-2.5 rounded-xl">
                  <span class="text-sm">📊</span> <span>Painel</span>
                </div>
                <div class="flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] hover:text-white rounded-xl transition-all">
                  <span class="text-sm">⚙️</span> <span>Configurar Blaze</span>
                </div>
                <div class="flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] hover:text-white rounded-xl transition-all">
                  <span class="text-sm">🟡</span> <span>Configurar Jonbet</span>
                </div>
                <div class="flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] hover:text-white rounded-xl transition-all">
                  <span class="text-sm">👥</span> <span>Bot do Telegram</span>
                </div>
                <div class="flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] hover:text-white rounded-xl transition-all">
                  <span class="text-sm">💳</span> <span>Assinatura</span>
                </div>
              </div>
            </div>
          </div>

          <div class="absolute w-[240px] sm:w-[270px] h-[450px] sm:h-[510px] bg-[#0c0d12] border-4 border-white/[0.08] rounded-[42px] shadow-[0_20px_50px_rgba(34,197,94,0.15)] hover:shadow-[0_20px_60px_rgba(34,197,94,0.3)] hover:border-green-500/35 overflow-hidden z-20 aw-animate-float-front transition-all duration-550 hover:scale-[1.04]">
            <div class="w-full h-6 bg-[#08090d] flex items-center justify-center border-b border-white/[0.04]">
              <div class="w-16 h-3.5 bg-black rounded-full"></div>
            </div>
            <div class="p-5 space-y-4 text-left">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-[9px] text-gray-500 font-bold uppercase tracking-wider">Painel Operacional</p>
                  <p class="text-xs font-black text-white truncate max-w-[125px]">Usuário Demo</p>
                </div>
                <div class="w-7 h-7 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center text-xs">👤</div>
              </div>

              <div class="bg-gradient-to-br from-green-500/10 to-emerald-600/[0.02] border border-green-500/20 rounded-2xl p-4 space-y-1 shadow-[inset_0_1px_10px_rgba(34,197,94,0.05)]">
                <p class="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Saldo Monitorado</p>
                <p class="text-lg font-black text-white tracking-tight">R$ 12.482,90</p>
                <div class="flex items-center gap-1.5 pt-2 border-t border-white/[0.04]">
                  <span class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                  <span class="text-[8px] text-green-400 font-extrabold uppercase tracking-widest">Motor Operando</span>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-2.5">
                <div class="bg-white/[0.02] border border-white/[0.04] p-3 rounded-xl">
                  <p class="text-[8px] text-gray-500 font-bold uppercase">Hoje</p>
                  <p class="text-xs font-black text-green-400">+R$ 240,10</p>
                </div>
                <div class="bg-white/[0.02] border border-white/[0.04] p-3 rounded-xl">
                  <p class="text-[8px] text-gray-500 font-bold uppercase">Assertividade</p>
                  <p class="text-xs font-black text-white">98.4%</p>
                </div>
              </div>

              <div class="bg-white/[0.01] border border-white/[0.03] rounded-xl p-3 space-y-2 text-[9px] text-gray-400">
                <div class="flex items-center justify-between text-white font-bold">
                  <span>Plataforma</span>
                  <span class="text-yellow-400 font-black">JONBET</span>
                </div>
                <div class="flex justify-between border-t border-white/[0.02] pt-1">
                  <span>Estratégia:</span>
                  <span class="text-white font-bold">Copiar Telegram</span>
                </div>
                <div class="flex justify-between">
                  <span>Gales:</span>
                  <span class="text-white font-bold">Até Gale 2</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="lg:col-span-6 space-y-10 text-center lg:text-left">
          <div class="space-y-4">
            <span class="text-xs font-black uppercase text-green-400 tracking-widest block">Instalação Facilitada</span>
            <h2 class="text-4xl sm:text-5xl font-black text-white leading-none tracking-tight">
              BAIXE O APLICATIVO <br>
              <span class="text-5xl sm:text-7xl font-black bg-clip-text text-transparent bg-gradient-to-r from-green-400 via-emerald-500 to-green-300">
                PARA CELULAR
              </span>
            </h2>
            <p class="text-gray-400 text-sm sm:text-base max-w-lg mx-auto lg:mx-0 leading-relaxed">
              Tenha controle total dos seus robôs e acompanhe seus lucros em tempo real na palma da mão, com um aplicativo leve e super seguro.
            </p>
          </div>

          <div class="grid grid-cols-2 gap-8 max-w-md mx-auto lg:mx-0">
            <?php
            $badges = [
                ['🔔', 'Alertas Push', 'Notificações em tempo real sobre cada sinal copiado e meta atingida.'],
                ['⚡', 'Instalação Direta', 'Sem necessidade de app store. Instala em 2 segundos pelo navegador.'],
                ['🪶', 'Extremamente Leve', 'Não consome a memória do celular nem bateria em segundo plano.'],
                ['🔐', 'Segurança Máxima', 'Seus dados protegidos sob protocolo criptografado de ponta a ponta.'],
            ];
            foreach ($badges as [$icon, $title, $desc]):
            ?>
            <div class="flex flex-col items-center lg:items-start text-center lg:text-left space-y-2 group">
              <div class="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center text-xl shadow-[0_0_15px_rgba(34,197,94,0.05)] transition-transform duration-300 group-hover:scale-110 group-hover:shadow-[0_0_20px_rgba(34,197,94,0.2)]">
                <?= $icon ?>
              </div>
              <h4 class="text-xs font-black text-white uppercase tracking-wider"><?= e($title) ?></h4>
              <p class="text-[11px] text-gray-500 leading-normal"><?= e($desc) ?></p>
            </div>
            <?php endforeach; ?>
          </div>

          <div class="pt-4 space-y-4">
            <button id="aw-install-btn" class="w-full sm:w-auto inline-flex items-center justify-center gap-3 bg-gradient-to-r from-green-500 via-emerald-600 to-green-500 hover:from-green-400 hover:to-emerald-500 text-black font-black py-4.5 px-10 rounded-2xl text-sm sm:text-base shadow-[0_8px_30px_rgba(34,197,94,0.2)] hover:shadow-[0_8px_40px_rgba(34,197,94,0.5)] transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]">
              <span>📲 BAIXAR E INSTALAR AGORA</span>
              <span class="text-lg">⚡</span>
            </button>
            <p class="text-[10px] text-gray-500 uppercase tracking-widest">
              Compatível com todos os dispositivos Android &amp; iOS
            </p>
          </div>
        </div>

      </div>
    </div>
  </section>

  <!-- Pricing / Plan Section (populado via JS a partir de /api/plans) -->
  <section id="planos" class="hidden py-20 md:py-28 border-t border-white/[0.02] bg-black/30 relative">
    <div class="max-w-6xl mx-auto px-4 text-center">
      <div class="max-w-xl mx-auto mb-20 space-y-4">
        <span class="text-xs font-black uppercase text-green-400 tracking-widest">Preços Justos</span>
        <h2 class="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight">Adquira sua Licença</h2>
        <p class="text-gray-550 text-xs sm:text-sm leading-relaxed">
          Liberação automática via Pix. Comece a lucrar agora mesmo no piloto automático.
        </p>
      </div>

      <div id="aw-plans-grid" class="flex flex-wrap justify-center gap-8"></div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="border-t border-white/[0.03] bg-black py-16 text-xs sm:text-sm text-gray-500">
    <div class="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-8">
      <div class="flex items-center gap-3 cursor-pointer group">
        <div class="w-8 h-8 rounded-xl overflow-hidden border border-green-500/20 p-0.5 bg-black">
          <img src="/logo.jpg" alt="Logo" class="w-full h-full object-cover rounded-lg">
        </div>
        <span class="font-bold text-gray-300 tracking-wider">AUTOWIN AUTOMATIC</span>
      </div>

      <p class="text-center md:text-left text-xs text-gray-600">
        © <?= date('Y') ?> Autowin Automatic. Todos os direitos reservados.
      </p>

      <div id="aw-social-links" class="hidden items-center gap-3">
        <a id="aw-social-instagram" href="#" target="_blank" rel="noopener noreferrer" title="Instagram" class="hidden w-9 h-9 rounded-xl bg-white/[0.01] border border-white/[0.05] items-center justify-center text-gray-400 hover:border-green-500/30 hover:bg-green-500/5 hover:text-green-400 transition-all duration-300">
          <svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M12 0C8.74 0 8.333.014 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.132 5.775.072 7.053.014 8.333 0 8.74 0 12s.014 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.014 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913C23.988 15.667 24 15.259 24 12s-.014-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.014 15.259 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z"/></svg>
        </a>
        <a id="aw-social-telegram" href="#" target="_blank" rel="noopener noreferrer" title="Telegram" class="hidden w-9 h-9 rounded-xl bg-white/[0.01] border border-white/[0.05] items-center justify-center text-gray-400 hover:border-green-500/30 hover:bg-green-500/5 hover:text-green-400 transition-all duration-300">
          <svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
        </a>
        <a id="aw-social-github" href="#" target="_blank" rel="noopener noreferrer" title="GitHub" class="hidden w-9 h-9 rounded-xl bg-white/[0.01] border border-white/[0.05] items-center justify-center text-gray-400 hover:border-green-500/30 hover:bg-green-500/5 hover:text-green-400 transition-all duration-300">
          <svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
        </a>
      </div>
    </div>
  </footer>

  <!-- iOS Installation Instructions Overlay Modal -->
  <div id="aw-ios-modal" class="hidden fixed inset-0 bg-black/80 backdrop-blur-sm z-50 items-center justify-center p-4">
    <div class="bg-[#0b0c10] border border-white/[0.06] rounded-[32px] p-6 max-w-sm w-full relative space-y-5 shadow-2xl">
      <button id="aw-ios-modal-close-x" class="absolute top-4 right-4 text-gray-400 hover:text-white font-bold text-sm bg-white/[0.03] hover:bg-white/[0.08] w-7 h-7 rounded-full flex items-center justify-center transition-colors">✕</button>
      <div class="text-center space-y-2">
        <span class="text-4xl block">🍎</span>
        <h3 class="text-lg font-black text-white">Instalar no seu iPhone</h3>
        <p class="text-gray-400 text-xs leading-relaxed">
          O iOS exige a instalação do aplicativo através do navegador Safari oficial:
        </p>
      </div>
      <ol class="text-xs text-gray-300 space-y-3 bg-white/[0.01] p-4.5 rounded-2xl border border-white/[0.03] list-decimal pl-6 font-medium">
        <li>Abra este site no navegador <strong>Safari</strong> do seu iPhone.</li>
        <li>Toque no botão de <strong>Compartilhar</strong> (ícone de um quadrado com seta para cima na barra inferior).</li>
        <li>Role a lista para baixo e selecione <strong>"Adicionar à Tela de Início"</strong>.</li>
        <li>Clique em <strong>"Adicionar"</strong> no canto superior direito.</li>
      </ol>
      <button id="aw-ios-modal-close" class="w-full bg-green-500 hover:bg-green-400 text-black font-black py-3.5 rounded-xl text-xs transition-colors">
        Entendido
      </button>
    </div>
  </div>
</div>

<script>
(function () {
  var deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(function () { console.log('Service Worker registrado.'); })
      .catch(function (err) { console.error('Erro SW:', err); });
  }

  var iosModal = document.getElementById('aw-ios-modal');
  function showIosModal() { iosModal.classList.remove('hidden'); iosModal.classList.add('flex'); }
  function hideIosModal() { iosModal.classList.add('hidden'); iosModal.classList.remove('flex'); }
  document.getElementById('aw-ios-modal-close').addEventListener('click', hideIosModal);
  document.getElementById('aw-ios-modal-close-x').addEventListener('click', hideIosModal);

  document.getElementById('aw-install-btn').addEventListener('click', function () {
    var isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIos) {
      showIosModal();
      return;
    }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        if (choice.outcome === 'accepted') deferredPrompt = null;
      });
    }
  });

  function formatBRL(n) {
    return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  fetch('/api/plans')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var plans = data.plans || [];
      if (plans.length > 0) {
        var grid = document.getElementById('aw-plans-grid');
        grid.innerHTML = plans.map(function (plan, i) {
          var badge = i === 0
            ? '<div class="absolute top-0 right-0 bg-green-500 text-black font-extrabold text-[9px] tracking-widest py-1.5 px-5 rounded-bl-2xl uppercase">Mais Popular</div>'
            : '';
          return (
            '<div class="bg-[#0b0c10]/90 backdrop-blur-xl border border-white/[0.06] rounded-3xl p-8 max-w-sm w-full relative overflow-hidden shadow-2xl transition-all duration-500 hover:border-green-500/40 hover:shadow-[0_10px_30px_rgba(34,197,94,0.15)] hover:-translate-y-1.5 group">' +
              badge +
              '<span class="text-xs font-black text-green-400 uppercase tracking-widest block mb-2">PLANO ' + plan.days + ' DIAS</span>' +
              '<h3 class="text-2xl font-black text-white mb-6">' + plan.title + '</h3>' +
              '<div class="my-6 py-4 border-y border-white/[0.04]">' +
                '<span class="text-4xl sm:text-5xl font-black text-white tracking-tight">R$ ' + formatBRL(plan.amount) + '</span>' +
                '<span class="text-gray-500 text-xs font-bold uppercase tracking-wider block mt-1">por ' + plan.days + ' dias de acesso</span>' +
              '</div>' +
              '<ul class="space-y-4 text-left text-xs sm:text-sm text-gray-400 mb-8">' +
                ['Acesso aos bots Blaze e Jonbet', 'Suporte a Double e Crash', 'Copiador de salas de Telegram VIP', 'Configuração ilimitada de Gales', 'Testes sem limites no modo DEMO']
                  .map(function (t) {
                    return '<li class="flex items-center gap-3"><span class="w-5 h-5 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center text-[10px] text-green-400 font-bold">✓</span> <span>' + t + '</span></li>';
                  }).join('') +
              '</ul>' +
              '<a href="/primeiro-acesso" class="block w-full text-center bg-green-500 hover:bg-green-400 text-black font-black py-4 rounded-2xl text-xs tracking-wider transition-all duration-300 shadow-[0_4px_15px_rgba(34,197,94,0.1)] hover:shadow-[0_4px_25px_rgba(34,197,94,0.35)]">QUERO COMEÇAR AGORA ⚡</a>' +
            '</div>'
          );
        }).join('');
        document.getElementById('planos').classList.remove('hidden');
      }

      var social = data.social || {};
      var any = false;
      if (social.instagram) {
        var a = document.getElementById('aw-social-instagram');
        a.href = social.instagram; a.classList.remove('hidden'); a.classList.add('flex'); any = true;
      }
      if (social.telegram) {
        var t = document.getElementById('aw-social-telegram');
        t.href = social.telegram; t.classList.remove('hidden'); t.classList.add('flex'); any = true;
      }
      if (social.github) {
        var g = document.getElementById('aw-social-github');
        g.href = social.github; g.classList.remove('hidden'); g.classList.add('flex'); any = true;
      }
      if (any) {
        var wrap = document.getElementById('aw-social-links');
        wrap.classList.remove('hidden'); wrap.classList.add('flex');
      }
    })
    .catch(function () {});
})();
</script>
</body>
</html>
