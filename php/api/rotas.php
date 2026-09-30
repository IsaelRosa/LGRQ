<?php
/**
 * LGRP · rotas específicas (autenticação e consultas agregadas)
 */

declare(strict_types=1);

require_once __DIR__ . '/core.php';

function lgrp_mes(string $iso): ?array
{
    if (!$iso) {
        return null;
    }
    $t = strtotime($iso);
    if ($t === false) {
        return null;
    }
    return ['ano' => (int) gmdate('Y', $t), 'mes' => (int) gmdate('n', $t)];
}

function lgrp_nome_mes(int $m): string
{
    return ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto',
            'Setembro', 'Outubro', 'Novembro', 'Dezembro'][$m - 1];
}

/* ------------------------------------------------------------------ */
/* /api/auth                                                           */
/* ------------------------------------------------------------------ */

function lgrp_rota_auth(array $corpo): void
{
    $m = lgrp_metodo();
    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
    $rota = '/' . trim(preg_replace('#^.*?/api/auth#', '', $uri), '/');

    if ($m === 'GET') {
        if ($rota !== '/me') {
            lgrp_erro(405, 'Use /api/auth/me para consultar a sessão.');
        }
        lgrp_resposta(['usuario' => lgrp_perfil_publico(lgrp_usuario())]);
    }

    if ($m === 'POST') {
        // Ambas terminam em lgrp_resposta/lgrp_erro, que encerram o script.
        $rota === '/register' ? lgrp_auth_registro($corpo) : lgrp_auth_login($corpo);
        return;
    }

    if ($m === 'PUT') {
        if ($rota !== '/senha') {
            lgrp_erro(405, 'Use /api/auth/senha para trocar a senha.');
        }
        $u = lgrp_usuario();
        if (!lgrp_verificar_senha((string) ($corpo['senhaAtual'] ?? ''), $u['senha_hash'])) {
            throw new LgrpErroHttp(401, 'Senha atual incorreta.', 'senha_incorreta');
        }
        $nova = lgrp_hash_senha((string) ($corpo['novaSenha'] ?? ''));
        db('usuarios')->update(['senha_hash' => $nova])->eq('id', $u['id'])->execute();
        lgrp_resposta(['ok' => true]);
    }

    if ($m === 'DELETE') {
        // JWT é sem estado: o descarte da sessão acontece no cliente.
        lgrp_resposta(['ok' => true]);
    }

    lgrp_erro(405, 'Método não permitido');
}

function lgrp_emitir_sessao(array $usuario): array
{
    return [
        'token' => lgrp_assinar_token(
            ['sub' => (int) $usuario['id'], 'email' => $usuario['email'], 'papel' => $usuario['papel']],
            lgrp_duracao(config('JWT_EXPIRES_IN', '12h') ?? '12h')
        ),
        'usuario' => lgrp_perfil_publico($usuario),
    ];
}

function lgrp_auth_login(array $corpo): void
{
    lgrp_exigir_rate_limit('login');
    $email = strtolower(trim((string) ($corpo['email'] ?? '')));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new LgrpErroHttp(400, 'Informe um endereço de e-mail válido.');
    }
    $senha = (string) ($corpo['senha'] ?? '');
    if ($senha === '') {
        throw new LgrpErroHttp(400, 'Informe a senha.');
    }
    $r = db('usuarios')->select(LGRP_SELECT_USUARIO)->eq('email', $email)->limit(1)->execute();
    $u = $r['data'][0] ?? null;
    $confere = lgrp_verificar_senha($senha, $u['senha_hash'] ?? '');
    if (!$u || !$confere) {
        throw new LgrpErroHttp(401, 'E-mail ou senha inválidos. Verifique os dados e tente novamente.', 'credenciais');
    }
    if (!$u['ativo']) {
        throw new LgrpErroHttp(403, 'Seu usuário está inativo. Procure o administrador do LGRP.', 'usuario_inativo');
    }
    lgrp_limpar_rate_limit('login');
    lgrp_resposta(lgrp_emitir_sessao($u));
}

function lgrp_auth_registro(array $corpo): void
{
    lgrp_exigir_rate_limit('register');
    $nome = trim((string) ($corpo['nome'] ?? ''));
    $email = strtolower(trim((string) ($corpo['email'] ?? '')));
    $senha = (string) ($corpo['senha'] ?? '');

    if (mb_strlen($nome) < 3) {
        throw new LgrpErroHttp(400, 'Informe o nome completo.');
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new LgrpErroHttp(400, 'Informe um endereço de e-mail válido.');
    }
    if (mb_strlen($senha) < 6) {
        throw new LgrpErroHttp(400, 'A senha deve ter no mínimo 6 caracteres.');
    }

    $total = (int) (db('usuarios')->select('id')->limit(1)->execute()['data'][0]['id'] ?? 0);
    $temAlguem = (bool) db('usuarios')->select('id')->limit(1)->execute()['data'];
    $papel = $temAlguem ? 'Consultor' : 'Administrador';
    $setor = $temAlguem ? null : 'Laboratório de Gestão de Resíduos Perigosos';

    if (db('usuarios')->select('id')->eq('email', $email)->limit(1)->execute()['data']) {
        throw new LgrpErroHttp(409, 'Este e-mail já está cadastrado. Faça login.', 'email_em_uso');
    }

    $dado = db('usuarios')->insert([
        'nome' => $nome, 'email' => $email, 'papel' => $papel, 'setor' => $setor,
        'ativo' => 1, 'senha_hash' => lgrp_hash_senha($senha),
    ])->select(LGRP_SELECT_USUARIO)->single()->execute()['data'];

    lgrp_registrar_historico([
        'tabela' => 'usuarios', 'registroId' => $dado['id'], 'codigo' => $dado['nome'],
        'acao' => 'INSERT', 'descricao' => "Usuário cadastrado: {$dado['nome']} ({$dado['papel']})",
        'usuario' => ['nome' => $dado['nome'], 'email' => $dado['email']], 'antes' => null,
        'depois' => ['nome' => $dado['nome'], 'email' => $dado['email'], 'papel' => $dado['papel']],
    ]);
    lgrp_limpar_rate_limit('register');

    lgrp_resposta(lgrp_emitir_sessao($dado) + [
        'aviso' => !$temAlguem
            ? 'Este é o primeiro usuário do sistema: perfil de Administrador atribuído automaticamente.'
            : 'Cadastro realizado. Um administrador deverá liberar suas permissões de edição.',
    ], 201);
}

