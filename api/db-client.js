/**
 * Cliente MySQL com uma camada de compatibilidade que expõe a API do
 * Supabase/PostgREST (`from().select().eq().or().order().limit().single()`).
 *
 * Isso permite que todo o código de negócio em `api/` permaneça inalterado
 * enquanto os dados ficam 100% no MySQL/MariaDB da Hostinger.
 */
import mysql from 'mysql2/promise';

const env = process.env;

/* ------------------------------------------------------------------ */
/* Colunas de data/boolean por tabela (fonte: lgrp_mysql.sql)          */
/* ------------------------------------------------------------------ */

const DATE_COLUMNS = {
  usuarios: ['criado_em', 'atualizado_em'],
  pedidos_coleta: [
    'data_solicitacao',
    'data_prevista',
    'data_coleta',
    'criado_em',
    'atualizado_em',
  ],
  coletas: ['data_coleta', 'criado_em'],
  tratamentos: ['data_inicio', 'data_conclusao', 'criado_em', 'atualizado_em'],
  solventes: ['data_recebimento', 'data_validade', 'criado_em', 'atualizado_em'],
  reagentes: ['data_aquisicao', 'data_validade', 'criado_em', 'atualizado_em'],
  vidrarias: ['data_registro', 'data_descontaminacao', 'criado_em', 'atualizado_em'],
  indicadores_mensais: ['criado_em', 'atualizado_em'],
  notificacoes: ['criado_em'],
  historico: ['criado_em'],
};

const BOOL_COLUMNS = {
  usuarios: ['ativo'],
  notificacoes: ['lida'],
  solventes: ['inflamavel'],
};

/* ------------------------------------------------------------------ */
/* Pool                                                                */
/* ------------------------------------------------------------------ */

const pool = mysql.createPool({
  host: env.MYSQL_HOST || env.DB_HOST || 'localhost',
  port: Number(env.MYSQL_PORT || env.DB_PORT || 3306),
  user: env.MYSQL_USER || env.DB_USER,
  password: env.MYSQL_PASSWORD || env.DB_PASSWORD,
  database: env.MYSQL_DATABASE || env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(env.MYSQL_CONNECTION_LIMIT || 5),
  queueLimit: 0,
  charset: 'utf8mb4',
  // DATETIME/TIMESTAMP como string ISO — evita deslocamento de fuso horário
  // e mantém o contrato de dados idêntico ao que o frontend já consome.
  dateStrings: true,
  // DECIMAL como Number — sem isso o Recharts e os cálculos somam strings.
  decimalNumbers: true,
  supportBigNumbers: true,
  bigNumberStrings: false,
  multipleStatements: false,
  ssl: env.MYSQL_SSL === 'true' ? {} : undefined,
});

/* ------------------------------------------------------------------ */
/* Normalização de datas                                               */
/* ------------------------------------------------------------------ */

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Data-hora SEM offset: o valor já está em UTC por convenção do projeto.
// Data-hora sem offset: o projeto trata esses valores como UTC.
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/** Converte uma data para o formato aceito pelo MySQL em colunas DATETIME. */
export function toSqlDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 23).replace('T', ' ');
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString().slice(0, 23).replace('T', ' ');
  }
  if (typeof value !== 'string') return value;

  const s = value.trim();
  if (ISO_DATE.test(s)) return `${s} 00:00:00.000`;
  if (!ISO_DATETIME.test(s)) return value; // não é data — devolve intacto

  // Sem offset: assume UTC em vez de converter da hora local, o que
  // deslocaria o horário em fusos negativos do Brasil (UTC-3).
  if (NAIVE_DATETIME.test(s)) {
    return `${s.includes('T') ? s.replace('T', ' ') : s}`.padEnd(23, '0');
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 23).replace('T', ' ');
}

