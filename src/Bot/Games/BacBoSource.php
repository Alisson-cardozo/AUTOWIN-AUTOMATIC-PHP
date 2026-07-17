<?php

declare(strict_types=1);

namespace App\Bot\Games;

use App\Database;

/**
 * Fonte de resultados Bac Bo (sala normal ou Ao Vivo).
 *
 * @param string $gameKey 'bacbo' | 'bacbo-live' (API Worker / tabelas separadas)
 *
 * Ordem:
 *  1) Feed WS Evolution — só para sala normal (quando fresco).
 *  2) Nossa API Worker TipMiner
 *     bacbo      → ?game=bacbo
 *     bacbo-live → ?game=bacbo-live
 *  3) casino.org — só sala normal.
 *  4) Banco local (bacbo_results | bacbo_live_results)
 */
final class BacBoSource
{
    /** Worker próprio (api-dos-jogos.js). */
    private const GAMES_API_URL = 'https://icy-frog-9f91.alissonprojetostaco.workers.dev';

    private const CASINO_ORG_URL =
        'https://api-cs.casino.org/svc-evolution-game-events/api/bacbo';

    private const MAX_RESULTS = 300;

    public const OUTCOME_NAME = [0 => 'EMPATE', 1 => 'PLAYER', 2 => 'BANKER'];

    /** @var 'ws'|'games-api'|'casino-org'|'db'|null */
    public static ?string $lastSource = null;

    public static function normalizeGameKey(string $gameKey): string
    {
        $k = strtolower(trim($gameKey));
        if (in_array($k, ['bacbo-live', 'bacbo_live', 'bacbolive', 'live'], true)) {
            return 'bacbo-live';
        }
        return 'bacbo';
    }

    public static function resultsTable(string $gameKey): string
    {
        return self::normalizeGameKey($gameKey) === 'bacbo-live' ? 'bacbo_live_results' : 'bacbo_results';
    }

    public static function winnerCode(string $w): int
    {
        if ($w === 'PlayerWon') {
            return 1;
        }
        if ($w === 'BankerWon') {
            return 2;
        }
        return 0;
    }

    /**
     * Regra oficial Evolution Bac Bo: soma dos 2 dados (2–12), maior vence.
     *
     * @return 'PlayerWon'|'BankerWon'|'Tie'
     */
    public static function winnerFromDice(int $p1, int $p2, int $b1, int $b2): string
    {
        $playerTotal = $p1 + $p2;
        $bankerTotal = $b1 + $b2;
        if ($playerTotal > $bankerTotal) {
            return 'PlayerWon';
        }
        if ($bankerTotal > $playerTotal) {
            return 'BankerWon';
        }
        return 'Tie';
    }

    /**
     * @return list<array{
     *   id:string,created_at:string,
     *   diceplayer1:int,diceplayer2:int,dicebanker1:int,dicebanker2:int,
     *   winner:string,score:int
     * }>|null
     */
    public static function fetchSource(string $gameKey = 'bacbo'): ?array
    {
        self::$lastSource = null;
        $gameKey = self::normalizeGameKey($gameKey);
        $isLive = $gameKey === 'bacbo-live';

        // WS Evolution atual é da sala padrão — não misturar com ao vivo
        if (!$isLive) {
            $ws = self::fetchWsFeed();
            if ($ws) {
                self::$lastSource = 'ws';
                return $ws;
            }
        }

        $api = self::fetchGamesApi($gameKey);
        if ($api) {
            self::$lastSource = 'games-api';
            return $api;
        }

        if (!$isLive) {
            $co = self::fetchCasinoOrg();
            if ($co) {
                self::$lastSource = 'casino-org';
                return $co;
            }
        }

        $db = self::fetchFromDb($gameKey);
        if ($db) {
            self::$lastSource = 'db';
            return $db;
        }

        return null;
    }