/* ------------------------------------------------------------------ */
/* /api/dashboard                                                      */
/* ------------------------------------------------------------------ */

function lgrp_rota_dashboard(): void
{
    if (lgrp_metodo() !== 'GET') {
        lgrp_erro(405, 'Método não permitido');
    }
    lgrp_usuario();
    lgrp_gerar_alertas();

    $pedidos = db('pedidos_coleta')->select('*')->limit(3000)->execute()['data'];
    $coletas = db('coletas')->select('*')->limit(3000)->execute()['data'];
    $trat = db('tratamentos')->select('*')->limit(3000)->execute()['data'];
    $solv = db('solventes')->select('*')->limit(3000)->execute()['data'];
    $reag = db('reagentes')->select('*')->limit(3000)->execute()['data'];
    $vid = db('vidrarias')->select('*')->limit(3000)->execute()['data'];
    $notif = db('notificacoes')->select('*')->eq('lida', false)
        ->order('criado_em', ['ascending' => false])->limit(50)->execute()['data'];
    $hist = db('historico')->select('*')->order('criado_em', ['ascending' => false])->limit(12)->execute()['data'];

    $n = fn($v): float => is_numeric($v) ? (float) $v : 0.0;
    $agora = time();
    $em30 = $agora + 30 * 86400;

    $r2 = fn(float $v): float => round($v * 10) / 10;
    $r2d = fn(float $v): float => round($v * 100) / 100;

    $destinados = count(array_filter($pedidos, fn($p) => $p['status'] === 'Destinado'));
    $encerrados = count(array_filter($pedidos, fn($p) => in_array($p['status'], ['Destinado', 'Cancelado'], true)));

    $vencidos = array_values(array_filter($reag, fn($r) => !empty($r['data_validade']) && strtotime($r['data_validade']) < $agora));
    $aVencer = array_values(array_filter($reag, function ($r) use ($agora, $em30) {
        $t = strtotime($r['data_validade'] ?? '');
        return $t >= $agora && $t <= $em30;
    }));
    $halogenados = array_values(array_filter($solv, fn($s) => str_contains($s['categoria'] ?? '', 'Halogenado')
        && !str_contains($s['categoria'] ?? '', 'Não')));

    $kpis = [
        'total_pedidos' => count($pedidos),
        'pedidos_abertos' => count(array_filter($pedidos, fn($p) => in_array($p['status'], ['Solicitado', 'Agendado'], true))),
        'pedidos_em_tratamento' => count(array_filter($pedidos, fn($p) => $p['status'] === 'Em Tratamento')),
        'pedidos_destinados' => $destinados,
        'coletas_realizadas' => count($coletas),
        'kg_coletados' => $r2(array_sum(array_map(fn($c) => $n($c['peso_kg']), $coletas))),
        'l_coletados' => $r2(array_sum(array_map(fn($c) => $n($c['volume_l']), $coletas))),
        'kg_tratados' => $r2(array_sum(array_map(fn($t) => $n($t['quantidade_entrada']),
            array_filter($trat, fn($t) => $t['status'] === 'Concluído' && ($t['unidade'] ?? 'kg') === 'kg')))),
        'l_tratados' => $r2(array_sum(array_map(fn($t) => $n($t['quantidade_entrada']),
            array_filter($trat, fn($t) => $t['status'] === 'Concluído' && $t['unidade'] === 'L')))),
        'l_recuperados' => $r2(array_sum(array_map(fn($t) => $n($t['quantidade_saida']),
            array_filter($trat, fn($t) => $t['status'] === 'Concluído' && str_contains($t['metodo'] ?? '', 'Destila'))))),
        'tratamentos_total' => count($trat),
        'tratamentos_concluidos' => count(array_filter($trat, fn($t) => $t['status'] === 'Concluído')),
        'tratamentos_andamento' => count(array_filter($trat, fn($t) => $t['status'] === 'Em Andamento')),
        'reagentes_total' => count($reag),
        'reagentes_vencidos' => count($vencidos),
        'reagentes_a_vencer' => count($aVencer),
        'solventes_total' => count($solv),
        'solventes_litros_estoque' => $r2(array_sum(array_map(fn($s) => $n($s['volume_restante_l']), $solv))),
        'solventes_litros_total' => $r2(array_sum(array_map(fn($s) => $n($s['volume_total_l']), $solv))),
        'solventes_halogenados' => count($halogenados),
        'solventes_halogenados_litros' => $r2(array_sum(array_map(fn($s) => $n($s['volume_restante_l']), $halogenados))),
        'solventes_recuperados_l' => $r2(array_sum(array_map(fn($s) => $n($s['volume_recuperado_l']), $solv))),
        'vidrarias_total' => count($vid),
        'vidrarias_pendentes' => count(array_filter($vid, fn($v) => in_array($v['status'], ['Aguardando Descontaminação', 'Em Descontaminação'], true))),
        'vidrarias_unidades_pendentes' => array_sum(array_map(
            fn($v) => (int) $n($v['quantidade']),
            array_filter($vid, fn($v) => in_array($v['status'], ['Aguardando Descontaminação', 'Em Descontaminação'], true)))),
        'vidrarias_descontaminadas' => count(array_filter($vid, fn($v) => in_array($v['status'], ['Descontaminada', 'Reaproveitada'], true))),
        'taxa_destinacao' => $encerrados ? round($destinados / $encerrados * 1000) / 10 : 0,
        'custo_total' => $r2d(array_sum(array_map(fn($t) => $n($t['custo']), $trat))),
        'alertas_abertos' => count($notif),
        'alertas_criticos' => count(array_filter($notif, fn($x) => $x['severidade'] === 'critica')),
    ];

    $meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    $serie = [];
    for ($i = 11; $i >= 0; $i--) {
        $dt = new DateTimeImmutable('first day of -' . $i . ' month', new DateTimeZone('UTC'));
        $serie[(int) $dt->format('Y') . '-' . (int) $dt->format('n')] = [
            'ano' => (int) $dt->format('Y'), 'mes' => (int) $dt->format('n'),
            'rotulo' => $meses[(int) $dt->format('n') - 1] . '/' . substr($dt->format('Y'), 2),
            'pedidos' => 0, 'coletas' => 0, 'kg_coletados' => 0.0, 'l_coletados' => 0.0,
            'kg_tratados' => 0.0, 'l_recuperados' => 0.0, 'custo' => 0.0,
        ];
    }
    foreach ($pedidos as $p) {
        $k = lgrp_mes($p['data_solicitacao'] ?? '');
        if ($k && isset($serie["{$k['ano']}-{$k['mes']}"])) {
            $serie["{$k['ano']}-{$k['mes']}"]['pedidos']++;
        }
    }
    foreach ($coletas as $c) {
        $k = lgrp_mes($c['data_coleta'] ?? '');
        if ($k && isset($serie["{$k['ano']}-{$k['mes']}"])) {
            $s = &$serie["{$k['ano']}-{$k['mes']}"];
            $s['coletas']++;
            $s['kg_coletados'] += $n($c['peso_kg']);
            $s['l_coletados'] += $n($c['volume_l']);
            unset($s);
        }
    }
    foreach ($trat as $t) {
        if ($t['status'] !== 'Concluído') {
            continue;
        }
        $k = lgrp_mes($t['data_conclusao'] ?? $t['data_inicio'] ?? '');
        if ($k && isset($serie["{$k['ano']}-{$k['mes']}"])) {
            $s = &$serie["{$k['ano']}-{$k['mes']}"];
            if (($t['unidade'] ?? 'kg') === 'kg') {
                $s['kg_tratados'] += $n($t['quantidade_entrada']);
            }
            if (str_contains($t['metodo'] ?? '', 'Destila')) {
                $s['l_recuperados'] += $n($t['quantidade_saida']);
            }
            $s['custo'] += $n($t['custo']);
            unset($s);
        }
    }
    foreach ($serie as &$s) {
        $s['kg_coletados'] = $r2($s['kg_coletados']);
        $s['l_coletados'] = $r2($s['l_coletados']);
        $s['kg_tratados'] = $r2($s['kg_tratados']);
        $s['l_recuperados'] = $r2($s['l_recuperados']);
        $s['custo'] = (int) round($s['custo']);
    }
    unset($s);

    $agrupar = function (array $lista, callable $chave, callable $valor): array {
        $m = [];
        foreach ($lista as $item) {
            $k = $chave($item);
            if (!$k) {
                continue;
            }
            $m[$k] = ($m[$k] ?? 0) + $valor($item);
        }
        $saida = array_map(fn($k, $v) => ['nome' => $k, 'valor' => round($v * 100) / 100], array_keys($m), $m);
        usort($saida, fn($a, $b) => $b['valor'] <=> $a['valor']);
        return $saida;
    };
    $somaQtd = fn($p) => $n($p['quantidade_estimada']) ?: 1;
    $porPedido = fn(array $p) => $p['id'];
    $labPorPedido = [];
    foreach ($pedidos as $p) {
        $labPorPedido[(int) $p['id']] = $p['laboratorio'];
    }

    lgrp_resposta([
        'kpis' => $kpis,
        'serie' => array_values($serie),
        'graficos' => [
            'porTipo' => $agrupar($pedidos, fn($p) => $p['tipo_residuo'], $somaQtd),
            'pedidosPorTipo' => $agrupar($pedidos, fn($p) => $p['tipo_residuo'], $somaQtd),
            'pedidosPorStatus' => $agrupar($pedidos, fn($p) => $p['status'], fn($p) => 1),
            'pedidosPorClasse' => $agrupar($pedidos, fn($p) => $p['classe'], $somaQtd),
            'porLaboratorio' => array_slice($agrupar($pedidos, fn($p) => $p['laboratorio'], $somaQtd), 0, 8),
            'coletasPorLaboratorio' => array_slice($agrupar($coletas,
                fn($c) => $labPorPedido[(int) ($c['pedido_id'] ?? 0)] ?? 'Não vinculado',
                fn($c) => $n($c['peso_kg'])), 0, 8),
            'porMetodo' => $agrupar($trat, fn($t) => $t['metodo'], fn($t) => $n($t['quantidade_entrada'])),
            'tratamentosPorStatus' => $agrupar($trat, fn($t) => $t['status'], fn($t) => 1),
            'reagentesPorRisco' => $agrupar($reag, fn($r) => $r['classe_risco'], fn($r) => 1),
            'solventesPorCategoria' => $agrupar($solv, fn($s) => $s['categoria'], fn($s) => $n($s['volume_restante_l'])),
            'vidrariasPorStatus' => $agrupar($vid, fn($v) => $v['status'], fn($v) => 1),
        ],
        'alertas' => $notif,
        'atividade' => $hist,
        'gerado_em' => gmdate('Y-m-d\TH:i:s\Z'),
    ]);
}

