<?php

declare(strict_types=1);

namespace App\Bot\Games;

use App\Bot\Blaze\BlazeAPI;
use App\Bot\Blaze\BlazePoller;
use App\Bot\Jonbet\JonbetAPI;
use App\Bot\Jonbet\JonbetPoller;
use App\Database;
use App\Models\UserRepository;
use App\Services\BotCommandService;
use App\Services\Notify;

/** Motor Fortune Double — mesma lógica de cores do Double, sala fortune. */
final class FortuneEngine
{
    private const COLOR_MAP = [0 => 'BRANCO', 1 => 'VERMELHO', 2 => 'PRETO'];
    private const COLOR_ID = ['VERMELHO' => 1, 'VERDE' => 1, 'PRETO' => 2, 'BRANCO' => 0];

    private BlazeAPI|JonbetAPI $api;
    private BlazePoller|JonbetPoller $ws;
    private int $userId;
    private string $platform;
    private bool $isDemo;
    private bool $running = false;
    private array $history = [];
    private int $live = 0;
    private bool $betInFlight = false;
    private bool $pendingStop = false;
    private float $currentBet = 0;
    private string $signal = '';
    private float $sim = 1000;
    private string $strategyType = 'SEQUÊNCIA';
    private bool $forceReset;
    private string $lastPattern = '';

    public function __construct(int $userId, BlazeAPI|JonbetAPI $api, bool $isDemo = false, string $platform = 'BLAZE', bool $forceReset = false)
    {
        $this->userId = $userId;
        $this->api = $api;
        $this->isDemo = $isDemo;
        $this->platform = $platform;
        $this->forceReset = $forceReset;
        if ($platform === 'JONBET') {
            $this->ws = new JonbetPoller('fortune_double_v2', fn () => $this->api->getToken());
            $this->ws->on('waiting', fn () => $this->onWaiting());
            $this->ws->on('complete', fn (array $d) => $this->onResult($d));
        } else {
            $this->ws = new BlazePoller('fortune_double_v2');
            $this->ws->onWaiting = fn () => $this->onWaiting();
            $this->ws->onComplete = fn (array $d) => $this->onResult($d);
        }
    }

    public function start(): void
    {
        $this->running = true;
        $this->initSession();
        $this->ws->connect();
        $this->msg('🟢 Bot Fortune iniciado');
    }

    private function initSession(): void
    {
        $vars = Database::fetch('SELECT * FROM `' . $this->vt() . '` WHERE ownerId = ?', [$this->userId]);
        if (!$vars) {
            return;
        }
        $mode = $this->isDemo ? 'DEMO' : 'REAL';
        $today = date('Y-m-d');
        $lastDate = !empty($vars['firstBalanceDate'])
            ? date('Y-m-d', strtotime((string) $vars['firstBalanceDate']))
            : null;
        $newDay = $lastDate !== $today;
        $modeChanged = ($vars['firstBalanceMode'] ?? null) !== $mode;

        if ($this->forceReset || $newDay || $modeChanged) {
            $bal = $this->isDemo ? (float) ($vars['balance'] ?? 1000) : (float) ($vars['balance'] ?? 0);
            if (!$this->isDemo) {
                try {
                    $bal = $this->api->extractBalance($this->api->getWallet());
                } catch (\Throwable) {
                }
            } else {
                $this->sim = $bal > 0 ? $bal : 1000;
                $bal = $this->sim;
            }
            \App\Bot\BotEntryLogger::resetSessionCounters($this->vt(), $this->userId, $bal);
            Database::update($this->vt(), ['firstBalanceMode' => $mode], 'ownerId = :oid', ['oid' => $this->userId]);
            if ($this->forceReset) {
                $this->msg('💰 Sessão reiniciada — vitórias/derrotas do painel zeradas (relatório do mês mantido)');
            }
        } elseif ($this->isDemo) {
            $this->sim = (float) ($vars['balance'] ?? 1000);
        }
    }

    public function stop(): void
    {
        $this->running = false;
        $this->ws->disconnect();
    }

    public function requestStop(): bool
    {
        if ($this->betInFlight) {
            $this->pendingStop = true;
            return false;
        }
        $this->stop();
        return true;
    }

    public function isRunning(): bool
    {
        return $this->running;
    }

    public function refreshCache(): void
    {
    }

