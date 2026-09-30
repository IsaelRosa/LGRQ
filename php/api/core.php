<?php
/**
 * LGRP · autenticação, autorização e regras de negócio
 */

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

/* ------------------------------------------------------------------ */
/* Senhas                                                              */
/* ------------------------------------------------------------------ */

/**
 * Usa bcrypt. O módulo argon2 não está disponível em toda hospedagem, e
 * bcrypt faz parte do núcleo do PHP.
 *
 * ATENÇÃO: os hashes criados pela versão Node usavam scrypt, em outro
 * formato. Contas migradas do Node precisam ter a senha redefinida aqui.
 */
function lgrp_hash_senha(string $senha): string
{
    if (mb_strlen($senha) < 6) {
        throw new LgrpErroHttp(400, 'A senha deve ter no mínimo 6 caracteres.');
    }
    return password_hash($senha, PASSWORD_BCRYPT, ['cost' => 12]);
}

function lgrp_verificar_senha(string $senha, string $hash): bool
{
    if ($hash === '' || $hash === null) {
        // Gasta o mesmo tempo de um hash real para não revelar, pelo tempo de
        // resposta, se a conta tem senha definida.
        password_verify($senha, '$2y$12$usadoapenasparagastartempoeimpedirtiming');
        return false;
    }
    return password_verify($senha, $hash);
}

/* ------------------------------------------------------------------ */
/* Erro HTTP                                                           */
/* ------------------------------------------------------------------ */

class LgrpErroHttp extends RuntimeException
{
    public function __construct(public int $status, string $message, public ?string $codigo = null)
    {
        parent::__construct($message);
    }
}

/* ------------------------------------------------------------------ */
/* JWT (HS256)                                                         */
/* ------------------------------------------------------------------ */

function lgrp_segredo(): string
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $s = config('JWT_SECRET');
    if ($s === null || strlen($s) < 32) {
        if (config('APP_ENV', 'production') === 'production') {
            throw new RuntimeException(
                'JWT_SECRET ausente ou com menos de 32 caracteres. Defina a variável de ambiente.'
            );
        }
        error_log('[LGRP] JWT_SECRET não definido; usando segredo efêmero (apenas desenvolvimento).');
        $cache = bin2hex(random_bytes(48));
        return $cache;
    }
    $cache = $s;
    return $cache;
}

function lgrp_b64(string $dados): string
{
    return rtrim(strtr(base64_encode($dados), '+/', '-_'), '=');
}

function lgrp_b64_decode(string $s): string|false
{
    return base64_decode(strtr($s, '-_', '+/'));
}

