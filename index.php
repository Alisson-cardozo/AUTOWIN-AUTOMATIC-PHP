<?php

/**
 * Fallback se o document root do servidor for a raiz do projeto
 * (em vez de /public). Encaminha para o front controller real.
 *
 * Ideal: configure o virtual host / domínio para apontar em /public.
 */

require __DIR__ . '/public/index.php';
