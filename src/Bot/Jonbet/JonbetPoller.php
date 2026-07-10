<?php

declare(strict_types=1);

namespace App\Bot\Jonbet;

use App\Bot\HttpClient;

/**
 * Port of bot/jonbet/websocket.ts — REST polling driven by worker tick.
 */
final class JonbetPoller
{
    public const ROOM_DOUBLE = 'double_v2';
    public const ROOM_CRASH = 'crash_v2';
    public const ROOM_FORTUNE = 'fortune_double_v2';

    private const DOUBLE_CURRENT_URL =
        'https://jonbet.bet.br/api/singleplayer-originals/originals/roulette_games/current/1';
    private const CRASH_CURRENT_URL =
        'https://jonbet.bet.br/api/singleplayer-originals/originals/crash_games/current/4';
    private const FORTUNE_CURRENT_URL =
        'https://jonbet.bet.br/api/singleplayer-originals/originals/fortune_double_games/current/1';

    private const POLL_MS = 250;

    private string $room;
    private bool $stopped = true;
    private ?string $lastId = null;
    private ?string $lastStatus = null;
    /** @var array<string, true> */
    private array $seenCompleteIds = [];
    /** @var array<string, true> */
    private array $seenWaitingIds = [];
    private bool $firstLog = true;
    private float $nextPollAt = 0;
    private HttpClient $http;

    /** @var callable|null */
    private $onComplete = null;
    /** @var callable|null */
    private $onWaiting = null;
    /** @var callable|null */
    private $getToken = null;

    public function __construct(string $room, ?callable $getToken = null)
    {
        $this->room = $room;
        $this->getToken = $getToken;
        // timeout 2s no poll (original ~1.5s)
        $this->http = new HttpClient('', [
            'Accept' => 'application/json',
            'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36',
            'Referer' => 'https://jonbet.bet.br/pt/games/double',
            'x-client-version' => 'e672a0517',
            'ipcountry' => 'BR',
        ], 2);
    }

    public function on(string $event, callable $cb): void
    {
        if ($event === 'complete') {
            $this->onComplete = $cb;
        } elseif ($event === 'waiting') {
            $this->onWaiting = $cb;
        }
    }

    public function connect(): void
    {
        $this->stopped = false;
        $this->lastId = null;
        $this->lastStatus = null;
        $this->seenCompleteIds = [];
        $this->seenWaitingIds = [];
        $this->firstLog = true;
        $this->nextPollAt = 0;
        echo "[jonbet:ws:{$this->room}] polling started\n";
    }

    /** @param string[] $ids */
    public function seedSeenIds(array $ids): void
    {
        foreach ($ids as $id) {
            $this->seenCompleteIds[(string) $id] = true;
        }
        echo '[jonbet:ws:' . $this->room . '] seeded ' . count($ids) . " IDs conhecidos\n";
    }

    public function disconnect(): void
    {
        $this->stopped = true;
        echo "[jonbet:ws:{$this->room}] polling stopped\n";
    }

    public function isRunning(): bool
    {
        return !$this->stopped;
    }

    public function tick(): void
    {
        if ($this->stopped) {
            return;
        }
        $now = microtime(true) * 1000;
        if ($now < $this->nextPollAt) {
            return;
        }

        $status = $this->doTick();
        $ms = self::POLL_MS;
        if ($status === 'complete') {
            $ms = 100;
        } elseif ($status === 'graphing') {
            $ms = 450;
        }
        $this->nextPollAt = (microtime(true) * 1000) + $ms;
    }

    private function baseUrl(): string
    {
        return match ($this->room) {
            self::ROOM_DOUBLE => self::DOUBLE_CURRENT_URL,
            self::ROOM_FORTUNE => self::FORTUNE_CURRENT_URL,
            default => self::CRASH_CURRENT_URL,
        };
    }

    private function doTick(): ?string
    {
        try {
            $t = (int) (microtime(true) * 1000);
            $url = $this->baseUrl() . "?t=$t";
            $data = $this->http->get($url, [], 1500);
            if (!is_array($data)) {
                return null;
            }

            if ($this->firstLog) {
                $this->firstLog = false;
                echo '[jonbet:ws:' . $this->room . '] primeiro payload: id=' . ($data['id'] ?? '?') . ' status=' . ($data['status'] ?? '?') . "\n";
            }

            if (empty($data['id'])) {
                $inner = $data['data'] ?? $data['result'] ?? null;
                if (is_array($inner) && !empty($inner['id'])) {
                    $data = array_merge($data, $inner);
                } else {
                    return null;
                }
            }

            return $this->processUpdate(
                (string) $data['id'],
                (string) ($data['status'] ?? ''),
                $data['crash_point'] ?? null,
                'poll',
                $data
            );
        } catch (\Throwable $err) {
            echo '[jonbet:ws:' . $this->room . '] poll error: ' . $err->getMessage() . "\n";
            return null;
        }
    }

