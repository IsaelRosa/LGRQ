<?php
/**
 * Roteador do servidor embutido do PHP, usado APENAS em desenvolvimento e
 * nos testes locais.
 *
 * O servidor embutido não lê .htaccess, então /api/auth/register cairia em
 * 404 antes de chegar ao index.php. Em produção quem faz esse roteamento é
 * o Apache (ou LiteSpeed) através de php/.htaccess — este arquivo existe
 * para reproduzir esse comportamento no `php -S`.
 *
 *   php -S 127.0.0.1:8000 -t php php/router.php
 */

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

// Arquivo existente é servido normalmente (frontend, .css, imagens).
$caminho = __DIR__ . $uri;
if ($uri !== '/' && is_file($caminho)) {
    return false;
}

// Tudo que começa com /api vai para o controlador.
if (preg_match('#^/api(/.*)?$#', $uri)) {
    require __DIR__ . '/api/index.php';
    return true;
}

// Qualquer outra rota devolve o index.html do frontend (SPA).
$index = __DIR__ . '/index.html';
if (is_file($index)) {
    readfile($index);
    return true;
}

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo "Rota não encontrada. Rode o build do frontend ou ajuste a raiz.";