function lgrp_assinar_token(array $payload, int $expiraEmSegundos = 43200): string
{
    $payload['iat'] = time();
    $payload['exp'] = time() + $expiraEmSegundos;
    $header = lgrp_b64(json_encode(['alg' => 'HS256', 'typ' => 'JWT'], JSON_UNESCAPED_SLASHES));
    $body = lgrp_b64(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $assinatura = hash_hmac('sha256', "$header.$body", lgrp_segredo(), true);
    return "$header.$body." . lgrp_b64($assinatura);
}

function lgrp_verificar_token(?string $token): ?array
{
    if (!$token || substr_count($token, '.') !== 2) {
        return null;
    }
    [$h, $b, $s] = explode('.', $token);
    $esperada = hash_hmac('sha256', "$h.$b", lgrp_segredo(), true);
    // Comparação em tempo constante.
    if (!hash_equals(lgrp_b64($esperada), $s)) {
        return null;
    }
    $json = lgrp_b64_decode($b);
    if ($json === false) {
        return null;
    }
    $payload = json_decode($json, true);
    if (!is_array($payload) || !isset($payload['exp']) || $payload['exp'] < time()) {
        return null;
    }
    return $payload;
}

function lgrp_duracao(string $valor): int
{
    if (preg_match('/^(\d+)([smhd])$/', $valor, $m)) {
        return (int) $m[1] * ['s' => 1, 'm' => 60, 'h' => 3600, 'd' => 86400][$m[2]];
    }
    return 43200;
}

/* ------------------------------------------------------------------ */
/* Respostas                                                           */
/* ------------------------------------------------------------------ */

function lgrp_cors(): void
{
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: strict-origin-when-cross-origin');
}

function lgrp_json($dados, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function lgrp_erro(int $status, string $mensagem, ?string $codigo = null): void
{
    lgrp_json(['error' => $mensagem, 'codigo' => $codigo], $status);
}

function lgrp_token_request(): string
{
    $cabecalho = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!$cabecalho && function_exists('getallheaders')) {
        foreach (getallheaders() as $nome => $valor) {
            if (strcasecmp($nome, 'Authorization') === 0) {
                $cabecalho = $valor;
                break;
            }
        }
    }
    return trim(preg_replace('/^Bearer\s+/i', '', (string) $cabecalho));
}

/* ------------------------------------------------------------------ */
/* Sessão                                                              */
/* ------------------------------------------------------------------ */

const LGRP_SELECT_USUARIO = 'id, nome, email, papel, setor, crq, telefone, ativo, senha_hash';

/** Usuário da requisição. Lança 401 se não houver sessão válida. */
function lgrp_usuario(): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $token = lgrp_token_request();
    if ($token === '') {
        throw new LgrpErroHttp(401, 'Sessão não informada. Faça login para continuar.', 'sem_sessao');
    }
    $payload = lgrp_verificar_token($token);
    if (!$payload || !isset($payload['sub'])) {
        throw new LgrpErroHttp(401, 'Sessão inválida ou expirada. Faça login novamente.', 'sessao_invalida');
    }
    $r = db('usuarios')->select(LGRP_SELECT_USUARIO)->eq('id', (int) $payload['sub'])->limit(1)->execute();
    $u = $r['data'][0] ?? null;
    if (!$u) {
        throw new LgrpErroHttp(401, 'Usuário não encontrado.', 'sem_usuario');
    }
    if (!$u['ativo']) {
        throw new LgrpErroHttp(403, 'Seu usuário está inativo. Procure o administrador do LGRP.', 'usuario_inativo');
    }
    $cache = $u;
    return $u;
}

function lgrp_perfil_publico(?array $u): ?array
{
    if (!$u) {
        return null;
    }
    return [
        'id' => (int) $u['id'],
        'nome' => $u['nome'],
        'email' => $u['email'],
        'papel' => $u['papel'],
        'setor' => $u['setor'] ?? '',
        'crq' => $u['crq'] ?? '',
        'telefone' => $u['telefone'] ?? '',
        'ativo' => (bool) $u['ativo'],
    ];
}

const LGRP_PAPEIS_EDITOR = ['Administrador', 'Coordenador', 'Químico Responsável', 'Gestor Ambiental', 'Técnico de Laboratório'];
const LGRP_PAPEIS_ADMIN = ['Administrador'];

function lgrp_exigir_edicao(array $u): void
{
    if (!in_array($u['papel'], LGRP_PAPEIS_EDITOR, true)) {
        throw new LgrpErroHttp(
            403,
            'Seu perfil possui acesso somente leitura. Solicite a um administrador a permissão de edição.',
            'somente_leitura'
        );
    }
}

function lgrp_exigir_admin(array $u): void
{
    if (!in_array($u['papel'], LGRP_PAPEIS_ADMIN, true)) {
        throw new LgrpErroHttp(403, 'Apenas administradores podem gerenciar usuários.', 'requer_admin');
    }
}

/* ------------------------------------------------------------------ */
/* Rate limit (em memória, por IP)                                     */
/* ------------------------------------------------------------------ */

function lgrp_ip(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? 'desconhecido';
}

function lgrp_exigir_rate_limit(string $chave = 'login'): void
{
    $arquivo = sys_get_temp_dir() . '/lgrp_rate_' . md5($chave . '|' . lgrp_ip()) . '.json';
    $agora = time();
    $dados = ['n' => 1, 'expira' => $agora + 600];
    if (is_readable($arquivo)) {
        $lido = json_decode((string) file_get_contents($arquivo), true);
        if (is_array($lido) && ($lido['expira'] ?? 0) > $agora) {
            $dados = ['n' => $lido['n'] + 1, 'expira' => $lido['expira']];
            if ($dados['n'] > 8) {
                throw new LgrpErroHttp(
                    429,
                    'Muitas tentativas de acesso. Aguarde alguns minutos antes de tentar novamente.',
                    'rate_limit'
                );
            }
        }
    }
    @file_put_contents($arquivo, json_encode($dados));
}

