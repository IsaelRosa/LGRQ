/**
 * Diagnóstico da conexão com o MySQL.
 *
 *   npm run check:db
 *
 * Roda no terminal do servidor (SSH ou o console do hPanel) e diz exatamente
 * o que está errado: variáveis faltando, credencial recusada, banco
 * inexistente, tabela faltando ou coluna `senha_hash` ausente.
 *
 * A senha nunca é impressa.
 */
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const V = {};
const VARS = [
  ['MYSQL_HOST', process.env.MYSQL_HOST],
  ['MYSQL_PORT', process.env.MYSQL_PORT || '3306'],
  ['MYSQL_DATABASE', process.env.MYSQL_DATABASE],
  ['MYSQL_USER', process.env.MYSQL_USER],
  ['MYSQL_PASSWORD', process.env.MYSQL_PASSWORD],
];

const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const erro = (s) => `\x1b[31m${s}\x1b[0m`;
const aviso = (s) => `\x1b[33m${s}\x1b[0m`;
const negrito = (s) => `\x1b[1m${s}\x1b[0m`;

function mascara(v) {
  if (!v) return '(vazio)';
  return v.length <= 2 ? '**' : `${v[0]}${'*'.repeat(Math.min(v.length - 2, 8))}${v[v.length - 1]}`;
}

console.log(negrito('\n=== LGRP · diagnóstico do banco de dados ===\n'));

/* ------------------------------------------------------------------ */
/* 1. O .env foi carregado?                                            */
/* ------------------------------------------------------------------ */

const envPath = path.join(root, '.env');
const envExiste = existsSync(envPath);
console.log(negrito('1. Arquivo .env'));
if (envExiste) {
  console.log(`   ${ok('presente')} em ${envPath}`);
  const bruto = readFileSync(envPath, 'utf8');
  const chaves = bruto
    .split('\n')
    .map((l) => l.split('=')[0].trim())
    .filter((l) => l && !l.startsWith('#'));
  console.log(`   chaves encontradas: ${chaves.join(', ') || '(nenhuma)'}`);
} else {
  console.log(`   ${erro('AUSENTE')} em ${envPath}`);
  console.log(
    `   ${aviso('Se o Start Command no hPanel nao usa --env-file, o processo')} `
  );
  console.log(
    `   ${aviso('nao recebe nenhuma variavel e a conexao cai no padrao localhost.')}`
  );
  console.log(`   Start Command sugerido:  ${negrito('node --env-file=.env server.js')}`);
}

/* ------------------------------------------------------------------ */
/* 2. Variáveis de conexão                                            */
/* ------------------------------------------------------------------ */

console.log(`\n${negrito('2. Variáveis de conexão')}`);
const faltando = [];
for (const [nome, valor] of VARS) {
  V[nome] = valor;
  if (!valor) {
    faltando.push(nome);
    console.log(`   ${erro('✗')} ${nome.padEnd(16)} ${erro('não definida')}`);
  } else {
    const shown = nome === 'MYSQL_PASSWORD' ? mascara(valor) : valor;
    console.log(`   ${ok('✓')} ${nome.padEnd(16)} ${shown}`);
  }
}
if (!process.env.MYSQL_HOST) {
  console.log(`   ${aviso('·')} MYSQL_HOST não definida — o padrão é "localhost"`);
}

/* ------------------------------------------------------------------ */
/* 3. Conexão                                                          */
/* ------------------------------------------------------------------ */

console.log(`\n${negrito('3. Teste de conexão')}`);

if (faltando.length) {
  console.log(
    `   ${erro('Falha na configuração:')} ${faltando.join(', ')} não definida(s).`
  );
  console.log(`   Corrija o .env e rode novamente.`);
  process.exit(1);
}