/* ------------------------------------------------------------------ */
/* /api/indicadores                                                    */
/* ------------------------------------------------------------------ */

function lgrp_rota_indicadores(array $corpo): void
{
    $m = lgrp_metodo();
    $usuario = lgrp_usuario();

    if ($m === 'GET') {
        $ano = (int) ($_GET['ano'] ?? date('Y'));
        $arm = [];
        foreach (db('indicadores_mensais')->select('*')->eq('ano', $ano)->limit(24)->execute()['data'] as $a) {
            $arm[(int) $a['mes']] = $a;
        }
        $pedidos = db('pedidos_coleta')->select('*')->limit(5000)->execute()['data'];
        $coletas = db('coletas')->select('*')->limit(5000)->execute()['data'];
        $trat = db('tratamentos')->select('*')->limit(5000)->execute()['data'];
        $reag = db('reagentes')->select('*')->limit(5000)->execute()['data'];
        $vid = db('vidrarias')->select('*')->limit(5000)->execute()['data'];
        $labPorPedido = [];
        foreach ($pedidos as $p) {
            $labPorPedido[(int) $p['id']] = $p;
        }
        $n = fn($v): float => is_numeric($v) ? (float) $v : 0.0;
        $r2 = fn(float $v): float => round($v * 10) / 10;

        $meses = [];
        for ($mes = 1; $mes <= 12; $mes++) {
            $base = [
                'id' => $arm[$mes]['id'] ?? null, 'mes' => $mes, 'ano' => $ano,
                'nome' => lgrp_nome_mes($mes), 'rotulo' => substr(lgrp_nome_mes($mes), 0, 3) . "/$ano",
                'pedidos_recebidos' => 0, 'coletas_realizadas' => 0, 'residuos_coletados_kg' => 0.0,
                'residuos_coletados_l' => 0.0, 'residuos_tratados_kg' => 0.0, 'solventes_recuperados_l' => 0.0,
                'reagentes_vencidos' => 0, 'vidrarias_descontaminadas' => 0, 'destinados' => 0,
                'coletas_vinculadas' => 0,
            ];
            foreach ($pedidos as $p) {
                $k = lgrp_mes($p['data_solicitacao'] ?? '');
                if ($k && $k['ano'] === $ano && $k['mes'] === $mes) {
                    $base['pedidos_recebidos']++;
                }
            }
            foreach ($coletas as $c) {
                $k = lgrp_mes($c['data_coleta'] ?? '');
                if (!$k || $k['ano'] !== $ano || $k['mes'] !== $mes) {
                    continue;
                }
                $base['coletas_realizadas']++;
                $base['residuos_coletados_kg'] += $n($c['peso_kg']);
                $base['residuos_coletados_l'] += $n($c['volume_l']);
                $ped = $labPorPedido[(int) ($c['pedido_id'] ?? 0)] ?? null;
                if ($ped) {
                    $base['coletas_vinculadas']++;
                    if ($ped['status'] === 'Destinado') {
                        $base['destinados']++;
                    }
                }
            }
            foreach ($trat as $t) {
                if ($t['status'] !== 'Concluído') {
                    continue;
                }
                $k = lgrp_mes($t['data_conclusao'] ?? $t['data_inicio'] ?? '');
                if (!$k || $k['ano'] !== $ano || $k['mes'] !== $mes) {
                    continue;
                }
                if (($t['unidade'] ?? 'kg') === 'kg') {
                    $base['residuos_tratados_kg'] += $n($t['quantidade_entrada']);
                }
                if (str_contains($t['metodo'] ?? '', 'Destila')) {
                    $base['solventes_recuperados_l'] += $n($t['quantidade_saida']);
                }
                $base['custo_total'] = ($base['custo_total'] ?? 0) + $n($t['custo']);
            }
            foreach ($reag as $r) {
                $k = lgrp_mes($r['data_validade'] ?? '');
                if ($k && $k['ano'] === $ano && $k['mes'] === $mes && strtotime($r['data_validade']) < time()) {
                    $base['reagentes_vencidos']++;
                }
            }
            foreach ($vid as $v) {
                $k = lgrp_mes($v['data_descontaminacao'] ?? '');
                if ($k && $k['ano'] === $ano && $k['mes'] === $mes
                    && in_array($v['status'], ['Descontaminada', 'Reaproveitada'], true)) {
                    $base['vidrarias_descontaminadas'] += (int) $n($v['quantidade']) ?: 1;
                }
            }
            $a = $arm[$mes] ?? [];
            $pct = $a['destinacao_correta_pct'] ?? null;
            $auto = $base['coletas_vinculadas'] ? round($base['destinados'] / $base['coletas_vinculadas'] * 1000) / 10 : 0;
            $meses[] = [
                'id' => $a['id'] ?? null, 'mes' => $mes, 'ano' => $ano,
                'nome' => $base['nome'], 'rotulo' => $base['rotulo'],
                'pedidos_recebidos' => $base['pedidos_recebidos'],
                'coletas_realizadas' => $base['coletas_realizadas'],
                'residuos_coletados_kg' => $r2($base['residuos_coletados_kg']),
                'residuos_coletados_l' => $r2($base['residuos_coletados_l']),
                'residuos_tratados_kg' => $r2($base['residuos_tratados_kg']),
                'solventes_recuperados_l' => $r2($base['solventes_recuperados_l']),
                'reagentes_vencidos' => $base['reagentes_vencidos'],
                'vidrarias_descontaminadas' => $base['vidrarias_descontaminadas'],
                'destinacao_correta_pct' => $pct !== null ? (float) $pct : $auto,
                'custo_total' => round(($base['custo_total'] ?? 0) + (float) ($a['custo_operacional'] ?? 0), 2),
                'acidentes' => (int) ($a['acidentes'] ?? 0),
                'treinamentos' => (int) ($a['treinamentos'] ?? 0),
                'custo_operacional' => (float) ($a['custo_operacional'] ?? 0),
                'observacoes' => $a['observacoes'] ?? '',
            ];
        }
        $total = [];
        foreach ($meses[0] as $chave => $v) {
            if (!is_numeric($v)) {
                continue;
            }
            $total[$chave] = round(array_sum(array_map(fn($x) => (float) $x[$chave], $meses)), 1);
        }
        lgrp_resposta(['ano' => $ano, 'meses' => $meses, 'total' => $total]);
    }

    if ($m === 'PUT' || $m === 'POST') {
        lgrp_exigir_edicao($usuario);
        if (empty($corpo['mes']) || empty($corpo['ano'])) {
            lgrp_erro(400, 'Informe mês e ano.');
        }
        $payload = [
            'mes' => (int) $corpo['mes'], 'ano' => (int) $corpo['ano'],
            'acidentes' => (int) ($corpo['acidentes'] ?? 0),
            'treinamentos' => (int) ($corpo['treinamentos'] ?? 0),
            'custo_operacional' => (float) ($corpo['custo_operacional'] ?? 0),
            'destinacao_correta_pct' => ($corpo['destinacao_correta_pct'] ?? '') === '' ? null
                : (float) $corpo['destinacao_correta_pct'],
            'observacoes' => (string) ($corpo['observacoes'] ?? ''),
        ];
        $existente = db('indicadores_mensais')->select('*')
            ->eq('mes', $payload['mes'])->eq('ano', $payload['ano'])->limit(1)->execute()['data'][0] ?? null;

        if ($existente) {
            $payload['atualizado_em'] = gmdate('Y-m-d\TH:i:s.v\Z');
            $salvo = db('indicadores_mensais')->update($payload)->eq('id', $existente['id'])
                ->select('*')->single()->execute()['data'];
            lgrp_registrar_historico([
                'tabela' => 'indicadores_mensais', 'registroId' => $salvo['id'],
                'codigo' => lgrp_nome_mes($payload['mes']) . "/{$payload['ano']}",
                'acao' => 'UPDATE',
                'descricao' => 'Indicadores de ' . lgrp_nome_mes($payload['mes']) . "/{$payload['ano']} atualizados",
                'usuario' => $usuario, 'antes' => $existente, 'depois' => $salvo,
            ]);
        } else {
            $salvo = db('indicadores_mensais')->insert($payload)
                ->select('*')->single()->execute()['data'];
            lgrp_registrar_historico([
                'tabela' => 'indicadores_mensais', 'registroId' => $salvo['id'],
                'codigo' => lgrp_nome_mes($payload['mes']) . "/{$payload['ano']}",
                'acao' => 'INSERT',
                'descricao' => 'Indicadores de ' . lgrp_nome_mes($payload['mes']) . "/{$payload['ano']} registrados",
                'usuario' => $usuario, 'antes' => null, 'depois' => $salvo,
            ]);
        }
        lgrp_resposta($salvo);
    }

    lgrp_erro(405, 'Método não permitido');
}

