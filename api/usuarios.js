import { makeCrud } from './shared.js';
import { hashSenha, HttpError, PAPEIS_VALIDOS } from './authz.js';
import db from './db-client.js';

export const CAMPOS = ['nome', 'email', 'papel', 'setor', 'crq', 'telefone', 'ativo'];

const PAPEIS = PAPEIS_VALIDOS;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Erro de regra de negócio: vira 400, não 500. */
function regra(mensagem) {
  return new HttpError(400, mensagem);
}

function validar(body, registroAtual) {
  if (body.email !== undefined) {
    body.email = String(body.email).trim().toLowerCase();
    if (!EMAIL_RE.test(body.email)) throw regra('Informe um e-mail válido.');
  }
  if (body.papel !== undefined && body.papel !== null) {
    if (!PAPEIS.includes(body.papel)) {
      throw regra(`Perfil inválido. Use um destes: ${PAPEIS.join(', ')}.`);
    }
  } else if (!registroAtual) {
    body.papel = 'Técnico de Laboratório';
  }
  if (body.ativo !== undefined && body.ativo !== null) body.ativo = !!body.ativo;
  else if (!registroAtual) body.ativo = true;

  if (!registroAtual && !body.nome) throw regra('Informe o nome do usuário.');
}

/** Impede que a instalação fique sem nenhum administrador ativo. */
async function garantirAdministrador(id, body, atual) {
  const perdeAdmin =
    atual?.papel === 'Administrador' &&
    ((body.papel !== undefined && body.papel !== 'Administrador') || body.ativo === false);
  if (!perdeAdmin) return;

  const { data } = await db
    .from('usuarios')
    .select('id')
    .eq('papel', 'Administrador')
    .eq('ativo', true);
  const outros = (data || []).filter((u) => Number(u.id) !== Number(id));
  if (!outros.length) {
    throw regra(
      'Este é o único administrador ativo do sistema. Promova outro usuário antes de rebaixar ou desativar esta conta.'
    );
  }
}

export default makeCrud({
  tabela: 'usuarios',
  campos: CAMPOS,
  searchable: ['nome', 'email', 'setor', 'papel', 'crq'],
  rotulo: 'Usuário',
  ordenarPor: 'nome',
  ascendente: true,
  // Somente administradores cadastram, alteram ou removem usuários.
  permissaoEscrita: 'admin',
  // `senha_hash` nunca sai do servidor.
  sanitize: (row) => {
    if (!row) return row;
    const copia = { ...row };
    delete copia.senha_hash;
    return copia;
  },
  beforeInsert: async (body, bruto) => {
    validar(body, null);

    const senha = String(bruto?.senhaInicial || bruto?.senha || '');
    if (senha.length < 6) {
      throw regra('Defina uma senha inicial com no mínimo 6 caracteres para o novo usuário.');
    }
    body.senha_hash = await hashSenha(senha);
  },
  beforeUpdate: async (body, bruto, atual, usuario) => {
    validar(body, atual);
    await garantirAdministrador(atual.id, body, atual);

    // Impede que o administrador remova o próprio acesso acidentalmente.
    if (Number(atual.id) === Number(usuario?.id)) {
      if (body.ativo === false) throw regra('Você não pode desativar a própria conta.');
      if (body.papel && body.papel !== 'Administrador') {
        throw regra('Você não pode rebaixar o próprio perfil de administrador.');
      }
    }

    const senha = String(bruto?.senha || '');
    if (senha) {
      if (senha.length < 6) throw regra('A senha deve ter no mínimo 6 caracteres.');
      body.senha_hash = await hashSenha(senha);
    }
    // O e-mail é a chave de login: trocar exige uma nova senha.
    if (body.email && body.email !== atual.email && !senha) {
      throw regra('Ao alterar o e-mail, defina também uma nova senha para o usuário.');
    }
  },
});
