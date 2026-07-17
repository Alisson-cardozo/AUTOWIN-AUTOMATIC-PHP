package com.autowin.app;

/**
 * JS injetado na WebView headless depois que ela navega de verdade pra
 * página da Evolution (ver BetBridgeService). Adaptado de
 * public/bacbo-bridge.js do portal — mesma lógica de captura do WebSocket
 * real e montagem da mensagem de aposta, só que sem o poll/report (isso
 * fica nativo, em BetBridgeService) e reportando pro lado Android via
 * "AndroidBridge" (addJavascriptInterface).
 */
final class BetBridgeScript {

    private BetBridgeScript() {
    }

    static final String SOURCE = "" +
        "(function () {\n" +
        "  'use strict';\n" +
        "  if (window.__autowinBridgeInstalled) return;\n" +
        "  window.__autowinBridgeInstalled = true;\n" +
        "\n" +
        "  var _origWS = window.WebSocket;\n" +
        "  var _socket = null;\n" +
        "  var _gameId = null;\n" +
        "  var _stage = null;\n" +
        "\n" +
        "  window.WebSocket = function (url, protocols) {\n" +
        "    var ws = protocols ? new _origWS(url, protocols) : new _origWS(url);\n" +
        "    if (String(url || '').indexOf('bacbo') !== -1) {\n" +
        "      _socket = ws;\n" +
        "      ws.addEventListener('message', function (evt) {\n" +
        "        try {\n" +
        "          var data = JSON.parse(evt.data);\n" +
        "          if (data && data.type === 'bacbo.playerState' && data.args && data.args.game) {\n" +
        "            var g = data.args.game;\n" +
        "            if (g.gameId || g.id) _gameId = g.gameId || g.id;\n" +
        "            if (g.stage) _stage = g.stage;\n" +
        "            if (window.AndroidBridge) {\n" +
        "              window.AndroidBridge.onGameState(_gameId || '', _stage || '');\n" +
        "            }\n" +
        "          }\n" +
        "        } catch (_e) { /* ignora frames que não são playerState */ }\n" +
        "      });\n" +
        "      ws.addEventListener('open', function () {\n" +
        "        if (window.AndroidBridge) window.AndroidBridge.onSocketOpen();\n" +
        "      });\n" +
        "      ws.addEventListener('close', function () {\n" +
        "        if (window.AndroidBridge) window.AndroidBridge.onSocketClose();\n" +
        "      });\n" +
        "    }\n" +
        "    return ws;\n" +
        "  };\n" +
        "  Object.assign(window.WebSocket, _origWS);\n" +
        "\n" +
        "  function buildBetMessage(gameId, spot, amount, protectionAmount) {\n" +
        "    var s = String(spot || 'PLAYER').toUpperCase();\n" +
        "    var betMap = { player: 0, tie: 0, banker: 0 };\n" +
        "    var entries = [];\n" +
        "    if (s === 'EMPATE' || s === 'TIE') {\n" +
        "      betMap.tie = amount;\n" +
        "      entries.push({ to: 'Tie', amount: amount });\n" +
        "    } else if (s === 'BANKER' || s === 'BANK') {\n" +
        "      betMap.banker = amount;\n" +
        "      entries.push({ to: 'Banker', amount: amount });\n" +
        "    } else {\n" +
        "      betMap.player = amount;\n" +
        "      entries.push({ to: 'Player', amount: amount });\n" +
        "    }\n" +
        "    if (protectionAmount > 0 && s !== 'EMPATE' && s !== 'TIE') {\n" +
        "      betMap.tie = protectionAmount;\n" +
        "      entries.push({ to: 'Tie', amount: protectionAmount });\n" +
        "    }\n" +
        "    var randId = function () { return Math.random().toString(36).slice(2, 12); };\n" +
        "    return JSON.stringify({\n" +
        "      id: randId(),\n" +
        "      type: 'bacbo.bet',\n" +
        "      args: {\n" +
        "        gameId: gameId,\n" +
        "        betTags: {\n" +
        "          mwLayout: '8', openMwTables: '1',\n" +
        "          latency: String(150 + Math.floor(Math.random() * 120)),\n" +
        "          videoProtocol: 'fmp4', btVideoQuality: '9',\n" +
        "          btTableView: '0', orientation: 'landscape'\n" +
        "        },\n" +
        "        betMap: betMap,\n" +
        "        actions: [{ from: 'Chipstack', entries: entries }]\n" +
        "      }\n" +
        "    });\n" +
        "  }\n" +
        "\n" +
        "  window.__autowinPlaceBet = function (spot, amount, protectionAmount) {\n" +
        "    if (!_socket || _socket.readyState !== WebSocket.OPEN) {\n" +
        "      return JSON.stringify({ ok: false, error: 'WebSocket do Bac Bo não encontrado/aberto.' });\n" +
        "    }\n" +
        "    if (!_gameId) {\n" +
        "      return JSON.stringify({ ok: false, error: 'gameId ainda não capturado.' });\n" +
        "    }\n" +
        "    try {\n" +
        "      _socket.send(buildBetMessage(_gameId, spot, amount, protectionAmount || 0));\n" +
        "      return JSON.stringify({ ok: true, gameId: _gameId, spot: spot, amount: amount });\n" +
        "    } catch (e) {\n" +
        "      return JSON.stringify({ ok: false, error: String(e && e.message || e) });\n" +
        "    }\n" +
        "  };\n" +
        "\n" +
        "  if (window.AndroidBridge) window.AndroidBridge.onReady();\n" +
        "})();";
}
