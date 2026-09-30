<?php
/**
 * LGRP · controlador frontal da API
 *
 * Recebe /api/<recurso> e despacha. Toda a regra de acesso vive aqui e em
 * core.php — o frontend só esconde botões, nunca é a barreira.
 */

declare(strict_types=1);

require_once __DIR__ . '/core.php';
require_once __DIR__ . '/rotas.php';

lgrp_cors();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
// Só o PRIMEIRO segmento é o recurso: /api/auth/register -> auth.
// Usar o caminho inteiro faria "auth/register" cair no 404.
$caminhoApi = trim(preg_replace('#^.*?/api/?#', '', $uri), '/');
$partes = $caminhoApi === '' ? [] : explode('/', $caminhoApi);
$recurso = strtolower($partes[0] ?? '');

$bruto = (string) file_get_contents('php://input');
// Remover BOM UTF-8: alguns clientes (e o PowerShell ao gravar o arquivo)
// o precedem ao '{', e o json_decode falha silenciosamente nesse caso.
if (str_starts_with($bruto, "\xEF\xBB\xBF")) {
    $bruto = substr($bruto, 3);
}
$corpo = json_decode($bruto === '' ? '{}' : $bruto, true);
$corpo = is_array($corpo) ? $corpo : [];
$get = $_GET;

$recurso = strtolower($partes[0] ?? '');

if ($recurso === 'health') {
    try {
        lgrp_pdo()->query('SELECT 1');
        lgrp_resposta(['ok' => true, 'banco' => 'conectado']);
    } catch (Throwable $e) {
        lgrp_resposta(['ok' => false, 'banco' => 'indisponivel'], 503);
    }
}

if ($recurso === 'auth') {
    // DENTRO do try: sem isto uma validação rejeitada escapa como erro fatal
    // e imprime o caminho do arquivo no navegador.
    if (!in_array($caminhoApi, ['auth', 'auth/login', 'auth/register', 'auth/me', 'auth/senha'], true)) {
        lgrp_erro(404, 'Rota de API inexistente.');
    }
    try {
        lgrp_rota_auth($corpo);
    } catch (LgrpErroHttp $e) {
        lgrp_erro($e->status, $e->getMessage(), $e->codigo);
    } catch (PDOException $e) {
        error_log('LGRP SQL (auth): ' . $e->getMessage());
        lgrp_erro(500, 'Erro ao consultar o banco.', 'erro_interno');
    } catch (Throwable $e) {
        error_log('LGRP (auth): ' . $e->getMessage());
        lgrp_erro(500, $e->getMessage() ?: 'Erro interno do servidor.', 'erro_interno');
    }
}

/* ------------------------------------------------------------------ */
/* CRUD genérico                                                       */
/* ------------------------------------------------------------------ */

/**
 * @param array{beforeInsert?:callable, beforeUpdate?:callable, afterWrite?:callable,
 *              transform?:callable, sanitize?:callable} $opcoes
 */
