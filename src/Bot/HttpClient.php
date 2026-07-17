<?php

declare(strict_types=1);

namespace App\Bot;

/**
 * Cliente HTTP do bot.
 *
 * Assinaturas aceitas (compat com usos mistos no port):
 *   new HttpClient($baseUrl)
 *   new HttpClient($baseUrl, $headers)
 *   new HttpClient($baseUrl, $headers, $timeout)
 *   new HttpClient($baseUrl, $timeout)          // timeout em ms ou segundos
 */
final class HttpClient
{
    private string $baseUrl;
    /** @var array<string,string> */
    private array $headers;
    private int $timeout;

    /**
     * @param array<string,string>|int $headersOrTimeout
     */
    public function __construct(string $baseUrl = '', array|int $headersOrTimeout = [], int $timeout = 15)
    {
        $this->baseUrl = rtrim($baseUrl, '/');
        if (is_int($headersOrTimeout)) {
            // Timeout passado como 2º arg — se > 1000, trata como milissegundos
            $t = $headersOrTimeout;
            $this->timeout = $t > 1000 ? (int) max(1, (int) ceil($t / 1000)) : max(1, $t);
            $this->headers = [];
        } else {
            $this->headers = $headersOrTimeout;
            // timeout: se > 1000, ms → s
            $this->timeout = $timeout > 1000 ? (int) max(1, (int) ceil($timeout / 1000)) : max(1, $timeout);
        }
    }

    public function setHeader(string $k, string $v): void
    {
        $this->headers[$k] = $v;
    }

    /** @param array<string,string> $headers */
    public function setHeaders(array $headers): void
    {
        foreach ($headers as $k => $v) {
            $this->headers[(string) $k] = (string) $v;
        }
    }

    public function get(string $path): array
    {
        return $this->request('GET', $path);
    }

    public function post(string $path, mixed $body = null, array $extraHeaders = []): array
    {
        return $this->request('POST', $path, $body, $extraHeaders);
    }

    public function put(string $path, mixed $body = null, array $extraHeaders = []): array
    {
        return $this->request('PUT', $path, $body, $extraHeaders);
    }

    public function request(string $method, string $path, mixed $body = null, array $extraHeaders = []): array
    {
        $url = str_starts_with($path, 'http') ? $path : $this->baseUrl . $path;
        $ch = curl_init($url);
        $headers = array_merge($this->headers, $extraHeaders);
        $lines = [];
        foreach ($headers as $k => $v) {
            $lines[] = "$k: $v";
        }
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $lines,
            CURLOPT_TIMEOUT => $this->timeout,
            CURLOPT_CONNECTTIMEOUT => min(15, $this->timeout),
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($body) ? $body : json_encode($body, JSON_UNESCAPED_UNICODE));
        }
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($raw === false) {
            throw new \RuntimeException("HTTP error: $err");
        }
        $data = json_decode($raw, true);
        if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
            // Alguns provedores (ex: casino.org) emitem \uXXXX de surrogate UTF-16
            // desemparelhado em nomes de usuário — json_decode do PHP rejeita o
            // payload inteiro nesse caso (outros parsers, como o do Python, toleram).
            // Remove os escapes de surrogate quebrados e tenta de novo antes de desistir.
            $sanitized = preg_replace('/\\\\u[dD][89abcdefABCDEF][0-9a-fA-F]{2}/', '', $raw);
            $data = $sanitized !== null ? json_decode($sanitized, true) : null;
        }
        if ($status >= 400) {
            $ex = new \RuntimeException("HTTP $status: $raw", $status);
            /** @phpstan-ignore-next-line */
            $ex->response = ['status' => $status, 'data' => $data, 'raw' => $raw];
            throw $ex;
        }
        if (!is_array($data)) {
            throw new \RuntimeException('JSON decode falhou: ' . json_last_error_msg());
        }
        return $data;
    }
}
