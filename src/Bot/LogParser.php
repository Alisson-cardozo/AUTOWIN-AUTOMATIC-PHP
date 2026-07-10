<?php

declare(strict_types=1);

namespace App\Bot;

/**
 * Port stateless/em lote de recordMessage() (bot/engine-registry.ts).
 *
 * O TS mantém um Map<userId, LogEntry[]> em memória de processo (Node de vida
 * longa) e vai mutando incrementalmente a cada mensagem emitida. PHP não tem
 * memória compartilhada entre requisições (bot/worker.php é um processo
 * diferente do que serve GET /api/user/bot) — então aqui a mesma lógica de
 * merge é reaplicada do zero, em lote, sobre o histórico bruto salvo em
 * bot_messages, toda vez que o painel pede o log. Resultado idêntico, sem
 * precisar de um estado persistente novo.
 */
final class LogParser
{
    /**
     * @param list<array{id:int|string,message:string,strategyType:?string,createdAt:string}> $rows Ordem ASC (mais antigo primeiro)
     * @return list<array<string,mixed>> Mais recente primeiro
     */
    public static function build(array $rows): array
    {
        $history = [];
        foreach ($rows as $row) {
            self::record(
                $history,
                (string) $row['message'],
                (string) ($row['strategyType'] ?? ''),
                (string) $row['createdAt'],
                (string) $row['id']
            );
        }
        return $history;
    }

