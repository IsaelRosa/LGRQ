<?php
/**
 * Teste da API em PHP contra um MySQL real.
 *
 *   php test/e2e-php.php
 *
 * Se já houver um servidor rodando, reaproveita:
 *   LGRP_TEST_URL=http://127.0.0.1:8000 php test/e2e-php.php
 *
 * O relatório também é gravado em $TMPDIR/lgrp_e2e_relatorio.txt, porque em
 * alguns terminais a captura de stdout do PHP se perde.
 */

$raiz = dirname(__DIR__);

$bd = [
    'host' => getenv('LGRP_TEST_DB_HOST') ?: '127.0.0.1',
    'porta' => getenv('LGRP_TEST_DB_PORTA') ?: '3399',
    'banco' => getenv('LGRP_TEST_DB_NOME') ?: 'lgrp',
    'usuario' => getenv('LGRP_TEST_DB_USUARIO') ?: 'lgrp_user',
    'senha' => getenv('LGRP_TEST_DB_SENHA') ?: 'senha-local-teste',
];

$pdo = new PDO(
    "mysql:host={$bd['host']};port={$bd['porta']};dbname={$bd['banco']};charset=utf8mb4",
    $bd['usuario'],
    $bd['senha'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);

// Banco limpo para o teste.
foreach (['historico', 'notificacoes', 'coletas', 'tratamentos', 'pedidos_coleta',
          'solventes', 'reagentes', 'vidrarias', 'indicadores_mensais', 'usuarios'] as $t) {
    $pdo->exec("DELETE FROM `$t`");
}
$pdo->exec('ALTER TABLE usuarios AUTO_INCREMENT = 1');

/**
 * O servidor NÃO é iniciado por este script.
 *
 * Em Windows, `php -S ... &` dentro de shell_exec não retorna o PID e trava o
 * processo. Sube o servidor numa sessão e aponte a variável:
 *
 *   php -S 127.0.0.1:8791 -t php php/router.php
 *   LGRP_TEST_URL=http://127.0.0.1:8791 php test/e2e-php.php
 */
$base = rtrim((string) getenv('LGRP_TEST_URL'), '/');
if ($base === '') {
    fwrite(STDERR, "Defina LGRP_TEST_URL. Exemplo:\n  LGRP_TEST_URL=http://127.0.0.1:8791 php test/e2e-php.php\n");
    exit(2);
}

$docroot = $raiz . '/php';

if (@file_get_contents("$base/api/health") === false) {
    file_put_contents(sys_get_temp_dir() . '/lgrp_e2e_relatorio.txt', "SERVIDOR NAO RESPONDEU em $base\n");
    fwrite(STDERR, "O servidor PHP nao respondeu em $base\n");
    exit(1);
}

$RELATORIO = sys_get_temp_dir() . '/lgrp_e2e_relatorio.txt';
@unlink($RELATORIO);
$falhas = 0;

function check(string $nome, bool $ok, string $detalhe = ''): void
{
    global $falhas, $RELATORIO;
    $linha = $ok ? "  ok    $nome" : "  FALHA $nome  $detalhe";
    if (!$ok) {
        $falhas++;
    }
    echo $linha . "\n";
    file_put_contents($RELATORIO, $linha . "\n", FILE_APPEND);
}

function req(string $metodo, string $rota, array $corpo = [], ?string $token = null): array
{
    global $base;
    $ch = curl_init($base . $rota);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $metodo,
        CURLOPT_HTTPHEADER => array_values(array_filter([
            'Content-Type: application/json',
            $token ? "Authorization: Bearer $token" : null,
        ])),
        CURLOPT_POSTFIELDS => json_encode($corpo, JSON_UNESCAPED_UNICODE),
        CURLOPT_TIMEOUT => 20,
    ]);
    $resposta = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['status' => $status, 'body' => json_decode((string) $resposta, true) ?? $resposta];
}

echo "E2E da API em PHP  ($base)\n\n";

/* ---------------- autenticação ---------------- */
echo "Autenticacao\n";
$email = 'e2e@php.test';
$senha = 'senha-forte-123';

$r = req('POST', '/api/auth/register', ['nome' => 'E2E Tecnico', 'email' => $email, 'senha' => $senha]);
check('Cadastro cria conta', $r['status'] === 201, "veio {$r['status']} " . json_encode($r['body']));
check('Primeiro usuario vira Administrador', ($r['body']['usuario']['papel'] ?? '') === 'Administrador', $r['body']['usuario']['papel'] ?? 'sem');
check('Senha nao volta na resposta', !str_contains(json_encode($r['body']), 'senha_hash'));
check('Devolve token', !empty($r['body']['token']));
$token = $r['body']['token'] ?? '';

