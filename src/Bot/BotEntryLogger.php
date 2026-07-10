<?php

declare(strict_types=1);

namespace App\Bot;

use App\Database;

/**
 * Persistência unificada de WIN/LOSS para o relatório mensal da tela inicial.
 * Usado por Double, Crash, Fortune e Bac Bo (Blaze e Jonbet).
 */
final class BotEntryLogger
{
    /**
     * @param 'WIN'|'LOSS'|'GALE'|'OBS_WIN'|'OBS_LOSS' $type
     * @param 'DOUBLE'|'CRASH'|'FORTUNE'|'BACBO' $gameType
     * @param 'BLAZE'|'JONBET' $platform
     */
    public static function log(
        int $ownerId,
        string $type,
        string $gameType,
        string $platform,
        ?string $signalColor = null,
        ?string $resultColor = null,
        ?string $pattern = null,
        ?float $betAmount = null,
        ?float $profit = null,
        ?int $galeLevel = null
    ): void {
        try {
            $row = [
                'type' => $type,
                'signalColor' => $signalColor,
                'resultColor' => $resultColor,
                'pattern' => $pattern,
                'betAmount' => $betAmount,
                'profit' => $profit,
                'galeLevel' => $galeLevel,
                'platform' => strtoupper($platform) === 'JONBET' ? 'JONBET' : 'BLAZE',
                'ownerId' => $ownerId,
                'createdAt' => now(),
            ];
            // gameType é opcional no schema antigo — tenta incluir; se coluna não existir, re-tenta sem.
            try {
                Database::insert('bot_entries', array_merge($row, [
                    'gameType' => strtoupper($gameType),
                ]));
            } catch (\Throwable) {
                Database::insert('bot_entries', $row);
            }
        } catch (\Throwable) {
        }
    }

    /**
     * Zera contadores da sessão no painel "Iniciar Bot".
     * NÃO zera monthCountWin/monthCountLoss (relatório mensal).
     *
     * @param 'variables'|'jonbet_variables'|'bacbo_variables' $table
     */
    public static function resetSessionCounters(string $table, int $ownerId, ?float $balance = null): void
    {
        $data = [
            'countWin' => 0,
            'countLoss' => 0,
            'countMartingale' => 0,
            'isGale' => 0,
            'profit' => 0,
            'firstBalanceDate' => now(),
        ];
        if ($balance !== null) {
            $data['balance'] = $balance;
            $data['firstBalance'] = $balance;
        }
        try {
            Database::update($table, $data, 'ownerId = :oid', ['oid' => $ownerId]);
        } catch (\Throwable) {
        }

        // Garante contadores de mês inicializados
        try {
            $row = Database::fetch("SELECT monthStartDate, monthCountWin FROM `{$table}` WHERE ownerId = ?", [$ownerId]);
            if (!$row) {
                return;
            }
            $monthStart = !empty($row['monthStartDate'])
                ? date('Y-m', strtotime((string) $row['monthStartDate']))
                : null;
            if ($monthStart !== date('Y-m')) {
                $upd = [
                    'monthStartDate' => now(),
                    'monthCountWin' => 0,
                    'monthCountLoss' => 0,
                ];
                if ($balance !== null) {
                    $upd['monthStartBalance'] = $balance;
                }
                Database::update($table, $upd, 'ownerId = :oid', ['oid' => $ownerId]);
            }
        } catch (\Throwable) {
        }
    }
}
