/**
 * AUTOWIN — Browser Bridge (Bac Bo) v2
 *
 * Roda no domínio da mesa (Blaze / Evolution) e:
 *  1) dá poll no painel Autowin (BASE_URL + Bearer token)
 *  2) envia bacbo.bet no WebSocket já autenticado da mesa
 *
 * Config (obrigatória se não estiver no mesmo domínio do painel):
 *   window.__AUTOWIN_BRIDGE__ = { baseUrl: "https://seu-painel.com", token: "..." }
 *
 * Gere o snippet no painel: Conta → Iniciar Bot → "Ativar aposta automática"
 */
(function () {
  'use strict';

  const CFG = window.__AUTOWIN_BRIDGE__ || {};
  const BASE_URL = String(CFG.baseUrl || window.location.origin || '').replace(/\/$/, '');
  const TOKEN = String(CFG.token || '');
  const POLL_MS = 2000;
  const VERSION = '2.0.0';

  if (!BASE_URL) {
    console.error('[Bridge] baseUrl não definido. Use o script gerado no painel Autowin.');
    return;
  }
  if (!TOKEN) {
    console.warn(
      '[Bridge] Sem token — só funciona se o cookie da sessão Autowin existir neste domínio. ' +
      'Na mesa Evolution use o snippet do painel (Authorization Bearer).'
    );
  }

  function authHeaders(extra) {
    const h = Object.assign({ Accept: 'application/json' }, extra || {});
    if (TOKEN) h.Authorization = 'Bearer ' + TOKEN;
    return h;
  }

  // Localiza o WebSocket aberto pelo Bac Bo
  const _origWS = window.WebSocket;
  const _sockets = [];

  window.WebSocket = function (url, protocols) {
    const ws = protocols !== undefined ? new _origWS(url, protocols) : new _origWS(url);
    try {
      if (/bacbo|evolution|evo-games|game/i.test(String(url || ''))) {
        _sockets.push(ws);
        console.log('[Bridge] WebSocket capturado:', String(url).slice(0, 100));
      }
    } catch (_) { /* */ }
    return ws;
  };
  Object.assign(window.WebSocket, _origWS);
  try {
    window.WebSocket.prototype = _origWS.prototype;
  } catch (_) { /* */ }

  function findOpenSocket() {
    for (let i = _sockets.length - 1; i >= 0; i--) {
      const ws = _sockets[i];
      if (ws && ws.readyState === WebSocket.OPEN) {
        const u = String(ws.url || '');
        if (/bacbo/i.test(u) || /game/i.test(u)) return ws;
      }
    }
    // fallback: qualquer WS ainda aberto capturado
    for (let i = _sockets.length - 1; i >= 0; i--) {
      const ws = _sockets[i];
      if (ws && ws.readyState === WebSocket.OPEN) return ws;
    }
    return null;
  }

  function buildBetMessage(gameId, spot, amount, protectionAmount) {
    const s = String(spot || 'PLAYER').toUpperCase();
    const betMap = { player: 0, tie: 0, banker: 0 };
    const entries = [];

    if (s === 'EMPATE' || s === 'TIE') {
      betMap.tie = amount;
      entries.push({ to: 'Tie', amount });
    } else if (s === 'BANKER' || s === 'BANK') {
      betMap.banker = amount;
      entries.push({ to: 'Banker', amount });
    } else {
      betMap.player = amount;
      entries.push({ to: 'Player', amount });
    }

    if (protectionAmount > 0 && s !== 'EMPATE' && s !== 'TIE') {
      betMap.tie = protectionAmount;
      entries.push({ to: 'Tie', amount: protectionAmount });
    }

    const randId = () => Math.random().toString(36).slice(2, 12);
    return JSON.stringify({
      id: randId(),
      type: 'bacbo.bet',
      args: {
        gameId,
        betTags: {
          mwLayout: '8',
          openMwTables: '1',
          latency: String(150 + Math.floor(Math.random() * 120)),
          videoProtocol: 'fmp4',
          btVideoQuality: '9',
          btTableView: '0',
          orientation: 'landscape',
        },
        betMap,
        actions: [{ from: 'Chipstack', entries }],
      },
    });
  }

  let currentGameId = null;

  // Hook em listeners de message (WS criados depois do script)
  const _addEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (type === 'message' && this instanceof WebSocket) {
      const wrapped = function (evt) {
        try {
          const data = JSON.parse(evt.data);
          if (data && data.type === 'bacbo.playerState' && data.args && data.args.game) {
            const g = data.args.game;
            if (g.gameId || g.id) currentGameId = g.gameId || g.id;
          }
          if (data && data.args && data.args.game && (data.args.game.gameId || data.args.game.id)) {
            currentGameId = data.args.game.gameId || data.args.game.id;
          }
        } catch (_) { /* */ }
        return fn.call(this, evt);
      };
      return _addEventListener.call(this, type, wrapped, opts);
    }
    return _addEventListener.call(this, type, fn, opts);
  };

  // Também escuta sockets já capturados via onmessage wrapper
  function attachOnMessage(ws) {
    if (!ws || ws.__awBridgeHooked) return;
    ws.__awBridgeHooked = true;
    const prev = ws.onmessage;
    ws.onmessage = function (evt) {
      try {
        const data = JSON.parse(evt.data);
        if (data && data.args && data.args.game) {
          const g = data.args.game;
          if (g.gameId || g.id) currentGameId = g.gameId || g.id;
        }
      } catch (_) { /* */ }
      if (typeof prev === 'function') return prev.call(this, evt);
    };
  }

  async function pollAndBet() {
    try {
      _sockets.forEach(attachOnMessage);

      const res = await fetch(BASE_URL + '/api/user/bacbo-bridge/poll', {
        method: 'GET',
        headers: authHeaders(),
        mode: 'cors',
        cache: 'no-store',
        credentials: TOKEN ? 'omit' : 'include',
      });
      if (!res.ok) {
        if (res.status === 401) {
          console.warn('[Bridge] 401 — token inválido ou expirado. Gere outro no painel Autowin.');
        }
        setBadge('erro ' + res.status, false);
        return;
      }
      const data = await res.json();
      setBadge(data.pending ? 'enviando…' : 'online', true);

      if (!data.pending) return;

      const { betId, spot, amount, protectionAmount } = data;
      console.log('[Bridge] Aposta #' + betId + ':', spot, 'R$' + amount);

      const ws = findOpenSocket();
      if (!ws) {
        console.warn('[Bridge] Nenhum WebSocket do Bac Bo. Recarregue a mesa e cole o script de novo.');
        await reportResult(betId, false, { error: 'WebSocket do Bac Bo nao encontrado.' });
        return;
      }
      if (!currentGameId) {
        console.warn('[Bridge] gameId ainda nao capturado — aguarde a proxima rodada e tente de novo.');
        await reportResult(betId, false, { error: 'gameId nao capturado.' });
        return;
      }

      const msg = buildBetMessage(currentGameId, spot, amount, protectionAmount || 0);
      ws.send(msg);
      console.log('[Bridge] Aposta enviada via WS:', spot, 'R$' + amount, 'game=' + currentGameId);
      setBadge('aposta OK', true);
      await reportResult(betId, true, { ok: true, spot, amount, gameId: currentGameId });
    } catch (e) {
      console.error('[Bridge] Erro:', e && e.message ? e.message : e);
      setBadge('falha rede', false);
    }
  }

  async function reportResult(betId, ok, result) {
    try {
      await fetch(BASE_URL + '/api/user/bacbo-bridge/result', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        mode: 'cors',
        credentials: TOKEN ? 'omit' : 'include',
        body: JSON.stringify({ betId, ok, result }),
      });
    } catch (e) {
      console.error('[Bridge] Erro ao reportar:', e && e.message ? e.message : e);
    }
  }

  // Badge visual discreto na página do jogo
  let badgeEl = null;
  function setBadge(text, ok) {
    try {
      if (!badgeEl) {
        badgeEl = document.createElement('div');
        badgeEl.id = '__aw_bacbo_bridge_badge';
        badgeEl.style.cssText =
          'position:fixed;z-index:2147483647;bottom:12px;right:12px;padding:8px 12px;' +
          'border-radius:10px;font:12px/1.3 system-ui,sans-serif;font-weight:700;' +
          'box-shadow:0 4px 16px rgba(0,0,0,.35);pointer-events:none;';
        (document.body || document.documentElement).appendChild(badgeEl);
      }
      badgeEl.style.background = ok ? 'rgba(22,163,74,.92)' : 'rgba(220,38,38,.92)';
      badgeEl.style.color = '#fff';
      badgeEl.textContent = 'AUTOWIN · ' + text;
    } catch (_) { /* */ }
  }

  console.log(
    '%c[AUTOWIN Browser Bridge v' + VERSION + '] Ativo',
    'color:#22c55e;font-weight:bold;font-size:14px;'
  );
  console.log('[Bridge] API:', BASE_URL, TOKEN ? '(Bearer)' : '(cookie)');
  console.log('[Bridge] Poll a cada ' + POLL_MS / 1000 + 's. Mantenha o Bac Bo aberto nesta aba.');
  setBadge('conectando…', true);

  const interval = setInterval(pollAndBet, POLL_MS);
  pollAndBet();

  window.__stopBacBoBridge = function () {
    clearInterval(interval);
    if (badgeEl && badgeEl.parentNode) badgeEl.parentNode.removeChild(badgeEl);
    badgeEl = null;
    console.log('[Bridge] Parado.');
  };
})();
