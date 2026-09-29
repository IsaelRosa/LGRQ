# LGRP — Laboratório de Gestão de Resíduos Perigosos

Sistema web de controle de pedidos de coleta, tratamentos, destinação final,
banco de reagentes, solventes, vidrarias contaminadas e indicadores ambientais.

**Stack:** React 19 + TypeScript + Vite · Express 5 · **MySQL/MariaDB** · JWT

---

## Como funciona

```
src/            SPA (React) — 12 páginas, todas sob /api/*
api/            Handlers HTTP (Express)
  authz.js        senhas (scrypt), tokens (JWT), permissões
  auth.js         /api/auth
  db-client.js    camada MySQL com sintaxe compatível com PostgREST
  shared.js       CRUD genérico + auditoria + motor de alertas
lgrp_mysql.sql  Schema (10 tabelas)
```

O ponto central é `api/db-client.js`: ele expõe a interface do Supabase
(`from().select().eq().or().order().limit().single()`) traduzindo tudo para SQL
do MySQL. Assim, o código de negócio não depende do banco escolhido.

### Perfis de acesso

| Perfil                    | Leitura | Edição | Usuários |
|---------------------------|:-------:|:------:|:---------:|
| Administrador             |    ✓    |   ✓    |     ✓     |
| Coordenador               |    ✓    |   ✓    |     –     |
| Químico Responsável       |    ✓    |   ✓    |     –     |
| Gestor Ambiental          |    ✓    |   ✓    |     –     |
| Técnico de Laboratório    |    ✓    |   ✓    |     –     |
| Consultor                 |    ✓    |   –     |     –     |

A regra é aplicada no servidor (`api/authz.js`). O frontend apenas esconde os
botões; a barreira real é a API.

---

## Desenvolvimento local

Requisitos: **Node.js 20.6+** (o `--env-file` nativo é usado) e um MySQL 8 ou
MariaDB 10.4+.

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
```

Edite o `.env` com as credenciais do seu MySQL e gere um segredo:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Crie o banco e importe o schema:

```bash
mysql -u root -p -e "CREATE DATABASE lgrp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p lgrp < lgrp_mysql.sql
```

Suba os dados de demonstração (opcional) e o servidor:

```bash
npm run seed              # 10 usuários, 78 pedidos, 54 tratamentos...
npm run dev               # API em :3000 + Vite em :5173
```

Acesse `http://localhost:5173`. O Vite faz proxy de `/api` para a porta 3000,
reproduzindo o mesmo caminho usado em produção.

### Scripts

| Comando            | O que faz                                    |
|--------------------|----------------------------------------------|
| `npm run dev`      | API + frontend com hot reload                |
| `npm run build`    | `tsc -b` e gera `dist/`                      |
| `npm start`        | Sobe o servidor servindo `dist/` + API       |
| `npm run seed`     | Popula o banco (apaga tudo antes)            |
| `npm test`         | Testes unitários, sem banco                  |
| `npm run test:e2e` | Fluxo completo contra o MySQL                |
| `npm run lint`     | ESLint                                       |

---

## Deploy na Hostinger

### 1. Requisito de plano

O hPanel só executa aplicações Node.js nos planos **Business, Cloud e
Enterprise**. Na hospedagem compartilhada básica não há Node.js — nesse caso o
backend precisaria ser reescrito em PHP.

### 2. Banco de dados

**hPanel → Bancos de Dados → Gerenciar MySQL.** Crie o banco e anote host,
usuário, senha e porta. Importe o schema em **phpMyAdmin → Importar →
`lgrp_mysql.sql`**.

Se o banco já existia com a versão anterior do projeto, rode a migração:

```bash
mysql -u USUARIO -p NOME_DO_BANCO < migrations/002_auth_mysql.sql
```

### 3. Envio dos arquivos

Envie o conteúdo do projeto (sem `node_modules` e `dist`) para
`/home/SEU_USUARIO/domains/DOMINIO/public_html/`, ou ajuste a raiz no hPanel.

No **.env** da produção:

```ini
NODE_ENV=production
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_DATABASE=SEU_BANCO
MYSQL_USER=SEU_USUARIO
MYSQL_PASSWORD=SUA_SENHA
MYSQL_CONNECTION_LIMIT=5
MYSQL_SSL=false
JWT_SECRET=<o valor gerado no passo anterior>
JWT_EXPIRES_IN=12h
PORT=3000
```

> `JWT_SECRET` é obrigatório em produção. Sem ele o servidor se recusa a
> subir, porque todas as sessões cairiam a cada reinício.

### 4. Configuração do Node.js no hPanel

**Advanced → Node.js → Add Node.js App**

| Campo                | Valor             |
|----------------------|-------------------|
| Node.js version      | 20 ou superior    |
| Application root     | a pasta do projeto|
| Application startup file | `server.js`   |
| Application mode     | `production`      |

O hPanel instala as dependências e inicia o processo. Recomenda-se manter
`MYSQL_CONNECTION_LIMIT` baixo (3–5): hospedagem compartilhada tem limite de
conexões simultâneas.

### 5. Build do frontend

O `npm run build` **precisa rodar** — o servidor serve `dist/`, que não é
versionado. Se o hPanel não executar o build no deploy, rode localmente com as
mesmas versões de Node e envie o `dist/` junto:

```bash
npm ci && npm run build
```

### 6. Primeiro acesso

Abra a aplicação e use **Cadastrar**. O primeiro usuário criado recebe
automaticamente o perfil de **Administrador**; os seguintes entram como
**Consultor** até serem promovidos.

Para começar com dados de demonstração em vez disso:

```bash
npm run seed -- --senha SUA_SENHA
```

### 7. Verificação

```bash
curl https://SEU_DOMINIO/health
# {"ok":true,"banco":"conectado","uptime":123.4}
```

### 8. Checklist

- [ ] `JWT_SECRET` definido e com 32+ caracteres
- [ ] `.env` **fora** do versionamento (já está no `.gitignore`)
- [ ] `MYSQL_SSL=false` (o MySQL da Hostinger é local, sem TLS)
- [ ] `dist/` gerado e presente no servidor
- [ ] `/health` respondendo `ok: true`
- [ ] Senha do administrador trocada após o primeiro acesso
- [ ] `npm run test:e2e` executado contra o banco de produção

---

## Segurança

- Senhas com **scrypt** (N=16384) e salt por usuário; nunca em texto puro.
- Sessões em **JWT HS256** com expiração (`JWT_EXPIRES_IN`).
- **Toda rota** sob `/api/` exige sessão válida, exceto `/api/auth`.
- Consultores recebem **403** em qualquer escrita — a checagem é no servidor.
- **Rate limit** de 8 tentativas / 10 min por IP no login.
- Login com e-mail inexistente percorre a mesma verificação de senha, para não
  revelar quais contas existem pelo tempo de resposta.
- `senha_hash` nunca é devolvido pela API (`sanitize` em `api/usuarios.js`).
- O sistema recusa remover ou rebaixar o **último administrador ativo**.
- Identificadores SQL são validados por regex e todo valor vai por
  *prepared statement*; `LIKE` escapa `%` e `_` do usuário.

---

## Testes

```bash
npm test          # 11 testes unitários (datas, SQL, senha, JWT) — sem banco
npm run test:e2e  # fluxo real: login → CRUD → permissões → auditoria
```

O E2E cria um usuário descartável (`@lgrp-teste`) e remove tudo ao final.