function lgrp_crud(string $tabela, array $opcoes): void
{
    // A função vive no escopo global do arquivo: precisa enxergar o corpo
    // da requisição e os parâmetros de query.
    global $corpo, $get;

    $m = lgrp_metodo();
    $usuario = lgrp_usuario();

    $campos = $opcoes['campos'] ?? [];
    $prefixo = $opcoes['prefixo'] ?? null;
    $searchable = $opcoes['searchable'] ?? [];
    $rotulo = $opcoes['rotulo'] ?? 'Registro';
    $ordenarPor = $opcoes['ordenarPor'] ?? 'id';
    $ascendente = $opcoes['ascendente'] ?? false;
    $campoData = $opcoes['campoData'] ?? 'criado_em';
    $temAtualizadoEm = $opcoes['temAtualizadoEm'] ?? true;
    $permissao = $opcoes['permissaoEscrita'] ?? 'edicao';
    $transform = $opcoes['transform'] ?? null;
    $sanitize = $opcoes['sanitize'] ?? null;

    if ($m !== 'GET') {
        if ($permissao === 'admin') {
            lgrp_exigir_admin($usuario);
        } else {
            lgrp_exigir_edicao($usuario);
        }
    }

    /* ------------------------------ GET */
    if ($m === 'GET') {
        $q = db($tabela)->select('*');
        foreach ($campos as $f) {
            $v = $get[$f] ?? null;
            if ($v !== null && $v !== '' && !in_array($v, ['todos', 'Todas', 'Todos'], true)) {
                $q = $q->eq($f, $v);
            }
        }
        if (!empty($get['pedido_id'])) {
            $q = $q->eq('pedido_id', $get['pedido_id']);
        }
        if (!empty($get['busca'])) {
            $expr = lgrp_filtro_busca($searchable, (string) $get['busca']);
            if ($expr !== null) {
                $q = $q->or($expr);
            }
        }
        if (!empty($get['de'])) {
            $q = $q->gte($campoData, $get['de']);
        }
        if (!empty($get['ate'])) {
            $ate = (string) $get['ate'];
            $q = $q->lte($campoData, strlen($ate) === 10 ? $ate . 'T23:59:59.999Z' : $ate);
        }
        $r = $q->order($ordenarPor, ['ascending' => $ascendente])->limit(3000)->execute();
        $linhas = $r['data'] ?: [];
        if ($transform) {
            $linhas = array_map($transform, $linhas);
        }
        if ($sanitize) {
            $linhas = array_map($sanitize, $linhas);
        }
        lgrp_resposta(array_values($linhas));
    }

    /* ----------------------------- POST */
    if ($m === 'POST') {
        $body = lgrp_pegar($corpo, $campos);
        if ($prefixo && empty($body['codigo'])) {
            $body['codigo'] = lgrp_proximo_codigo($tabela, $prefixo);
        }
        if (!empty($opcoes['beforeInsert'])) {
            $opcoes['beforeInsert']($body, $corpo, $usuario);
        }
        $r = db($tabela)->insert($body)->select('*')->single()->execute();
        $dado = $r['data'];
        lgrp_registrar_historico([
            'tabela' => $tabela, 'registroId' => $dado['id'],
            'codigo' => $dado['codigo'] ?? '#' . $dado['id'],
            'acao' => 'INSERT',
            'descricao' => $rotulo . ' criado' . (!empty($dado['codigo']) ? " ({$dado['codigo']})" : ''),
            'usuario' => $usuario, 'antes' => null, 'depois' => $dado,
        ]);
        if (!empty($opcoes['afterWrite'])) {
            $opcoes['afterWrite']('POST', $dado, null, $usuario);
        }
        lgrp_resposta($sanitize ? $sanitize($dado) : ($transform ? $transform($dado) : $dado), 201);
    }

    /* ------------------------------ PUT */
    if ($m === 'PUT') {
        $id = $corpo['id'] ?? $get['id'] ?? null;
        if (!$id) {
            lgrp_erro(400, 'Campo "id" é obrigatório.');
        }
        $r = db($tabela)->select('*')->eq('id', $id)->limit(1)->execute();
        $registro = $r['data'][0] ?? null;
        if (!$registro) {
            lgrp_erro(404, 'Registro não encontrado.');
        }
        $body = lgrp_pegar($corpo, $campos);
        if (!empty($opcoes['beforeUpdate'])) {
            $opcoes['beforeUpdate']($body, $corpo, $registro, $usuario);
        }
        if ($temAtualizadoEm) {
            $body['atualizado_em'] = gmdate('Y-m-d\TH:i:s.v\Z');
        }
        $dado = db($tabela)->update($body)->eq('id', $id)->select('*')->single()->execute()['data'];
        $mudancas = lgrp_diff($registro, $dado, $campos);
        lgrp_registrar_historico([
            'tabela' => $tabela, 'registroId' => $id,
            'codigo' => $dado['codigo'] ?? '#' . $id,
            'acao' => 'UPDATE',
            'descricao' => $rotulo . ' atualizado' . (!empty($dado['codigo']) ? " ({$dado['codigo']})" : ''),
            'usuario' => $usuario, 'antes' => $registro, 'depois' => $dado,
            'mudancas' => $mudancas ?: null,
        ]);
        if (!empty($opcoes['afterWrite'])) {
            $opcoes['afterWrite']('PUT', $dado, $registro, $usuario);
        }
        lgrp_resposta($sanitize ? $sanitize($dado) : ($transform ? $transform($dado) : $dado));
    }

    /* --------------------------- DELETE */
    if ($m === 'DELETE') {
        $id = $corpo['id'] ?? $get['id'] ?? null;
        if (!$id) {
            lgrp_erro(400, 'Campo "id" é obrigatório.');
        }
        $r = db($tabela)->select('*')->eq('id', $id)->limit(1)->execute();
        $antes = $r['data'][0] ?? null;
        db($tabela)->delete()->eq('id', $id)->execute();
        lgrp_registrar_historico([
            'tabela' => $tabela, 'registroId' => $id,
            'codigo' => $antes['codigo'] ?? '#' . $id,
            'acao' => 'DELETE',
            'descricao' => $rotulo . ' excluído' . (!empty($antes['codigo']) ? " ({$antes['codigo']})" : ''),
            'usuario' => $usuario, 'antes' => $antes, 'depois' => null,
        ]);
        lgrp_resposta(['ok' => true]);
    }

    lgrp_erro(405, 'Método não permitido');
}

