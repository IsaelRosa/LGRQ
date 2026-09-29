import { setCORS, gerarAlertas, supabase, currentUser, responderErro } from './shared.js';
import { exigirEdicao } from './authz.js';

export default async function handler(req, res) {
  if (setCORS(req, res)) return;
  try {
    const user = await currentUser(req);
    if (req.method !== 'GET') exigirEdicao(user);

    if (req.method === 'GET') {
      await gerarAlertas();
      let q = supabase.from('notificacoes').select('*');
      if (req.query.lida === 'true') q = q.eq('lida', true);
      if (req.query.lida === 'false') q = q.eq('lida', false);
      if (req.query.severidade && req.query.severidade !== 'todos') {
        q = q.eq('severidade', req.query.severidade);
      }
      if (req.query.tipo && req.query.tipo !== 'todos') q = q.eq('tipo', req.query.tipo);
      const { data, error } = await q.order('criado_em', { ascending: false }).limit(300);
      if (error) throw error;
      return res.status(200).json(data || []);
    }

    if (req.method === 'POST') {
      const { titulo, mensagem, severidade = 'info', tipo = 'Aviso', origem, origem_id } =
        req.body || {};
      if (!titulo) return res.status(400).json({ error: 'Título é obrigatório.' });
      const { data, error } = await supabase
        .from('notificacoes')
        .insert({ titulo, mensagem, severidade, tipo, origem, origem_id: origem_id || null })
        .select('*')
        .single();
      if (error) throw error;
      return res.status(201).json(data);
    }

    if (req.method === 'PUT') {
      const { id, lida, todas } = req.body || {};
      if (todas) {
        const { data, error } = await supabase
          .from('notificacoes')
          .update({ lida: lida !== false })
          .eq('lida', lida === false)
          .select('*');
        if (error) throw error;
        return res.status(200).json(data || []);
      }
      if (!id) return res.status(400).json({ error: 'Campo "id" é obrigatório.' });
      const { data, error } = await supabase
        .from('notificacoes')
        .update({ lida: !!lida })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const { id, todasLidas } = req.body || {};
      if (todasLidas) {
        const { error } = await supabase.from('notificacoes').delete().eq('lida', true);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }
      if (!id) return res.status(400).json({ error: 'Campo "id" é obrigatório.' });
      const { error } = await supabase.from('notificacoes').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Método não permitido' });
  } catch (err) {
    return responderErro(res, err);
  }
}
