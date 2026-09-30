/**
 * Cria ou ajusta a conta de administrador com senha corretamente protegida.
 *
 *   npm run admin -- --email VOCE@exemplo.com --senha SUA_SENHA
 *   npm run admin -- --email VOCE@exemplo.com --senha SUA_SENHA --nome "Seu Nome"
 *
 * Inserir o usuário direto pelo phpMyAdmin não funciona: a coluna senha_hash
 * precisa guardar o resultado do scrypt (formato
 * `scrypt$N$r$p$salt$hash`), não a senha em texto puro. Com texto puro a
 * conta é criada, mas nunca autentica.
 */
import db, { pool } from '../api/db-client.js';
import { hashSenha } from '../api/authz.js';

const args = process.argv.slice(2);

function arg(nome, padrao = null) {
  const i = args.indexOf(`--${nome}`);
  if (i < 0) return padrao;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) return padrao;
  return v;
}

const email = String(arg('email', '') || '').trim().toLowerCase();
const senha = String(arg('senha', '') || '');
const nome = String(arg('nome', '') || '').trim();
const setor = arg('setor', 'Laboratório de Gestão de Resíduos Perigosos');
const papel = arg('papel', 'Administrador');
const telefone = arg('telefone', '');
const crq = arg('crq', '');

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('\nE-mail inválido ou ausente.\nUso: npm run admin -- --email voce@exemplo.com --senha SUA_SENHA\n');
  process.exit(1);
}
if (senha.length < 6) {
  console.error('\nA senha precisa ter ao menos 6 caracteres.\n');
  process.exit(1);
}
if (senha === '123456' || !/[A-Za-z]/.test(senha) || !/[0-9]/.test(senha)) {
  console.warn('\nSenha fraca. Use pelo menos 8 caracteres, com letras e números.\n');
}

const senha_hash = await hashSenha(senha);

try {
  await db.from('usuarios').select('id').eq('email', email).limit(1);
} catch (e) {
  console.error(`\nNão consegui falar com o banco: ${e.code || ''} ${e.message}\n`);
  console.error('Confira o .env e rode:  npm run check:db\n');
  process.exit(1);
}

const [existentes] = await pool.query('SELECT id, nome, papel FROM usuarios WHERE email = ?', [email]);
const existente = existentes[0];

const dados = {
  nome: nome || existente?.nome || email.split('@')[0],
  email,
  papel,
  setor,
  crq,
  telefone,
  ativo: 1,
  senha_hash,
};

if (existente) {
  await pool.query(
    'UPDATE usuarios SET nome=?, papel=?, setor=?, crq=?, telefone=?, ativo=1, senha_hash=? WHERE id=?',
    [dados.nome, papel, setor, crq, telefone, senha_hash, existente.id]
  );
  console.log(`\nConta atualizada: ${email}`);
  if (existente.papel !== papel) {
    console.log(`  perfil: ${existente.papel} -> ${papel}`);
  }
} else {
  const [r] = await pool.query(
    'INSERT INTO usuarios (nome, email, papel, setor, crq, telefone, ativo, senha_hash) VALUES (?,?,?,?,?,?,1,?)',
    [dados.nome, email, papel, setor, crq, telefone, senha_hash]
  );
  console.log(`\nConta criada: ${email}  (id ${r.insertId})`);
  if (papel !== 'Administrador') {
    console.log(`  perfil: ${papel}`);
  }
}

const [adm] = await pool.query(
  "SELECT COUNT(*) AS n FROM usuarios WHERE papel = 'Administrador' AND ativo = 1"
);
console.log(`  administradores ativos: ${adm[0].n}`);
console.log('\nEntre no sistema com:');
console.log(`  e-mail: ${email}`);
console.log(`  senha:  ${senha}\n`);

await pool.end();