/* ------------------------------------------------------------------ */
/* Definição dos módulos                                               */
/* ------------------------------------------------------------------ */

/**
 * Módulos do CRUD.
 *
 * A CHAVE é o nome usado na URL pela interface (/api/pedidos), que não
 * coincide com o nome da tabela (pedidos_coleta). Conflundir os dois faz
 * todas as rotas devolverem 404.
 */
$MODULOS = [
    'pedidos' => [
        'tabela' => 'pedidos_coleta', 'prefixo' => 'PED',
        'campos' => ['codigo', 'laboratorio', 'solicitante', 'usuario_id', 'tipo_residuo', 'grupo', 'classe',
                     'quantidade_estimada', 'unidade', 'embalagem', 'local_coleta', 'data_solicitacao',
                     'data_prevista', 'data_coleta', 'status', 'prioridade', 'responsavel', 'risco', 'observacoes'],
        'searchable' => ['codigo', 'laboratorio', 'solicitante', 'tipo_residuo', 'local_coleta', 'responsavel'],
        'rotulo' => 'Pedido de coleta', 'campoData' => 'data_solicitacao',
        'beforeInsert' => function (&$body, $bruto): void {
            $body['data_solicitacao'] ??= gmdate('Y-m-d\TH:i:s\Z');
            $body['status'] ??= 'Solicitado';
            $body['prioridade'] ??= 'Média';
            $body['unidade'] ??= 'kg';
        },
        'afterWrite' => function (string $m, array $dado, ?array $antes): void {
            if ($m === 'PUT' && $antes && ($antes['status'] ?? '') !== ($dado['status'] ?? '')) {
                db('notificacoes')->insert([
                    'tipo' => 'Status atualizado',
                    'severidade' => $dado['status'] === 'Destinado' ? 'sucesso' : 'info',
                    'titulo' => "Pedido {$dado['codigo']} → {$dado['status']}",
                    'mensagem' => "O pedido de coleta {$dado['codigo']} do laboratório {$dado['laboratorio']} "
                        . "mudou de \"{$antes['status']}\" para \"{$dado['status']}\".",
                    'origem' => 'pedidos_coleta', 'origem_id' => (string) $dado['id'],
                ])->execute();
            }
        },
    ],
    'coletas' => [
        'tabela' => 'coletas',
        'campos' => ['pedido_id', 'data_coleta', 'coletor', 'equipe', 'peso_kg', 'volume_l', 'unidades',
                     'destino_temporario', 'veiculo', 'mtr', 'observacoes'],
        'searchable' => ['coletor', 'equipe', 'mtr', 'destino_temporario', 'veiculo'],
        'rotulo' => 'Registro de coleta', 'ordenarPor' => 'data_coleta', 'campoData' => 'data_coleta',
        'temAtualizadoEm' => false,
        'beforeInsert' => function (&$body, $bruto): void {
            $body['data_coleta'] ??= gmdate('Y-m-d\TH:i:s\Z');
        },
    ],
    'tratamentos' => [
        'tabela' => 'tratamentos', 'prefixo' => 'TRT',
        'campos' => ['codigo', 'pedido_id', 'residuo', 'grupo', 'metodo', 'quantidade_entrada', 'unidade',
                     'quantidade_saida', 'eficiencia', 'data_inicio', 'data_conclusao', 'operador',
                     'responsavel_tecnico', 'destino_final', 'cnpj_destinador', 'mtr', 'certificado',
                     'custo', 'status', 'observacoes'],
        'searchable' => ['codigo', 'residuo', 'metodo', 'destino_final', 'operador', 'responsavel_tecnico'],
        'rotulo' => 'Tratamento', 'campoData' => 'data_inicio',
        'beforeInsert' => function (&$body): void {
            $body['data_inicio'] ??= gmdate('Y-m-d\TH:i:s\Z');
            $body['status'] ??= 'Agendado';
            $body['unidade'] ??= 'kg';
        },
    ],
    'solventes' => [
        'tabela' => 'solventes', 'prefixo' => 'SOL',
        'campos' => ['codigo', 'nome', 'formula', 'cas', 'categoria', 'pureza', 'volume_total_l',
                     'volume_restante_l', 'volume_recuperado_l', 'embalagem', 'laboratorio', 'localizacao',
                     'data_recebimento', 'data_validade', 'status', 'inflamavel', 'responsavel', 'observacoes'],
        'searchable' => ['codigo', 'nome', 'formula', 'cas', 'laboratorio', 'localizacao', 'categoria'],
        'rotulo' => 'Solvente', 'campoData' => 'data_recebimento',
        'beforeInsert' => function (&$body, $bruto): void {
            $body['data_recebimento'] ??= gmdate('Y-m-d\TH:i:s\Z');
            $body['status'] ??= 'Em Estoque';
            $body['categoria'] ??= 'Não Halogenado';
            if (!isset($body['volume_restante_l']) || $body['volume_restante_l'] === null) {
                $body['volume_restante_l'] = $body['volume_total_l'] ?? null;
            }
        },
        'transform' => function (array $r): array {
            $total = (float) ($r['volume_total_l'] ?? 0);
            $resto = (float) ($r['volume_restante_l'] ?? 0);
            $em30 = gmdate('Y-m-d\TH:i:s\Z', time() + 30 * 86400);
            if (!empty($r['data_validade']) && $r['data_validade'] < gmdate('Y-m-d\TH:i:s\Z')) {
                $sit = 'Vencido';
            } elseif (!empty($r['data_validade']) && $r['data_validade'] <= $em30) {
                $sit = 'A vencer';
            } elseif ($total > 0 && $resto / $total <= 0.15) {
                $sit = 'Estoque baixo';
            } elseif ($resto <= 0) {
                $sit = 'Esgotado';
            } else {
                $sit = 'Regular';
            }
            $r['situacao'] = $sit;
            return $r;
        },
    ],
    'reagentes' => [
        'tabela' => 'reagentes', 'prefixo' => 'REA',
        'campos' => ['codigo', 'nome', 'formula', 'cas', 'classe_risco', 'fabricante', 'lote', 'quantidade',
                     'unidade', 'laboratorio', 'localizacao', 'data_aquisicao', 'data_validade', 'status', 'observacoes'],
        'searchable' => ['codigo', 'nome', 'formula', 'cas', 'lote', 'laboratorio', 'fabricante', 'classe_risco'],
        'rotulo' => 'Reagente', 'campoData' => 'data_aquisicao',
        'beforeInsert' => function (&$body): void {
            $body['data_aquisicao'] ??= gmdate('Y-m-d\TH:i:s\Z');
            $body['status'] ??= 'Ativo';
        },
        'transform' => function (array $r): array {
            if (empty($r['data_validade'])) {
                $r['situacao'] = 'Sem validade';
            } else {
                $t = strtotime($r['data_validade']);
                $r['situacao'] = match (true) {
                    $t < time() => 'Vencido',
                    $t <= time() + 30 * 86400 => 'A vencer',
                    $t <= time() + 90 * 86400 => 'Atenção',
                    default => 'Válido',
                };
            }
            return $r;
        },
    ],
    'vidrarias' => [
        'tabela' => 'vidrarias', 'prefixo' => 'VID',
        'campos' => ['codigo', 'tipo', 'laboratorio', 'contaminante', 'classe_contaminante', 'nivel_contaminacao',
                     'quantidade', 'data_registro', 'data_descontaminacao', 'metodo_descontaminacao',
                     'responsavel', 'status', 'destino', 'observacoes'],
        'searchable' => ['codigo', 'tipo', 'laboratorio', 'contaminante', 'metodo_descontaminacao', 'responsavel'],
        'rotulo' => 'Vidraria', 'campoData' => 'data_registro',
        'beforeInsert' => function (&$body): void {
            $body['data_registro'] ??= gmdate('Y-m-d\TH:i:s\Z');
            $body['status'] ??= 'Aguardando Descontaminação';
            $body['nivel_contaminacao'] ??= 'Médio';
        },
    ],
    'usuarios' => [
        'tabela' => 'usuarios',
        'campos' => ['nome', 'email', 'papel', 'setor', 'crq', 'telefone', 'ativo'],
        'searchable' => ['nome', 'email', 'setor', 'papel', 'crq'],
        'rotulo' => 'Usuário', 'ordenarPor' => 'nome', 'ascendente' => true,
        'permissaoEscrita' => 'admin',
        'sanitize' => function (array $r): array {
            unset($r['senha_hash']);
            return $r;
        },
        'beforeInsert' => function (&$body, $bruto): void {
            $body['email'] = strtolower(trim((string) ($body['email'] ?? '')));
            if (!filter_var($body['email'], FILTER_VALIDATE_EMAIL)) {
                throw new LgrpErroHttp(400, 'Informe um e-mail válido.');
            }
            $body['papel'] = $body['papel'] ?? 'Técnico de Laboratório';
            if (!in_array($body['papel'], [...LGRP_PAPEIS_EDITOR, 'Consultor'], true)) {
                throw new LgrpErroHttp(400, 'Perfil inválido.');
            }
            $body['ativo'] = (int) ($body['ativo'] ?? 1);
            $senha = (string) ($bruto['senhaInicial'] ?? $bruto['senha'] ?? '');
            if (mb_strlen($senha) < 6) {
                throw new LgrpErroHttp(400, 'Defina uma senha inicial com no mínimo 6 caracteres para o novo usuário.');
            }
            $body['senha_hash'] = lgrp_hash_senha($senha);
        },
        'beforeUpdate' => function (&$body, $bruto, array $atual, array $usuario): void {
            if (isset($body['email'])) {
                $body['email'] = strtolower(trim((string) $body['email']));
                if (!filter_var($body['email'], FILTER_VALIDATE_EMAIL)) {
                    throw new LgrpErroHttp(400, 'Informe um e-mail válido.');
                }
            }
            if (!empty($body['papel']) && !in_array($body['papel'], [...LGRP_PAPEIS_EDITOR, 'Consultor'], true)) {
                throw new LgrpErroHttp(400, 'Perfil inválido.');
            }
            if (array_key_exists('ativo', $body) && $body['ativo'] !== null) {
                $body['ativo'] = (int) (bool) $body['ativo'];
            }
            // O sistema não pode ficar sem nenhum administrador ativo.
            $perdeAdmin = $atual['papel'] === 'Administrador'
                && ((!empty($body['papel']) && $body['papel'] !== 'Administrador') || (isset($body['ativo']) && !$body['ativo']));
            if ($perdeAdmin) {
                $outros = db('usuarios')->select('id')->eq('papel', 'Administrador')->eq('ativo', true)->execute()['data'];
                $outros = array_filter($outros, fn($u) => (int) $u['id'] !== (int) $atual['id']);
                if (!$outros) {
                    throw new LgrpErroHttp(400, 'Este é o único administrador ativo do sistema. '
                        . 'Promova outro usuário antes de rebaixar ou desativar esta conta.');
                }
            }
            if ((int) $atual['id'] === (int) $usuario['id']) {
                if (isset($body['ativo']) && !$body['ativo']) {
                    throw new LgrpErroHttp(400, 'Você não pode desativar a própria conta.');
                }
                if (!empty($body['papel']) && $body['papel'] !== 'Administrador') {
                    throw new LgrpErroHttp(400, 'Você não pode rebaixar o próprio perfil de administrador.');
                }
            }
            $senha = (string) ($bruto['senha'] ?? '');
            if ($senha !== '') {
                $body['senha_hash'] = lgrp_hash_senha($senha);
            } elseif (!empty($body['email']) && $body['email'] !== $atual['email']) {
                throw new LgrpErroHttp(400, 'Ao alterar o e-mail, defina também uma nova senha para o usuário.');
            }
        },
    ],
];