/* ------------------------------------------------------------------ */
/* /api/notificacoes                                                   */
/* ------------------------------------------------------------------ */

function lgrp_rota_notificacoes(array $corpo, array $get): void
{
    $m = lgrp_metodo();
    $usuario = lgrp_usuario();
    if ($m !== 'GET') {
        lgrp_exigir_edicao($usuario);
    }

    if ($m === 'GET') {
        lgrp_gerar_alertas();
        $q = db('notificacoes')->select('*');
        if (($get['lida'] ?? '') === 'true') {
            $q = $q->eq('lida', 1);
        }
        if (($get['lida'] ?? '') === 'false') {
            $q = $q->eq('lida', 0);
        }
        if (!empty($get['severidade']) && $get['severidade'] !== 'todos') {
            $q = $q->eq('severidade', $get['severidade']);
        }
        if (!empty($get['tipo']) && $get['tipo'] !== 'todos') {
            $q = $q->eq('tipo', $get['tipo']);
        }
        lgrp_resposta($q->order('criado_em', ['ascending' => false])->limit(300)->execute()['data']);
    }

    if ($m === 'POST') {
        if (empty($corpo['titulo'])) {
            lgrp_erro(400, 'Título é obrigatório.');
        }
        $dado = db('notificacoes')->insert([
            'titulo' => $corpo['titulo'],
            'mensagem' => $corpo['mensagem'] ?? null,
            'severidade' => $corpo['severidade'] ?? 'info',
            'tipo' => $corpo['tipo'] ?? 'Aviso',
            'origem' => $corpo['origem'] ?? null,
            'origem_id' => $corpo['origem_id'] ?? null,
        ])->select('*')->single()->execute()['data'];
        lgrp_resposta($dado, 201);
    }

    if ($m === 'PUT') {
        $lida = $corpo['lida'] ?? false;
        if (!empty($corpo['todas'])) {
            $dados = db('notificacoes')->update(['lida' => $lida === false ? 0 : 1])
                ->eq('lida', $lida === false ? 1 : 0)->select('*')->execute()['data'];
            lgrp_resposta($dados);
        }
        if (empty($corpo['id'])) {
            lgrp_erro(400, 'Campo "id" é obrigatório.');
        }
        $dado = db('notificacoes')->update(['lida' => $lida ? 1 : 0])->eq('id', $corpo['id'])
            ->select('*')->single()->execute()['data'];
        lgrp_resposta($dado);
    }

    if ($m === 'DELETE') {
        if (!empty($corpo['todasLidas'])) {
            db('notificacoes')->delete()->eq('lida', 1)->execute();
            lgrp_resposta(['ok' => true]);
        }
        if (empty($corpo['id'])) {
            lgrp_erro(400, 'Campo "id" é obrigatório.');
        }
        db('notificacoes')->delete()->eq('id', $corpo['id'])->execute();
        lgrp_resposta(['ok' => true]);
    }

    lgrp_erro(405, 'Método não permitido');
}

