<?php

declare(strict_types=1);

namespace App\Bot\Games;

/**
 * Sinais técnicos para Day Trade / IQ Option.
 * Recebe velas [{open,high,low,close,volume?,from?}] ASC (antiga → nova).
 */
final class DayTradeSignals
{
    /**
     * @param  list<array{open?:float,high?:float,low?:float,close?:float}>  $candles
     * @return 'CALL'|'PUT'|null
     */
    public static function detect(string $strategyType, array $candles, array $params = []): ?string
    {
        $n = count($candles);
        if ($n < 30) {
            return null;
        }
        $type = strtoupper(trim($strategyType));
        return match ($type) {
            'SMA_CROSS', 'EMA_CROSS' => self::maCross($candles, $params, str_starts_with($type, 'EMA')),
            'SUPPORT_RES' => self::supportResistance($candles),
            'RSI_DIV', 'RSI' => self::rsiSignal($candles, $params),
            'BOLLINGER', 'BB' => self::bollinger($candles),
            'TREND_ADX', 'TREND' => self::trendFollow($candles),
            'CANDLE_PATTERN', 'CANDLE' => self::candlePattern($candles),
            'BREAKOUT' => self::breakout($candles),
            'PSAR_EMA', 'PSAR' => self::psarEma($candles),
            'HEDGING' => null, // tratado no engine (pós-loss)
            'NEWS_SR' => self::supportResistance($candles), // S/R após filtro de horário no engine
            default => null,
        };
    }

    /** @param list<array> $candles */
    private static function closes(array $candles): array
    {
        return array_map(static fn ($c) => (float) ($c['close'] ?? 0), $candles);
    }

    /** @param list<float> $values */
    private static function sma(array $values, int $period): ?float
    {
        $n = count($values);
        if ($n < $period || $period < 1) {
            return null;
        }
        $slice = array_slice($values, -$period);
        return array_sum($slice) / $period;
    }

    /** @param list<float> $values @return list<float|null> */
    private static function smaSeries(array $values, int $period): array
    {
        $out = [];
        $n = count($values);
        for ($i = 0; $i < $n; $i++) {
            if ($i + 1 < $period) {
                $out[] = null;
                continue;
            }
            $slice = array_slice($values, $i + 1 - $period, $period);
            $out[] = array_sum($slice) / $period;
        }
        return $out;
    }

    /** @param list<float> $values @return list<float|null> */
    private static function emaSeries(array $values, int $period): array
    {
        $out = [];
        $n = count($values);
        if ($n === 0 || $period < 1) {
            return $out;
        }
        $k = 2 / ($period + 1);
        $ema = null;
        for ($i = 0; $i < $n; $i++) {
            $v = $values[$i];
            if ($i + 1 < $period) {
                $out[] = null;
                continue;
            }
            if ($ema === null) {
                $ema = array_sum(array_slice($values, 0, $period)) / $period;
                $out[] = $ema;
                continue;
            }
            $ema = ($v - $ema) * $k + $ema;
            $out[] = $ema;
        }
        return $out;
    }

    private static function maCross(array $candles, array $params, bool $ema): ?string
    {
        $fastP = max(2, (int) ($params['fast'] ?? ($ema ? 11 : 8)));
        $slowP = max($fastP + 1, (int) ($params['slow'] ?? ($ema ? 56 : 21)));
        $closes = self::closes($candles);
        $fast = $ema ? self::emaSeries($closes, $fastP) : self::smaSeries($closes, $fastP);
        $slow = $ema ? self::emaSeries($closes, $slowP) : self::smaSeries($closes, $slowP);
        $i = count($closes) - 1;
        $j = $i - 1;
        if ($j < 0 || $fast[$i] === null || $slow[$i] === null || $fast[$j] === null || $slow[$j] === null) {
            return null;
        }
        // cruzamento no último fechamento
        if ($fast[$j] <= $slow[$j] && $fast[$i] > $slow[$i]) {
            return 'CALL';
        }
        if ($fast[$j] >= $slow[$j] && $fast[$i] < $slow[$i]) {
            return 'PUT';
        }
        return null;
    }

