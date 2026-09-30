/**
 * Rotas de autenticação: /api/auth
 *
 *   POST /api/auth/login      -> { email, senha }
 *   POST /api/auth/register   -> { nome, email, senha }
 *   GET  /api/auth/me         -> perfil da sessão atual
 *   POST /api/auth/logout     -> invalida a sessão
 *   PUT  /api/auth/senha      -> { senhaAtual, novaSenha }
 */
import db from './db-client.js';
import {
  HttpError,
  ehFalhaDeConexao,
  exigirAuth,
  exigirRateLimit,
  hashSenha,
  limparRateLimit,
  perfilPublico,
  responderErro,
  signToken,
  verificarSenha,
} from './authz.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SELECT_USUARIO = 'id, nome, email, papel, setor, crq, telefone, ativo, senha_hash';

/** Caminho normalizado, sem query string nem barra final. */
function caminho(req) {
  const bruto = req.originalUrl || req.url || '';
  const limpo = bruto.split('?')[0].replace(/\/+$/, '');
  return limpo || '/api/auth';
}

/**
 * Converte erro de driver em HttpError. Falha de conexão/credencial vira
 * 503 (banco fora do ar); qualquer outra coisa — schema incompleto, coluna
 * faltando — é devolvida crua para o tratador global responder 500 com a
 * mensagem verdadeira, em vez de mascarar tudo como "banco indisponível".
 */
function erroDeBanco(error) {
  if (ehFalhaDeConexao(error)) {
    return new HttpError(
      503,
      'Não foi possível falar com o banco de dados. Tente novamente em instantes.',
      'banco_indisponivel'
    );
  }
  return error;
}