/* ------------------------------------------------------------------ */
/* /api/historico                                                      */
/* ------------------------------------------------------------------ */

function lgrp_rota_historico(array $get): void
{
    if (lgrp_metodo() !== 'GET') {
        lgrp_erro(405, 'Método não permitido');
    }
    lgrp_usuario();

    $rotulos = [
        'pedidos_coleta' => 'Pedidos de Coleta', 'coletas' => 'Coletas', 'tratamentos' => 'Tratamentos',
        'solventes' => 'Solventes', 'reagentes' => 'Reagentes', 'vidrarias' => 'Vidrarias',
        'indicadores_mensais' => 'Indicadores Mensais', 'usuarios' => 'Usuários', 'notificacoes' => 'Notificações',
    ];
    $q = db('historico')->select('*');
    if (!empty($get['tabela']) && $get['tabela'] !== 'todos') {
        $q = $q->eq('tabela', $get['tabela']);
    }
    if (!empty($get['acao']) && $get['acao'] !== 'todos') {
        $q = $q->eq('acao', $get['acao']);
    }
    if (!empty($get['usuario']) && $get['usuario'] !== 'todos') {
        $q = $q->eq('usuario', $get['usuario']);
    }
    if (!empty($get['registro_id'])) {
        $q = $q->eq('registro_id', (string) $get['registro_id']);
    }
    if (!empty($get['de'])) {
        $q = $q->gte('criado_em', $get['de']);
    }
    if (!empty($get['ate'])) {
        $ate = (string) $get['ate'];
        $q = $q->lte('criado_em', strlen($ate) === 10 ? $ate . 'T23:59:59.999Z' : $ate);
    }
    if (!empty($get['busca'])) {
        $expr = lgrp_filtro_busca(['descricao', 'registro_codigo', 'usuario'], (string) $get['busca']);
        if ($expr !== null) {
            $q = $q->or($expr);
        }
    }
    $limite = min((int) ($get['limit'] ?? 200) ?: 200, 1000);
    $itens = $q->order('criado_em', ['ascending' => false])->limit($limite)->execute()['data'];
    foreach ($itens as &$h) {
        $h['modulo'] = $rotulos[$h['tabela']] ?? $h['tabela'];
    }
    unset($h);

    $nomes = array_column(
        db('usuarios')->select('nome')->order('nome', ['ascending' => true])->execute()['data'],
        'nome'
    );
    lgrp_resposta([
        'itens' => $itens,
        'tabelas' => array_map(fn($k) => ['valor' => $k, 'rotulo' => $rotulos[$k]], array_keys($rotulos)),
        'usuarios' => $nomes,
    ]);
}

