/**
 * Fluxo de ponta a ponta contra um MySQL real.
 *
 *   npm run test:e2e
 *
 * Cria um usuario descartavel, valida login/permissoes e apaga tudo ao final.
 * Todos os e-mails usam o dominio reservado @lgrp.test (RFC 2606), que nunca
 * pode colidir com um endereco real.
 */
import db, { pool } from '../api/db-client.js';
import { hashSenha } from '../api/authz.js';
import authHandler from '../api/auth.js';
import notificacoesHandler from '../api/notificacoes.js';
import pedidosHandler from '../api/pedidos.js';
import solventesHandler from '../api/solventes.js';
import usuariosHandler from '../api/usuarios.js';

const DOMINIO = 'lgrp.test';
const SELO = Date.now();
const EMAIL = `e2e-${SELO}@${DOMINIO}`;
const SENHA = 'senha-e2e-forte';

let falhas = 0;

function check(nome, condicao, detalhe = '') {
  if (condicao) {
    console.log(`  ok   ${nome}`);
  } else {
    falhas += 1;
    console.error(`  FALHA ${nome} ${detalhe}`);
  }
}

/** Adaptador de requisição/resposta, para chamar os handlers sem subir o servidor. */
function call(handler, { method = 'GET', path = '/', query = {}, body = {}, token = null } = {}) {
  return new Promise((resolve) => {
    const url = query && Object.keys(query).length ? `${path}?${new URLSearchParams(query)}` : path;
    const req = {
      method,
      path,
      url,
      originalUrl: url,
      query,
      body,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(p) {
        resolve({ status: this.statusCode, body: p });
        return this;
      },
      send(p) {
        resolve({ status: this.statusCode, body: p });
        return this;
      },
      end() {
        resolve({ status: this.statusCode, body: null });
        return this;
      },
    };
    Promise.resolve(handler(req, res)).catch((e) =>
      resolve({ status: 500, body: { error: e.message } })
    );
  });
}

/** COUNT(*) pode voltar como número ou string, dependendo do driver/config. */
async function contar(sql) {
  const [rows] = await pool.query(sql);
  const linha = rows[0] || {};
  return Number(linha.n ?? Object.values(linha)[0] ?? 0);
}

async function limpar() {
  await pool.query('DELETE FROM coletas WHERE pedido_id IN (SELECT id FROM pedidos_coleta WHERE solicitante = ?)', ['E2E']);
  await pool.query('DELETE FROM historico WHERE usuario_email LIKE ?', [`%@${DOMINIO}`]);
  await pool.query("DELETE FROM pedidos_coleta WHERE solicitante = 'E2E'");
  await pool.query('DELETE FROM usuarios WHERE email LIKE ?', [`%@${DOMINIO}`]);
}