function setCORS(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

function emitirSessao(usuario) {
  return {
    token: signToken(
      { sub: usuario.id, email: usuario.email, papel: usuario.papel },
      { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
    ),
    usuario: perfilPublico(usuario),
  };
}

function validarEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw new HttpError(400, 'Informe um endereço de e-mail válido.');
  return e;
}

export default async function handler(req, res) {
  if (setCORS(req, res)) return;

  try {
    /* ------------------------------- LOGIN */
    if (req.method === 'POST') {
      const rota = caminho(req);
      if (rota === '/api/auth/register') return await registrar(req, res);
      if (rota !== '/api/auth/login') {
        return res.status(405).json({ error: 'Use /api/auth/login ou /api/auth/register.' });
      }
      return await login(req, res);
    }

    /* --------------------------------- ME */
    if (req.method === 'GET') {
      // /api/auth em GET não é o perfil; é a listagem (que não existe aqui).
      if (caminho(req) !== '/api/auth/me') {
        return res.status(405).json({ error: 'Use /api/auth/me para consultar a sessão.' });
      }
      const usuario = await exigirAuth(req);
      return res.status(200).json({ usuario: perfilPublico(usuario) });
    }

    /* ------------------------------ LOGOUT */
    if (req.method === 'DELETE' && caminho(req) === '/api/auth') {
      // O JWT é sem estado: o descarte da sessão acontece no cliente.
      // O endpoint existe para que a UI possa centralizar a rotina de saída.
      return res.status(200).json({ ok: true });
    }

    /* ------------------------------ SENHA */
    if (req.method === 'PUT') {
      if (caminho(req) !== '/api/auth/senha') {
        return res.status(405).json({ error: 'Use /api/auth/senha para trocar a senha.' });
      }
      return await trocarSenha(req, res);
    }

    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (err) {
    return responderErro(res, err);
  }
}

/* ------------------------------------------------------------------ */

async function login(req, res) {
  exigirRateLimit(req, 'login');

  const email = validarEmail(req.body?.email);
  const senha = String(req.body?.senha || '');
  if (!senha) throw new HttpError(400, 'Informe a senha.');

  const { data, error } = await db
    .from('usuarios')
    .select(SELECT_USUARIO)
    .eq('email', email)
    .limit(1);
  if (error) {
    // Só conexão/secredo recusado vira 503. Erro de schema precisa chegar ao
    // usuário como 500 com a mensagem real, senão ele investiga a rede à toa.
    console.error('login: falha ao consultar o banco:', error.code || '', error.message);
    throw erroDeBanco(error);
  }

  const usuario = data && data[0];
  const hash = usuario?.senha_hash;

  // Usuario inexistente ainda passa por uma verificação de senha para não
  // vazar, pelo tempo de resposta, quais e-mails existem no sistema.
  const confere = hash
    ? await verificarSenha(senha, hash)
    : await verificarSenha(senha, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');

  if (!usuario || !confere) {
    throw new HttpError(401, 'E-mail ou senha inválidos. Verifique os dados e tente novamente.', 'credenciais');
  }
  if (!usuario.ativo) {
    throw new HttpError(403, 'Seu usuário está inativo. Procure o administrador do LGRP.', 'usuario_inativo');
  }

  limparRateLimit(req, 'login');
  return res.status(200).json(emitirSessao(usuario));
}

/* ------------------------------------------------------------------ */

async function registrar(req, res) {
  exigirRateLimit(req, 'register');

  const nome = String(req.body?.nome || '').trim();
  const email = validarEmail(req.body?.email);
  const senha = String(req.body?.senha || '');

  if (nome.length < 3) throw new HttpError(400, 'Informe o nome completo.');
  if (senha.length < 6) throw new HttpError(400, 'A senha deve ter no mínimo 6 caracteres.');

  const { data: existentes, error: erroBusca } = await db
    .from('usuarios')
    .select('id, papel')
    .limit(1);
  if (erroBusca) {
    console.error('register: falha ao consultar o banco:', erroBusca.code || '', erroBusca.message);
    throw erroDeBanco(erroBusca);
  }

  // O primeiro usuário do sistema precisa poder administrar os demais.
  const primeiroUsuario = !existentes || existentes.length === 0;
  const papel = primeiroUsuario ? 'Administrador' : 'Consultor';
  const setor = primeiroUsuario ? 'Laboratório de Gestão de Resíduos Perigosos' : null;

  const { data: jaExiste, error: erroDuplicado } = await db
    .from('usuarios')
    .select('id')
    .eq('email', email)
    .limit(1);
  if (erroDuplicado) {
    console.error('register: falha ao checar e-mail:', erroDuplicado.code || '', erroDuplicado.message);
    throw erroDeBanco(erroDuplicado);
  }
  if (jaExiste && jaExiste.length) {
    throw new HttpError(409, 'Este e-mail já está cadastrado. Faça login.', 'email_em_uso');
  }

  const senha_hash = await hashSenha(senha);
  const { data, error } = await db
    .from('usuarios')
    .insert({ nome, email, papel, setor, ativo: true, senha_hash })
    .select(SELECT_USUARIO)
    .single();
  if (error) {
    // Corrida entre dois cadastros com o mesmo e-mail: o índice único
    // barrou o segundo, o que não é uma falha do servidor.
    if (error.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'Este e-mail já está cadastrado. Faça login.', 'email_em_uso');
    }
    console.error('register: falha ao gravar:', error.code || '', error.message);
    throw erroDeBanco(error);
  }

  await db.from('historico').insert({
    tabela: 'usuarios',
    registro_id: String(data.id),
    registro_codigo: data.nome,
    acao: 'INSERT',
    descricao: `Usuário cadastrado: ${data.nome} (${data.papel})`,
    usuario: data.nome,
    usuario_email: data.email,
    dados_anteriores: null,
    dados_novos: { nome: data.nome, email: data.email, papel: data.papel },
    mudancas: null,
  });

  limparRateLimit(req, 'register');
  return res.status(201).json({
    ...emitirSessao(data),
    aviso: primeiroUsuario
      ? 'Este é o primeiro usuário do sistema: perfil de Administrador atribuído automaticamente.'
      : 'Cadastro realizado. Um administrador deverá liberar suas permissões de edição.',
  });
}

/* ------------------------------------------------------------------ */

async function trocarSenha(req, res) {
  const usuario = await exigirAuth(req);
  const senhaAtual = String(req.body?.senhaAtual || '');
  const novaSenha = String(req.body?.novaSenha || '');

  if (!(await verificarSenha(senhaAtual, usuario.senha_hash))) {
    throw new HttpError(401, 'Senha atual incorreta.', 'senha_incorreta');
  }
  if (novaSenha.length < 6) {
    throw new HttpError(400, 'A nova senha deve ter no mínimo 6 caracteres.');
  }

  const senha_hash = await hashSenha(novaSenha);
  const { error } = await db.from('usuarios').update({ senha_hash }).eq('id', usuario.id);
  if (error) throw error;

  return res.status(200).json({ ok: true });
}
