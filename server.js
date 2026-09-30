import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import auth from './api/auth.js';
import coletas from './api/coletas.js';
import dashboard from './api/dashboard.js';
import historico from './api/historico.js';
import indicadores from './api/indicadores.js';
import notificacoes from './api/notificacoes.js';
import pedidos from './api/pedidos.js';
import reagentes from './api/reagentes.js';
import relatorios from './api/relatorios.js';
import solventes from './api/solventes.js';
import tratamentos from './api/tratamentos.js';
import usuarios from './api/usuarios.js';
import vidrarias from './api/vidrarias.js';
import { descreverErro, diagnosticoConfig, healthCheck, pool } from './api/db-client.js';

const app = express();
const port = Number(process.env.PORT || 3000);
// Atrás de um proxy (Nginx/Apache) o app deve escutar apenas em loopback:
// em 0.0.0.0 a porta fica exposta na internet sem TLS nem os headers do proxy.
const host = process.env.HOST || '127.0.0.1';
const root = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
// A Hostinger termina o TLS no proxy; isso faz o req.ip correto no rate limit.
app.set('trust proxy', 1);

app.use(express.json({ limit: '2mb' }));

/* ------------------------------------------------------------------ */
/* Cabeçalhos de segurança                                            */
/* ------------------------------------------------------------------ */

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

/* ------------------------------------------------------------------ */
/* Rotas da API                                                       */
/* ------------------------------------------------------------------ */

// A autenticação responde tanto em /api/auth quanto em /api/auth/*.
// O prefixo é a única área pública da API.
app.all(/^\/api\/auth(\/.*)?$/, (req, res) => auth(req, res));

const routes = {
  coletas,
  dashboard,
  historico,
  indicadores,
  notificacoes,
  pedidos,
  reagentes,
  relatorios,
  solventes,
  tratamentos,
  usuarios,
  vidrarias,
};

for (const [name, handler] of Object.entries(routes)) {
  app.all(`/api/${name}`, (req, res) => handler(req, res));
}

// Qualquer /api/* desconhecido precisa responder 401/404 em JSON, nunca o index.html.
app.all(/^\/api\/.+/, (_req, res) => res.status(404).json({ error: 'Rota de API inexistente.' }));

/* ------------------------------------------------------------------ */
/* Saúde e frontend                                                    */
/* ------------------------------------------------------------------ */

app.get('/health', async (_req, res) => {
  const cfg = diagnosticoConfig();
  try {
    await healthCheck();
    res.status(200).json({ ok: true, banco: 'conectado', uptime: process.uptime() });
  } catch (err) {
    console.error('[health] falha ao falar com o MySQL:', err.code || '', descreverErro(err));
    res.status(503).json({
      ok: false,
      banco: 'indisponivel',
      erro: descreverErro(err),
      codigo: err.code || null,
      // Ajuda a separar "banco fora do ar" de "configuração ausente".
      faltando: cfg.faltando,
      alvo: cfg.alvo,
    });
  }
});

const distDir = path.join(root, 'dist');

if (!fs.existsSync(distDir)) {
  console.warn('[lgrp] dist/ não encontrado — execute "npm run build" antes de iniciar em produção.');
}

app.use(
  express.static(distDir, {
    index: false,
    maxAge: isProd ? '1y' : 0,
    setHeaders(res, filePath) {
      // O index.html nunca deve ficar em cache: é ele que aponta para os
      // bundles versionados por hash.
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

// Fallback da SPA: qualquer GET desconhecido devolve o index.
app.use((req, res) => {
  if (req.method !== 'GET') {
    return res.status(404).json({ error: 'Rota não encontrada.' });
  }
  return res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) {
      res
        .status(500)
        .json({ error: 'Frontend não compilado. Execute "npm run build" e reinicie o servidor.' });
    }
  });
});

/* ------------------------------------------------------------------ */
/* Tratamento global de erro                                          */
/* ------------------------------------------------------------------ */

app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Corpo da requisição não é um JSON válido.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload acima do limite de 2 MB.' });
  }
  console.error('Erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

/* ------------------------------------------------------------------ */
/* Ciclo de vida                                                      */
/* ------------------------------------------------------------------ */

const server = app.listen(port, host, () => {
  console.log(`LGRP server em http://${host}:${port} (${isProd ? 'produção' : 'desenvolvimento'})`);
});

async function encerrar(sinal) {
  console.log(`\n[lgrp] recebido ${sinal}, encerrando...`);
  server.close(async () => {
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
  // Não deixa conexões presas bloquearem o encerramento na Hostinger.
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
process.on('unhandledRejection', (reason) => console.error('[lgrp] unhandledRejection:', reason));
