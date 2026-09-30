/**
 * Autenticação e autorização do LGRP.
 *
 * Implementado apenas com módulos nativos do Node (`node:crypto`) para não
 * exigir compilação de dependências nativas na hospedagem:
 *   - senhas  -> scrypt + salt aleatório
 *   - sessões -> JWT HS256 assinado com JWT_SECRET
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import db from './db-client.js';

const scrypt = promisify(crypto.scrypt);

/* ------------------------------------------------------------------ */
/* Erro HTTP                                                           */
/* ------------------------------------------------------------------ */

export class HttpError extends Error {
  constructor(status, message, codigo = null) {
    super(message);
    this.status = status;
    this.codigo = codigo;
  }
}

const CODIGOS_CONEXAO = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
]);

/**
 * Tabela/banco ausentes não são falha de conexão: são schema não importado
 * ou migração não aplicada. Distinguir os dois evita mandar o usuário
 * investigar rede quando o problema é outro.
 */
const CODIGOS_SCHEMA = new Set([
  'ER_NO_SUCH_TABLE',
  'ER_BAD_FIELD_ERROR',
  'ER_PARSE_ERROR',
  'ER_NO_SUCH_INDEX',
]);

function ehFalhaDeConexao(err) {
  if (!err) return false;
  if (err.fatal && err.code) return true;
  return CODIGOS_CONEXAO.has(err.code);
}

export { ehFalhaDeConexao };

/**
 * Converte qualquer erro em uma resposta JSON coerente.
 *
 * Falha de banco vira 503 com mensagem genérica: o usuário não deve ver
 * erro de conexão, e a mensagem real (host, porta, permissão) fica apenas
 * no log do servidor.
 */
export function responderErro(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, codigo: err.codigo });
  }
  if (ehFalhaDeConexao(err)) {
    console.error('Falha de conexão com o MySQL:', err.code, err.message);
    return res.status(503).json({
      error: 'Não foi possível falar com o banco de dados. Tente novamente em instantes.',
      codigo: 'banco_indisponivel',
    });
  }
  if (err && CODIGOS_SCHEMA.has(err.code)) {
    // Schema incompleto é erro de instalação, não de rede — a mensagem precisa
    // dizer isso, senão o usuário fica caçando problema de conexão à toa.
    console.error('Schema do banco incompleto:', err.code, err.message);
    return res.status(500).json({
      error:
        'O banco de dados não tem o schema esperado. Importe lgrp_mysql.sql e rode "npm run migrate" (veja o README).',
      codigo: 'schema_incompleto',
    });
  }
  console.error('API error:', err);
  return res.status(500).json({
    error: err.message || 'Erro interno do servidor.',
    codigo: 'erro_interno',
  });
}

/* ------------------------------------------------------------------ */
/* Segredo                                                             */
/* ------------------------------------------------------------------ */

let _segredoCache = null;

function segredo() {
  if (_segredoCache) return _segredoCache;
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'JWT_SECRET ausente ou com menos de 32 caracteres. Defina a variável de ambiente antes de iniciar o servidor.'
      );
    }
    console.warn(
      '[auth] JWT_SECRET não definido; usando segredo efêmero. As sessões cairão a cada reinício (apenas em desenvolvimento).'
    );
    _segredoCache = crypto.randomBytes(48).toString('hex');
    return _segredoCache;
  }
  _segredoCache = s;
  return s;
}

export function segredoJwt() {
  return segredo();
}

