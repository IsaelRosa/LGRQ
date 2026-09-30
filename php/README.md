# Implantação em PHP (hospedagem compartilhada / Cloud Startup)

A tela *Sites → Implantações* do hPanel publica apenas arquivos estáticos.
Ela constrói e envia o frontend, mas **não sobe servidor nenhum** — por isso
`/api/*` responde 503.

Este backend em PHP resolve sem Node.js, sem root e sem VPS: a hospedagem já
tem PHP 8 e MySQL.

---

## O que enviar

```
sua-pasta-do-site/
  .htaccess          <- de php/.htaccess
  .env               <- novo (veja abaixo)
  api/
    bootstrap.php    <- de php/api/
    core.php
    index.php
    rotas.php
  (os arquivos do frontend, já publicados pelo hPanel)
```

Ou seja: copie a pasta `php/api` para dentro de `api/`, e o `php/.htaccess`
para a raiz do site, **ao lado** do `index.html`.

## Arquivo .env na raiz do site

```ini
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_DATABASE=u315093330_LGRP
MYSQL_USER=u315093330_LGRP
MYSQL_PASSWORD=a senha que voce criou no hPanel
MYSQL_SSL=false

JWT_SECRET=cole aqui um valor com 32+ caracteres
JWT_EXPIRES_IN=12h
APP_ENV=production
```

Para gerar o segredo, abra o **Terminal** do hPanel e rode:

```bash
php -r "echo bin2hex(random_bytes(48)), PHP_EOL;"
```

## Verificar

Acesse no navegador:

```
https://SEU_DOMINIO/api/health
```

Resposta esperada:

```json
{"ok":true,"banco":"conectado"}
```

Se aparecer `{"ok":false}`, o backend responde mas o MySQL não — confira
`MYSQL_*` no `.env`.

## Criar a conta de administrador

No **Terminal** do hPanel (hPanel → *Avançado* → *Terminal*), com o
`.env` no lugar, rode o script de seed ou crie a conta na tela de login.

**O jeito mais simples:** abra o site, vá na aba **Cadastrar** e crie sua
conta. **O primeiro usuário cadastrado vira Administrador
automaticamente.** Não precisa de script.

## Senha em texto puro não funciona

Não cadastre usuário direto pelo phpMyAdmin. A coluna `senha_hash` precisa
guardar o hash (bcrypt), não a senha — com texto puro a conta é criada mas
nunca autentica.

## Se o .htaccess não for respeitado

Alguns planos desabilitam `mod_rewrite`. Teste: se `https://SEU_DOMINIO/api/health`
mostrar **404 do servidor** (não o JSON do LGRP), o rewrite não está ativo.

Workaround: renomeie `api/index.php` para `api/index.php` e crie um arquivo
`api.php` na raiz com:

```php
<?php
// Redireciona /api/...? para o controlador
$rota = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$rota = preg_replace('#^.*?/api#', '', $rota);
$_SERVER['REQUEST_URI'] = '/api' . $rota;
require __DIR__ . '/api/index.php';
```

E então o `.htaccess` fica só com a reescrita para `api.php`.

---

## Estrutura do código

| Arquivo | Responsabilidade |
|---------|------------------|
| `api/bootstrap.php` | `.env`, conexão PDO, camada de consultas, conversão de tipos |
| `api/core.php` | senhas, JWT, sessão, permissões, auditoria, alertas, CRUD |
| `api/index.php` | roteador e definição dos módulos |
| `api/rotas.php` | login, dashboard, indicadores, notificações, histórico, relatórios |
| `router.php` | **apenas em desenvolvimento** — o servidor embutido do PHP não lê `.htaccess` |

## Testar localmente

```bash
# 1. subir o servidor
php -S 127.0.0.1:8000 -t php php/router.php

# 2. em outro terminal
LGRP_TEST_URL=http://127.0.0.1:8000 php test/e2e-php.php
```

39 verificações: cadastro, login, permissões, CRUD, tipos de dados,
busca, filtros, auditoria e relatórios.

## Diferenças em relação à versão Node

- **Senhas**: bcrypt (o módulo argon2 não está disponível em toda
  hospedagem). Contas criadas pela versão Node, com scrypt, precisam ter a
  senha redefinida.
- **Rate limit**: em arquivo no diretório temporário, em vez de memória.
- **Desempenho**: o PHP abre uma conexão por requisição. Para muitos
  usuários simultâneos, a versão Node é melhor.
