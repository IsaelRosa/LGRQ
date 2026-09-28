import { makeCrud } from './shared.js';

export const CAMPOS = [
  'nome',
  'email',
  'papel',
  'setor',
  'crq',
  'telefone',
  'ativo',
  'auth_id',
];

export default makeCrud({
  tabela: 'usuarios',
  campos: CAMPOS,
  searchable: ['nome', 'email', 'setor', 'papel', 'crq'],
  rotulo: 'Usuário',
  ordenarPor: 'id',
  ascendente: true,
  beforeInsert: async (body) => {
    if (body.ativo === undefined || body.ativo === null) body.ativo = true;
    if (!body.papel) body.papel = 'Técnico de Laboratório';
  },
});