    private static function supportResistance(array $candles): ?string
    {
        $n = count($candles);
        $look = min(40, $n - 2);
        if ($look < 10) {
            return null;
        }
        $window = array_slice($candles, -$look - 1, $look); // sem a última
        $highs = array_map(static fn ($c) => (float) ($c['high'] ?? 0), $window);
        $lows = array_map(static fn ($c) => (float) ($c['low'] ?? 0), $window);
        $res = max($highs);
        $sup = min($lows);
        $last = $candles[$n - 1];
        $o = (float) ($last['open'] ?? 0);
        $c = (float) ($last['close'] ?? 0);
        $h = (float) ($last['high'] ?? 0);
        $l = (float) ($last['low'] ?? 0);
        $range = max(1e-9, $res - $sup);
        $nearSup = abs($l - $sup) / $range < 0.08 || abs($c - $sup) / $range < 0.08;
        $nearRes = abs($h - $res) / $range < 0.08 || abs($c - $res) / $range < 0.08;
        $bull = $c > $o;
        $bear = $c < $o;
        if ($nearSup && $bull) {
            return 'CALL';
        }
        if ($nearRes && $bear) {
            return 'PUT';
        }
        return null;
    }

    private static function rsiSignal(array $candles, array $params): ?string
    {
        $period = max(2, (int) ($params['period'] ?? 14));
        $closes = self::closes($candles);
        $rsi = self::rsiSeries($closes, $period);
        $i = count($rsi) - 1;
        if ($i < 1 || $rsi[$i] === null || $rsi[$i - 1] === null) {
            return null;
        }
        $cur = $rsi[$i];
        $prev = $rsi[$i - 1];
        // sai de oversold
        if ($prev < 30 && $cur >= 30) {
            return 'CALL';
        }
        // sai de overbought
        if ($prev > 70 && $cur <= 70) {
            return 'PUT';
        }
        return null;
    }

    /** @param list<float> $closes @return list<float|null> */
    private static function rsiSeries(array $closes, int $period): array
    {
        $out = [];
        $n = count($closes);
        $gains = [];
        $losses = [];
        for ($i = 0; $i < $n; $i++) {
            if ($i === 0) {
                $out[] = null;
                continue;
            }
            $diff = $closes[$i] - $closes[$i - 1];
            $gains[] = $diff > 0 ? $diff : 0.0;
            $losses[] = $diff < 0 ? -$diff : 0.0;
            if (count($gains) < $period) {
                $out[] = null;
                continue;
            }
            $avgG = array_sum(array_slice($gains, -$period)) / $period;
            $avgL = array_sum(array_slice($losses, -$period)) / $period;
            if ($avgL < 1e-12) {
                $out[] = 100.0;
            } else {
                $rs = $avgG / $avgL;
                $out[] = 100 - (100 / (1 + $rs));
            }
        }
        return $out;
    }

    private static function bollinger(array $candles): ?string
    {
        $period = 20;
        $closes = self::closes($candles);
        $n = count($closes);
        if ($n < $period + 1) {
            return null;
        }
        $slice = array_slice($closes, -$period);
        $mid = array_sum($slice) / $period;
        $var = 0.0;
        foreach ($slice as $v) {
            $var += ($v - $mid) ** 2;
        }
        $std = sqrt($var / $period);
        $upper = $mid + 2 * $std;
        $lower = $mid - 2 * $std;
        $last = $candles[$n - 1];
        $o = (float) ($last['open'] ?? 0);
        $c = (float) ($last['close'] ?? 0);
        $l = (float) ($last['low'] ?? 0);
        $h = (float) ($last['high'] ?? 0);
        if ($l <= $lower && $c > $o) {
            return 'CALL';
        }
        if ($h >= $upper && $c < $o) {
            return 'PUT';
        }
        return null;
    }

    private static function trendFollow(array $candles): ?string
    {
        $closes = self::closes($candles);
        $ema21 = self::emaSeries($closes, 21);
        $ema55 = self::emaSeries($closes, 55);
        $i = count($closes) - 1;
        if ($ema21[$i] === null || $ema55[$i] === null) {
            return null;
        }
        $last = $candles[$i];
        $o = (float) ($last['open'] ?? 0);
        $c = (float) ($last['close'] ?? 0);
        $upTrend = $ema21[$i] > $ema55[$i];
        $downTrend = $ema21[$i] < $ema55[$i];
        // pullback na direção da tendência
        if ($upTrend && $c > $o && $c >= $ema21[$i]) {
            return 'CALL';
        }
        if ($downTrend && $c < $o && $c <= $ema21[$i]) {
            return 'PUT';
        }
        return null;
    }