$me = req('GET', '/api/auth/me', [], $token);
check('/api/auth/me devolve o perfil', ($me['body']['usuario']['email'] ?? '') === $email, json_encode($me['body']));

check('Senha errada retorna 401', req('POST', '/api/auth/login', ['email' => $email, 'senha' => 'errada'])['status'] === 401);

$login = req('POST', '/api/auth/login', ['email' => $email, 'senha' => $senha]);
check('Login valido', $login['status'] === 200 && !empty($login['body']['token']), json_encode($login['body']));
$token = $login['body']['token'] ?? $token;

check('Sem token retorna 401', req('GET', '/api/pedidos')['status'] === 401);
check('Token invalido retorna 401', req('GET', '/api/pedidos', [], 'a.b.c')['status'] === 401);
check('Rota inexistente retorna 404', req('GET', '/api/naoexiste', [], $token)['status'] === 404);

/* ---------------- CRUD ---------------- */
echo "\nCRUD\n";

$criado = req('POST', '/api/pedidos', [
    'laboratorio' => 'Lab. E2E', 'solicitante' => 'E2E',
    'tipo_residuo' => 'Acido Inorganico', 'unidade' => 'kg', 'quantidade_estimada' => 12.5,
], $token);
check('POST cria registro', $criado['status'] === 201 && !empty($criado['body']['id']), json_encode($criado['body']));
check('Codigo automatico', preg_match('/^PED-\d{4}-\d{4}$/', $criado['body']['codigo'] ?? '') === 1, $criado['body']['codigo'] ?? '');
check('DECIMAL volta como numero', is_float($criado['body']['quantidade_estimada'] ?? null), gettype($criado['body']['quantidade_estimada'] ?? null));
check('Data volta em ISO', preg_match('/^\d{4}-\d{2}-\d{2}T/', $criado['body']['criado_em'] ?? '') === 1, $criado['body']['criado_em'] ?? '');
check('Prioridade com acento preservada', ($criado['body']['prioridade'] ?? '') === 'Média', bin2hex($criado['body']['prioridade'] ?? ''));

$segundo = req('POST', '/api/pedidos', ['laboratorio' => 'Lab. E2E', 'solicitante' => 'E2E', 'tipo_residuo' => 'Base'], $token);
check('Sequencia de codigo incrementa', ($segundo['body']['codigo'] ?? '') !== ($criado['body']['codigo'] ?? ''), ($segundo['body']['codigo'] ?? 'sem'));

$comData = req('POST', '/api/pedidos', [
    'laboratorio' => 'Lab. E2E', 'solicitante' => 'E2E', 'tipo_residuo' => 'Solvente',
    'data_solicitacao' => '2026-03-05T14:30:00.000Z',
], $token);
check('DATETIME com offset preserva horario', str_starts_with((string) ($comData['body']['data_solicitacao'] ?? ''), '2026-03-05T14:30'), $comData['body']['data_solicitacao'] ?? 'sem');

$atual = req('PUT', '/api/pedidos', ['id' => $criado['body']['id'], 'status' => 'Agendado'], $token);
check('PUT atualiza', ($atual['body']['status'] ?? '') === 'Agendado', json_encode($atual['body']));

$busca = req('GET', '/api/pedidos?busca=E2E', [], $token);
check('Busca textual', is_array($busca['body']) && count($busca['body']) > 0, 'sem resultados');

$wild = req('GET', '/api/pedidos?busca=%25', [], $token);
check('Busca com % nao vira curinga', is_array($wild['body']) && count($wild['body']) < 100, json_encode(is_array($wild['body']) ? count($wild['body']) : $wild['body']));

check('Filtro por periodo', req('GET', '/api/pedidos?de=2026-01-01&ate=2026-12-31', [], $token)['status'] === 200);

/* ---------------- tipos ---------------- */
echo "\nTipos (MySQL -> JSON)\n";

$solv = req('GET', '/api/solventes', [], $token);
check('GET /api/solventes responde', is_array($solv['body']), gettype($solv['body']));

$indic = req('GET', '/api/indicadores?ano=2026', [], $token);
check('Indicadores devolvem 12 meses', count($indic['body']['meses'] ?? []) === 12, json_encode(array_slice((array) ($indic['body']['meses'] ?? []), 0, 1)));

