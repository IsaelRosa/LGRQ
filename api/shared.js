import supabase from './db-client.js';
import { escapeLike, toSqlDate, withTransaction } from './db-client.js';
import { exigirAuth, exigirEdicao, exigirAdmin, HttpError, responderErro } from './authz.js';

/* ------------------------------------------------------------------ */
/* CORS                                                               */
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

/** Usuário da requisição. Lança 401 se não houver sessão válida. */
export async function currentUser(req) {
  return exigirAuth(req);
}

/* ------------------------------------------------------------------ */
/* Trilha de auditoria                                                 */
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
    const { error } = await supabase.from('historico').insert({
      tabela,
      registro_id: String(registroId ?? ''),
      registro_codigo: codigo || `#${registroId ?? ''}`,
      acao,
      descricao: String(descricao || `${acao} em ${tabela}`).slice(0, 500),
      usuario: usuario?.nome || 'Sistema LGRP',
      usuario_email: usuario?.email || '',
      dados_anteriores: limpar(antes),
      dados_novos: limpar(depois),
      mudancas: mudancas || null,
    });
    if (error) console.error('registrarHistorico error', error);
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
/* Numeração automática de documentos                                 */
/* ------------------------------------------------------------------ */

/**
 * Gera o próximo código sequencial (ex.: PED-2026-0007).
 *
 * Roda em transação com `SELECT ... FOR UPDATE`, evitando que duas requisições
 * simultâneas gerem o mesmo código (o índice único de `codigo` transformaria
 * isso em erro 500).
 */
export async function proximoCodigo(tabela, prefixo, campo = 'codigo') {
  const ano = new Date().getFullYear();
  // `prefixo` e `campo` vêm do código (nunca do usuário) e o padrão já
  // contém o curinga desejado — escapar aqui o transformaria em literal.
  const padrao = `${prefixo}-${ano}-%`;

  return withTransaction(async (conn) => {
    const [ultimos] = await conn.query(
      `SELECT \`${campo}\` AS \`v\` FROM \`${tabela}\` WHERE \`${campo}\` LIKE ? ORDER BY \`id\` DESC LIMIT 1 FOR UPDATE`,
      [padrao]
    );

    let n = 1;
    const ultimo = ultimos[0] && ultimos[0].v;
    if (ultimo) {
      const partes = String(ultimo).split('-');
      const num = parseInt(partes[partes.length - 1], 10);
      if (!Number.isNaN(num) && num > 0) n = num + 1;
    }
    return `${prefixo}-${ano}-${String(n).padStart(4, '0')}`;
  });
}

/* ------------------------------------------------------------------ */
/* Motor de alertas automáticos                                       */
/* ------------------------------------------------------------------ */

const DIAS = 86400000;
const ALERTA_INTERVALO_MS = 5 * 60 * 1000;
let ultimoGeramento = 0;
let alertasEmCurso = null;

/**
 * Gera os alertas de vencimento/estoque.
 *
 * Era executado a cada GET de notificações e do dashboard, o que significava
 * seis consultas de 1000 linhas por página aberta. O resultado é memorizado
 * por 5 minutos — os alertas derivam de dados que mudam esporadicamente.
 */
export async function gerarAlertas({ forcar = false } = {}) {
  const agora = Date.now();
  if (!forcar && agora - ultimoGeramento < ALERTA_INTERVALO_MS) return 0;
  if (alertasEmCurso) return alertasEmCurso;

  alertasEmCurso = gerarAlertasInterno()
    .catch((e) => {
      console.error('gerarAlertas error', e);
      return 0;
    })
    .finally(() => {
      ultimoGeramento = Date.now();
      alertasEmCurso = null;
    });

  return alertasEmCurso;
}