async function main() {
  console.log(`E2E · ${EMAIL}`);

  try {
    await pool.query('SELECT 1');
  } catch (e) {
    console.error(
      '\nNao foi possivel conectar ao MySQL.\n' +
        'Verifique o .env (MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE).\n' +
        `Detalhe: ${e.code || e.message}\n`
    );
    process.exitCode = 1;
    return;
  }

  await limpar();

  /* ---------------- autenticacao ---------------- */
  console.log('\nAutenticacao');

  const semToken = await call(usuariosHandler, { method: 'GET', path: '/api/usuarios' });
  check('GET sem token retorna 401', semToken.status === 401, `veio ${semToken.status}`);

  const tokenRuim = await call(usuariosHandler, {
    method: 'GET',
    path: '/api/usuarios',
    token: 'abc.def.ghi',
  });
  check('Token invalido retorna 401', tokenRuim.status === 401, `veio ${tokenRuim.status}`);

  const { data: novo } = await db
    .from('usuarios')
    .insert({
      nome: 'E2E Tecnico',
      email: EMAIL,
      papel: 'Tecnico de Laboratorio',
      ativo: true,
      senha_hash: await hashSenha(SENHA),
    })
    .select('id')
    .single();

  const loginRuim = await call(authHandler, {
    method: 'POST',
    path: '/api/auth/login',
    body: { email: EMAIL, senha: 'errada' },
  });
  check('Senha errada retorna 401', loginRuim.status === 401, `veio ${loginRuim.status}`);

  const loginOk = await call(authHandler, {
    method: 'POST',
    path: '/api/auth/login',
    body: { email: EMAIL, senha: SENHA },
  });
  check(
    'Login valido retorna token',
    loginOk.status === 200 && !!loginOk.body?.token,
    JSON.stringify(loginOk.body)
  );
  check('Resposta de login nao vaza o hash', !JSON.stringify(loginOk.body).includes('senha_hash'));
  const token = loginOk.body?.token;

  const me = await call(authHandler, { method: 'GET', path: '/api/auth/me', token });
  check('/api/auth/me devolve o perfil', me.body?.usuario?.email === EMAIL, JSON.stringify(me.body));

  const rotaErrada = await call(authHandler, { method: 'GET', path: '/api/auth', token });
  check('Rota /api/auth em GET responde 405', rotaErrada.status === 405, `veio ${rotaErrada.status}`);

  // Promove para editor: o e2e exercita escrita, o perfil Consultor e' testado
  // separadamente mais abaixo.
  await pool.query("UPDATE usuarios SET papel = 'Técnico de Laboratório' WHERE id = ?", [novo.id]);

  /* ---------------- CRUD ---------------- */
  console.log('\nCRUD de pedidos');

  const listaSemToken = await call(pedidosHandler, { method: 'GET', path: '/api/pedidos' });
  check('Listagem exige sessao', listaSemToken.status === 401, `veio ${listaSemToken.status}`);

  const lista = await call(pedidosHandler, { method: 'GET', path: '/api/pedidos', token });
  check(
    'Listagem com token funciona',
    lista.status === 200 && Array.isArray(lista.body),
    `veio ${lista.status}`
  );

  const criado = await call(pedidosHandler, {
    method: 'POST',
    path: '/api/pedidos',
    token,
    body: {
      laboratorio: 'Lab. E2E',
      solicitante: 'E2E',
      tipo_residuo: 'Ácido Inorgânico',
      unidade: 'kg',
      quantidade_estimada: 12.5,
    },
  });
  check('POST cria registro', criado.status === 201 && !!criado.body?.id, JSON.stringify(criado.body));
  check(
    'Codigo automatico gerado',
    /^PED-\d{4}-\d{4}$/.test(criado.body?.codigo || ''),
    criado.body?.codigo
  );
  check(
    'DECIMAL volta como numero',
    typeof criado.body?.quantidade_estimada === 'number',
    `${typeof criado.body?.quantidade_estimada}`
  );
  check(
    'Data volta em ISO',
    /^\d{4}-\d{2}-\d{2}T/.test(criado.body?.criado_em || ''),
    criado.body?.criado_em
  );
  check(
    'atualizado_em volta em ISO',
    /^\d{4}-\d{2}-\d{2}T/.test(criado.body?.atualizado_em || ''),
    criado.body?.atualizado_em
  );

  const codigo = criado.body.codigo;

  const segundo = await call(pedidosHandler, {
    method: 'POST',
    path: '/api/pedidos',
    token,
    body: { laboratorio: 'Lab. E2E', solicitante: 'E2E', tipo_residuo: 'Base Inorgânica' },
  });
  check(
    'Sequencia de codigo incrementa',
    segundo.body?.codigo !== codigo,
    `${codigo} vs ${segundo.body?.codigo}`
  );

  // Data ISO com offset precisa ser aceita pelo MySQL sem truncamento.
  const comData = await call(pedidosHandler, {
    method: 'POST',
    path: '/api/pedidos',
    token,
    body: {
      laboratorio: 'Lab. E2E',
      solicitante: 'E2E',
      tipo_residuo: 'Solvente Orgânico Halogenado',
      data_solicitacao: '2026-03-05T14:30:00.000Z',
    },
  });
  check(
    'DATETIME com offset ISO preserva o horario',
    String(comData.body?.data_solicitacao).startsWith('2026-03-05T14:30'),
    comData.body?.data_solicitacao
  );

  const atualizado = await call(pedidosHandler, {
    method: 'PUT',
    path: '/api/pedidos',
    token,
    body: { id: criado.body.id, status: 'Agendado' },
  });
  check(
    'PUT atualiza e devolve o registro',
    atualizado.body?.status === 'Agendado',
    JSON.stringify(atualizado.body)
  );

  const busca = await call(pedidosHandler, {
    method: 'GET',
    path: '/api/pedidos',
    token,
    query: { busca: 'E2E' },
  });
  const resultados = Array.isArray(busca.body) ? busca.body : [];
  check(
    'Busca textual encontra o registro',
    resultados.some((p) => p.id === criado.body.id),
    `veio ${resultados.length} resultados`
  );

  // Uma busca por % nao pode transformar a clausula em "qualquer coisa".
  const buscaWildcard = await call(pedidosHandler, {
    method: 'GET',
    path: '/api/pedidos',
    token,
    query: { busca: '%' },
  });
  check(
    'Busca com % nao vira curinga',
    buscaWildcard.status === 200 && buscaWildcard.body.length < 50,
    `veio ${buscaWildcard.status} / ${buscaWildcard.body?.length} linhas`
  );

  const filtroData = await call(pedidosHandler, {
    method: 'GET',
    path: '/api/pedidos',
    token,
    query: { de: '2026-01-01', ate: '2026-12-31' },
  });
  check(
    'Filtro por periodo funciona',
    filtroData.status === 200 && Array.isArray(filtroData.body),
    `veio ${filtroData.status}`
  );

  /* ---------------- tipos na saida ---------------- */
  console.log('\nTipos na saida (MySQL -> JSON)');

  // Colunas DATETIME precisam chegar como ISO, e TINYINT(1) como boolean.
  const solventes = await call(solventesHandler, {
    method: 'GET',
    path: '/api/solventes',
    token,
  });
  const sol = (Array.isArray(solventes.body) ? solventes.body : [])[0];
  check(
    'DATETIME de saida vira ISO',
    /^\d{4}-\d{2}-\d{2}T/.test(sol?.data_validade || ''),
    sol?.data_validade
  );
  check(
    'TINYINT(1) de saida vira boolean',
    typeof sol?.inflamavel === 'boolean',
    `${typeof sol?.inflamavel} (${sol?.inflamavel})`
  );

  // gerarAlertas compara `data_validade < isoString`. Com Date oResultado
  // seria sempre false e nenhum alerta de vencimento apareceria.
  const notif = await call(notificacoesHandler, {
    method: 'GET',
    path: '/api/notificacoes',
    token,
  });
  const alertas = Array.isArray(notif.body) ? notif.body : [];
  check('GET de notificacoes funciona', notif.status === 200, `veio ${notif.status}`);
  check('Endpoint devolve lista', Array.isArray(notif.body), typeof notif.body);

  // A geracao de alertas so produz registros quando ha dados vencidos no banco.
  const totalVencidos = await contar(
    'SELECT COUNT(*) AS n FROM reagentes WHERE data_validade < UTC_TIMESTAMP(3)'
  );
  const totalAlertas = await contar(
    "SELECT COUNT(*) AS n FROM notificacoes WHERE tipo IN ('Reagente vencido','Reagente a vencer')"
  );
  check(
    'Alertas de vencimento refletem o banco',
    totalVencidos === 0 ? totalAlertas >= 0 : totalAlertas > 0,
    `${totalVencidos} reagentes vencidos / ${totalAlertas} alertas gravados`
  );
  check(
    'Alertas tem origem rastreavel',
    alertas.every((x) => !x.origem_id || /^\d+$/.test(String(x.origem_id))),
    JSON.stringify(alertas.slice(0, 2).map((x) => x.origem_id))
  );

  /* ---------------- permissoes ---------------- */
  console.log('\nPermissoes');

  const cadastro = await call(authHandler, {
    method: 'POST',
    path: '/api/auth/register',
    body: { nome: 'E2E Consultor', email: `consultor-${SELO}@${DOMINIO}`, senha: SENHA },
  });
  check('Cadastro publico cria usuario', cadastro.status === 201, `veio ${cadastro.status}`);
  check(
    'Auto-registro recebe perfil Consultor',
    cadastro.body?.usuario?.papel === 'Consultor',
    cadastro.body?.usuario?.papel
  );
  const tokenConsultor = cadastro.body?.token;

  const escritaConsultor = await call(pedidosHandler, {
    method: 'POST',
    path: '/api/pedidos',
    token: tokenConsultor,
    body: { laboratorio: 'X', solicitante: 'X', tipo_residuo: 'X' },
  });
  check('Consultor nao pode escrever', escritaConsultor.status === 403, `veio ${escritaConsultor.status}`);

  const leituraConsultor = await call(pedidosHandler, {
    method: 'GET',
    path: '/api/pedidos',
    token: tokenConsultor,
  });
  check('Consultor pode ler', leituraConsultor.status === 200, `veio ${leituraConsultor.status}`);

  const crudUsuarios = await call(usuariosHandler, {
    method: 'POST',
    path: '/api/usuarios',
    token: tokenConsultor,
    body: { nome: 'X', email: `x-${SELO}@${DOMINIO}`, senhaInicial: 'abcdef' },
  });
  check('Nao-admin nao gerencia usuarios', crudUsuarios.status === 403, `veio ${crudUsuarios.status}`);

  const { data: admins } = await db.from('usuarios').select('id').eq('papel', 'Administrador').eq('ativo', true);
  if (admins.length) {
    await pool.query("UPDATE usuarios SET papel = 'Administrador' WHERE id = ?", [novo.id]);
    const crudAdmin = await call(usuariosHandler, {
      method: 'POST',
      path: '/api/usuarios',
      token,
      body: { nome: 'E2E Criado', email: `criado-${SELO}@${DOMINIO}`, senhaInicial: 'abcdef' },
    });
    check('Admin gerencia usuarios', crudAdmin.status === 201, `veio ${crudAdmin.status}`);
    check('senha_hash nao e retornado', !JSON.stringify(crudAdmin.body || {}).includes('senha_hash'));
    await pool.query("UPDATE usuarios SET papel = 'Técnico de Laboratório' WHERE id = ?", [novo.id]);
  } else {
    console.log('  --   (sem administrador no banco: teste de permissao de admin pulado)');
  }

  /* ---------------- exclusao e auditoria ---------------- */
  console.log('\nExclusao e auditoria');

  const del = await call(pedidosHandler, {
    method: 'DELETE',
    path: '/api/pedidos',
    token,
    body: { id: criado.body.id },
  });
  check('DELETE remove o registro', del.status === 200, `veio ${del.status}`);

  const { data: audit } = await db
    .from('historico')
    .select('*')
    .eq('tabela', 'pedidos_coleta')
    .eq('registro_id', String(criado.body.id));
  check(
    'Trilha de auditoria registrou as 3 acoes',
    (audit || []).length === 3,
    `${(audit || []).length} registros`
  );
  check(
    'Auditoria guarda quem operou',
    (audit || []).every((h) => h.usuario_email === EMAIL),
    JSON.stringify((audit || []).map((h) => h.usuario_email))
  );
  const insercao = (audit || []).find((h) => h.acao === 'INSERT');
  check(
    'Campo JSON da auditoria volta como objeto',
    insercao && typeof insercao.dados_novos === 'object' && insercao.dados_novos !== null,
    JSON.stringify(insercao?.dados_novos)
  );

  console.log('\nLimpando...');
  await limpar();

  console.log(
    falhas === 0 ? '\nE2E: todos os testes passaram' : `\nE2E: ${falhas} falha(s)`
  );
  process.exitCode = falhas === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error('ERRO:', e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