$dash = req('GET', '/api/dashboard', [], $token);
check('Dashboard com KPIs', isset($dash['body']['kpis']['total_pedidos']), json_encode(array_slice((array) ($dash['body'] ?? []), 0, 1)));
check('Serie de 12 meses', count($dash['body']['serie'] ?? []) === 12, 'serie incompleta');
check('Graficos presentes', count($dash['body']['graficos'] ?? []) >= 10, count($dash['body']['graficos'] ?? []));

$notif = req('GET', '/api/notificacoes', [], $token);
check('Notificacoes em lista', is_array($notif['body']), gettype($notif['body']));

$hist = req('GET', '/api/historico?limit=5', [], $token);
check('Historico com modulos', isset($hist['body']['itens'][0]['modulo']), json_encode(array_slice((array) ($hist['body'] ?? []), 0, 1)));

$rel = req('GET', '/api/relatorios?modulos=lista', [], $token);
check('Relatorios: 6 modulos', count($rel['body']['modulos'] ?? []) === 6, json_encode($rel['body']));

$rel2 = req('GET', '/api/relatorios?modulo=pedidos_coleta&agrupar=status', [], $token);
check('Relatorios: agrupamento', ($rel2['body']['resumo']['registros'] ?? 0) > 0, json_encode($rel2['body']['resumo'] ?? []));

/* ---------------- permissões ---------------- */
echo "\nPermissoes\n";

$consultor = req('POST', '/api/auth/register', ['nome' => 'E2E Consultor', 'email' => 'consultor@php.test', 'senha' => $senha]);
check('Auto-registro vira Consultor', ($consultor['body']['usuario']['papel'] ?? '') === 'Consultor', $consultor['body']['usuario']['papel'] ?? 'sem');
$tc = $consultor['body']['token'] ?? '';

check('Consultor le', req('GET', '/api/pedidos', [], $tc)['status'] === 200);
check('Consultor nao escreve', req('POST', '/api/pedidos', ['laboratorio' => 'X', 'solicitante' => 'X', 'tipo_residuo' => 'X'], $tc)['status'] === 403);
check('Nao-admin nao gerencia usuarios', req('POST', '/api/usuarios', ['nome' => 'X', 'email' => 'x@php.test', 'senhaInicial' => 'abcdef'], $tc)['status'] === 403);

/* ---------------- exclusão e auditoria ---------------- */
echo "\nExclusao e auditoria\n";

check('DELETE remove', req('DELETE', '/api/pedidos', ['id' => $criado['body']['id']], $token)['status'] === 200);

$aud = $pdo->prepare("SELECT * FROM historico WHERE tabela='pedidos_coleta' AND registro_id=?");
$aud->execute([(string) $criado['body']['id']]);
$linhas = $aud->fetchAll();
check('Auditoria com 3 acoes', count($linhas) === 3, count($linhas) . ' registros');
check('Auditoria grava o autor', array_reduce($linhas, fn($c, $l) => $c && $l['usuario_email'] === $email, true));
$insercao = array_values(array_filter($linhas, fn($l) => $l['acao'] === 'INSERT'))[0] ?? null;
// Conferir pela API, e não pelo PDO cru: o que importa e o que o
// frontend recebe. O PDO devolve JSON como string; a hidratacao converte.
$apiHist = req('GET', '/api/historico?registro_id=' . $criado['body']['id'], [], $token);
$itens = $apiHist['body']['itens'] ?? [];
// A API vem em ordem cronologica decrescente: a ultima e a criacao.
// O DELETE nao tem dados_novos por natureza, entao precisa ser a criacao.
$itemApi = null;
foreach ($itens as $item) {
    if (($item['acao'] ?? '') === 'INSERT') {
        $itemApi = $item;
        break;
    }
}
check(
    'Campo JSON volta como objeto na API',
    isset($itemApi['dados_novos']) && is_array($itemApi['dados_novos']),
    gettype($itemApi['dados_novos'] ?? null)
);
check('Auditoria traz as 3 acoes pela API', count($itens) === 3, count($itens) . ' itens');

/* ---------------- limpeza ---------------- */
echo "\nLimpando...\n";
foreach (['historico', 'notificacoes', 'coletas', 'pedidos_coleta', 'indicadores_mensais', 'usuarios'] as $t) {
    $pdo->exec("DELETE FROM `$t`");
}

$resumo = $falhas === 0 ? 'PHP: todos os testes passaram' : "PHP: $falhas falha(s)";
echo "\n$resumo\n";
file_put_contents($RELATORIO, "\n$resumo\n", FILE_APPEND);
exit($falhas === 0 ? 0 : 1);