/** Converte a saída do MySQL para o formato ISO que o frontend consome. */
function fromSqlDate(value) {
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (ISO_DATE.test(s)) return `${s}T00:00:00.000Z`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
    return `${s.replace(' ', 'T')}Z`;
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* Utilidades de valor                                                 */
/* ------------------------------------------------------------------ */

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function identifier(value) {
  if (!IDENTIFIER.test(String(value))) throw new Error(`Identificador SQL inválido: ${value}`);
  return `\`${value}\``;
}

function columns(value) {
  if (!value || value === '*') return '*';
  return String(value)
    .split(',')
    .map((column) => identifier(column.trim()))
    .join(', ');
}

/** Escapa os curingas do LIKE para que o termo seja tratado como texto literal. */
export function escapeLike(term) {
  return String(term).replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Monta um padrão `campo.ilike.%termo%` no formato aceito por `parseOr`. */
export function ilikeTerm(campo, termo) {
  return `${campo}.ilike.%${escapeLike(termo)}%`;
}

function serialize(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return toSqlDate(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    // O frontend envia datas em ISO ('...T...Z'); o MySQL/MariaDB só aceita
    // 'YYYY-MM-DD HH:MM:SS.mmm' em colunas DATETIME.
    return toSqlDate(value);
  }
  if (typeof value === 'object' && !Buffer.isBuffer(value)) return JSON.stringify(value);
  return value;
}

/** Aplica a mesma normalização usada na escrita, mas para parâmetros de filtro. */
function normalizeParam(value) {
  if (typeof value === 'string') return toSqlDate(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* WHERE (OR)                                                          */
/* ------------------------------------------------------------------ */

/**
 * Interpreta a sintaxe `campo.operador.valor` usada pelo código existente:
 *   `nome.ilike.%ana%`  →  (`nome` LIKE ?)
 *   `status.eq.Solicitado` → (`status` = ?)
 */
function parseOr(value, params) {
  const expressions = [];
  for (const part of String(value).split(',')) {
    const match = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\.(eq|neq|like|ilike|gt|gte|lt|lte)\.(.*)$/s);
    if (!match) {
      // Um termo com vírgula não deve derrubar a consulta inteira: descarta-o.
      continue;
    }
    const [, field, operator, raw] = match;
    const valor = raw.startsWith('.') ? raw.slice(1) : raw;
    const sqlOperator = {
      eq: '=',
      neq: '<>',
      like: 'LIKE',
      ilike: 'LIKE',
      gt: '>',
      gte: '>=',
      lt: '<',
      lte: '<=',
    }[operator];

    // `%termo%` — curingas deliberados; demais valores vão escapados.
    const like = /%.*%/.test(valor) ? valor : `%${escapeLike(valor)}%`;
    params.push(operator === 'like' || operator === 'ilike' ? like : normalizeParam(valor));
    expressions.push(`${identifier(field)} ${sqlOperator} ?`);
  }
  if (!expressions.length) return null;
  return `(${expressions.join(' OR ')})`;
}

/* ------------------------------------------------------------------ */
/* Hidratação de linhas                                                */
/* ------------------------------------------------------------------ */

function hydrateRow(row, table) {
  if (!row || typeof row !== 'object') return row;
  const dates = DATE_COLUMNS[table];
  const bools = BOOL_COLUMNS[table];
  let changed = false;
  const out = { ...row };

  if (dates) {
    for (const col of dates) {
      if (out[col] !== null && out[col] !== undefined) {
        const v = fromSqlDate(out[col]);
        if (v !== out[col]) {
          out[col] = v;
          changed = true;
        }
      }
    }
  }
  if (bools) {
    for (const col of bools) {
      if (out[col] !== null && out[col] !== undefined) {
        out[col] = Boolean(Number(out[col]));
        changed = true;
      }
    }
  }
  return changed ? out : row;
}

function hydrateRows(rows, table) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((r) => hydrateRow(r, table));
}

/* ------------------------------------------------------------------ */
/* QueryBuilder (API compatível com PostgREST)                         */
/* ------------------------------------------------------------------ */

class QueryBuilder {
  constructor(table) {
    if (!IDENTIFIER.test(String(table))) throw new Error(`Tabela inválida: ${table}`);
    this.table = identifier(table);
    this.rawTable = table;
    this.action = 'select';
    this.selected = '*';
    this.filters = [];
    this.params = [];
    this.orderBy = null;
    this.maxRows = null;
    this.returnRows = false;
    this.singleRow = false;
    this.payload = null;
  }

  select(fields = '*') {
    this.selected = columns(fields);
    this.returnRows = true;
    return this;
  }

  insert(payload) {
    this.action = 'insert';
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  update(payload) {
    this.action = 'update';
    this.payload = payload || {};
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  eq(field, value) {
    return this.filter(field, '=', value);
  }

  neq(field, value) {
    return this.filter(field, '<>', value);
  }

  gt(field, value) {
    return this.filter(field, '>', value);
  }

  gte(field, value) {
    return this.filter(field, '>=', value);
  }

  lt(field, value) {
    return this.filter(field, '<', value);
  }

  lte(field, value) {
    return this.filter(field, '<=', value);
  }

  like(field, value) {
    return this.filter(field, 'LIKE', value);
  }

  ilike(field, value) {
    return this.filter(field, 'LIKE', value);
  }

  filter(field, operator, value) {
    this.filters.push(`${identifier(field)} ${operator} ?`);
    this.params.push(normalizeParam(value));
    return this;
  }

  or(value) {
    const clause = parseOr(value, this.params);
    if (clause) this.filters.push(clause);
    return this;
  }

  in(field, values) {
    const list = (Array.isArray(values) ? values : []).map(normalizeParam);
    if (!list.length) {
      this.filters.push('1 = 0');
      return this;
    }
    this.filters.push(`${identifier(field)} IN (${list.map(() => '?').join(', ')})`);
    this.params.push(...list);
    return this;
  }

  order(field, options = {}) {
    // Padrão do Supabase é ASC — mantido para não alterar a ordenação existente.
    const dir = options.ascending === false ? 'DESC' : 'ASC';
    this.orderBy = `${identifier(field)} ${dir}`;
    return this;
  }

  limit(value) {
    const n = Number(value);
    this.maxRows = Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
    return this;
  }

  single() {
    this.singleRow = true;
    this.maxRows = 1;
    return this;
  }

  whereClause() {
    return this.filters.length ? ` WHERE ${this.filters.join(' AND ')}` : '';
  }

  async execute() {
    try {
      if (this.action === 'select') return await this.executeSelect();
      if (this.action === 'insert') return await this.executeInsert();
      if (this.action === 'update') return await this.executeUpdate();
      return await this.executeDelete();
    } catch (error) {
      return { data: null, error };
    }
  }

  async executeSelect() {
    let sql = `SELECT ${this.selected} FROM ${this.table}${this.whereClause()}`;
    if (this.orderBy) sql += ` ORDER BY ${this.orderBy}`;
    if (this.maxRows !== null) sql += ` LIMIT ${this.maxRows}`;
    const [rows] = await pool.query(sql, this.params);
    const data = hydrateRows(rows, this.rawTable);
    return { data: this.singleRow ? data[0] || null : data, error: null };
  }

  async executeInsert() {
    if (!this.payload.length) return { data: [], error: null, count: 0 };
    const fields = Object.keys(this.payload[0]);
    const fieldSql = fields.map(identifier).join(', ');
    const values = this.payload.map((row) => fields.map((field) => serialize(row[field])));
    const placeholders = values.map((row) => `(${row.map(() => '?').join(', ')})`).join(', ');
    const [result] = await pool.query(
      `INSERT INTO ${this.table} (${fieldSql}) VALUES ${placeholders}`,
      values.flat()
    );
    if (!this.returnRows) return { data: null, error: null, count: result.affectedRows };

    const firstId = Number(result.insertId);
    const ids = Array.from({ length: result.affectedRows }, (_, i) => firstId + i);
    const [rows] = await pool.query(
      `SELECT ${this.selected} FROM ${this.table} WHERE ${identifier('id')} IN (${ids
        .map(() => '?')
        .join(', ')}) ORDER BY ${identifier('id')}`,
      ids
    );
    const data = hydrateRows(rows, this.rawTable);
    return { data: this.singleRow ? data[0] || null : data, error: null, count: ids.length };
  }

  async executeUpdate() {
    const fields = Object.keys(this.payload);
    if (!fields.length) return { data: null, error: null, count: 0 };

    // Os ids são capturados ANTES do UPDATE: reexecutar o SELECT com os
    // filtros originais devolveria zero linhas quando o próprio UPDATE altera
    // a coluna filtrada (ex.: marcar notificações como lidas).
    let alvoIds = null;
    if (this.returnRows) {
      const [ids] = await pool.query(
        `SELECT ${identifier('id')} FROM ${this.table}${this.whereClause()}`,
        this.params
      );
      alvoIds = ids.map((r) => r.id);
      if (!alvoIds.length) {
        const vazio = this.singleRow ? null : [];
        return { data: vazio, error: null, count: 0 };
      }
    }

    const setSql = fields.map((field) => `${identifier(field)} = ?`).join(', ');
    const [result] = await pool.query(
      `UPDATE ${this.table} SET ${setSql}${this.whereClause()}`,
      [...fields.map((field) => serialize(this.payload[field])), ...this.params]
    );
    if (!this.returnRows) return { data: null, error: null, count: result.affectedRows };

    const [rows] = await pool.query(
      `SELECT ${this.selected} FROM ${this.table} WHERE ${identifier('id')} IN (${alvoIds
        .map(() => '?')
        .join(', ')})`,
      alvoIds
    );
    const data = hydrateRows(rows, this.rawTable);
    return {
      data: this.singleRow ? data[0] || null : data,
      error: null,
      count: result.affectedRows,
    };
  }

  async executeDelete() {
    const [result] = await pool.query(`DELETE FROM ${this.table}${this.whereClause()}`, this.params);
    return { data: null, error: null, count: result.affectedRows };
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

/* ------------------------------------------------------------------ */
/* Utilidades expostas                                                 */
/* ------------------------------------------------------------------ */

/** Executa SQL avulso dentro de uma transação. */
export async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const resultado = await fn(conn);
    await conn.commit();
    return resultado;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    conn.release();
  }
}

/** Verifica a conectividade com o banco. */
export async function healthCheck() {
  const [rows] = await pool.query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}

/**
 * Resumo da configuração, sem expor segredos.
 *
 * A maioria dos 503 em produção não é falha do MySQL: é o `.env` não ter
 * chegado ao processo (hPanel iniciado sem `--env-file`). Expor quais
 * variáveis faltam no /health transforma um mistério em um diagnóstico
 * imediato, e nome de variável não é informação sensível.
 */
export function diagnosticoConfig() {
  const faltando = [];
  if (!env.MYSQL_HOST && !env.DB_HOST) faltando.push('MYSQL_HOST');
  if (!env.MYSQL_USER && !env.DB_USER) faltando.push('MYSQL_USER');
  if (!env.MYSQL_PASSWORD && !env.DB_PASSWORD) faltando.push('MYSQL_PASSWORD');
  if (!env.MYSQL_DATABASE && !env.DB_NAME) faltando.push('MYSQL_DATABASE');
  if (!env.JWT_SECRET) faltando.push('JWT_SECRET');
  return {
    faltando,
    // Host e porta ajudam a identificar host/porta errados sem revelar
    // usuário ou senha.
    alvo: `${env.MYSQL_HOST || env.DB_HOST || 'localhost'}:${env.MYSQL_PORT || env.DB_PORT || 3306}/${env.MYSQL_DATABASE || env.DB_NAME || '(sem banco)'}`,
    ssl: env.MYSQL_SSL === 'true',
  };
}

/**
 * AggregateError (usado pelo mysql2 quando o host resolve para ::1 e IPv4)
 * não traz mensagem. Esta função garante texto utilizável em logs e no
 * endpoint /health, onde uma mensagem vazia é impossível de diagnosticar.
 */
export function descreverErro(err) {
  if (!err) return 'Erro desconhecido.';
  if (err.message) return err.message;
  if (err.code) return `${err.code} ao conectar ao MySQL.`;
  if (Array.isArray(err.errors) && err.errors.length) {
    return err.errors.map((e) => e.message || e.code).filter(Boolean).join(' | ') || 'Falha de conexão.';
  }
  return 'Falha ao conectar ao MySQL.';
}

const db = {
  from(table) {
    return new QueryBuilder(table);
  },
};

export { pool, QueryBuilder, DATE_COLUMNS, BOOL_COLUMNS };
export default db;