    public function tick(): void
    {
        if (!$this->running) {
            return;
        }
        if ($this->ws instanceof JonbetPoller) {
            $this->ws->tick();
        } else {
            $this->ws->tick($this->api);
        }
    }

    private function msg(string $m): void
    {
        BotCommandService::pushMessage($this->userId, $m, $this->platform, $this->strategyType);
    }

    private function st(): string
    {
        return $this->platform === 'JONBET' ? 'jonbet_settings' : 'settings';
    }

    private function vt(): string
    {
        return $this->platform === 'JONBET' ? 'jonbet_variables' : 'variables';
    }

    private function onWaiting(): void
    {
        if (!$this->running || $this->live < 1 || $this->betInFlight) {
            return;
        }
        $settings = Database::fetch('SELECT * FROM `' . $this->st() . '` WHERE ownerId = ?', [$this->userId]);
        $vars = Database::fetch('SELECT * FROM `' . $this->vt() . '` WHERE ownerId = ?', [$this->userId]);
        if (!$settings || !$vars) {
            return;
        }
        $this->strategyType = (string) ($settings['strategyType'] ?? 'SEQUÊNCIA');
        $signal = $this->detect();
        if (!$signal) {
            return;
        }
        $this->signal = $signal;
        $base = ($settings['enterType'] ?? '') === 'PORCENTAGEM'
            ? ((float) $vars['balance'] * (float) $settings['enterPercent'] / 100)
            : (float) $settings['enterValue'];
        $amount = round($base * pow((float) $settings['martingaleMultiplier'], (int) $vars['countMartingale']), 2);
        $this->currentBet = $amount;
        $this->betInFlight = true;
        UserRepository::update($this->userId, [
            ($this->platform === 'JONBET' ? 'jonbetIsBetting' : 'isBetting') => 1,
            ($this->platform === 'JONBET' ? 'jonbetColorBet' : 'colorBet') => $signal,
        ]);
        try {
            if (!$this->isDemo) {
                $this->api->betFortune(self::COLOR_ID[$signal] ?? 1, $amount);
            }
            $this->msg("🎯 Fortune: *{$signal}* R$ " . number_format($amount, 2, '.', '') . ($this->lastPattern !== '' ? " | 📋 {$this->lastPattern}" : ''));
            Notify::notifyUser($this->userId, 'entrada', "Entrando: {$signal} — R$ " . number_format($amount, 2, '.', ''), 'Fortune', $this->platform);
        } catch (\Throwable $e) {
            $this->betInFlight = false;
            UserRepository::update($this->userId, [($this->platform === 'JONBET' ? 'jonbetIsBetting' : 'isBetting') => 0]);
            $this->msg('Erro fortune: ' . $e->getMessage());
        }
    }

