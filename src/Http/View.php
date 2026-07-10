<?php

declare(strict_types=1);

namespace App\Http;

final class View
{
    public static function render(string $template, array $data = [], ?string $layout = 'layouts/app'): void
    {
        extract($data, EXTR_SKIP);
        ob_start();
        $file = view_path(str_replace('.', '/', $template) . '.php');
        if (!is_file($file)) {
            http_response_code(500);
            echo "View não encontrada: $template";
            return;
        }
        require $file;
        $content = ob_get_clean() ?: '';

        if ($layout === null) {
            echo $content;
            return;
        }

        $layoutFile = view_path(str_replace('.', '/', $layout) . '.php');
        if (!is_file($layoutFile)) {
            echo $content;
            return;
        }
        require $layoutFile;
    }

    public static function json(mixed $data, int $status = 200): never
    {
        json_response($data, $status);
    }
}
