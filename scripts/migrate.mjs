/**
 * Aplica as migrações em migrations/*.sql, em ordem de nome.
 *
 *   npm run migrate
 *
 * Pensado para instalar a coluna `senha_hash` em bases criadas pela versão
 * anterior do schema. Idempotente: os `IF NOT EXISTS` evitam erro ao rodar
 * mais de uma vez.
 */
import mysql from 'mysql2/promise';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirMigrations = path.join(root, 'migrations');

const required = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'];
const faltando = required.filter((v) => !process.env[v]);

if (faltando.length) {
  console.error(`\nVariáveis de ambiente ausentes: ${faltando.join(', ')}`);
  console.error('Rode com --env-file:  node --env-file=.env scripts/migrate.mjs\n');
  process.exit(1);
}

const arquivos = readdirSync(dirMigrations)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (!arquivos.length) {
  console.log('Nenhuma migração encontrada em migrations/.');
  process.exit(0);
}

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  multipleStatements: true,
  ssl: process.env.MYSQL_SSL === 'true' ? {} : undefined,
});

console.log(`\nBanco: ${process.env.MYSQL_DATABASE} em ${process.env.MYSQL_HOST}\n`);

let aplicadas = 0;
for (const arquivo of arquivos) {
  const sql = readFileSync(path.join(dirMigrations, arquivo), 'utf8');
  // Remove linhas de comentário para não poluir a saída.
  const sqlLimpo = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  if (!sqlLimpo.trim()) {
    console.log(`  = ${arquivo} (só comentários)`);
    continue;
  }
  try {
    await conn.query(sqlLimpo);
    console.log(`  ✓ ${arquivo}`);
    aplicadas++;
  } catch (e) {
    console.error(`  ✗ ${arquivo}`);
    console.error(`    ${e.code || ''} ${e.message}`);
    await conn.end();
    process.exit(1);
  }
}

await conn.end();
console.log(`\n${aplicadas} migração(ões) aplicada(s).\n`);