    private function processUpdate(
        string $currentId,
        string $currentStatus,
        mixed $rawCrashPoint,
        string $source,
        ?array $extra = null
    ): string {
        if ($this->lastId === null) {
            $this->lastId = $currentId;
            $this->lastStatus = $currentStatus;
            if ($currentStatus === 'complete') {
                $this->seenCompleteIds[$currentId] = true;
            }
            echo "[jonbet:ws:{$this->room}] seeded id=$currentId status=$currentStatus ($source)\n";
            return $currentStatus;
        }

        if ($currentStatus === 'complete' && !isset($this->seenCompleteIds[$currentId])) {
            if (!isset($this->seenWaitingIds[$currentId])) {
                echo "[jonbet:ws:{$this->room}] 👻 SUSPEITO: id=$currentId completou ($source) sem waiting\n";
            }
            $this->seenCompleteIds[$currentId] = true;
            if (count($this->seenCompleteIds) > 30) {
                array_shift($this->seenCompleteIds);
            }
            $this->lastId = $currentId;
            $this->lastStatus = 'complete';

            if ($this->room === self::ROOM_CRASH) {
                if ($rawCrashPoint !== null) {
                    $cp = ((float) $rawCrashPoint) === 0.0 ? 1.00 : (float) $rawCrashPoint;
                    $this->emitComplete(['id' => $currentId, 'crash_point' => $cp, 'status' => 'complete']);
                    return 'complete';
                }
                $this->confirmCrashPointAndEmit($currentId, $extra ?? ['id' => $currentId]);
                return 'complete';
            }

            $payload = is_array($extra) ? $extra : [];
            $payload['id'] = $currentId;
            $payload['status'] = 'complete';
            $this->emitComplete($payload);
            return 'complete';
        }

        if ($currentStatus === 'waiting' && !isset($this->seenWaitingIds[$currentId])) {
            $this->seenWaitingIds[$currentId] = true;
            if (count($this->seenWaitingIds) > 30) {
                array_shift($this->seenWaitingIds);
            }
            $this->lastId = $currentId;
            $this->lastStatus = 'waiting';
            $this->emitWaiting($currentId);
            return 'waiting';
        }

        if ($currentId !== $this->lastId) {
            return $this->lastStatus ?? $currentStatus;
        }

        $this->lastStatus = $currentStatus;
        return $currentStatus;
    }

    private function confirmCrashPointAndEmit(string $roundId, array $fallbackData): void
    {
        for ($attempt = 0; $attempt < 10; $attempt++) {
            if ($this->stopped) {
                return;
            }
            usleep(100_000);
            try {
                $t = (int) (microtime(true) * 1000);
                $data = $this->http->get(self::CRASH_CURRENT_URL . "?t=$t", [], 800);
                if (is_array($data)) {
                    if (isset($data['id']) && (string) $data['id'] === $roundId && array_key_exists('crash_point', $data) && $data['crash_point'] !== null) {
                        $cp = ((float) $data['crash_point']) === 0.0 ? 1.00 : (float) $data['crash_point'];
                        $this->emitComplete(array_merge($fallbackData, [
                            'id' => $roundId,
                            'crash_point' => $cp,
                            'status' => 'complete',
                        ]));
                        return;
                    }
                    if (!empty($data['id']) && (string) $data['id'] !== $roundId) {
                        break;
                    }
                }
            } catch (\Throwable) {
            }
        }
        $this->emitComplete(array_merge($fallbackData, [
            'id' => $roundId,
            'crash_point' => 0,
            'status' => 'complete',
        ]));
    }

    private function emitComplete(array $data): void
    {
        if ($this->onComplete) {
            ($this->onComplete)($data);
        }
    }

    private function emitWaiting(string $roundId): void
    {
        if ($this->onWaiting) {
            ($this->onWaiting)($roundId);
        }
    }
}