    private function onResult(array $data): void
    {
        $this->live++;
        $color = (int) ($data['color'] ?? 0);
        array_unshift($this->history, $color);
        if (count($this->history) > 14) {
            array_pop($this->history);
        }
        if (!$this->betInFlight) {
            return;
        }
        $this->betInFlight = false;
        $result = self::COLOR_MAP[$color] ?? 'PRETO';
        $won = $result === $this->signal || ($result === 'BRANCO' && $this->signal !== 'BRANCO');
        $vars = Database::fetch('SELECT * FROM `' . $this->vt() . '` WHERE ownerId = ?', [$this->userId]);
        $settings = Database::fetch('SELECT * FROM `' . $this->st() . '` WHERE ownerId = ?', [$this->userId]);
        if (!$vars || !$settings) {
            return;
        }
        if ($this->isDemo) {
            $this->sim += $won ? $this->currentBet : -$this->currentBet;
            $bal = $this->sim;
        } else {
            try {
                $bal = $this->api->extractBalance($this->api->getWallet());
            } catch (\Throwable) {
                $bal = (float) $vars['balance'];
            }
        }
        $profit = $bal - (float) $vars['firstBalance'];
        $roundProfit = $won ? $this->currentBet : -$this->currentBet;
        UserRepository::update($this->userId, [($this->platform === 'JONBET' ? 'jonbetIsBetting' : 'isBetting') => 0]);
        if ($won) {
            Database::update($this->vt(), [
                'countWin' => (int) $vars['countWin'] + 1,
                'monthCountWin' => (int) ($vars['monthCountWin'] ?? 0) + 1,
                'countMartingale' => 0,
                'isGale' => 0,
                'profit' => $profit,
                'balance' => $bal,
            ], 'ownerId = :oid', ['oid' => $this->userId]);
            $this->msg("✅ *WIN* Fortune — {$result}\nLucro: R$ " . number_format($profit, 2, '.', ''));
            Notify::notifyUser($this->userId, 'win', "WIN — {$result} | Lucro: R$ " . number_format($profit, 2, '.', ''), 'Fortune', $this->platform);
            \App\Bot\BotEntryLogger::log(
                $this->userId,
                'WIN',
                'FORTUNE',
                $this->platform,
                $this->signal,
                $result,
                $this->lastPattern !== '' ? $this->lastPattern : null,
                $this->currentBet,
                $roundProfit,
                (int) ($vars['countMartingale'] ?? 0),
                $this->isDemo ? 'DEMO' : 'REAL'
            );
        } else {
            $g = (int) $vars['countMartingale'] + 1;
            $maxGale = (int) ($settings['martingale'] ?? 0);
            if ($g <= $maxGale) {
                Database::update($this->vt(), [
                    'countMartingale' => $g,
                    'isGale' => 1,
                    'profit' => $profit,
                    'balance' => $bal,
                ], 'ownerId = :oid', ['oid' => $this->userId]);
                $this->msg("❌ *LOSS* Fortune | Gale {$g}/{$maxGale}");
                \App\Bot\BotEntryLogger::log(
                    $this->userId,
                    'GALE',
                    'FORTUNE',
                    $this->platform,
                    $this->signal,
                    $result,
                    $this->lastPattern !== '' ? $this->lastPattern : null,
                    $this->currentBet,
                    $roundProfit,
                    $g,
                    $this->isDemo ? 'DEMO' : 'REAL'
                );
            } else {
                Database::update($this->vt(), [
                    'countLoss' => (int) $vars['countLoss'] + 1,
                    'monthCountLoss' => (int) ($vars['monthCountLoss'] ?? 0) + 1,
                    'countMartingale' => 0,
                    'isGale' => 0,
                    'profit' => $profit,
                    'balance' => $bal,
                ], 'ownerId = :oid', ['oid' => $this->userId]);
                $this->msg("❌ *LOSS* Fortune | Gales esgotados\nLucro: R$ " . number_format($profit, 2, '.', ''));
                Notify::notifyUser($this->userId, 'loss', "LOSS — {$result} | Lucro: R$ " . number_format($profit, 2, '.', ''), 'Fortune', $this->platform);
                \App\Bot\BotEntryLogger::log(
                    $this->userId,
                    'LOSS',
                    'FORTUNE',
                    $this->platform,
                    $this->signal,
                    $result,
                    $this->lastPattern !== '' ? $this->lastPattern : null,
                    $this->currentBet,
                    $roundProfit,
                    $g,
                    $this->isDemo ? 'DEMO' : 'REAL'
                );
            }
        }
        if ($this->pendingStop) {
            $this->pendingStop = false;
            $this->stop();
            UserRepository::update($this->userId, [($this->platform === 'JONBET' ? 'jonbetIsActive' : 'isActive') => 0]);
            $this->msg('⏹️ Entrada finalizada — parando o robô, como solicitado.');
        }
    }

    private function detect(): ?string
    {
        $strategies = Database::fetchAll(
            "SELECT * FROM strategies WHERE ownerId = ? AND gameType = 'FORTUNE' AND platform = ?",
            [$this->userId, $this->platform]
        );
        $last = array_map(fn ($c) => self::COLOR_MAP[$c] ?? 'PRETO', array_slice($this->history, 0, 14));
        foreach ($strategies as $s) {
            $seq = array_map(fn ($x) => strtoupper(trim($x)), explode(',', (string) $s['sequence']));
            if (count($seq) > count($last)) {
                continue;
            }
            $ok = true;
            foreach ($seq as $i => $color) {
                if ($color !== 'X' && ($last[count($seq) - 1 - $i] ?? null) !== $color) {
                    $ok = false;
                    break;
                }
            }
            // pattern label for report
            if ($ok) {
                $this->lastPattern = (string) ($s['sequence'] ?? '');
            }
            if ($ok) {
                return strtoupper((string) $s['color']);
            }
        }
        return null;
    }
}