    /** @param list<array<string,mixed>> $history */
    private static function record(array &$history, string $msg, string $strategyType, string $createdAt, string $id): void
    {
        $ts = strtotime($createdAt);
        $time = $ts !== false ? date('H:i:s', $ts) : '';

        if (str_contains($msg, '🎯')) {
            if (!preg_match('/\*([A-ZÇÃÊÕÔÁÀÉÍÓÚ]+)\*/u', $msg, $colorMatch)) {
                preg_match('/\*(\d+(?:\.\d+)?x)\*/i', $msg, $colorMatch);
            }
            preg_match('/R\$\s*([\d.]+)/', $msg, $amountMatch);
            preg_match('/🛡️.*?R\$\s*([\d.]+)/u', $msg, $protMatch);
            preg_match('/📋\s*([^|\n]+)/u', $msg, $patternMatch);
            preg_match('/📊\s*([\d.]+)%/u', $msg, $accuracyMatch);
            $amt = isset($amountMatch[1]) ? (float) $amountMatch[1] : null;
            array_unshift($history, [
                'id' => $id,
                'time' => $time,
                'type' => 'ENTRADA',
                'strategyType' => $strategyType !== '' ? $strategyType : null,
                'color' => $colorMatch[1] ?? null,
                'amount' => $amt,
                'initialAmount' => $amt,
                'protectionValue' => isset($protMatch[1]) ? (float) $protMatch[1] : null,
                'pattern' => isset($patternMatch[1]) ? trim($patternMatch[1]) : null,
                'accuracy' => isset($accuracyMatch[1]) ? (float) $accuracyMatch[1] : null,
            ]);
        } elseif (str_contains($msg, '🔄')) {
            preg_match('/Gale\s*(\d+)\/(\d+)/', $msg, $galeMatch);
            preg_match('/R\$\s*([\d.]+)/', $msg, $amountMatch);
            preg_match('/🛡️.*?R\$\s*([\d.]+)/u', $msg, $protMatch);
            $idx = self::findIndex($history, static function (array $e): bool {
                if (($e['type'] ?? null) !== 'ENTRADA') {
                    return false;
                }
                $resolved = $e['resolved'] ?? false;
                if ($resolved && ($e['resultWin'] ?? false)) {
                    return false;
                }
                if ($resolved && ($e['resultColor'] ?? null) === 'cancelado') {
                    return false;
                }
                return true;
            });
            if ($idx !== null) {
                $history[$idx]['resolved'] = false;
                $history[$idx]['gale'] = isset($galeMatch[1]) ? (int) $galeMatch[1] : null;
                $history[$idx]['maxGale'] = isset($galeMatch[2]) ? (int) $galeMatch[2] : null;
                if (isset($amountMatch[1])) {
                    $history[$idx]['amount'] = (float) $amountMatch[1];
                }
                if (isset($protMatch[1])) {
                    $history[$idx]['protectionValue'] = (float) $protMatch[1];
                }
                $history[$idx]['resultColor'] = null;
                $history[$idx]['resultWin'] = null;
                $history[$idx]['resultProfit'] = null;
            }
        } elseif (str_contains($msg, '⚙️')) {
            preg_match('/Alvo[^:]*:\s*\*?(\d+[.,]?\d*[xX]?)\*?/iu', $msg, $targetMatch);
            preg_match('/Após[^:]*:\s*\*?(\d+[.,]?\d*[xX]?)\*?/iu', $msg, $afterMatch);
            $pattern = '⚙️ Calibração';
            if (isset($targetMatch[1])) {
                $pattern .= " — Alvo: {$targetMatch[1]}";
            }
            if (isset($afterMatch[1])) {
                $pattern .= " | Após: {$afterMatch[1]}";
            }
            $pattern .= ' — próxima entrada será realizada normalmente';
            array_unshift($history, ['id' => $id, 'time' => $time, 'type' => 'INFO', 'pattern' => $pattern]);
        } elseif (
            str_contains($msg, '🔍') || str_contains($msg, '⏱️') || str_contains($msg, '↩️')
            || str_contains($msg, 'Observação') || str_contains($msg, 'observação')
        ) {
            // Checa "Observação" antes das ramificações genéricas de ✅/❌ abaixo —
            // a mensagem de "não confirmou, entrando na próxima rodada" começa
            // com ✅ mas não é resultado de aposta, é continuação do fluxo de
            // "Pular Primeira Entrada"/"Entrada Após Loss".
            $line1 = trim(str_replace('*', '', explode("\n", $msg)[0]));
            $lastIsOngoingObservation = isset($history[0])
                && ($history[0]['type'] ?? null) === 'INFO'
                && !str_starts_with((string) ($history[0]['pattern'] ?? ''), '⚙️');
            if ($lastIsOngoingObservation) {
                $history[0]['time'] = $time;
                $history[0]['pattern'] = $line1;
            } else {
                array_unshift($history, ['id' => $id, 'time' => $time, 'type' => 'INFO', 'pattern' => $line1]);
            }
        } elseif (str_contains($msg, '✅')) {
            if (!preg_match('/— ([A-ZÇÃÊÕÔÁÀÉÍÓÚ]+)/u', $msg, $colorMatch)) {
                preg_match('/— (\d+(?:\.\d+)?x)/', $msg, $colorMatch);
            }
            preg_match('/Lucro:\s*R\$\s*([-\d.]+)/', $msg, $profitMatch);
            $idx = self::findUnresolvedEntry($history);
            if ($idx !== null) {
                $history[$idx]['resolved'] = true;
                $history[$idx]['resultWin'] = true;
                $history[$idx]['resultColor'] = $colorMatch[1] ?? null;
                $history[$idx]['resultProfit'] = isset($profitMatch[1]) ? (float) $profitMatch[1] : null;
            }
        } elseif (str_contains($msg, '❌')) {
            if (!preg_match('/— ([A-ZÇÃÊÕÔÁÀÉÍÓÚ]+)/u', $msg, $colorMatch)) {
                preg_match('/— (\d+(?:\.\d+)?x)/', $msg, $colorMatch);
            }
            preg_match('/Lucro:\s*R\$\s*([-\d.]+)/', $msg, $profitMatch);
            $idx = self::findUnresolvedEntry($history);
            if ($idx !== null) {
                $history[$idx]['resolved'] = true;
                $history[$idx]['resultWin'] = false;
                $history[$idx]['resultColor'] = $colorMatch[1] ?? null;
                $history[$idx]['resultProfit'] = isset($profitMatch[1]) ? (float) $profitMatch[1] : null;
            }
        } elseif (str_contains($msg, '🏆')) {
            preg_match('/R\$\s*([\d.]+)/', $msg, $profitMatch);
            array_unshift($history, [
                'id' => $id, 'time' => $time, 'type' => 'STOP_WIN',
                'profit' => isset($profitMatch[1]) ? (float) $profitMatch[1] : null,
            ]);
        } elseif (str_contains($msg, '🛑')) {
            preg_match('/R\$\s*([\d.]+)/', $msg, $profitMatch);
            array_unshift($history, [
                'id' => $id, 'time' => $time, 'type' => 'STOP_LOSS',
                'profit' => isset($profitMatch[1]) ? (float) $profitMatch[1] : null,
            ]);
        } elseif (str_contains($msg, '⭕')) {
            $idx = self::findUnresolvedEntry($history);
            if ($idx !== null) {
                $history[$idx]['resolved'] = true;
                $history[$idx]['resultColor'] = 'cancelado';
                $history[$idx]['resultProfit'] = 0;
            }
        } elseif (str_contains($msg, '⏸️') || str_contains($msg, '⏹️')) {
            // Aviso/confirmação de parada pedida pelo usuário no meio de uma
            // entrada — só informativo, não é STOP_WIN/STOP_LOSS de verdade.
            array_unshift($history, [
                'id' => $id, 'time' => $time, 'type' => 'INFO',
                'pattern' => trim(str_replace('*', '', explode("\n", $msg)[0])),
            ]);
        } elseif (
            str_contains($msg, '⚠️')
            && (str_contains(mb_strtolower($msg), 'saldo') || str_contains(mb_strtolower($msg), 'insuficiente'))
        ) {
            array_unshift($history, ['id' => $id, 'time' => $time, 'type' => 'STOP_SALDO']);
        }

        if (count($history) > 300) {
            array_splice($history, 300);
        }
    }

    /** @param list<array<string,mixed>> $history */
    private static function findUnresolvedEntry(array $history): ?int
    {
        return self::findIndex($history, static fn (array $e): bool =>
            in_array($e['type'] ?? null, ['ENTRADA', 'GALE'], true) && empty($e['resolved']));
    }

    /** @param list<array<string,mixed>> $history */
    private static function findIndex(array $history, callable $predicate): ?int
    {
        foreach ($history as $i => $entry) {
            if ($predicate($entry)) {
                return $i;
            }
        }
        return null;
    }
}
