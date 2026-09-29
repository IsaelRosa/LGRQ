/**
 * Testes da camada de dados e de autenticação, sem banco de dados.
 *
 *   npm test
 *
 * Cobre a normalização de datas/booleanos (o ponto onde a migração para MySQL
 * costuma quebrar silenciosamente) e a criptografia de sessão.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { toSqlDate, escapeLike, QueryBuilder } from '../api/db-client.js';
import {
  hashSenha,
  verificarSenha,
  signToken,
  verifyToken,
} from '../api/authz.js';

process.env.JWT_SECRET = 'segredo-de-teste-com-tamanho-suficiente-para-hmac-sha256';

test('toSqlDate converte ISO em literal MySQL', () => {
  assert.equal(toSqlDate('2026-03-05T14:30:00.000Z'), '2026-03-05 14:30:00.000');
  assert.equal(toSqlDate('2026-03-05T14:30:00Z'), '2026-03-05 14:30:00.000');
  // Aceita também o separador de espaço, comum em strings vindas do MySQL.
  assert.equal(toSqlDate('2026-03-05 14:30:00.000'), '2026-03-05 14:30:00.000');
  // Data sem hora vira início do dia.
  assert.equal(toSqlDate('2026-03-05'), '2026-03-05 00:00:00.000');
});

test('toSqlDate preserva valores que não são datas', () => {
  assert.equal(toSqlDate('Solvente Orgânico Halogenado'), 'Solvente Orgânico Halogenado');
  assert.equal(toSqlDate('PED-2026-0001'), 'PED-2026-0001');
  assert.equal(toSqlDate(''), null);
  assert.equal(toSqlDate(null), null);
  assert.equal(toSqlDate(undefined), null);
});

test('escapeLike neutraliza curingas do usuário', () => {
  assert.equal(escapeLike('50%'), '50\\%');
  assert.equal(escapeLike('a_b'), 'a\\_b');
  // Uma busca por "100%" não pode transformar a cláusula em "qualquer valor".
  assert.match(escapeLike('100%'), /\\%/);
});

test('QueryBuilder gera SQL parametrizado e bloqueia injeção', () => {
  const q = new QueryBuilder('pedidos_coleta')
    .select('id, codigo')
    .eq('status', 'Solicitado')
    .limit(10);

  assert.equal(
    q.whereClause(),
    " WHERE `status` = ?"
  );
  assert.deepEqual(q.params, ['Solicitado']);
  assert.equal(q.maxRows, 10);
  assert.equal(q.table, '`pedidos_coleta`');
});

test('QueryBuilder rejeita identificador malicioso', () => {
  // Um nome de tabela vindo de URL não pode virar SQL.
  assert.throws(() => new QueryBuilder('pedidos; DROP TABLE usuarios'), /Tabela inválida/);
  const q = new QueryBuilder('pedidos_coleta');
  assert.throws(() => q.eq('status = 1 OR 1', 'x'), /Identificador SQL inválido/);
});

test('QueryBuilder escapa curingas em busca textual', () => {
  const q = new QueryBuilder('solventes');
  q.or('nome.ilike.%clor%');
  assert.match(q.whereClause(), /WHERE/);
  assert.equal(q.whereClause(), ' WHERE (`nome` LIKE ?)');
  assert.deepEqual(q.params, ['%clor%']);

  // Termo com % do usuário precisa ser escapado, não virar curinga.
  const q2 = new QueryBuilder('solventes');
  q2.or(`nome.ilike.%${escapeLike('50% acetona')}%`);
  assert.deepEqual(q2.params, ['%50\\% acetona%']);
});

test('parâmetros de filtro normalizam datas', () => {
  const q = new QueryBuilder('pedidos_coleta');
  q.gte('data_solicitacao', '2026-01-01T00:00:00.000Z');
  q.lte('data_solicitacao', '2026-12-31T23:59:59.999Z');
  assert.deepEqual(q.params, ['2026-01-01 00:00:00.000', '2026-12-31 23:59:59.999']);
});

test('ordem padrão é ASC, como no Supabase', () => {
  const asc = new QueryBuilder('usuarios').order('nome');
  assert.equal(asc.orderBy, '`nome` ASC');
  const desc = new QueryBuilder('usuarios').order('nome', { ascending: false });
  assert.equal(desc.orderBy, '`nome` DESC');
});

test('senha: hash é salinado e senha errada é rejeitada', async () => {
  const h1 = await hashSenha('senhaforte123');
  const h2 = await hashSenha('senhaforte123');

  // Mesmo texto, hashes diferentes: o salt impede reversão por tabela pré-computada.
  assert.notEqual(h1, h2);
  assert.match(h1, /^scrypt\$16384\$8\$1\$/);

  assert.equal(await verificarSenha('senhaforte123', h1), true);
  assert.equal(await verificarSenha('senhaerrada', h1), false);
  assert.equal(await verificarSenha('senhaforte123', 'lixo'), false);
});

test('senha curta é recusada', async () => {
  await assert.rejects(() => hashSenha('123'), /mínimo 6 caracteres/);
});

test('JWT: assina, valida e rejeita adulteração/expiração', () => {
  const token = signToken({ sub: 7, email: 'a@b.br' }, { expiresIn: '1h' });
  const payload = verifyToken(token);
  assert.equal(payload.sub, 7);
  assert.equal(payload.email, 'a@b.br');

  // Um token válido com o payload trojado não pode ser aceito.
  const partes = token.split('.');
  const forjado = `${partes[0]}.${Buffer.from('{"sub":1,"exp":99999999999}').toString('base64url')}.${partes[2]}`;
  assert.equal(verifyToken(forjado), null);

  assert.equal(verifyToken('abc'), null);
  assert.equal(verifyToken(null), null);

  const curto = signToken({ sub: 1 }, { expiresIn: '1s' });
  const exp = verifyToken(curto).exp;
  assert.ok(exp > Math.floor(Date.now() / 1000));
});


