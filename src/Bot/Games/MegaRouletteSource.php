<?php

declare(strict_types=1);

namespace App\Bot\Games;

use App\Database;
use App\Services\MegaRouletteWsFeed;

/**
 * Fonte de resultados Blaze Mega Roulette (Pragmatic Play) — feed WS direto
 * (bot/megaroulette-ws-feed.cjs), sem bloqueio Akamai (esse provedor é
 * diferente da Evolution/Bac Bo). Persiste em `game_results`
 * (gameType=ROLETA, platform=BLAZE), mesmo padrão do Double/Fortune.
 */
final class MegaRouletteSource
{
    public const GAME_TYPE = 'ROLETA';
    public const PLATFORM = 'BLAZE';

    /** Números vermelhos da roleta europeia — resto (exceto 0) é preto. */
    private const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

    public static function colorOf(int $roll): string
    {
        if ($roll <= 0) {
            return 'BRANCO';
        }
        return in_array($roll, self::RED_NUMBERS, true) ? 'VERMELHO' : 'PRETO';
    }

    /**
     * @return list<array{id:string,created_at:string,roll:int,color:string}>|null
     */
    public static function fetchSource(): ?array
    {
        try {
            MegaRouletteWsFeed::ensureRunning();
            if (MegaRouletteWsFeed::isStale()) {
                // log rate-limit: no máximo 1x / 60s
                static $lastWarn = 0;
                if (time() - $lastWarn >= 60) {
                    $lastWarn = time();
                    $age = is_file(MegaRouletteWsFeed::historyPath())
                        ? (time() - ((int) @filemtime(MegaRouletteWsFeed::historyPath())))
                        : -1;
                    log_msg(
                        '[megaroulette] feed STALE age=' . $age . 's running='
                        . (MegaRouletteWsFeed::isRunning() ? '1' : '0')
                        . ' — confira MEGAROULETTE_FEED_TOKEN (token Blaze) e logs/megaroulette-ws-feed.log',
                        'bot'
                    );
                }
                return null;
            }
            return MegaRouletteWsFeed::readResults();
        } catch (\Throwable) {
            return null;
        }
    }

    /** @param list<array{id:string,created_at:string,roll:int,color:string}> $results */
    public static function persistNew(array $results): int
    {
        if (!$results) {
            return 0;
        }

        $newest = Database::fetch(
            'SELECT blazeId FROM game_results WHERE gameType = ? AND platform = ? ORDER BY id DESC LIMIT 1',
            [self::GAME_TYPE, self::PLATFORM]
        );

        if (!$newest) {
            $novos = array_slice($results, 0, 100);
        } else {
            $knownIdx = -1;
            foreach ($results as $i => $r) {
                if (($r['id'] ?? '') === $newest['blazeId']) {
                    $knownIdx = $i;
                    break;
                }
            }
            // BUG antigo: knownIdx=-1 só pegava 1 resultado e "pulava" o meio
            // (ex.: zero entre 9 e 10). Agora faz catch-up de vários.
            $novos = $knownIdx === -1
                ? array_slice($results, 0, 20)
                : array_slice($results, 0, $knownIdx);
        }
        if (!$novos) {
            return 0;
        }

        $inserted = 0;
        foreach (array_reverse($novos) as $r) {
            try {
                // roll=0 é válido — checar existência da chave, nunca empty($roll)
                if (!array_key_exists('roll', $r)) {
                    continue;
                }
                $roll = (int) $r['roll'];
                if ($roll < 0 || $roll > 36) {
                    continue;
                }
                $color = isset($r['color']) && $r['color'] !== ''
                    ? strtoupper((string) $r['color'])
                    : self::colorOf($roll);
                if (!in_array($color, ['VERMELHO', 'PRETO', 'BRANCO'], true)) {
                    $color = self::colorOf($roll);
                }
                // 0 = BRANCO sempre (proteção / padrões)
                if ($roll === 0) {
                    $color = 'BRANCO';
                }
                // Feed WS grava ISO 8601 (2026-07-13T03:59:51.388Z); DATETIME exige 'Y-m-d H:i:s'.
                $ts = !empty($r['created_at']) ? strtotime((string) $r['created_at']) : false;
                $createdAt = $ts !== false ? date('Y-m-d H:i:s', $ts) : now();
                $blazeId = (string) ($r['id'] ?? '');
                if ($blazeId === '') {
                    continue;
                }
                Database::insert('game_results', [
                    'blazeId' => $blazeId,
                    'gameType' => self::GAME_TYPE,
                    'platform' => self::PLATFORM,
                    'color' => $color,
                    'roll' => $roll,
                    'createdAt' => $createdAt,
                ]);
                $inserted++;
            } catch (\Throwable) {
                // skip duplicado
            }
        }

        return $inserted;
    }
}