let conn;
try {
  conn = await mysql.createConnection({
    host: V.MYSQL_HOST,
    port: Number(V.MYSQL_PORT),
    user: V.MYSQL_USER,
    password: V.MYSQL_PASSWORD,
    database: V.MYSQL_DATABASE,
    connectTimeout: 10000,
    ssl: process.env.MYSQL_SSL === 'true' ? {} : undefined,
  });
  console.log(`   ${ok('✓')} Conectado a ${V.MYSQL_HOST}:${V.MYSQL_PORT}/${V.MYSQL_DATABASE}`);

  const [versao] = await conn.query('SELECT VERSION() AS v');
  console.log(`   ${ok('✓')} Servidor: ${versao[0].v}`);
} catch (e) {
  console.log(`   ${erro('✗')} Falha: ${e.code || ''} ${e.message}`);
  console.log(`\n${negrito('O que isso significa:')}`);

  const msg = String(e.message || '');
  const code = e.code || '';

  if (code === 'ER_DBACCESS_DENIED_ERROR' || /to database/i.test(msg)) {
    // O usuário existe, mas não tem permissão neste banco — quase sempre
    // porque o nome do banco está errado ou o schema não foi criado.
    // Precisa vir antes do teste genérico de "Access denied for user",
    // que também casaria com esta mensagem.
    console.log(`   • O usuário não tem acesso ao banco ${negrito(V.MYSQL_DATABASE)}.`);
    console.log(`     Causas prováveis:`);
    console.log(`       - o nome do banco está errado (veja o prefixo acima)`);
    console.log(`       - o banco não existe no painel`);
    console.log(`       - o usuário ${negrito(V.MYSQL_USER)} não tem privilégios sobre ele`);
  } else if (code === 'ER_ACCESS_DENIED_ERROR' || /Access denied for user/i.test(msg)) {
    console.log(`   • Usuário ou senha incorretos.`);
    console.log(
      `     Na Hostinger o usuário tem prefixo, ex.: ${negrito('u123456789_admin')},`
    );
    console.log(`     e o banco é ${negrito('u123456789_admin_lgrp')}. Confira em`);
    console.log(`     hPanel → Bancos de Dados → Gerenciar MySQL.`);
  } else if (code === 'ER_BAD_DB_ERROR' || /Unknown database/i.test(msg)) {
    console.log(`   • O banco ${negrito(V.MYSQL_DATABASE)} não existe.`);
    console.log(`     Crie em hPanel → Bancos de Dados, ou corrija MYSQL_DATABASE.`);
  } else if (code === 'ECONNREFUSED') {
    console.log(`   • Nada escutando em ${V.MYSQL_HOST}:${V.MYSQL_PORT}.`);
    console.log(`     Na Hostinger use ${negrito('MYSQL_HOST=localhost')} e porta 3306.`);
  } else if (
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH'
  ) {
    console.log(`   • O host ${V.MYSQL_HOST} não é alcançável a partir do servidor.`);
    console.log(`     Use ${negrito('localhost')} — o MySQL é local à hospedagem.`);
  } else if (code === 'ER_NO_SUCH_TABLE' || code === 'ER_BAD_FIELD_ERROR') {
    console.log(`   • O schema não foi importado, ou está desatualizado.`);
  } else {
    console.log(`   • Erro não mapeado. Pesquise o código ${negrito(code)} do MySQL.`);
  }
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 4. Schema                                                           */
/* ------------------------------------------------------------------ */

console.log(`\n${negrito('4. Tabelas')}`);
const ESPERADAS = [
  'usuarios',
  'pedidos_coleta',
  'coletas',
  'tratamentos',
  'solventes',
  'reagentes',
  'vidrarias',
  'indicadores_mensais',
  'notificacoes',
  'historico',
];
let problemas = 0;
for (const t of ESPERADAS) {
  const [r] = await conn.query(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
    [V.MYSQL_DATABASE, t]
  );
  if (Number(r[0].n) > 0) {
    console.log(`   ${ok('✓')} ${t}`);
  } else {
    problemas++;
    console.log(`   ${erro('✗')} ${t} ${erro('— não existe')}`);
  }
}
if (problemas) {
  console.log(
    `\n   ${erro('Faltam tabelas.')} Importe o schema pelo phpMyAdmin (hPanel →`);
  console.log(`   Bancos de Dados → phpMyAdmin → Importar → lgrp_mysql.sql).`);
}

/* ------------------------------------------------------------------ */
/* 5. Coluna de senha (migração 002)                                   */
/* ------------------------------------------------------------------ */

console.log(`\n${negrito('5. Autenticação')}`);
try {
  const [r] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = ? AND table_name = 'usuarios' AND column_name = 'senha_hash'",
    [V.MYSQL_DATABASE]
  );
  if (Number(r[0].n) > 0) {
    console.log(`   ${ok('✓')} Coluna usuarios.senha_hash presente`);
  } else {
    problemas++;
    console.log(`   ${erro('✗')} Coluna usuarios.senha_hash AUSENTE`);
    console.log(
      `     O login falhará. Rode a migração:  ${negrito('npm run migrate')}`
    );
  }
} catch {
  /* tabela usuarios inexistente: já reportado acima */
}

/* ------------------------------------------------------------------ */
/* 6. JWT                                                              */
/* ------------------------------------------------------------------ */

console.log(`\n${negrito('6. Sessão')}`);
const secret = process.env.JWT_SECRET || '';
if (!secret) {
  console.log(`   ${erro('✗')} JWT_SECRET não definida — o servidor não sobe em produção.`);
} else if (secret.length < 32) {
  console.log(`   ${erro('✗')} JWT_SECRET tem só ${secret.length} caracteres (mínimo 32).`);
} else {
  console.log(`   ${ok('✓')} JWT_SECRET definida (${secret.length} caracteres)`);
}

/* ------------------------------------------------------------------ */

await conn.end();

console.log('');
if (problemas || faltando.length) {
  console.log(erro(negrito('Diagnóstico concluído com pendências.')));
  process.exit(1);
}
console.log(ok(negrito('Tudo certo: o sistema deve conseguir falar com o banco.')));
process.exit(0);