/* ------------------------------------------------------------------ */
/* /api/relatorios                                                     */
/* ------------------------------------------------------------------ */

function lgrp_relatorios_modulos(): array
{
    return [
        'pedidos_coleta' => [
            'rotulo' => 'Pedidos de Coleta', 'campoData' => 'data_solicitacao',
            'colunas' => [
                ['key' => 'codigo', 'label' => 'Código', 'tipo' => 'texto'],
                ['key' => 'laboratorio', 'label' => 'Laboratório / Setor', 'tipo' => 'texto'],
                ['key' => 'solicitante', 'label' => 'Solicitante', 'tipo' => 'texto'],
                ['key' => 'tipo_residuo', 'label' => 'Tipo de Resíduo', 'tipo' => 'texto'],
                ['key' => 'grupo', 'label' => 'Grupo', 'tipo' => 'texto'],
                ['key' => 'classe', 'label' => 'Classe', 'tipo' => 'texto'],
                ['key' => 'quantidade_estimada', 'label' => 'Quantidade', 'tipo' => 'numero'],
                ['key' => 'unidade', 'label' => 'Unidade', 'tipo' => 'texto'],
                ['key' => 'embalagem', 'label' => 'Embalagem', 'tipo' => 'texto'],
                ['key' => 'local_coleta', 'label' => 'Local de Coleta', 'tipo' => 'texto'],
                ['key' => 'data_solicitacao', 'label' => 'Data da Solicitação', 'tipo' => 'data'],
                ['key' => 'data_prevista', 'label' => 'Data Prevista', 'tipo' => 'data'],
                ['key' => 'data_coleta', 'label' => 'Data da Coleta', 'tipo' => 'data'],
                ['key' => 'status', 'label' => 'Status', 'tipo' => 'texto'],
                ['key' => 'prioridade', 'label' => 'Prioridade', 'tipo' => 'texto'],
                ['key' => 'responsavel', 'label' => 'Responsável', 'tipo' => 'texto'],
                ['key' => 'risco', 'label' => 'Risco Associado', 'tipo' => 'texto'],
            ],
            'agrupaveis' => ['laboratorio', 'tipo_residuo', 'classe', 'status', 'prioridade', 'grupo'],
            'numericos' => ['quantidade_estimada'],
        ],
        'coletas' => [
            'rotulo' => 'Registros de Coleta', 'campoData' => 'data_coleta',
            'colunas' => [
                ['key' => 'id', 'label' => 'Nº', 'tipo' => 'numero'],
                ['key' => 'pedido_codigo', 'label' => 'Pedido', 'tipo' => 'texto'],
                ['key' => 'laboratorio', 'label' => 'Laboratório', 'tipo' => 'texto'],
                ['key' => 'data_coleta', 'label' => 'Data da Coleta', 'tipo' => 'data'],
                ['key' => 'coletor', 'label' => 'Coletor', 'tipo' => 'texto'],
                ['key' => 'equipe', 'label' => 'Equipe', 'tipo' => 'texto'],
                ['key' => 'peso_kg', 'label' => 'Peso (kg)', 'tipo' => 'numero'],
                ['key' => 'volume_l', 'label' => 'Volume (L)', 'tipo' => 'numero'],
                ['key' => 'unidades', 'label' => 'Unidades', 'tipo' => 'numero'],
                ['key' => 'destino_temporario', 'label' => 'Destino Temporário', 'tipo' => 'texto'],
                ['key' => 'mtr', 'label' => 'MTR', 'tipo' => 'texto'],
                ['key' => 'veiculo', 'label' => 'Veículo', 'tipo' => 'texto'],
            ],
            'agrupaveis' => ['laboratorio', 'coletor', 'destino_temporario'],
            'numericos' => ['peso_kg', 'volume_l', 'unidades'],
        ],
        'tratamentos' => [
            'rotulo' => 'Tratamentos e Destinação', 'campoData' => 'data_inicio',
            'colunas' => [
                ['key' => 'codigo', 'label' => 'Código', 'tipo' => 'texto'],
                ['key' => 'residuo', 'label' => 'Resíduo', 'tipo' => 'texto'],
                ['key' => 'grupo', 'label' => 'Grupo', 'tipo' => 'texto'],
                ['key' => 'metodo', 'label' => 'Método', 'tipo' => 'texto'],
                ['key' => 'quantidade_entrada', 'label' => 'Qtd. Entrada', 'tipo' => 'numero'],
                ['key' => 'unidade', 'label' => 'Unidade', 'tipo' => 'texto'],
                ['key' => 'quantidade_saida', 'label' => 'Qtd. Saída', 'tipo' => 'numero'],
                ['key' => 'eficiencia', 'label' => 'Eficiência (%)', 'tipo' => 'numero'],
                ['key' => 'data_inicio', 'label' => 'Início', 'tipo' => 'data'],
                ['key' => 'data_conclusao', 'label' => 'Conclusão', 'tipo' => 'data'],
                ['key' => 'operador', 'label' => 'Operador', 'tipo' => 'texto'],
                ['key' => 'destino_final', 'label' => 'Destino Final', 'tipo' => 'texto'],
                ['key' => 'mtr', 'label' => 'MTR', 'tipo' => 'texto'],
                ['key' => 'certificado', 'label' => 'Certificado (CDF)', 'tipo' => 'texto'],
                ['key' => 'custo', 'label' => 'Custo (R$)', 'tipo' => 'numero'],
                ['key' => 'status', 'label' => 'Status', 'tipo' => 'texto'],
            ],
            'agrupaveis' => ['metodo', 'status', 'destino_final', 'grupo', 'operador'],
            'numericos' => ['quantidade_entrada', 'quantidade_saida', 'custo'],
        ],
        'solventes' => [
            'rotulo' => 'Controle de Solventes', 'campoData' => 'data_recebimento',
            'colunas' => [
                ['key' => 'codigo', 'label' => 'Código', 'tipo' => 'texto'],
                ['key' => 'nome', 'label' => 'Solvente', 'tipo' => 'texto'],
                ['key' => 'formula', 'label' => 'Fórmula', 'tipo' => 'texto'],
                ['key' => 'cas', 'label' => 'CAS', 'tipo' => 'texto'],
                ['key' => 'categoria', 'label' => 'Categoria', 'tipo' => 'texto'],
                ['key' => 'pureza', 'label' => 'Pureza (%)', 'tipo' => 'numero'],
                ['key' => 'volume_total_l', 'label' => 'Volume Total (L)', 'tipo' => 'numero'],
                ['key' => 'volume_restante_l', 'label' => 'Volume Restante (L)', 'tipo' => 'numero'],
                ['key' => 'volume_recuperado_l', 'label' => 'Volume Recuperado (L)', 'tipo' => 'numero'],
                ['key' => 'laboratorio', 'label' => 'Laboratório', 'tipo' => 'texto'],
                ['key' => 'localizacao', 'label' => 'Localização', 'tipo' => 'texto'],
                ['key' => 'data_validade', 'label' => 'Validade', 'tipo' => 'data'],
                ['key' => 'status', 'label' => 'Status', 'tipo' => 'texto'],
            ],
            'agrupaveis' => ['categoria', 'laboratorio', 'status'],
            'numericos' => ['volume_total_l', 'volume_restante_l', 'volume_recuperado_l'],
        ],
        'reagentes' => [
            'rotulo' => 'Banco de Reagentes', 'campoData' => 'data_aquisicao',
            'colunas' => [
                ['key' => 'codigo', 'label' => 'Código', 'tipo' => 'texto'],
                ['key' => 'nome', 'label' => 'Reagente', 'tipo' => 'texto'],
                ['key' => 'formula', 'label' => 'Fórmula', 'tipo' => 'texto'],
                ['key' => 'cas', 'label' => 'CAS', 'tipo' => 'texto'],
                ['key' => 'fabricante', 'label' => 'Fabricante', 'tipo' => 'texto'],
                ['key' => 'lote', 'label' => 'Lote', 'tipo' => 'texto'],
                ['key' => 'quantidade', 'label' => 'Quantidade', 'tipo' => 'numero'],
                ['key' => 'unidade', 'label' => 'Unidade', 'tipo' => 'texto'],
                ['key' => 'classe_risco', 'label' => 'Classe de Risco', 'tipo' => 'texto'],
                ['key' => 'laboratorio', 'label' => 'Laboratório', 'tipo' => 'texto'],
                ['key' => 'localizacao', 'label' => 'Localização', 'tipo' => 'texto'],
                ['key' => 'data_validade', 'label' => 'Validade', 'tipo' => 'data'],
                ['key' => 'situacao_validade', 'label' => 'Situação', 'tipo' => 'texto'],
                ['key' => 'status', 'label' => 'Status', 'tipo' => 'texto'],
            ],
            'agrupaveis' => ['classe_risco', 'laboratorio', 'status', 'fabricante'],
            'numericos' => ['quantidade'],
        ],
        'vidrarias' => [
            'rotulo' => 'Vidrarias Contaminadas', 'campoData' => 'data_registro',
            'colunas' => [
                ['key' => 'codigo', 'label' => 'Código', 'tipo' => 'texto'],
                ['key' => 'tipo', 'label' => 'Tipo de Vidraria', 'tipo' => 'texto'],
                ['key' => 'laboratorio', 'label' => 'Laboratório', 'tipo' => 'texto'],
                ['key' => 'contaminante', 'label' => 'Contaminante', 'tipo' => 'texto'],
                ['key' => 'classe_contaminante', 'label' => 'Classe do Contaminante', 'tipo' => 'texto'],
                ['key' => 'nivel_contaminacao', 'label' => 'Nível de Contaminação', 'tipo' => 'texto'],
                ['key' => 'quantidade', 'label' => 'Quantidade', 'tipo' => 'numero'],
                ['key' => 'data_registro', 'label' => 'Data de Registro', 'tipo' => 'data'],
                ['key' => 'data_descontaminacao', 'label' => 'Data de Descontaminação', 'tipo' => 'data'],
                ['key' => 'metodo_descontaminacao', 'label' => 'Método de Descontaminação', 'tipo' => 'texto'],
                ['key' => 'responsavel', 'label' => 'Responsável', 'tipo' => 'texto'],
                ['key' => 'status', 'label' => 'Status', 'tipo' => 'texto'],
                ['key' => 'destino', 'label' => 'Destino', 'tipo' => 'texto'],
            ],
            'agrupaveis' => ['tipo', 'laboratorio', 'nivel_contaminacao', 'status', 'metodo_descontaminacao'],
            'numericos' => ['quantidade'],
        ],
    ];
}

