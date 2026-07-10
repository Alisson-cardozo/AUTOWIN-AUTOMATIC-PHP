<?php

declare(strict_types=1);

namespace App\Bot\Blaze;

/**
 * Polling REST (equivalente ao BlazeWebSocket do Node).
 * Emite callbacks: onWaiting(), onComplete(array $data)
 */
final class BlazePoller
{
    private string $room;
    private bool $stopped = true;
    private ?string $lastId = null;
    private ?string $lastStatus = null;
    /** @var array<string,true> */
    private array $seenComplete = [];
    /** @var callable|null */
    public $onWaiting = null;
    /** @var callable|null */
    public $onComplete = null;

    public function __construct(string $room = 'double_v2')
    {
        $this->room = $room;
    }

    public function connect(): void
    {
        $this->stopped = false;
        $this->lastId = null;
        $this->lastStatus = null;
        $this->seenComplete = [];
        log_msg("[ws:{$this->room}] polling started", 'bot');
    }

    public function disconnect(): void
    {
        $this->stopped = true;
    }

    public function seedSeenIds(array $ids): void
    {
        foreach ($ids as $id) {
            $this->seenComplete[(string) $id] = true;
        }
    }

    public function tick(BlazeAPI $api): void
    {
        if ($this->stopped) {
            return;
        }
        try {
            $data = match ($this->room) {
                'crash_v2' => $api->getCurrentCrash(),
                'fortune_double_v2' => $api->getCurrentFortune(),
                default => $api->getCurrentDouble(),
            };
        } catch (\Throwable $e) {
            return;
        }

        $id = (string) ($data['id'] ?? '');
        $status = (string) ($data['status'] ?? '');
        if ($id === '' || $status === '') {
            return;
        }

        if ($status === 'waiting' && ($this->lastStatus !== 'waiting' || $this->lastId !== $id)) {
            $this->lastStatus = 'waiting';
            $this->lastId = $id;
            if ($this->onWaiting) {
                ($this->onWaiting)($data);
            }
        }

        if ($status === 'complete') {
            // Crash: a API às vezes devolve complete com crash_point=0 (dado
            // incompleto). NÃO marca como visto e NÃO dispara onComplete —
            // o próximo poll deve trazer o multiplicador real. Se processarmos
            // 0.00x, a aposta vira "cancelada" sem ser LOSS/gale de verdade.
            if ($this->room === 'crash_v2') {
                $cp = (float) ($data['crash_point'] ?? $data['crashPoint'] ?? 0);
                if ($cp <= 0) {
                    $this->lastStatus = 'complete';
                    $this->lastId = $id;
                    return;
                }
            }

            if (!isset($this->seenComplete[$id])) {
                $this->seenComplete[$id] = true;
                // limpa set antigo
                if (count($this->seenComplete) > 200) {
                    $this->seenComplete = array_slice($this->seenComplete, -100, null, true);
                }
                if ($this->onComplete) {
                    ($this->onComplete)($data);
                }
            }
            $this->lastStatus = 'complete';
            $this->lastId = $id;
        } elseif ($status === 'rolling' || $status === 'graphing') {
            $this->lastStatus = $status;
            $this->lastId = $id;
        }
    }
}
