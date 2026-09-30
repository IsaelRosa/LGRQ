# Implantação em VPS (Hostinger Cloud Startup)

O plano **Cloud Startup é um VPS**: você tem SSH e pode rodar Node.js.
A tela *Sites → Implantações* do hPanel só constrói e serve **arquivos
estáticos** — por isso o frontend aparece e `/api/*` responde 503. Nenhum
servidor Express foi iniciado.

A solução é rodar a aplicação Node por conta própria (systemd) e colocar o
Nginx na frente como proxy reverso.

---

## 1. Obter os dados de acesso

No hPanel, em **Avançado → Acesso SSH**, anote:

- **IP**
- **Porta** (a Hostinger usa uma porta alta, não a 22)
- **Nome de usuário** (formato `u315093330`, **não** é root)
- **Senha** (clique em *Alterar* se não souber)

## 2. Conectar

No Windows, abra o **PowerShell** (não precisa instalar PuTTY):

```bash
ssh -p PORTA USUARIO@IP
```

Exemplo:

```bash
ssh -p 65002 u315093330@147.93.34.54
```

Digite a senha quando solicitado. **A senha não aparece enquanto você digita** —
é normal, o terminal não ecoa nada. Aperte Enter mesmo assim.

Na primeira conexão pode aparecer uma pergunta sobre a autenticidade do host.
Digite `yes` e Enter.

O prompt fica parecido com:

```
u315093330@server:~$
```

> **Este usuário não é root.** Todos os comandos de instalação precisam de
> `sudo`, e o próprio `sudo` pode pedir a senha novamente.

## 3. Instalar o código

```bash
sudo apt-get update -y
sudo apt-get install -y git
sudo git clone https://github.com/IsaelRosa/LGRQ.git /var/www/lgrp
cd /var/www/lgrp
```

## 4. Rodar a implantação

```bash
sudo SITE_DOMAIN=mediumorchid-gaur-339159.hostingersite.com bash deploy/deploy.sh
```

Troque pelo seu domínio. O script instala o Node se faltar, compila, cria o
`.env` com um segredo aleatório, registra o serviço e configura o proxy.

É **idempotente** — pode repetir a cada atualização, sem risco.

Se preferir passo a passo:

```bash
node -v                      # precisa ser v20+
sudo npm install
sudo npm run build           # gera o dist/

sudo cp .env.example .env
sudo nano .env

sudo cp deploy/lgrp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lgrp
```

## 5. Criar o banco

O script não mexe no MySQL. Rode manualmente:

```bash
sudo mysql <<'SQL'
CREATE DATABASE IF NOT EXISTS lgrp
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'lgrp_user'@'localhost' IDENTIFIED BY 'SENHA_FORTE';
GRANT ALL PRIVILEGES ON lgrp.* TO 'lgrp_user'@'localhost';
FLUSH PRIVILEGES;
SQL

sudo mysql lgrp < lgrp_mysql.sql
```

Depois ajuste o `.env` com **a mesma senha** e reinicie:

```bash
cd /var/www/lgrp
sudo nano .env                # MYSQL_PASSWORD=SENHA_FORTE
sudo npm run check:db         # diagnostica tabelas, colunas e credencial
sudo npm run migrate
sudo systemctl restart lgrp
```

No `nano`: `Ctrl+O` salva, `Enter` confirma, `Ctrl+X` sai.

## 6. Confirmar

```bash
curl -i http://127.0.0.1:3000/health     # app local
curl -i http://SEU_DOMINIO/health        # via proxy
```

Resposta esperada:

```json
{"ok":true,"banco":"conectado","uptime":12.3}
```

Se aparecer `faltando` ou `codigo`, o `npm run check:db` diz o que corrigir.

## 7. Desligar a implantação estática

Depois que o Node responde, a implantação estática do hPanel deixa de ter
efeito — o Nginx assume o vhost. Para ela não tentar publicar o `dist/` de
novo, em **Sites**, pause a implantação automática.

## 8. HTTPS

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
| Atualizar | `cd /var/www/lgrp && sudo git pull && sudo SITE_DOMAIN=SEU_DOMINIO bash deploy/deploy.sh` |
| Diagnóstico do banco | `cd /var/www/lgrp && sudo npm run check:db` |

Atualizar é sempre o mesmo comando: `git pull` seguido do script. Ele
recompila, reinicia o serviço e recarrega o Nginx.

## Se algo der errado

**O serviço não sobe**

```bash
journalctl -u lgrp -n 40 --no-pager
```

Erros comuns: `Cannot find module` (falta `npm install`); `EADDRINUSE`
(outro processo ocupa a porta 3000).

**`sudo` pede senha e não aceita**

Digite a senha do usuário SSH — é a mesma. Se der "usuário não está no
arquivo sudoers", peça ao suporte da Hostinger para liberar sudo, ou
trabalhe com o usuário root.

**O site continua mostrando a versão estática**

O Nginx não recarregou. Verifique qual servidor está em uso:

```bash
systemctl is-active nginx apache2
sudo nginx -t
sudo systemctl reload nginx
```

**A porta 3000 está exposta na internet**

Não deveria: o app escuta em `127.0.0.1` (`HOST` no `.env`). Confira com:

```bash
sudo ss -tlnp | grep 3000
```

Deve aparecer `127.0.0.1:3000`, nunca `0.0.0.0:3000`.

**403 Forbidden do Nginx**

O usuário do serviço (`www-data`) não lê a pasta. O `.env` deve estar em
`640 root:www-data`:

```bash
sudo chown root:www-data /var/www/lgrp/.env
sudo chmod 640 /var/www/lgrp/.env
```

**git clone falha por causa da rede**

Tente de novo — às vezes o primeiro acesso ao GitHub é bloqueado por HTTPS
do VPS:

```bash
sudo apt-get install -y ca-certificates
sudo git config --global http.sslVerify true
```