function lgrp_limpar_rate_limit(string $chave = 'login'): void
{
    @unlink(sys_get_temp_dir() . '/lgrp_rate_' . md5($chave . '|' . lgrp_ip()) . '.json');
}

/* ------------------------------------------------------------------ */
/* Auditoria                                                           */
/* ------------------------------------------------------------------ */

function lgrp_registrar_historico(array $d): void
{
    try {
        db('historico')->insert([
            'tabela' => $d['tabela'],
            'registro_id' => (string) ($d['registroId'] ?? ''),
            'registro_codigo' => $d['codigo'] ?? '#' . ($d['registroId'] ?? ''),
            'acao' => $d['acao'],
            'descricao' => mb_substr($d['descricao'] ?? $d['acao'] . ' em ' . $d['tabela'], 0, 500),
            'usuario' => $d['usuario']['nome'] ?? 'Sistema LGRP',
            'usuario_email' => $d['usuario']['email'] ?? '',
            'dados_anteriores' => $d['antes'] ?? null,
            'dados_novos' => $d['depois'] ?? null,
            'mudancas' => $d['mudancas'] ?? null,
        ])->execute();
    } catch (Throwable $e) {
        error_log('registrarHistorico: ' . $e->getMessage());
    }
}

function lgrp_limpar_array($obj): ?array
{
    if (!is_array($obj)) {
        return null;
    }
    $out = [];
    foreach ($obj as $k => $v) {
        if ($v !== null) {
            $out[$k] = $v;
        }
    }
    return $out ?: null;
}

function lgrp_diff(array $antes, array $depois, array $campos): array
{
    $mudancas = [];
    foreach ($campos as $c) {
        $a = $antes[$c] ?? null;
        $d = $depois[$c] ?? null;
        if ((string) ($a ?? '') !== (string) ($d ?? '')) {
            $mudancas[$c] = ['antes' => $a, 'depois' => $d];
        }
    }
    return $mudancas;
}

/* ------------------------------------------------------------------ */
/* Numeração de documentos                                             */
/* ------------------------------------------------------------------ */

