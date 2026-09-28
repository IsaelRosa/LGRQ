import supabase from './db-client.js';

/* ------------------------------------------------------------------ */
/* CORS + auth helpers                                                 */
/* ------------------------------------------------------------------ */

export function setCORS(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export async function currentUser(req) {
  const raw = req.headers?.authorization || '';
  const token = raw.replace(/^Bearer\s+/i, '');
  const fallback = { nome: 'Sistema LGRP', email: 'sistema@lgrp.edu.br', papel: 'Sistema' };
  if (!token) return fallback;
  try {
    const { data } = await supabase.auth.getUser(token);
    const email = data?.user?.email || '';
    if (!email) return fallback;
    const { data: rows } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .limit(1);
    const u = rows && rows[0];
    const nomeMeta =
      data?.user?.user_metadata?.full_name || data?.user?.user_metadata?.name || '';
    return {
      id: u?.id ?? null,
      nome: u?.nome || nomeMeta || email.split('@')[0],
      email,
      papel: u?.papel || 'Consultor',
      setor: u?.setor || '',
    };
  } catch (e) {
    console.error('currentUser error', e);
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/* Trilha de auditoria (histórico de alterações)                       */
/* ------------------------------------------------------------------ */

export async function registrarHistorico({
  tabela,
  registroId,
  codigo,
  acao,
  descricao,
  usuario,
  antes = null,
  depois = null,
  mudancas = null,
}) {
  try {
    await supabase.from('historico').insert({
      tabela,
      registro_id: String(registroId ?? ''),
      registro_codigo: codigo || `#${registroId ?? ''}`,
      acao,
      descricao: descricao || `${acao} em ${tabela}`,
      usuario: usuario?.nome || 'Sistema LGRP',
      usuario_email: usuario?.email || '',
      dados_anteriores: limpar(antes),
      dados_novos: limpar(depois),
      mudancas: mudancas || null,
    });
  } catch (e) {
    console.error('registrarHistorico error', e);
  }
}

function limpar(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

export function diffCampos(antes, depois, campos) {
  const mudancas = {};
  for (const c of campos) {
    const a = antes?.[c];
    const d = depois?.[c];
    const sa = a === null || a === undefined ? '' : String(a);
    const sd = d === null || d === undefined ? '' : String(d);
    if (sa !== sd) mudancas[c] = { antes: a ?? null, depois: d ?? null };
  }
  return mudancas;
}

/* ------------------------------------------------------------------ */
/* Numeração automática de documentos                                  */
/* ------------------------------------------------------------------ */

export async function proximoCodigo(tabela, prefixo, campo = 'codigo') {
  const ano = new Date().getFullYear();
  const padrao = `${prefixo}-${ano}-%`;
  const { data } = await supabase
    .from(tabela)
    .select(campo)
    .like(campo, padrao)
    .order('id', { ascending: false })
    .limit(1);
  let n = 1;
  const ultimo = data && data[0] && data[0][campo];
  if (ultimo) {
    const partes = String(ultimo).split('-');
    const num = parseInt(partes[partes.length - 1], 10);
    if (!Number.isNaN(num)) n = num + 1;
  }
  return `${prefixo}-${ano}-${String(n).padStart(4, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Motor de alertas automáticos                                        */
/* ------------------------------------------------------------------ */

const DIAS = 86400000;

export async function gerarAlertas() {
  const hoje = new Date();
  const iso = hoje.toISOString();
  const em30 = new Date(hoje.getTime() + 30 * DIAS).toISOString();
  const em7 = new Date(hoje.getTime() + 7 * DIAS).toISOString();
  const ha7 = new Date(hoje.getTime() - 7 * DIAS).toISOString();
  const ha30 = new Date(hoje.getTime() - 30 * DIAS).toISOString();

  const [
    { data: existentes },
    { data: reagentes },
    { data: solventes },
    { data: pedidos },
    { data: vidrarias },
    { data: tratamentos },
  ] = await Promise.all([
    supabase.from('notificacoes').select('tipo,origem,origem_id').eq('lida', false).limit(1000),
    supabase.from('reagentes').select('id,codigo,nome,data_validade,laboratorio').limit(1000),
    supabase
      .from('solventes')
      .select('id,codigo,nome,volume_total_l,volume_restante_l,data_validade,laboratorio,categoria')
      .limit(1000),
    supabase
      .from('pedidos_coleta')
      .select('id,codigo,laboratorio,status,data_solicitacao,data_prevista,tipo_residuo,prioridade')
      .limit(1000),
    supabase
      .from('vidrarias')
      .select('id,codigo,tipo,laboratorio,nivel_contaminacao,status,contaminante')
      .limit(1000),
    supabase
      .from('tratamentos')
      .select('id,codigo,residuo,metodo,status,data_inicio')
      .limit(1000),
  ]);

  const chave = (t, o, i) => `${t}|${o}|${i}`;
  const jaExiste = new Set((existentes || []).map((n) => chave(n.tipo, n.origem, n.origem_id)));
  const novas = [];

  const push = (n) => {
    const k = chave(n.tipo, n.origem, n.origem_id);
    if (jaExiste.has(k)) return;
    jaExiste.add(k);
    novas.push(n);
  };

  for (const r of reagentes || []) {
    if (!r.data_validade) continue;
    if (r.data_validade < iso) {
      push({
        tipo: 'Reagente vencido',
        severidade: 'critica',
        titulo: `Reagente vencido: ${r.nome}`,
        mensagem: `O reagente ${r.nome} (${r.codigo || 'sem código'}) do laboratório ${
          r.laboratorio || '—'
        } está vencido desde ${new Date(r.data_validade).toLocaleDateString('pt-BR')}. Segregar e solicitar coleta imediata.`,
        origem: 'reagentes',
        origem_id: String(r.id),
      });
    } else if (r.data_validade <= em30) {
      const dias = Math.max(0, Math.ceil((new Date(r.data_validade) - hoje) / DIAS));
      push({
        tipo: 'Reagente a vencer',
        severidade: 'aviso',
        titulo: `Reagente vence em ${dias} dia(s): ${r.nome}`,
        mensagem: `O reagente ${r.nome} (${r.codigo || 'sem código'}) vence em ${new Date(
          r.data_validade
        ).toLocaleDateString('pt-BR')}. Priorize o uso ou programe a destinação.`,
        origem: 'reagentes',
        origem_id: String(r.id),
      });
    }
  }

  for (const s of solventes || []) {
    const total = Number(s.volume_total_l || 0);
    const rest = Number(s.volume_restante_l || 0);
    if (s.data_validade && s.data_validade < iso) {
      push({
        tipo: 'Solvente vencido',
        severidade: 'critica',
        titulo: `Solvente vencido: ${s.nome}`,
        mensagem: `O solvente ${s.nome} (${s.codigo || '—'}) está com validade expirada. Encaminhar para recuperação ou destinação final.`,
        origem: 'solventes',
        origem_id: String(s.id),
      });
    }
    if (total > 0 && rest > 0 && rest / total <= 0.15) {
      push({
        tipo: 'Estoque baixo',
        severidade: 'aviso',
        titulo: `Estoque baixo: ${s.nome}`,
        mensagem: `Restam ${rest.toFixed(1)} L de ${total.toFixed(1)} L de ${s.nome} (${
          s.laboratorio || '—'
        }). Considere reposição ou coleta do resíduo.`,
        origem: 'solventes',
        origem_id: String(s.id),
      });
    }
  }

  for (const p of pedidos || []) {
    const aberto = ['Solicitado', 'Agendado'].includes(p.status);
    if (aberto && p.data_prevista && p.data_prevista < iso) {
      push({
        tipo: 'Coleta atrasada',
        severidade: 'critica',
        titulo: `Coleta atrasada: ${p.codigo}`,
        mensagem: `O pedido ${p.codigo} (${p.laboratorio}) está com status "${p.status}" e a data prevista (${new Date(
          p.data_prevista
        ).toLocaleDateString('pt-BR')}) já foi ultrapassada.`,
        origem: 'pedidos_coleta',
        origem_id: String(p.id),
      });
    } else if (p.status === 'Solicitado' && p.data_solicitacao && p.data_solicitacao < ha7) {
      push({
        tipo: 'Pedido pendente',
        severidade: 'aviso',
        titulo: `Pedido sem agendamento: ${p.codigo}`,
        mensagem: `O pedido ${p.codigo} (${p.laboratorio} — ${p.tipo_residuo}) aguarda agendamento de coleta há mais de 7 dias.`,
        origem: 'pedidos_coleta',
        origem_id: String(p.id),
      });
    }
    if (p.status === 'Em Tratamento' && p.prioridade === 'Crítica') {
      push({
        tipo: 'Prioridade crítica',
        severidade: 'aviso',
        titulo: `Resíduo de prioridade crítica em tratamento: ${p.codigo}`,
        mensagem: `O pedido ${p.codigo} (${p.tipo_residuo}) possui prioridade crítica e está em tratamento. Acompanhe o prazo.`,
        origem: 'pedidos_coleta',
        origem_id: String(p.id),
      });
    }
  }

  for (const v of vidrarias || []) {
    if (v.status === 'Aguardando Descontaminação' && v.nivel_contaminacao === 'Crítico') {
      push({
        tipo: 'Contaminação crítica',
        severidade: 'critica',
        titulo: `Vidraria com contaminação crítica: ${v.codigo}`,
        mensagem: `${v.quantidade || 1} unidade(s) de ${v.tipo} (${v.laboratorio}) contaminada(s) com ${
          v.contaminante || 'agente não informado'
        } aguardam descontaminação.`,
        origem: 'vidrarias',
        origem_id: String(v.id),
      });
    }
  }

  for (const t of tratamentos || []) {
    if (t.status === 'Em Andamento' && t.data_inicio && t.data_inicio < ha30) {
      push({
        tipo: 'Tratamento prolongado',
        severidade: 'aviso',
        titulo: `Tratamento há mais de 30 dias: ${t.codigo}`,
        mensagem: `O tratamento ${t.codigo} (${t.metodo} — ${t.residuo}) iniciou em ${new Date(
          t.data_inicio
        ).toLocaleDateString('pt-BR')} e ainda não foi concluído.`,
        origem: 'tratamentos',
        origem_id: String(t.id),
      });
    }
  }

  if (novas.length) {
    const { error } = await supabase.from('notificacoes').insert(novas);
    if (error) console.error('gerarAlertas insert', error);
  }
  return novas.length;
}

/* ------------------------------------------------------------------ */
/* Fábrica de rotas CRUD com auditoria automática                      */
/* ------------------------------------------------------------------ */

function pick(obj, campos) {
  const out = {};
  for (const c of campos) {
    if (obj[c] !== undefined) out[c] = obj[c] === '' ? null : obj[c];
  }
  return out;
}

function normDate(v) {
  if (!v) return v;
  if (typeof v === 'string' && v.length === 10) return v;
  return v;
}

export function makeCrud(opts) {
  const {
    tabela,
    prefixo = null,
    campos = [],
    searchable = [],
    rotulo = 'Registro',
    ordenarPor = 'id',
    ascendente = false,
    campoData = 'criado_em',
    temAtualizadoEm = true,
    transform = null,
    beforeInsert = null,
    beforeUpdate = null,
    afterWrite = null,
  } = opts;

  return async function handler(req, res) {
    if (setCORS(req, res)) return;
    try {
      const user = await currentUser(req);

      /* ------------------------------ GET */
      if (req.method === 'GET') {
        let q = supabase.from(tabela).select('*');
        for (const f of campos) {
          const v = req.query[f];
          if (v !== undefined && v !== '' && v !== 'todos' && v !== 'Todas' && v !== 'Todos') {
            q = q.eq(f, v);
          }
        }
        if (req.query.pedido_id) q = q.eq('pedido_id', req.query.pedido_id);
        if (req.query.busca && searchable.length) {
          const termo = String(req.query.busca).replace(/[,()%]/g, ' ').trim();
          if (termo) {
            q = q.or(searchable.map((c) => `${c}.ilike.%${termo}%`).join(','));
          }
        }
        if (req.query.de) q = q.gte(campoData, normDate(req.query.de));
        if (req.query.ate) {
          const ate = String(req.query.ate);
          q = q.lte(campoData, ate.length === 10 ? `${ate}T23:59:59.999Z` : ate);
        }
        const { data, error } = await q
          .order(ordenarPor, { ascending: ascendente })
          .limit(3000);
        if (error) throw error;
        let rows = data || [];
        if (transform) rows = rows.map(transform);
        return res.status(200).json(rows);
      }

      /* ----------------------------- POST */
      if (req.method === 'POST') {
        const bruto = req.body || {};
        const body = pick(bruto, campos);
        if (prefixo && !body.codigo) body.codigo = await proximoCodigo(tabela, prefixo);
        if (beforeInsert) await beforeInsert(body, bruto, user);
        const { data, error } = await supabase.from(tabela).insert(body).select('*').single();
        if (error) throw error;
        await registrarHistorico({
          tabela,
          registroId: data.id,
          codigo: data.codigo || `#${data.id}`,
          acao: 'INSERT',
          descricao: `${rotulo} criado${data.codigo ? ` (${data.codigo})` : ''}`,
          usuario: user,
          antes: null,
          depois: data,
        });
        if (afterWrite) await afterWrite('POST', data, null, user);
        return res.status(201).json(transform ? transform(data) : data);
      }

      /* ------------------------------ PUT */
      if (req.method === 'PUT') {
        const bruto = req.body || {};
        const id = bruto.id ?? req.query.id;
        if (!id) return res.status(400).json({ error: 'Campo "id" é obrigatório.' });
        const { data: antes } = await supabase.from(tabela).select('*').eq('id', id).single();
        if (!antes) return res.status(404).json({ error: 'Registro não encontrado.' });
        const body = pick(bruto, campos);
        if (beforeUpdate) await beforeUpdate(body, bruto, antes, user);
        if (temAtualizadoEm) body.atualizado_em = new Date().toISOString();
        const { data, error } = await supabase
          .from(tabela)
          .update(body)
          .eq('id', id)
          .select('*')
          .single();
        if (error) throw error;
        const mudancas = diffCampos(antes, data, campos);
        await registrarHistorico({
          tabela,
          registroId: id,
          codigo: data.codigo || `#${id}`,
          acao: 'UPDATE',
          descricao: `${rotulo} atualizado${data.codigo ? ` (${data.codigo})` : ''}`,
          usuario: user,
          antes,
          depois: data,
          mudancas: Object.keys(mudancas).length ? mudancas : null,
        });
        if (afterWrite) await afterWrite('PUT', data, antes, user);
        return res.status(200).json(transform ? transform(data) : data);
      }

      /* --------------------------- DELETE */
      if (req.method === 'DELETE') {
        const id = (req.body || {}).id ?? req.query.id;
        if (!id) return res.status(400).json({ error: 'Campo "id" é obrigatório.' });
        const { data: antes } = await supabase.from(tabela).select('*').eq('id', id).single();
        const { error } = await supabase.from(tabela).delete().eq('id', id);
        if (error) throw error;
        await registrarHistorico({
          tabela,
          registroId: id,
          codigo: antes?.codigo || `#${id}`,
          acao: 'DELETE',
          descricao: `${rotulo} excluído${antes?.codigo ? ` (${antes.codigo})` : ''}`,
          usuario: user,
          antes,
          depois: null,
        });
        return res.status(200).json({ ok: true });
      }

      res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
      console.error('API error:', err);
      res.status(500).json({ error: err.message });
    }
  };
}

export { supabase };
