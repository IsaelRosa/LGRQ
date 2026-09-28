import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const app = express();
const port = Number(process.env.PORT || 3000);
const root = path.dirname(fileURLToPath(import.meta.url));

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

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

app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
app.use(express.static(path.join(root, 'dist')));
app.use((req, res) => {
  if (req.method !== 'GET') return res.status(404).json({ error: 'Rota não encontrada.' });
  return res.sendFile(path.join(root, 'dist', 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`LGRP server listening on port ${port}`);
});