    private static function candlePattern(array $candles): ?string
    {
        $n = count($candles);
        $last = $candles[$n - 1];
        $prev = $candles[$n - 2];
        $o = (float) ($last['open'] ?? 0);
        $c = (float) ($last['close'] ?? 0);
        $h = (float) ($last['high'] ?? 0);
        $l = (float) ($last['low'] ?? 0);
        $body = abs($c - $o);
        $range = max(1e-9, $h - $l);
        $upper = $h - max($c, $o);
        $lower = min($c, $o) - $l;
        // Hammer: sombra inferior longa, corpo no topo
        if ($lower >= 2 * $body && $upper <= $body * 0.5 && $body / $range < 0.4) {
            return 'CALL';
        }
        // Shooting star
        if ($upper >= 2 * $body && $lower <= $body * 0.5 && $body / $range < 0.4) {
            return 'PUT';
        }
        // Bullish engulfing
        $po = (float) ($prev['open'] ?? 0);
        $pc = (float) ($prev['close'] ?? 0);
        if ($pc < $po && $c > $o && $c >= $po && $o <= $pc) {
            return 'CALL';
        }
        // Bearish engulfing
        if ($pc > $po && $c < $o && $c <= $po && $o >= $pc) {
            return 'PUT';
        }
        return null;
    }

    private static function breakout(array $candles): ?string
    {
        $n = count($candles);
        $look = 20;
        if ($n < $look + 2) {
            return null;
        }
        $window = array_slice($candles, -($look + 1), $look);
        $highs = array_map(static fn ($c) => (float) ($c['high'] ?? 0), $window);
        $lows = array_map(static fn ($c) => (float) ($c['low'] ?? 0), $window);
        $top = max($highs);
        $bot = min($lows);
        $last = $candles[$n - 1];
        $c = (float) ($last['close'] ?? 0);
        $o = (float) ($last['open'] ?? 0);
        if ($c > $top && $c > $o) {
            return 'CALL';
        }
        if ($c < $bot && $c < $o) {
            return 'PUT';
        }
        return null;
    }

    private static function psarEma(array $candles): ?string
    {
        $closes = self::closes($candles);
        $ema = self::emaSeries($closes, 21);
        $psar = self::parabolicSar($candles);
        $i = count($candles) - 1;
        if ($i < 2 || $ema[$i] === null || $psar[$i] === null || $psar[$i - 1] === null) {
            return null;
        }
        $c = $closes[$i];
        $prevC = $closes[$i - 1];
        // SAR de baixo p/ cima (preço cruza acima do SAR)
        if ($prevC <= $psar[$i - 1] && $c > $psar[$i] && $c > $ema[$i]) {
            return 'CALL';
        }
        if ($prevC >= $psar[$i - 1] && $c < $psar[$i] && $c < $ema[$i]) {
            return 'PUT';
        }
        return null;
    }

    /** @return list<float|null> */
    private static function parabolicSar(array $candles): array
    {
        $n = count($candles);
        $out = array_fill(0, $n, null);
        if ($n < 3) {
            return $out;
        }
        $af = 0.02;
        $maxAf = 0.2;
        $up = true;
        $sar = (float) ($candles[0]['low'] ?? 0);
        $ep = (float) ($candles[0]['high'] ?? 0);
        $out[0] = $sar;
        for ($i = 1; $i < $n; $i++) {
            $h = (float) ($candles[$i]['high'] ?? 0);
            $l = (float) ($candles[$i]['low'] ?? 0);
            $sar = $sar + $af * ($ep - $sar);
            if ($up) {
                $sar = min($sar, (float) ($candles[$i - 1]['low'] ?? $sar));
                if ($i >= 2) {
                    $sar = min($sar, (float) ($candles[$i - 2]['low'] ?? $sar));
                }
                if ($l < $sar) {
                    $up = false;
                    $sar = $ep;
                    $ep = $l;
                    $af = 0.02;
                } else {
                    if ($h > $ep) {
                        $ep = $h;
                        $af = min($maxAf, $af + 0.02);
                    }
                }
            } else {
                $sar = max($sar, (float) ($candles[$i - 1]['high'] ?? $sar));
                if ($i >= 2) {
                    $sar = max($sar, (float) ($candles[$i - 2]['high'] ?? $sar));
                }
                if ($h > $sar) {
                    $up = true;
                    $sar = $ep;
                    $ep = $h;
                    $af = 0.02;
                } else {
                    if ($l < $ep) {
                        $ep = $l;
                        $af = min($maxAf, $af + 0.02);
                    }
                }
            }
            $out[$i] = $sar;
        }
        return $out;
    }

    /** Horário “seguro” p/ NEWS_SR (evita 30min de janelas típicas de notícia — simplificado). */
    public static function isNewsSafeHour(): bool
    {
        // Brasília approx UTC-3
        $h = (int) gmdate('G', time() - 3 * 3600);
        $m = (int) gmdate('i', time() - 3 * 3600);
        // evita 8h30–9h30 e 14h30–15h30 BRT (aprox. dados US)
        if ($h === 8 && $m >= 30) {
            return false;
        }
        if ($h === 9 && $m <= 30) {
            return false;
        }
        if ($h === 14 && $m >= 30) {
            return false;
        }
        if ($h === 15 && $m <= 30) {
            return false;
        }
        return true;
    }
}
