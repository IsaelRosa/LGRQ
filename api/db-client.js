import mysql from 'mysql2/promise';
import { createClient } from '@supabase/supabase-js';

const env = process.env;
const pool = mysql.createPool({
  host: env.MYSQL_HOST || env.DB_HOST,
  port: Number(env.MYSQL_PORT || env.DB_PORT || 3306),
  user: env.MYSQL_USER || env.DB_USER,
  password: env.MYSQL_PASSWORD || env.DB_PASSWORD,
  database: env.MYSQL_DATABASE || env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(env.MYSQL_CONNECTION_LIMIT || 5),
  charset: 'utf8mb4',
  ssl: env.MYSQL_SSL === 'true' ? {} : undefined,
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL;
const supabaseKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const authClient = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function identifier(value) {
  if (!IDENTIFIER.test(value)) throw new Error(`Identificador SQL inválido: ${value}`);
  return `\`${value}\``;
}

function columns(value) {
  if (!value || value === '*') return '*';
  return value.split(',').map((column) => identifier(column.trim())).join(', ');
}

function serialize(value) {
  if (value !== null && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function parseOr(value, params) {
  const expressions = String(value).split(',').map((part) => {
    const match = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\.(eq|like|ilike)\.(.*)$/s);
    if (!match) throw new Error('Filtro OR inválido.');
    const [, field, operator, raw] = match;
    params.push(raw);
    return `${identifier(field)} ${operator === 'eq' ? '=' : 'LIKE'} ?`;
  });
  return `(${expressions.join(' OR ')})`;
}

class QueryBuilder {
  constructor(table) {
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
    this.payload = payload;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  eq(field, value) { return this.filter(field, '=', value); }
  neq(field, value) { return this.filter(field, '<>', value); }
  gte(field, value) { return this.filter(field, '>=', value); }
  lte(field, value) { return this.filter(field, '<=', value); }
  like(field, value) { return this.filter(field, 'LIKE', value); }

  ilike(field, value) {
    return this.filter(field, 'LIKE', value);
  }

  filter(field, operator, value) {
    this.filters.push(`${identifier(field)} ${operator} ?`);
    this.params.push(value);
    return this;
  }

  or(value) {
    this.filters.push(parseOr(value, this.params));
    return this;
  }

  in(field, values) {
    const list = Array.isArray(values) ? values : [];
    if (!list.length) {
      this.filters.push('1 = 0');
      return this;
    }
    this.filters.push(`${identifier(field)} IN (${list.map(() => '?').join(', ')})`);
    this.params.push(...list);
    return this;
  }

  order(field, options = {}) {
    this.orderBy = `${identifier(field)} ${options.ascending ? 'ASC' : 'DESC'}`;
    return this;
  }

  limit(value) {
    this.maxRows = Math.max(0, Number(value) || 0);
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
    return { data: this.singleRow ? (rows[0] || null) : rows, error: null };
  }

  async executeInsert() {
    if (!this.payload.length) return { data: [], error: null };
    const fields = Object.keys(this.payload[0]);
    const fieldSql = fields.map(identifier).join(', ');
    const values = this.payload.map((row) => fields.map((field) => serialize(row[field])));
    const placeholders = values.map((row) => `(${row.map(() => '?').join(', ')})`).join(', ');
    const [result] = await pool.query(
      `INSERT INTO ${this.table} (${fieldSql}) VALUES ${placeholders}`,
      values.flat()
    );
    if (!this.returnRows) return { data: null, error: null };
    const firstId = Number(result.insertId);
    const ids = Array.from({ length: result.affectedRows }, (_, index) => firstId + index);
    const [rows] = await pool.query(
      `SELECT ${this.selected} FROM ${this.table} WHERE ${identifier('id')} IN (${ids.map(() => '?').join(', ')}) ORDER BY ${identifier('id')}`,
      ids
    );
    return { data: this.singleRow ? (rows[0] || null) : rows, error: null };
  }

  async executeUpdate() {
    const fields = Object.keys(this.payload || {});
    const values = fields.map((field) => serialize(this.payload[field]));
    const setSql = fields.map((field) => `${identifier(field)} = ?`).join(', ');
    const [result] = await pool.query(
      `UPDATE ${this.table} SET ${setSql}${this.whereClause()}`,
      [...values, ...this.params]
    );
    if (!this.returnRows) return { data: null, error: null, count: result.affectedRows };
    const [rows] = await pool.query(`SELECT ${this.selected} FROM ${this.table}${this.whereClause()}`, this.params);
    return { data: this.singleRow ? (rows[0] || null) : rows, error: null };
  }

  async executeDelete() {
    const [result] = await pool.query(`DELETE FROM ${this.table}${this.whereClause()}`, this.params);
    return { data: null, error: null, count: result.affectedRows };
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

const db = {
  from(table) {
    return new QueryBuilder(table);
  },
  auth: {
    async getUser(token) {
      if (!authClient || !token) return { data: { user: null }, error: null };
      return authClient.auth.getUser(token);
    },
  },
};

export { pool };
export default db;
