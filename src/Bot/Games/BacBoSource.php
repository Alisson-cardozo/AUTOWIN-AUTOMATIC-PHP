<?php

declare(strict_types=1);

namespace App\Bot\Games;

use App\Database;

/**
 * Fonte de resultados Bac Bo.
 *
 * Ordem:
 *  1) TipMiner (API pública — type + result do vencedor)
 *  2) bacbominer (faces dos dados, se disponível)
 *  3) Banco local
 *
 * TipMiner:
 *   { uuid, type: PLAYER|BANKER|TIE, result: 2-12, instant }
 * Não envia faces dos 4 dados → o painel mostra o `score` (result) do vencedor.
 */
final class BacBoSource
{
    private const TIPMINER_URL =
        'https://api.core.public.tipminer.com/v1/bac-bo/rounds/cc71e81d-8b56-4868-91c7-7224be543dce/history';

    private const BACBOMINER_URL = 'https://bacbominer.com.br/api/bacbo';
    private const MAX_RESULTS = 300;

    public const OUTCOME_NAME = [0 => 'EMPATE', 1 => 'PLAYER', 2 => 'BANKER'];

    /** @var 'tipminer'|'bacbominer'|'db'|null */
    public static ?string $lastSource = null;

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
    public static function fetchSource(): ?array
    {
        self::$lastSource = null;

        $tip = self::fetchTipminer();
        if ($tip) {
            self::$lastSource = 'tipminer';
            return $tip;
        }

        $api = self::fetchBacbominer();
        if ($api) {
            self::$lastSource = 'bacbominer';
            return $api;
        }

        $db = self::fetchFromDb();
        if ($db) {
            self::$lastSource = 'db';
            return $db;
        }

        return null;
    }

    /** @return list<array>|null */
    private static function fetchTipminer(): ?array
    {
        try {
            $url = self::TIPMINER_URL
                . '?limit=' . self::MAX_RESULTS
                . '&timezone=' . rawurlencode('America/Sao_Paulo');

            $http = new \App\Bot\HttpClient('', [
                'Accept' => 'application/json',
                'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AutoWin/1.0',
                'Origin' => 'https://www.tipminer.com',
                'Referer' => 'https://www.tipminer.com/',
            ], 12);

            $data = $http->get($url);
            if (!is_array($data) || !array_is_list($data)) {
                return null;
            }

            $out = [];
            foreach ($data as $r) {
                if (!is_array($r) || empty($r['uuid'])) {
                    continue;
                }
                $type = strtoupper((string) ($r['type'] ?? ''));
                $score = (int) ($r['result'] ?? 0);
                if ($score < 2 || $score > 12) {
                    $score = max(0, min(12, $score));
                }

                $winner = match ($type) {
                    'PLAYER' => 'PlayerWon',
                    'BANKER' => 'BankerWon',
                    'TIE', 'EMPATE', 'DRAW' => 'Tie',
                    default => 'Tie',
                };

                // Faces zeradas — UI usa `score` (result do vencedor)
                $out[] = [
                    'id' => (string) $r['uuid'],
                    'created_at' => (string) ($r['instant'] ?? ''),
                    'diceplayer1' => 0,
                    'diceplayer2' => 0,
                    'dicebanker1' => 0,
                    'dicebanker2' => 0,
                    'winner' => $winner,
                    'score' => $score,
                    '_authoritativeWinner' => true,
                ];
            }

            return $out ?: null;
        } catch (\Throwable $e) {
            log_msg('[bacbo] tipminer: ' . $e->getMessage(), 'bot');
            return null;
        }
    }

    /** @return list<array>|null */
    private static function fetchBacbominer(): ?array
    {
        try {
            $http = new \App\Bot\HttpClient('', ['Accept' => 'application/json'], 10);
            $data = $http->get(self::BACBOMINER_URL);
            if (!is_array($data) || !array_is_list($data)) {
                return null;
            }
            $out = [];
            foreach ($data as $r) {
                if (empty($r['_id'])) {
                    continue;
                }
                $p1 = (int) ($r['diceplayer1'] ?? 0);
                $p2 = (int) ($r['diceplayer2'] ?? 0);
                $b1 = (int) ($r['dicebanker1'] ?? 0);
                $b2 = (int) ($r['dicebanker2'] ?? 0);
                $winner = self::winnerFromDice($p1, $p2, $b1, $b2);
                $score = match ($winner) {
                    'PlayerWon' => $p1 + $p2,
                    'BankerWon' => $b1 + $b2,
                    default => $p1 + $p2,
                };
                $out[] = [
                    'id' => (string) $r['_id'],
                    'created_at' => (string) ($r['createdAt'] ?? ''),
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

    /** @return list<array>|null */
    private static function fetchFromDb(): ?array
    {
        try {
            $rows = Database::fetchAll(
                'SELECT * FROM bacbo_results ORDER BY id DESC LIMIT ' . self::MAX_RESULTS
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
    public static function persistNew(array $results): int
    {
        if (!$results) {
            return 0;
        }

        $newest = Database::fetch('SELECT externalId FROM bacbo_results ORDER BY id DESC LIMIT 1');
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

                // Guarda o total do vencedor em playerTotal/bankerTotal
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

                Database::insert('bacbo_results', [
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

        $totalRow = Database::fetch('SELECT COUNT(*) AS c FROM bacbo_results');
        $total = (int) ($totalRow['c'] ?? 0);
        if ($total > self::MAX_RESULTS) {
            $excesso = $total - self::MAX_RESULTS;
            Database::query(
                'DELETE FROM bacbo_results WHERE id IN (
                    SELECT id FROM (
                        SELECT id FROM bacbo_results ORDER BY id ASC LIMIT ' . (int) $excesso . '
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
