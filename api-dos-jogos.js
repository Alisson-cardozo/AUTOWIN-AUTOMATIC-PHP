/**
 * Cloudflare Worker — proxy de APIs de jogos (TipMiner).
 *
 * BAC BO — 2 salas DIFERENTES na Blaze (ambas via TipMiner):
 *
 *   ?game=bacbo
 *     → Bac Bo (sala normal)
 *     → id: cc71e81d-8b56-4868-91c7-7224be543dce
 *
 *   ?game=bacbo-live
 *     → Bac Bo Ao Vivo
 *     → id: daed14c3-2a22-47b3-83c6-2c3a50c2ae69
 *
 * Outros:
 *   ?game=roulette-xtreme | roulette-immersive | double-max
 *
 * Opcional: ?limit=200
 */
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const game = (url.searchParams.get("game") || "bacbo").toLowerCase();
    const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") || "200", 10) || 200));

    const cors = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const games = {
      // ── Bac Bo (sala normal) ───────────────────────────────────────────
      bacbo: {
        type: "bac-bo",
        id: "cc71e81d-8b56-4868-91c7-7224be543dce",
        name: "Bac Bo",
        normalize: "bacbo",
        referer: "https://www.tipminer.com/br/cassinos/blaze/bac-bo",
      },
      // ── Bac Bo Ao Vivo (outra mesa) ────────────────────────────────────
      "bacbo-live": {
        type: "bac-bo",
        id: "daed14c3-2a22-47b3-83c6-2c3a50c2ae69",
        name: "Bac Bo Ao Vivo",
        normalize: "bacbo",
        referer: "https://www.tipminer.com/br/cassinos/blaze/bac-bo-ao-vivo",
      },
      // ── Roletas ────────────────────────────────────────────────────────
      "roulette-xtreme": {
        type: "roulette",
        id: "e640b7c7-aaba-4ffa-a678-6b6872898162",
        name: "XXXtreme Lightning Roulette",
      },
      "roulette-immersive": {
        type: "roulette",
        id: "dfa678e4-4452-4723-a97d-f3703302d5cc",
        name: "Immersive Roulette",
      },
      "double-max": {
        type: "double",
        id: "019e6619-2b67-70d7-9722-aaaf7b813a6e",
        name: "Double Max",
      },
    };

    if (!games[game]) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Jogo "${game}" não encontrado.`,
          available: ["bacbo", "bacbo-live", "roulette-xtreme", "roulette-immersive", "double-max"],
          note: "bacbo = Bac Bo normal | bacbo-live = Bac Bo Ao Vivo (mesas diferentes)",
        }),
        { status: 400, headers: cors }
      );
    }

    const { type, id, name, normalize, referer } = games[game];
    const cb = crypto.randomUUID();
    const target =
      `https://api.core.public.tipminer.com/v1/${type}/rounds/${id}/history` +
      `?limit=${limit}&timezone=America%2FSao_Paulo&_cb=${cb}`;

    try {
      const resp = await fetch(target, {
        headers: tipminerHeaders(referer),
      });

      if (!resp.ok) {
        return new Response(
          JSON.stringify({ success: false, error: `HTTP ${resp.status}`, source: "tipminer.com", game_key: game }),
          { status: resp.status, headers: cors }
        );
      }

      const data = await resp.json();
      const raw = Array.isArray(data) ? data : [];

      // Bac Bo / Bac Bo Ao Vivo → formato unificado
      if (normalize === "bacbo") {
        const results = raw.slice(0, limit).map(normalizeTipminerBacBo).filter(Boolean);
        return new Response(
          JSON.stringify({
            success: true,
            source: "tipminer.com",
            game: name,
            game_key: game,
            tipminer_id: id,
            fetched_at: new Date().toISOString(),
            count: results.length,
            results,
          }),
          { headers: cors }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          source: "tipminer.com",
          game: name,
          game_key: game,
          tipminer_id: id,
          fetched_at: new Date().toISOString(),
          count: raw.length,
          results: raw,
        }),
        { headers: cors }
      );
    } catch (e) {
      return new Response(
        JSON.stringify({ success: false, error: e && e.message ? e.message : String(e) }),
        { status: 502, headers: cors }
      );
    }
  },
};

function tipminerHeaders(referer) {
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9",
    "Cache-Control": "no-cache",
    Origin: "https://www.tipminer.com",
    Referer: referer || "https://www.tipminer.com/br/cassinos/blaze/bac-bo",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
  };
}

/**
 * TipMiner bac-bo history → formato unificado.
 * Campos típicos: uuid, type (PLAYER|BANKER|TIE), result (total 2–12), instant
 */
function normalizeTipminerBacBo(r) {
  if (!r || typeof r !== "object") return null;
  const id = String(r.uuid || r.id || r._id || "");
  if (!id) return null;

  const typeRaw = String(r.type || r.winner || r.outcome || "").toUpperCase();
  let type = "TIE";
  let winner = "TieWon";
  if (typeRaw.includes("PLAYER") || typeRaw === "P" || typeRaw === "PLAYERWON") {
    type = "PLAYER";
    winner = "PlayerWon";
  } else if (typeRaw.includes("BANKER") || typeRaw === "B" || typeRaw === "BANKERWON") {
    type = "BANKER";
    winner = "BankerWon";
  } else if (typeRaw.includes("TIE") || typeRaw.includes("EMPATE") || typeRaw.includes("DRAW") || typeRaw === "TIEWON") {
    type = "TIE";
    winner = "TieWon";
  }

  const score = Number(r.result ?? r.score ?? r.total ?? 0) || 0;

  let p1 = 0,
    p2 = 0,
    b1 = 0,
    b2 = 0;
  if (Array.isArray(r.player_dice) && r.player_dice.length >= 2) {
    p1 = Number(r.player_dice[0]) || 0;
    p2 = Number(r.player_dice[1]) || 0;
  } else {
    p1 = Number(r.diceplayer1 ?? r.player1 ?? 0) || 0;
    p2 = Number(r.diceplayer2 ?? r.player2 ?? 0) || 0;
  }
  if (Array.isArray(r.banker_dice) && r.banker_dice.length >= 2) {
    b1 = Number(r.banker_dice[0]) || 0;
    b2 = Number(r.banker_dice[1]) || 0;
  } else {
    b1 = Number(r.dicebanker1 ?? r.banker1 ?? 0) || 0;
    b2 = Number(r.dicebanker2 ?? r.banker2 ?? 0) || 0;
  }

  const player_total = p1 + p2 > 0 ? p1 + p2 : type === "PLAYER" ? score : Number(r.player_total) || 0;
  const banker_total = b1 + b2 > 0 ? b1 + b2 : type === "BANKER" ? score : Number(r.banker_total) || 0;

  return {
    id,
    uuid: id,
    winner,
    type,
    result: score,
    player_dice: [p1, p2],
    banker_dice: [b1, b2],
    player_total,
    banker_total,
    diceplayer1: p1,
    diceplayer2: p2,
    dicebanker1: b1,
    dicebanker2: b2,
    instant: String(r.instant || r.createdAt || r.created_at || r.settledAt || ""),
  };
}