function lgrp_proximo_codigo(string $tabela, string $prefixo, string $campo = 'codigo'): string
{
    $ano = (int) date('Y');
    $padrao = "$prefixo-$ano-%";
    $pdo = lgrp_pdo();
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare(
            "SELECT `$campo` AS v FROM `$tabela` WHERE `$campo` LIKE ? ORDER BY `id` DESC LIMIT 1 FOR UPDATE"
        );
        $st->execute([$padrao]);
        $ultimo = $st->fetch(PDO::FETCH_ASSOC);
        $n = 1;
        if ($ultimo && $ultimo['v']) {
            $partes = explode('-', (string) $ultimo['v']);
            $num = (int) end($partes);
            if ($num > 0) {
                $n = $num + 1;
            }
        }
        $pdo->commit();
        return sprintf('%s-%d-%04d', $prefixo, $ano, $n);
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

/* ------------------------------------------------------------------ */
/* Alertas automáticos                                                 */
/* ------------------------------------------------------------------ */

const LGRP_ALERTA_INTERVALO = 300;
const LGRP_CACHE_ALERTAS = '/tmp_lgrp_alertas';

function lgrp_gerar_alertas(bool $forcar = false): int
{
    $marca = sys_get_temp_dir() . '/' . LGRP_CACHE_ALERTAS;
    if (!$forcar && is_readable($marca) && (time() - (int) filemtime($marca)) < LGRP_ALERTA_INTERVALO) {
        return 0;
    }
    @touch($marca);

    $DIA = 86400000;
    $agora = time() * 1000;
    $iso = gmdate('Y-m-d\TH:i:s.v\Z');
    $em30 = gmdate('Y-m-d\TH:i:s.v\Z', intdiv($agora + 30 * $DIA, 1000));
    $ha7 = gmdate('Y-m-d\TH:i:s.v\Z', intdiv($agora - 7 * $DIA, 1000));
    $ha30 = gmdate('Y-m-d\TH:i:s.v\Z', intdiv($agora - 30 * $DIA, 1000));

    $existentes = db('notificacoes')->select('tipo,origem,origem_id')->eq('lida', false)->limit(1000)->execute()['data'];
    $reagentes = db('reagentes')->select('id,codigo,nome,data_validade,laboratorio')->limit(1000)->execute()['data'];
    $solventes = db('solventes')->select('id,codigo,nome,volume_total_l,volume_restante_l,data_validade,laboratorio,categoria')->limit(1000)->execute()['data'];
    $pedidos = db('pedidos_coleta')->select('id,codigo,laboratorio,status,data_solicitacao,data_prevista,tipo_residuo,prioridade')->limit(1000)->execute()['data'];
    $vidrarias = db('vidrarias')->select('id,codigo,tipo,laboratorio,nivel_contaminacao,status,contaminante,quantidade')->limit(1000)->execute()['data'];
    $tratamentos = db('tratamentos')->select('id,codigo,residuo,metodo,status,data_inicio')->limit(1000)->execute()['data'];

    $vistos = [];
    foreach ($existentes as $n) {
        $vistos[$n['tipo'] . '|' . $n['origem'] . '|' . $n['origem_id']] = true;
    }
    $novas = [];
    $push = function (array $n) use (&$vistos, &$novas): void {
        $k = $n['tipo'] . '|' . $n['origem'] . '|' . $n['origem_id'];
        if (isset($vistos[$k])) {
            return;
        }
        $vistos[$k] = true;
        $novas[] = $n;
    };
    $dataBr = fn(?string $iso): string => $iso
        ? (new DateTimeImmutable($iso))->setTimezone(new DateTimeZone('UTC'))->format('d/m/Y')
        : '—';

    foreach ($reagentes as $r) {
        if (!$r['data_validade']) {
            continue;
        }
        $codigoR = $r['codigo'] ?: 'sem código';
        $labR = $r['laboratorio'] ?: '—';
        if ($r['data_validade'] < $iso) {
            $push([
                'tipo' => 'Reagente vencido', 'severidade' => 'critica',
                'titulo' => "Reagente vencido: {$r['nome']}",
                'mensagem' => "O reagente {$r['nome']} ({$codigoR}) do laboratório {$labR} está vencido desde "
                    . $dataBr($r['data_validade']) . '. Segregar e solicitar coleta imediata.',
                'origem' => 'reagentes', 'origem_id' => (string) $r['id'],
            ]);
        } elseif ($r['data_validade'] <= $em30) {
            $dias = (int) max(0, ceil((strtotime($r['data_validade']) - $agora / 1000) / 86400));
            $push([
                'tipo' => 'Reagente a vencer', 'severidade' => 'aviso',
                'titulo' => "Reagente vence em {$dias} dia(s): {$r['nome']}",
                'mensagem' => "O reagente {$r['nome']} ({$codigoR}) vence em "
                    . $dataBr($r['data_validade']) . '. Priorize o uso ou programe a destinação.',
                'origem' => 'reagentes', 'origem_id' => (string) $r['id'],
            ]);
        }
    }

    foreach ($solventes as $s) {
        $total = (float) ($s['volume_total_l'] ?? 0);
        $resto = (float) ($s['volume_restante_l'] ?? 0);
        $codigoS = $s['codigo'] ?: '—';
        $labS = $s['laboratorio'] ?: '—';
        if ($s['data_validade'] && $s['data_validade'] < $iso) {
            $push([
                'tipo' => 'Solvente vencido', 'severidade' => 'critica',
                'titulo' => "Solvente vencido: {$s['nome']}",
                'mensagem' => "O solvente {$s['nome']} ({$codigoS}) está com validade expirada. "
                    . 'Encaminhar para recuperação ou destinação final.',
                'origem' => 'solventes', 'origem_id' => (string) $s['id'],
            ]);
        }
        if ($total > 0 && $resto > 0 && $resto / $total <= 0.15) {
            $push([
                'tipo' => 'Estoque baixo', 'severidade' => 'aviso',
                'titulo' => "Estoque baixo: {$s['nome']}",
                'mensagem' => sprintf('Restam %.1f L de %.1f L de %s (%s). Considere reposição ou coleta do resíduo.',
                    $resto, $total, $s['nome'], $labS),
                'origem' => 'solventes', 'origem_id' => (string) $s['id'],
            ]);
        }
    }

    foreach ($pedidos as $p) {
        $aberto = in_array($p['status'], ['Solicitado', 'Agendado'], true);
        if ($aberto && $p['data_prevista'] && $p['data_prevista'] < $iso) {
            $push([
                'tipo' => 'Coleta atrasada', 'severidade' => 'critica',
                'titulo' => "Coleta atrasada: {$p['codigo']}",
                'mensagem' => "O pedido {$p['codigo']} ({$p['laboratorio']}) está com status \"{$p['status']}\" "
                    . 'e a data prevista (' . $dataBr($p['data_prevista']) . ') já foi ultrapassada.',
                'origem' => 'pedidos_coleta', 'origem_id' => (string) $p['id'],
            ]);
        } elseif ($p['status'] === 'Solicitado' && $p['data_solicitacao'] && $p['data_solicitacao'] < $ha7) {
            $push([
                'tipo' => 'Pedido pendente', 'severidade' => 'aviso',
                'titulo' => "Pedido sem agendamento: {$p['codigo']}",
                'mensagem' => "O pedido {$p['codigo']} ({$p['laboratorio']} — {$p['tipo_residuo']}) "
                    . 'aguarda agendamento de coleta há mais de 7 dias.',
                'origem' => 'pedidos_coleta', 'origem_id' => (string) $p['id'],
            ]);
        }
        if ($p['status'] === 'Em Tratamento' && $p['prioridade'] === 'Crítica') {
            $push([
                'tipo' => 'Prioridade crítica', 'severidade' => 'aviso',
                'titulo' => "Resíduo de prioridade crítica em tratamento: {$p['codigo']}",
                'mensagem' => "O pedido {$p['codigo']} ({$p['tipo_residuo']}) possui prioridade crítica "
                    . 'e está em tratamento. Acompanhe o prazo.',
                'origem' => 'pedidos_coleta', 'origem_id' => (string) $p['id'],
            ]);
        }
    }

    foreach ($vidrarias as $v) {
        if ($v['status'] === 'Aguardando Descontaminação' && $v['nivel_contaminacao'] === 'Crítico') {
            $push([
                'tipo' => 'Contaminação crítica', 'severidade' => 'critica',
                'titulo' => "Vidraria com contaminação crítica: {$v['codigo']}",
                'mensagem' => sprintf('%d unidade(s) de %s (%s) contaminada(s) com %s aguardam descontaminação.',
                    (int) ($v['quantidade'] ?: 1), $v['tipo'], $v['laboratorio'] ?: '—',
                    $v['contaminante'] ?: 'agente não informado'),
                'origem' => 'vidrarias', 'origem_id' => (string) $v['id'],
            ]);
        }
    }

    foreach ($tratamentos as $t) {
        if ($t['status'] === 'Em Andamento' && $t['data_inicio'] && $t['data_inicio'] < $ha30) {
            $push([
                'tipo' => 'Tratamento prolongado', 'severidade' => 'aviso',
                'titulo' => "Tratamento há mais de 30 dias: {$t['codigo']}",
                'mensagem' => "O tratamento {$t['codigo']} ({$t['metodo']} — {$t['residuo']}) iniciou em "
                    . $dataBr($t['data_inicio']) . ' e ainda não foi concluído.',
                'origem' => 'tratamentos', 'origem_id' => (string) $t['id'],
            ]);
        }
    }

    if ($novas) {
        db('notificacoes')->insert($novas)->execute();
    }
    return count($novas);
}

/* ------------------------------------------------------------------ */
/* Fábrica CRUD                                                        */
/* ------------------------------------------------------------------ */

function lgrp_pegar(array $corpo, array $campos): array
{
    $out = [];
    foreach ($campos as $c) {
        if (array_key_exists($c, $corpo)) {
            $out[$c] = $corpo[$c] === '' ? null : $corpo[$c];
        }
    }
    return $out;
}

function lgrp_resposta($dados, int $status = 200): void
{
    lgrp_json($dados, $status);
}

function lgrp_metodo(): string
{
    return $_SERVER['REQUEST_METHOD'] ?? 'GET';
}

/** Filtro textual com escaping dos curingas. */
function lgrp_filtro_busca(array $searchable, string $termo): ?string
{
    $limpo = trim(preg_replace('/[,()]/', ' ', $termo));
    if ($limpo === '' || !$searchable) {
        return null;
    }
    $p = '%' . lgrp_escapar_like($limpo) . '%';
    return implode(',', array_map(fn($c) => "$c.ilike.$p", $searchable));
}