    /** @return list<array>|null */
    private static function fetchWsFeed(): ?array
    {
        try {
            if (\App\Services\BacBoWsFeed::isStale()) {
                return null;
            }
            $rows = \App\Services\BacBoWsFeed::readResults();
            if (!$rows) {
                return null;
            }
            $out = [];
            foreach ($rows as $r) {
                $p1 = (int) $r['diceplayer1'];
                $p2 = (int) $r['diceplayer2'];
                $b1 = (int) $r['dicebanker1'];
                $b2 = (int) $r['dicebanker2'];
                $winner = (string) ($r['winner'] ?: self::winnerFromDice($p1, $p2, $b1, $b2));
                $score = match ($winner) {
                    'PlayerWon' => $p1 + $p2,
                    'BankerWon' => $b1 + $b2,
                    default => max($p1 + $p2, $b1 + $b2),
                };
                $out[] = [
                    'id' => $r['id'],
                    'created_at' => $r['created_at'],
                    'diceplayer1' => $p1,
                    'diceplayer2' => $p2,
                    'dicebanker1' => $b1,
                    'dicebanker2' => $b2,
                    'winner' => $winner,
                    'score' => $score,
                ];
            }
            return $out ?: null;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * casino.org — svc-evolution-game-events. Traz dados reais dos dados
     * (playerDice/bankerDice) e o outcome já no formato PlayerWon/BankerWon/Tie.
     *
     * @return list<array>|null
     */
    private static function fetchCasinoOrg(): ?array
    {
        try {
            $url = self::CASINO_ORG_URL
                . '?page=0&size=' . self::MAX_RESULTS
                . '&sort=data.settledAt,desc&duration=120'
                . '&wheelResults=PlayerWon,BankerWon,Tie';

            $http = new \App\Bot\HttpClient('', ['Accept' => 'application/json'], 12);
            $data = $http->get($url);
            if (!is_array($data) || !array_is_list($data)) {
                return null;
            }

            $out = [];
            foreach ($data as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $round = $item['data'] ?? null;
                if (!is_array($round) || ($round['status'] ?? '') !== 'Resolved') {
                    continue;
                }
                $id = (string) ($round['id'] ?? '');
                $result = $round['result'] ?? null;
                if ($id === '' || !is_array($result)) {
                    continue;
                }
                $winner = (string) ($result['outcome'] ?? '');
                if (!in_array($winner, ['PlayerWon', 'BankerWon', 'Tie'], true)) {
                    continue;
                }
                $p1 = (int) ($result['playerDice']['first'] ?? 0);
                $p2 = (int) ($result['playerDice']['second'] ?? 0);
                $b1 = (int) ($result['bankerDice']['first'] ?? 0);
                $b2 = (int) ($result['bankerDice']['second'] ?? 0);
                $score = match ($winner) {
                    'PlayerWon' => $p1 + $p2,
                    'BankerWon' => $b1 + $b2,
                    default => max($p1 + $p2, $b1 + $b2),
                };

                $out[] = [
                    'id' => $id,
                    'created_at' => (string) ($round['settledAt'] ?? ''),
                    'diceplayer1' => $p1,
                    'diceplayer2' => $p2,
                    'dicebanker1' => $b1,
                    'dicebanker2' => $b2,
                    'winner' => $winner,
                    'score' => $score,
                ];
            }

            return $out ?: null;
        } catch (\Throwable $e) {
            log_msg('[bacbo] casino.org: ' . $e->getMessage(), 'bot');
            return null;
        }
    }

    /**
     * Nossa API Cloudflare Worker (api-dos-jogos.js).
     * Ex.: ?game=bacbo | ?game=bacbo-live
     *
     * @return list<array>|null
     */
    private static function fetchGamesApi(string $gameKey = 'bacbo'): ?array
    {
        try {
            $url = self::GAMES_API_URL
                . '?game=' . rawurlencode($gameKey)
                . '&limit=' . self::MAX_RESULTS;

            $http = new \App\Bot\HttpClient('', ['Accept' => 'application/json'], 12);
            $resp = $http->get($url);
            if (!is_array($resp) || empty($resp['success']) || !is_array($resp['results'] ?? null)) {
                return null;
            }

            $out = [];
            foreach ($resp['results'] as $r) {
                if (!is_array($r)) {
                    continue;
                }
                $id = (string) ($r['uuid'] ?? $r['id'] ?? '');
                if ($id === '') {
                    continue;
                }

                $type = strtoupper((string) ($r['type'] ?? ''));
                $winnerRaw = (string) ($r['winner'] ?? '');
                $winner = match (true) {
                    $winnerRaw === 'PlayerWon' || $type === 'PLAYER' => 'PlayerWon',
                    $winnerRaw === 'BankerWon' || $type === 'BANKER' => 'BankerWon',
                    $winnerRaw === 'Tie' || $winnerRaw === 'TieWon'
                        || in_array($type, ['TIE', 'EMPATE', 'DRAW'], true) => 'Tie',
                    default => 'Tie',
                };

                $p1 = (int) ($r['diceplayer1'] ?? (is_array($r['player_dice'] ?? null) ? ($r['player_dice'][0] ?? 0) : 0));
                $p2 = (int) ($r['diceplayer2'] ?? (is_array($r['player_dice'] ?? null) ? ($r['player_dice'][1] ?? 0) : 0));
                $b1 = (int) ($r['dicebanker1'] ?? (is_array($r['banker_dice'] ?? null) ? ($r['banker_dice'][0] ?? 0) : 0));
                $b2 = (int) ($r['dicebanker2'] ?? (is_array($r['banker_dice'] ?? null) ? ($r['banker_dice'][1] ?? 0) : 0));

                $score = (int) ($r['result'] ?? $r['score'] ?? 0);
                if ($score <= 0) {
                    $score = match ($winner) {
                        'PlayerWon' => $p1 + $p2 > 0 ? $p1 + $p2 : (int) ($r['player_total'] ?? 0),
                        'BankerWon' => $b1 + $b2 > 0 ? $b1 + $b2 : (int) ($r['banker_total'] ?? 0),
                        default => max($p1 + $p2, $b1 + $b2, (int) ($r['player_total'] ?? 0), (int) ($r['banker_total'] ?? 0)),
                    };
                }
                if ($score < 2 || $score > 12) {
                    $score = max(0, min(12, $score));
                }

                $out[] = [
                    'id' => $id,
                    'created_at' => (string) ($r['instant'] ?? $r['created_at'] ?? ''),
                    'diceplayer1' => $p1,
                    'diceplayer2' => $p2,
                    'dicebanker1' => $b1,
                    'dicebanker2' => $b2,
                    'winner' => $winner,
                    'score' => $score,
                    '_authoritativeWinner' => true,
                ];
            }

            return $out ?: null;
        } catch (\Throwable $e) {
            log_msg('[bacbo] games-api: ' . $e->getMessage(), 'bot');
            return null;
        }
    }

    /** @return list<array>|null */
    private static function fetchFromDb(string $gameKey = 'bacbo'): ?array
    {
        try {
            $table = self::resultsTable($gameKey);
            $rows = Database::fetchAll(
                'SELECT * FROM ' . $table . ' ORDER BY id DESC LIMIT ' . self::MAX_RESULTS
            );
            if (!$rows) {
                return null;
            }
            $out = [];
            foreach ($rows as $r) {
                $p1 = (int) $r['player1'];
                $p2 = (int) $r['player2'];
                $b1 = (int) $r['banker1'];
                $b2 = (int) $r['banker2'];
                $winner = (string) ($r['winner'] ?: self::winnerFromDice($p1, $p2, $b1, $b2));
                $pt = (int) ($r['playerTotal'] ?? ($p1 + $p2));
                $bt = (int) ($r['bankerTotal'] ?? ($b1 + $b2));
                $score = match ($winner) {
                    'PlayerWon' => $pt > 0 ? $pt : ($p1 + $p2),
                    'BankerWon' => $bt > 0 ? $bt : ($b1 + $b2),
                    default => max($pt, $bt, $p1 + $p2),
                };
                $out[] = [
                    'id' => (string) ($r['externalId'] ?? $r['id']),
                    'created_at' => (string) ($r['createdAt'] ?? ''),
                    'diceplayer1' => $p1,
                    'diceplayer2' => $p2,
                    'dicebanker1' => $b1,
                    'dicebanker2' => $b2,
                    'winner' => $winner,
                    'score' => $score,
                ];
            }
            return $out;
        } catch (\Throwable) {
            return null;
        }
    }

    /** @param list<array> $results */
    public static function persistNew(array $results, string $gameKey = 'bacbo'): int
    {
        if (!$results) {
            return 0;
        }

        $table = self::resultsTable($gameKey);
        $newest = Database::fetch('SELECT externalId FROM ' . $table . ' ORDER BY id DESC LIMIT 1');
        if (!$newest) {
            $novos = array_slice($results, 0, 100);
        } else {
            $knownIdx = -1;
            foreach ($results as $i => $r) {
                if ($r['id'] === $newest['externalId']) {
                    $knownIdx = $i;
                    break;
                }
            }
            $novos = $knownIdx === -1 ? array_slice($results, 0, 1) : array_slice($results, 0, $knownIdx);
        }
        if (!$novos) {
            return 0;
        }

        $ordenados = array_reverse($novos);
        foreach ($ordenados as $r) {
            try {
                $p1 = (int) $r['diceplayer1'];
                $p2 = (int) $r['diceplayer2'];
                $b1 = (int) $r['dicebanker1'];
                $b2 = (int) $r['dicebanker2'];
                $score = (int) ($r['score'] ?? 0);

                if (!empty($r['_authoritativeWinner']) && !empty($r['winner'])) {
                    $winner = (string) $r['winner'];
                } elseif ($p1 + $p2 + $b1 + $b2 > 0) {
                    $winner = self::winnerFromDice($p1, $p2, $b1, $b2);
                } else {
                    $winner = (string) ($r['winner'] ?? 'Tie');
                }

                $playerTotal = $p1 + $p2;
                $bankerTotal = $b1 + $b2;
                if ($score > 0) {
                    if ($winner === 'PlayerWon') {
                        $playerTotal = $score;
                        $bankerTotal = 0;
                    } elseif ($winner === 'BankerWon') {
                        $bankerTotal = $score;
                        $playerTotal = 0;
                    } else {
                        $playerTotal = $score;
                        $bankerTotal = $score;
                    }
                }

                Database::insert($table, [
                    'externalId' => $r['id'],
                    'winner' => $winner,
                    'playerTotal' => $playerTotal,
                    'bankerTotal' => $bankerTotal,
                    'player1' => $p1,
                    'player2' => $p2,
                    'banker1' => $b1,
                    'banker2' => $b2,
                    'createdAt' => now(),
                ]);
            } catch (\Throwable) {
                // skipDuplicates
            }
        }

        $totalRow = Database::fetch('SELECT COUNT(*) AS c FROM ' . $table);
        $total = (int) ($totalRow['c'] ?? 0);
        if ($total > self::MAX_RESULTS) {
            $excesso = $total - self::MAX_RESULTS;
            Database::query(
                'DELETE FROM ' . $table . ' WHERE id IN (
                    SELECT id FROM (
                        SELECT id FROM ' . $table . ' ORDER BY id ASC LIMIT ' . (int) $excesso . '
                    ) t
                )'
            );
        }

        return count($novos);
    }

    /**
     * Token SOMA (TipMiner / total do vencedor):
     *   PLAYER_8  → Player ganhou com total 8
     *   BANKER_4  → Banker ganhou com total 4
     *   EMPATE_6  → Empate com total 6
     *   EMPATE_X / EMPATE → qualquer empate
     *   PLAYER_X  → qualquer vitória Player
     *   X         → qualquer resultado
     *
     * Formato legado (faces dos dados) ainda aceito se houver dados reais:
     *   P16B66
     *
     * @param array{winner?:string,score?:int,player1?:int,player2?:int,banker1?:int,banker2?:int,playerTotal?:int,bankerTotal?:int} $result
     */
    public static function matchesSomaToken(string $token, array $result): bool
    {
        $t = strtoupper(trim($token));
        if ($t === '' || $t === 'X' || $t === '*') {
            return true;
        }

        // ── Novo formato: LADO_TOTAL (fonte TipMiner) ─────────────────────
        // EMPATE sozinho = qualquer empate
        if (preg_match('/^(EMPATE|TIE|E)$/', $t)) {
            return self::OUTCOME_NAME[self::winnerCode((string) ($result['winner'] ?? ''))] === 'EMPATE';
        }
        if (preg_match('/^(PLAYER|BANKER|EMPATE|TIE|P|B|E|AZUL|VERMELHO|V)[_:](\d{1,2}|X)$/', $t, $m)
            || preg_match('/^(PLAYER|BANKER|EMPATE|TIE|P|B|E|AZUL|VERMELHO|V)(\d{1,2}|X)$/', $t, $m)
        ) {
            $side = self::normalizeSomaSide($m[1]);
            $wantScore = strtoupper((string) $m[2]);

            $gotSide = self::OUTCOME_NAME[self::winnerCode((string) ($result['winner'] ?? ''))];
            if ($side !== $gotSide) {
                return false;
            }
            if ($wantScore === 'X') {
                return true;
            }
            $score = self::scoreOfResult($result);
            return $score === (int) $wantScore;
        }

        // ── Legado: faces PxxByy ──────────────────────────────────────────
        $matchesPair = function (string $pair, int $d1, int $d2): bool {
            if ($pair === 'XX') {
                return true;
            }
            if (strlen($pair) < 2) {
                return false;
            }
            $lo = min($d1, $d2);
            $hi = max($d1, $d2);
            return $lo === (int) $pair[0] && $hi === (int) $pair[1];
        };

        if (!preg_match('/^P(\d\d|XX)B(\d\d|XX)$/', $t, $m)) {
            return false;
        }
        // sem dados reais, legado não casa
        if (((int) ($result['player1'] ?? 0) + (int) ($result['player2'] ?? 0)
            + (int) ($result['banker1'] ?? 0) + (int) ($result['banker2'] ?? 0)) === 0
            && (int) ($result['score'] ?? 0) > 0
        ) {
            return false;
        }
        return $matchesPair($m[1], (int) ($result['player1'] ?? 0), (int) ($result['player2'] ?? 0))
            && $matchesPair($m[2], (int) ($result['banker1'] ?? 0), (int) ($result['banker2'] ?? 0));
    }

    /** Monta token novo: lado + total do vencedor (2–12 ou X). */
    public static function scoreSomaToken(string $side, int|string $score): string
    {
        $s = self::normalizeSomaSide($side);
        if (is_string($score) && strtoupper($score) === 'X') {
            return $s === 'EMPATE' ? 'EMPATE_X' : "{$s}_X";
        }
        $n = max(2, min(12, (int) $score));
        return "{$s}_{$n}";
    }

    public static function normalizeSomaSide(string $side): string
    {
        $s = strtoupper(trim($side));
        return match ($s) {
            'P', 'PLAYER', 'AZUL', 'BLUE' => 'PLAYER',
            'B', 'BANKER', 'VERMELHO', 'V', 'RED', 'BANK' => 'BANKER',
            'E', 'EMPATE', 'TIE', 'DRAW', 'AMARELO' => 'EMPATE',
            default => $s,
        };
    }

    /** @param array{winner?:string,score?:int,player1?:int,player2?:int,banker1?:int,banker2?:int,playerTotal?:int,bankerTotal?:int} $result */
    public static function scoreOfResult(array $result): int
    {
        $score = (int) ($result['score'] ?? 0);
        if ($score > 0) {
            return $score;
        }
        $winner = (string) ($result['winner'] ?? '');
        $pt = (int) ($result['playerTotal'] ?? ((int) ($result['player1'] ?? 0) + (int) ($result['player2'] ?? 0)));
        $bt = (int) ($result['bankerTotal'] ?? ((int) ($result['banker1'] ?? 0) + (int) ($result['banker2'] ?? 0)));
        if ($winner === 'PlayerWon' || self::winnerCode($winner) === 1) {
            return $pt;
        }
        if ($winner === 'BankerWon' || self::winnerCode($winner) === 2) {
            return $bt;
        }
        return max($pt, $bt);
    }

    /** @deprecated faces dos dados — preferir scoreSomaToken */
    public static function somaToken(?array $player, ?array $banker): string
    {
        $side = function (?array $pair): string {
            if (!$pair) {
                return 'XX';
            }
            $lo = min($pair[0], $pair[1]);
            $hi = max($pair[0], $pair[1]);
            return "{$lo}{$hi}";
        };
        return 'P' . $side($player) . 'B' . $side($banker);
    }
}