function lgrp_rota_relatorios(array $get): void
{
    if (lgrp_metodo() !== 'GET') {
        lgrp_erro(405, 'Método não permitido');
    }
    lgrp_usuario();

    $modulos = lgrp_relatorios_modulos();
    if (($get['modulos'] ?? '') === 'lista' || empty($get['modulo'])) {
        lgrp_resposta([
            'modulos' => array_map(fn($v, $cfg) => [
                'valor' => $v, 'rotulo' => $cfg['rotulo'],
                'colunas' => $cfg['colunas'], 'agrupaveis' => $cfg['agrupaveis'],
            ], array_keys($modulos), $modulos),
        ]);
    }

    $escolhidos = array_values(array_filter(
        explode(',', (string) $get['modulo']),
        fn($m) => isset($modulos[trim($m)])
    ));
    if (!$escolhidos) {
        lgrp_erro(400, 'Módulo inválido.');
    }

    $de = $get['de'] ?? null;
    $ate = !empty($get['ate']) ? (strlen((string) $get['ate']) === 10 ? $get['ate'] . 'T23:59:59.999Z' : $get['ate']) : null;
    $campo = $get['campo'] ?? null;
    $valor = (!empty($get['valor']) && $get['valor'] !== 'todos') ? $get['valor'] : null;
    $agrupar = $get['agrupar'] ?? null;

    $resultados = [];
    $resumo = ['registros' => 0, 'somas' => []];
    $n = fn($v): float => is_numeric($v) ? (float) $v : 0.0;

    foreach ($escolhidos as $mod) {
        $cfg = $modulos[$mod];
        $q = db($mod)->select('*');
        if ($de) {
            $q = $q->gte($cfg['campoData'], $de);
        }
        if ($ate) {
            $q = $q->lte($cfg['campoData'], $ate);
        }
        if ($campo && $valor && in_array($campo, array_column($cfg['colunas'], 'key'), true)) {
            $q = $q->eq($campo, $valor);
        }
        $linhas = $q->order($cfg['campoData'], ['ascending' => false])->limit(3000)->execute()['data'];

        if ($mod === 'coletas' && $linhas) {
            $ids = array_values(array_unique(array_filter(array_map(fn($c) => (int) ($c['pedido_id'] ?? 0), $linhas))));
            $peds = $ids ? db('pedidos_coleta')->select('id,codigo,laboratorio,tipo_residuo')->in('id', $ids)->execute()['data'] : [];
            $mapa = [];
            foreach ($peds as $p) {
                $mapa[(int) $p['id']] = $p;
            }
            $linhas = array_map(function ($c) use ($mapa) {
                $ped = $mapa[(int) ($c['pedido_id'] ?? 0)] ?? null;
                $c['pedido_codigo'] = $ped['codigo'] ?? '—';
                $c['laboratorio'] = $ped['laboratorio'] ?? '—';
                $c['tipo_residuo'] = $ped['tipo_residuo'] ?? '—';
                return $c;
            }, $linhas);
        }

        if ($mod === 'reagentes') {
            $agora = time();
            $linhas = array_map(function ($r) use ($agora) {
                if (empty($r['data_validade'])) {
                    $r['situacao_validade'] = 'Sem validade';
                } else {
                    $t = strtotime($r['data_validade']);
                    $r['situacao_validade'] = match (true) {
                        $t < $agora => 'Vencido',
                        $t <= $agora + 30 * 86400 => 'A vencer',
                        $t <= $agora + 90 * 86400 => 'Atenção',
                        default => 'Válido',
                    };
                }
                return $r;
            }, $linhas);
        }

        $somas = [];
        foreach ($cfg['numericos'] as $c) {
            $somas[$c] = round(array_sum(array_map(fn($r) => $n($r[$c] ?? 0), $linhas)), 2);
        }

        $agrupado = [];
        if ($agrupar && in_array($agrupar, $cfg['agrupaveis'], true)) {
            $m = [];
            foreach ($linhas as $r) {
                $k = $r[$agrupar] ?: 'Não informado';
                if (!isset($m[$k])) {
                    $m[$k] = ['chave' => $k, 'registros' => 0, 'somas' => []];
                }
                $m[$k]['registros']++;
                foreach ($cfg['numericos'] as $c) {
                    $m[$k]['somas'][$c] = round(($m[$k]['somas'][$c] ?? 0) + $n($r[$c] ?? 0), 2);
                }
            }
            $agrupado = array_values($m);
            usort($agrupado, fn($a, $b) => $b['registros'] <=> $a['registros']);
        }

        $resumo['registros'] += count($linhas);
        foreach ($somas as $k => $v) {
            $resumo['somas'][$k] = round(($resumo['somas'][$k] ?? 0) + $v, 2);
        }

        $resultados[$mod] = [
            'rotulo' => $cfg['rotulo'], 'campoData' => $cfg['campoData'],
            'colunas' => $cfg['colunas'], 'agrupaveis' => $cfg['agrupaveis'],
            'rows' => $linhas, 'somas' => $somas, 'agrupado' => $agrupado, 'total' => count($linhas),
        ];
    }

    lgrp_resposta([
        'periodo' => ['de' => $de, 'ate' => $ate],
        'agrupar' => $agrupar, 'resumo' => $resumo, 'resultados' => $resultados,
        'gerado_em' => gmdate('Y-m-d\TH:i:s\Z'),
    ]);
}
