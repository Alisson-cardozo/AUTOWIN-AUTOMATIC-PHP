<?php

declare(strict_types=1);

namespace App\Bot\Games;

use App\Bot\HttpClient;
use App\Database;

/**
 * Port of bot/bacbo-source.ts
 */
final class BacBoSource
{
    private const SOURCE_URL = 'https://bacbominer.com.br/api/bacbo';
    private const MAX_RESULTS = 300;

    public const OUTCOME_NAME = [0 => 'EMPATE', 1 => 'PLAYER', 2 => 'BANKER'];

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

    /** @return list<array{id:string,created_at:string,diceplayer1:int,diceplayer2:int,dicebanker1:int,dicebanker2:int,winner:string}>|null */
    public static function fetchSource(): ?array
    {
        try {
            $http = new HttpClient('', ['Accept' => 'application/json'], 10);
            $data = $http->get(self::SOURCE_URL);
            if (!is_array($data) || !array_is_list($data)) {
                return null;
            }
            $out = [];
            foreach ($data as $r) {
                if (empty($r['_id'])) {
                    continue;
                }
                $out[] = [
                    'id' => (string) $r['_id'],
                    'created_at' => (string) ($r['createdAt'] ?? ''),
                    'diceplayer1' => (int) ($r['diceplayer1'] ?? 0),
                    'diceplayer2' => (int) ($r['diceplayer2'] ?? 0),
                    'dicebanker1' => (int) ($r['dicebanker1'] ?? 0),
                    'dicebanker2' => (int) ($r['dicebanker2'] ?? 0),
                    'winner' => (string) ($r['winner'] ?? ''),
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
                Database::insert('bacbo_results', [
                    'externalId' => $r['id'],
                    'winner' => $r['winner'],
                    'playerTotal' => $r['diceplayer1'] + $r['diceplayer2'],
                    'bankerTotal' => $r['dicebanker1'] + $r['dicebanker2'],
                    'player1' => $r['diceplayer1'],
                    'player2' => $r['diceplayer2'],
                    'banker1' => $r['dicebanker1'],
                    'banker2' => $r['dicebanker2'],
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

    public static function matchesSomaToken(string $token, array $result): bool
    {
        $t = strtoupper(trim($token));
        if ($t === 'X') {
            return true;
        }

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
        return $matchesPair($m[1], (int) $result['player1'], (int) $result['player2'])
            && $matchesPair($m[2], (int) $result['banker1'], (int) $result['banker2']);
    }

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