/* ------------------------------------------------------------------ */
/* Senhas                                                              */
/* ------------------------------------------------------------------ */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 6) {
    throw new HttpError(400, 'A senha deve ter no mínimo 6 caracteres.');
  }
  const salt = crypto.randomBytes(16);
  const key = await scrypt(senha.normalize('NFKC'), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verificarSenha(senha, hash) {
  if (typeof senha !== 'string' || typeof hash !== 'string') return false;
  const partes = hash.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = partes;
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const esperado = Buffer.from(keyB64, 'base64');
    const obtido = await scrypt(senha.normalize('NFKC'), salt, esperado.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(esperado, obtido);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* JWT (HS256)                                                         */
/* ------------------------------------------------------------------ */

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload, { expiresIn = '12h' } = {}) {
  const agora = Math.floor(Date.now() / 1000);
  const corpo = { ...payload, iat: agora, exp: agora + duracaoSegundos(expiresIn) };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(corpo));
  const dados = `${header}.${body}`;
  const assinatura = crypto.createHmac('sha256', segredo()).update(dados).digest('base64url');
  return `${dados}.${assinatura}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const dados = `${partes[0]}.${partes[1]}`;
  const esperada = crypto.createHmac('sha256', segredo()).update(dados).digest('base64url');
  const a = Buffer.from(esperada);
  const b = Buffer.from(partes[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function duracaoSegundos(valor) {
  const m = /^(\d+)([smhd])$/.exec(String(valor));
  if (!m) return 12 * 3600;
  const n = Number(m[1]);
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
}

/* ------------------------------------------------------------------ */
/* Sessão                                                              */
/* ------------------------------------------------------------------ */

export function extrairToken(req) {
  const raw = req.headers?.authorization || req.headers?.Authorization || '';
  return String(raw).replace(/^Bearer\s+/i, '').trim();
}

/** Perfil público de um usuário (nunca inclui o hash da senha). */
export function perfilPublico(u) {
  if (!u) return null;
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    papel: u.papel,
    setor: u.setor || '',
    crq: u.crq || '',
    telefone: u.telefone || '',
    ativo: Boolean(u.ativo),
  };
}

const SELECT_USUARIO = 'id, nome, email, papel, setor, crq, telefone, ativo, senha_hash';

/**
 * Resolve o usuário autenticado. Lança 401 quando não há sessão válida.
 * Este é o único caminho de autorização de toda a API.
 */
export async function exigirAuth(req) {
  const token = extrairToken(req);
  if (!token) throw new HttpError(401, 'Sessão não informada. Faça login para continuar.', 'sem_sessao');

  const payload = verifyToken(token);
  if (!payload?.sub) {
    throw new HttpError(401, 'Sessão inválida ou expirada. Faça login novamente.', 'sessao_invalida');
  }

  const { data, error } = await db
    .from('usuarios')
    .select(SELECT_USUARIO)
    .eq('id', payload.sub)
    .limit(1);
  if (error) throw error;

  const usuario = data && data[0];
  if (!usuario) throw new HttpError(401, 'Usuário não encontrado.', 'sem_usuario');
  if (!usuario.ativo) {
    throw new HttpError(403, 'Seu usuário está inativo. Procure o administrador do LGRP.', 'usuario_inativo');
  }
  return usuario;
}

/** Perfis autorizados a alterar dados. Consultores são somente leitura. */
export const PAPEIS_EDITOR = [
  'Administrador',
  'Coordenador',
  'Químico Responsável',
  'Gestor Ambiental',
  'Técnico de Laboratório',
];

/** Perfis autorizados a gerenciar a base de usuários. */
export const PAPEIS_ADMIN = ['Administrador'];

export const PAPEIS_VALIDOS = [...PAPEIS_EDITOR, 'Consultor'];

export function podeEditar(usuario) {
  return !!usuario && PAPEIS_EDITOR.includes(usuario.papel);
}

export function ehAdmin(usuario) {
  return !!usuario && PAPEIS_ADMIN.includes(usuario.papel);
}

/** Garante que o usuário pode gravar. Consultores são somente leitura. */
export function exigirEdicao(usuario) {
  if (!podeEditar(usuario)) {
    throw new HttpError(
      403,
      'Seu perfil possui acesso somente leitura. Solicite a um administrador a permissão de edição.',
      'somente_leitura'
    );
  }
}

export function exigirAdmin(usuario) {
  if (!ehAdmin(usuario)) {
    throw new HttpError(403, 'Apenas administradores podem gerenciar usuários.', 'requer_admin');
  }
}

/* ------------------------------------------------------------------ */
/* Rate limit simples (por IP, em memória)                             */
/* ------------------------------------------------------------------ */

const tentativas = new Map();
const LIMITE = { max: 8, janelaMs: 10 * 60 * 1000 };

export function exigirRateLimit(req, chave = 'login') {
  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.ip || 'desconhecido';
  const id = `${chave}:${ip}`;
  const agora = Date.now();
  const registro = tentativas.get(id);

  if (!registro || agora > registro.expira) {
    tentativas.set(id, { contagem: 1, expira: agora + LIMITE.janelaMs });
    return;
  }
  registro.contagem += 1;
  if (registro.contagem > LIMITE.max) {
    throw new HttpError(
      429,
      'Muitas tentativas de acesso. Aguarde alguns minutos antes de tentar novamente.',
      'rate_limit'
    );
  }
  if (tentativas.size > 5000) tentativas.clear();
}

export function limparRateLimit(req, chave = 'login') {
  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.ip || 'desconhecido';
  tentativas.delete(`${chave}:${ip}`);
}
