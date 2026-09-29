import { setCORS, supabase, currentUser, responderErro } from './shared.js';
import { escapeLike } from './db-client.js';

const ROTULOS = {
  pedidos_coleta: 'Pedidos de Coleta',
  coletas: 'Coletas',
  tratamentos: 'Tratamentos',
  solventes: 'Solventes',
  reagentes: 'Reagentes',
  vidrarias: 'Vidrarias',
  indicadores_mensais: 'Indicadores Mensais',
  usuarios: 'Usuários',
  notificacoes: 'Notificações',
};

export default async function handler(req, res) {
  if (setCORS(req, res)) return;
  try {
    await currentUser(req);

    if (req.method === 'GET') {
      let q = supabase.from('historico').select('*');
      if (req.query.tabela && req.query.tabela !== 'todos') q = q.eq('tabela', req.query.tabela);
      if (req.query.acao && req.query.acao !== 'todos') q = q.eq('acao', req.query.acao);
      if (req.query.usuario && req.query.usuario !== 'todos') q = q.eq('usuario', req.query.usuario);
      if (req.query.registro_id) q = q.eq('registro_id', String(req.query.registro_id));
      if (req.query.de) q = q.gte('criado_em', req.query.de);
      if (req.query.ate) {
        const ate = String(req.query.ate);
        q = q.lte('criado_em', ate.length === 10 ? `${ate}T23:59:59.999Z` : ate);
      }
      if (req.query.busca) {
        const termo = String(req.query.busca)
          .replace(/[,()]/g, ' ')
          .trim();
        if (termo) {
          const p = `%${escapeLike(termo)}%`;
          q = q.or(
            `descricao.ilike.${p},registro_codigo.ilike.${p},usuario.ilike.${p}`
          );
        }
      }
      const limite = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
      const { data, error } = await q.order('criado_em', { ascending: false }).limit(limite);
      if (error) throw error;
      const { data: usuarios } = await supabase.from('usuarios').select('nome').order('nome');
      return res.status(200).json({
        itens: (data || []).map((h) => ({ ...h, modulo: ROTULOS[h.tabela] || h.tabela })),
        tabelas: Object.keys(ROTULOS).map((k) => ({ valor: k, rotulo: ROTULOS[k] })),
        usuarios: (usuarios || []).map((u) => u.nome),
      });
    }
    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    return responderErro(res, err);
  }
}