async function gerarAlertasInterno() {
  const hoje = new Date();
  const iso = hoje.toISOString();
  const em30 = new Date(hoje.getTime() + 30 * DIAS).toISOString();
  const ha7 = new Date(hoje.getTime() - 7 * DIAS).toISOString();
  const ha30 = new Date(hoje.getTime() - 30 * DIAS).toISOString();

  const [existentes, reagentes, solventes, pedidos, vidrarias, tratamentos] = await Promise.all([
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
      .select('id,codigo,tipo,laboratorio,nivel_contaminacao,status,contaminante,quantidade')
      .limit(1000),
    supabase.from('tratamentos').select('id,codigo,residuo,metodo,status,data_inicio').limit(1000),
  ]);

  const chave = (t, o, i) => `${t}|${o}|${i}`;
  const jaExiste = new Set((existentes.data || []).map((n) => chave(n.tipo, n.origem, n.origem_id)));
  const novas = [];

  const push = (n) => {
    const k = chave(n.tipo, n.origem, n.origem_id);
    if (jaExiste.has(k)) return;
    jaExiste.add(k);
    novas.push(n);
  };

  // `data_validade` chega como ISO ('...Z') graças à hidratação do db-client.
  // A comparação com `iso` abaixo depende disso: com objetos Date, o teste
  // seria sempre falso e nenhum alerta apareceria.
  for (const r of reagentes.data || []) {
    if (!r.data_validade) continue;
    if (r.data_validade < iso) {
      push({
        tipo: 'Reagente vencido',
        severidade: 'critica',
        titulo: `Reagente vencido: ${r.nome}`,
        mensagem: `O reagente ${r.nome} (${r.codigo || 'sem código'}) do laboratório ${
          r.laboratorio || '—'
        } está vencido desde ${new Date(r.data_validade).toLocaleDateString(
          'pt-BR'
        )}. Segregar e solicitar coleta imediata.`,
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

  for (const s of solventes.data || []) {
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

  for (const p of pedidos.data || []) {
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

  for (const v of vidrarias.data || []) {
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

  for (const t of tratamentos.data || []) {
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
/* Fábrica de rotas CRUD com auditoria automática                     */
/* ------------------------------------------------------------------ */

function pick(obj, campos) {
  const out = {};
  for (const c of campos) {
    if (obj[c] !== undefined) out[c] = obj[c] === '' ? null : obj[c];
  }
  return out;
}

/** Datas de filtro (`de`/`ate`) chegam como ISO e viram literal MySQL. */
function normDate(v) {
  return v ? toSqlDate(v) : v;
}

/** Monta o filtro textual (`campo.ilike.%termo%`) com escaping correto. */
function filtroBusca(searchable, termo) {
  const limpo = String(termo)
    .replace(/[,()]/g, ' ')
    .trim();
  if (!limpo || !searchable.length) return null;
  return searchable.map((c) => `${c}.ilike.%${escapeLike(limpo)}%`).join(',');
}

/**
 * Executa um hook de validação, convertendo `Error` comum em `HttpError(400)`.
 * Sem isto, uma regra de negócio violada (e-mail inválido, perfil
 * desconhecido) apareceria como 500 — falha do servidor — em vez de 400.
 */
async function validarRegra(fn) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, e?.message || 'Dados inválidos.');
  }
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
    // 'edicao' -> perfis com permissão de escrita (padrão)
    // 'admin'  -> apenas Administradores
    permissaoEscrita = 'edicao',
    sanitize = null,
  } = opts;

  return async function handler(req, res) {
    if (setCORS(req, res)) return;
    try {
      const user = await currentUser(req);

      if (req.method !== 'GET') {
        if (permissaoEscrita === 'admin') exigirAdmin(user);
        else exigirEdicao(user);
      }

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
        if (req.query.busca) {
          const expressao = filtroBusca(searchable, req.query.busca);
          if (expressao) q = q.or(expressao);
        }
        if (req.query.de) q = q.gte(campoData, normDate(req.query.de));
        if (req.query.ate) {
          const ate = String(req.query.ate);
          q = q.lte(campoData, ate.length === 10 ? `${ate}T23:59:59.999Z` : ate);
        }
        const { data, error } = await q.order(ordenarPor, { ascending: ascendente }).limit(3000);
        if (error) throw error;
        let rows = data || [];
        if (transform) rows = rows.map(transform);
        if (sanitize) rows = rows.map(sanitize);
        return res.status(200).json(rows);
      }

      /* ----------------------------- POST */
      if (req.method === 'POST') {
        const bruto = req.body || {};
        const body = pick(bruto, campos);
        if (prefixo && !body.codigo) body.codigo = await proximoCodigo(tabela, prefixo);
        if (beforeInsert) await validarRegra(() => beforeInsert(body, bruto, user));
        const { data, error } = await supabase
          .from(tabela)
          .insert(body)
          .select('*')
          .single();
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
        const saida = transform ? transform(data) : data;
        return res.status(201).json(sanitize ? sanitize(saida) : saida);
      }

      /* ------------------------------ PUT */
      if (req.method === 'PUT') {
        const bruto = req.body || {};
        const id = bruto.id ?? req.query.id;
        if (!id) return res.status(400).json({ error: 'Campo "id" é obrigatório.' });
        const { data: antes } = await supabase
          .from(tabela)
          .select('*')
          .eq('id', id)
          .limit(1);
        const registro = antes && antes[0];
        if (!registro) return res.status(404).json({ error: 'Registro não encontrado.' });
        const body = pick(bruto, campos);
        if (beforeUpdate) await validarRegra(() => beforeUpdate(body, bruto, registro, user));
        if (temAtualizadoEm) body.atualizado_em = new Date().toISOString();
        const { data, error } = await supabase
          .from(tabela)
          .update(body)
          .eq('id', id)
          .select('*')
          .single();
        if (error) throw error;
        const mudancas = diffCampos(registro, data, campos);
        await registrarHistorico({
          tabela,
          registroId: id,
          codigo: data.codigo || `#${id}`,
          acao: 'UPDATE',
          descricao: `${rotulo} atualizado${data.codigo ? ` (${data.codigo})` : ''}`,
          usuario: user,
          antes: registro,
          depois: data,
          mudancas: Object.keys(mudancas).length ? mudancas : null,
        });
        if (afterWrite) await afterWrite('PUT', data, registro, user);
        const saida = transform ? transform(data) : data;
        return res.status(200).json(sanitize ? sanitize(saida) : saida);
      }

      /* --------------------------- DELETE */
      if (req.method === 'DELETE') {
        const id = (req.body || {}).id ?? req.query.id;
        if (!id) return res.status(400).json({ error: 'Campo "id" é obrigatório.' });
        const { data: antes } = await supabase
          .from(tabela)
          .select('*')
          .eq('id', id)
          .limit(1);
        const { error } = await supabase.from(tabela).delete().eq('id', id);
        if (error) throw error;
        await registrarHistorico({
          tabela,
          registroId: id,
          codigo: antes?.[0]?.codigo || `#${id}`,
          acao: 'DELETE',
          descricao: `${rotulo} excluído${antes?.[0]?.codigo ? ` (${antes[0].codigo})` : ''}`,
          usuario: user,
          antes: antes?.[0] || null,
          depois: null,
        });
        return res.status(200).json({ ok: true });
      }

      res.status(405).json({ error: 'Método não permitido' });
    } catch (err) {
      return responderErro(res, err);
    }
  };
}

export { supabase, HttpError, responderErro };