/* ------------------------------------------------------------------ */
/* Autenticação e demais rotas                                         */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */

try {
    if (isset($MODULOS[$recurso])) {
        lgrp_crud($MODULOS[$recurso]['tabela'], $MODULOS[$recurso]);
    }

    switch ($recurso) {
        case 'dashboard':      lgrp_rota_dashboard(); break;
        case 'indicadores':    lgrp_rota_indicadores($corpo); break;
        case 'notificacoes':   lgrp_rota_notificacoes($corpo, $get); break;
        case 'historico':      lgrp_rota_historico($get); break;
        case 'relatorios':     lgrp_rota_relatorios($get); break;
        default:
            lgrp_erro(404, 'Rota de API inexistente.');
    }
} catch (LgrpErroHttp $e) {
    lgrp_erro($e->status, $e->getMessage(), $e->codigo);
} catch (PDOException $e) {
    error_log('LGRP SQL: ' . $e->getMessage());
    if (in_array($e->getCode(), ['42S02', '42S22', '42000', '42S12', '23000'], true)) {
        lgrp_erro(500, 'O banco de dados não tem o schema esperado. Importe o lgrp_mysql.sql.', 'schema_incompleto');
    }
    lgrp_erro(500, 'Erro ao consultar o banco.', 'erro_interno');
} catch (Throwable $e) {
    error_log('LGRP: ' . $e->getMessage());
    lgrp_erro(500, $e->getMessage() ?: 'Erro interno do servidor.', 'erro_interno');
}
