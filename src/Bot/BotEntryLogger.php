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
     * @param string $gameType DOUBLE|FORTUNE|BACBO|DAY_TRADE|…
     * @param string $platform BLAZE|JONBET|IQOPTION
     * @param 'REAL'|'DEMO'|null $accountType
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
        ?int $galeLevel = null,
        ?string $accountType = null
    ): void {
        try {
            $plat = strtoupper(trim($platform));
            if (in_array($plat, ['JONBET'], true)) {
                $plat = 'JONBET';
            } elseif (in_array($plat, ['IQOPTION', 'DAYTRADE', 'DAY_TRADE', 'IQ'], true)) {
                $plat = 'IQOPTION';
            } else {
                $plat = 'BLAZE';
            }
            $row = [
                'type' => $type,
                'signalColor' => $signalColor,
                'resultColor' => $resultColor,
                'pattern' => $pattern,
                'betAmount' => $betAmount,
                'profit' => $profit,
                'galeLevel' => $galeLevel,
                'platform' => $plat,
                'accountType' => $accountType,
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
