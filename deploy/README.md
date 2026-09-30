# Implantação em VPS (Hostinger Cloud Startup)

O plano **Cloud Startup é um VPS**: você tem root, SSH e pode rodar Node.js.
A tela "Sites → Implantações" do hPanel só constrói e serve **arquivos
estáticos** — por isso o frontend aparece e `/api/*` responde 503. Nenhum
servidor Express foi iniciado.

A solução é rodar a aplicação Node por conta própria (systemd) e colocar o
Nginx na frente como proxy reverso.

---

## 1. Obter os dados de acesso

No hPanel, em **Servidor / VPS → Gerenciar**, anote:

- **Endereço IP**
- **Usuário** (normalmente `root`)
- **Senha root**
- **Porta SSH** (normalmente 22)

## 2. Instalar o código

```bash
ssh root@SEU_IP
apt-get update && apt-get install -y git
git clone https://github.com/IsaelRosa/LGRQ.git /var/www/lgrp
cd /var/www/lgrp
```

## 3. Rodar a implantação

```bash
SITE_DOMAIN=mediumorchid-gaur-339159.hostingersite.com bash deploy/deploy.sh
```

Troque pelo seu domínio. O script instala o Node se faltar, compila, cria o
`.env` com um segredo aleatório, registra o serviço e configura o proxy.

É **idempotente** — pode repetir a cada atualização, sem risco.

### Se preferir passo a passo

```bash
node -v                      # precisa ser v20+
npm install
npm run build                # gera o dist/

cp .env.example .env         # e edite
nano .env

sudo cp deploy/lgrp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lgrp
```

## 4. Criar o banco

```bash
sudo mysql <<'SQL'
CREATE DATABASE IF NOT EXISTS lgrp
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'lgrp_user'@'localhost' IDENTIFIED BY 'SENHA_FORTE';
GRANT ALL PRIVILEGES ON lgrp.* TO 'lgrp_user'@'localhost';
FLUSH PRIVILEGES;
SQL

mysql lgrp < lgrp_mysql.sql
```

Depois edite o `.env` com **a mesma senha** e reinicie:

```bash
cd /var/www/lgrp
nano .env                     # MYSQL_PASSWORD=SENHA_FORTE
npm run check:db              # diagnostico: tabelas, colunas, credencial
npm run migrate
sudo systemctl restart lgrp
```

## 5. Confirmar

```bash
curl -i http://127.0.0.1:3000/health     # app local
curl -i http://SEU_DOMINIO/health        # via proxy
```

Resposta esperada:

```json
{"ok":true,"banco":"conectado","uptime":12.3}
```

Se aparecer `faltando` ou `codigo`, o `npm run check:db` diz o que corrigir.

## 6. Desligar a implantação estática

Depois que o Node estiver respondendo, a implantação estática do hPanel deixa
de ter efeito (o Nginx sobrescreve o vhost). Se quiser evitar que o hPanel
tente servir o `dist/` de novo, em **Sites**, pause a implantação automática.

## 6b. HTTPS

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d SEU_DOMINIO
```

O certificado é emitido em segundos. O sistema já envia o header HSTS quando
`NODE_ENV=production`.

---

## Operar

| Ação | Comando |
|------|---------|
| Ver log | `journalctl -u lgrp -f` |
| Reiniciar | `sudo systemctl restart lgrp` |
| Estado | `systemctl status lgrp` |
| Atualizar código | `cd /var/www/lgrp && git pull && bash deploy/deploy.sh` |
| Diagnóstico do banco | `cd /var/www/lgrp && npm run check:db` |

Atualizar é sempre o mesmo comando: `git pull` seguido do script. Ele
recompila, reinicia o serviço e recarrega o Nginx.

## Se algo der errado

**O serviço não sobe**
```bash
journalctl -u lgrp -n 40 --no-pager
```
Erros comuns: `Cannot find module` (rode `npm install`); `EADDRINUSE`
(outra ocupa a porta 3000).

**O site continua mostrando a versão estática**
O Nginx não recarregou. Verifique qual servidor está em uso:

```bash
systemctl is-active nginx apache2
nginx -t
sudo systemctl reload nginx
```

**A porta 3000 está exposta na internet**
Não deveria: o app escuta em `127.0.0.1` (`HOST` no `.env`). Confira com
`sudo ss -tlnp | grep 3000` — deve aparecer em `127.0.0.1:3000`, nunca em
`0.0.0.0:3000`.

**`403 Forbidden` do Nginx**
O usuário do serviço (`www-data`) não lê a pasta. Verifique as permissões de
`/var/www/lgrp`, em especial o `.env` (precisa ser `640 root:www-data`).
