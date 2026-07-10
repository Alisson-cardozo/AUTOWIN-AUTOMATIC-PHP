<?php

declare(strict_types=1);

namespace App\Services;

final class HttpClient
{
    private string $baseUrl;
    private array $defaultHeaders;
    private int $timeout;

    public function __construct(string $baseUrl = '', array $defaultHeaders = [], int $timeout = 15)
    {
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->defaultHeaders = $defaultHeaders;
        $this->timeout = $timeout;
    }

    public function setHeader(string $key, string $value): void
    {
        $this->defaultHeaders[$key] = $value;
    }

    public function get(string $path, array $headers = []): array
    {
        return $this->request('GET', $path, null, $headers);
    }

    public function post(string $path, mixed $body = null, array $headers = []): array
    {
        return $this->request('POST', $path, $body, $headers);
    }

    public function put(string $path, mixed $body = null, array $headers = []): array
    {
        return $this->request('PUT', $path, $body, $headers);
    }

    public function request(string $method, string $path, mixed $body = null, array $headers = []): array
    {
        $url = str_starts_with($path, 'http') ? $path : $this->baseUrl . $path;
        $ch = curl_init($url);
        $merged = array_merge($this->defaultHeaders, $headers);
        $headerLines = [];
        foreach ($merged as $k => $v) {
            $headerLines[] = "$k: $v";
        }

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headerLines,
            CURLOPT_TIMEOUT => $this->timeout,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);

        if ($body !== null) {
            $payload = is_string($body) ? $body : json_encode($body, JSON_UNESCAPED_UNICODE);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        }

        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($raw === false) {
            return ['ok' => false, 'status' => 0, 'error' => $err, 'data' => null, 'raw' => ''];
        }

        $data = json_decode($raw, true);
        return [
            'ok' => $status >= 200 && $status < 300,
            'status' => $status,
            'data' => $data,
            'raw' => $raw,
            'error' => $status >= 400 ? ($data['message'] ?? $raw) : null,
        ];
    }
}
