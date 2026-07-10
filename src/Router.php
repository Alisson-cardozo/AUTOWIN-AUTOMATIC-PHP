<?php

declare(strict_types=1);

namespace App;

final class Router
{
    /** @var array<string, array<string, callable|array{0:class-string,1:string}>> */
    private array $routes = [];

    public function get(string $path, callable|array $handler): self
    {
        return $this->add('GET', $path, $handler);
    }

    public function post(string $path, callable|array $handler): self
    {
        return $this->add('POST', $path, $handler);
    }

    public function put(string $path, callable|array $handler): self
    {
        return $this->add('PUT', $path, $handler);
    }

    public function delete(string $path, callable|array $handler): self
    {
        return $this->add('DELETE', $path, $handler);
    }

    public function any(string $path, callable|array $handler): self
    {
        foreach (['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as $m) {
            $this->add($m, $path, $handler);
        }
        return $this;
    }

    private function add(string $method, string $path, callable|array $handler): self
    {
        $this->routes[$method][$this->normalize($path)] = $handler;
        return $this;
    }

    public function dispatch(string $method, string $uri): void
    {
        $path = parse_url($uri, PHP_URL_PATH) ?: '/';
        $path = $this->normalize($path);
        $method = strtoupper($method);
        // method override (HTML forms / proxies)
        if ($method === 'POST') {
            $override = $_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE']
                ?? ($_POST['_method'] ?? (request_json()['_method'] ?? null));
            if (is_string($override) && $override !== '') {
                $method = strtoupper($override);
            }
        }

        $handler = $this->routes[$method][$path] ?? null;

        // match dinâmico simples /api/foo/{id}
        if (!$handler) {
            foreach ($this->routes[$method] ?? [] as $route => $h) {
                $pattern = preg_replace('#\{([a-zA-Z_]+)\}#', '([^/]+)', $route);
                $pattern = '#^' . $pattern . '$#';
                if (preg_match($pattern, $path, $m)) {
                    array_shift($m);
                    preg_match_all('#\{([a-zA-Z_]+)\}#', $route, $names);
                    $params = [];
                    foreach ($names[1] as $i => $name) {
                        $params[$name] = $m[$i] ?? null;
                    }
                    $this->invoke($h, $params);
                    return;
                }
            }
        }

        if (!$handler) {
            if (str_starts_with($path, '/api/')) {
                json_response(['error' => 'Rota não encontrada'], 404);
            }
            http_response_code(404);
            echo 'Página não encontrada';
            return;
        }

        $this->invoke($handler, []);
    }

    private function invoke(callable|array $handler, array $params): void
    {
        if (is_array($handler)) {
            [$class, $method] = $handler;
            $obj = new $class();
            $obj->$method(...array_values($params));
            return;
        }
        $handler(...array_values($params));
    }

    private function normalize(string $path): string
    {
        $path = '/' . trim($path, '/');
        return $path === '/' ? '/' : rtrim($path, '/');
    }
}
