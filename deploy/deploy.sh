#!/usr/bin/env bash
#
# Implantação do LGRP em VPS (Hostinger Cloud Startup / Ubuntu).
#
#   sudo bash deploy/deploy.sh
#
# O que o script faz:
#   1. Verifica/instala Node.js 20+
#   2. Instala dependências e compila o frontend
#   3. Cria o .env com um JWT_SECRET aleatório (sem sobrescrever o existente)
#   4. Registra o app como serviço systemd
#   5. Configura Nginx como proxy reverso
#
# Ele é idempotente: pode rodar de novo a cada atualização.
#
# O banco NÃO é criado aqui — veja o final da saída para os comandos de MySQL.

set -euo pipefail

# --------------------------------------------------------------------------
# Configuração
# --------------------------------------------------------------------------
APP_DIR="${APP_DIR:-/var/www/lgrp}"
SERVICE_NAME="lgrp"
APP_PORT="${APP_PORT:-3000}"
SITE_DOMAIN="${SITE_DOMAIN:-}"
NODE_MAJOR=20

log()  { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
aviso(){ printf '\033[33m    %s\033[0m\n' "$*"; }
erro() { printf '\n\033[1;31mERRO:\033[0m %s\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
  erro "Este script precisa de root. Rode assim:
    cd $APP_DIR
    sudo SITE_DOMAIN=SEU_DOMINIO bash deploy/deploy.sh
  (na Hostinger o usuário costuma ser u3150..., sem privilégio de root direto)"
fi

# --------------------------------------------------------------------------
log "1/5 · Node.js"
# --------------------------------------------------------------------------
install_node() {
  aviso "instalando Node.js ${NODE_MAJOR} via NodeSource"
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg
  mkdir -p /etc/apt/keyrings
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
}

if ! command -v node >/dev/null 2>&1; then
  install_node
else
  ATUAL="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
  if [ "$ATUAL" -lt "$NODE_MAJOR" ]; then
    aviso "Node v${ATUAL} instalado, mas é preciso v${NODE_MAJOR}+ (--env-file). Atualizando."
    install_node
  else
    aviso "Node $(node -v) — ok"
  fi
fi

# --------------------------------------------------------------------------
log "2/5 · Dependências e build"
# --------------------------------------------------------------------------
[ -d "$APP_DIR" ] || erro "Pasta $APP_DIR não existe. Clone o repositório nela antes."

cd "$APP_DIR"
[ -f package.json ] || erro "package.json não encontrado em $APP_DIR"

if [ -d .git ] && [ -z "${SKIP_PULL:-}" ]; then
  aviso "atualizando código do repositório"
  git pull --ff-only || aviso "git pull falhou; usando o código que está na pasta"
fi

# `npm ci` instala produção + desenvolvimento; o build precisa do Vite e do
# TypeScript. O `prune` no fim remove as ferramentas de build, deixando só o
# que o servidor usa em execução.
aviso "instalando dependências (pode levar um minuto)"
npm ci --no-audit --no-fund || npm install --no-audit --no-fund

aviso "compilando o frontend"
npm run build

[ -f dist/index.html ] || erro "dist/index.html não foi gerado — o build frontend falhou."

aviso "removendo dependências só de build"
npm prune --omit=dev --no-audit --no-fund

# --------------------------------------------------------------------------
log "3/5 · Configuração (.env)"
# --------------------------------------------------------------------------
if [ -f .env ]; then
  aviso ".env já existe — mantido intacto"
else
  SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
  cat > .env <<EOF
# Gerado por deploy/deploy.sh em $(date -u +%Y-%m-%dT%H:%M:%SZ)

NODE_ENV=production
HOST=127.0.0.1
PORT=${APP_PORT}

# --- MySQL ---
# AJUSTE Estes quatro valores. Na Hostinger Cloud o MySQL é local: use localhost.
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_DATABASE=lgrp
MYSQL_USER=lgrp_user
MYSQL_PASSWORD=TROQUE_ESTA_SENHA
MYSQL_CONNECTION_LIMIT=5
MYSQL_SSL=false

# --- Sessão ---
JWT_SECRET=${SECRET}
JWT_EXPIRES_IN=12h
EOF
  chmod 600 .env
  aviso ".env criado com um JWT_SECRET aleatório."
  aviso ">>> EDITE O .env E COLOQUE AS CREDENCIAIS REAIS DO MySQL <<<"
fi

# --------------------------------------------------------------------------
log "4/5 · Serviço systemd"
# --------------------------------------------------------------------------
cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=LGRP - Gestão de Resíduos Químicos
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=${APP_DIR}

[Install]
WantedBy=multi-user.target
EOF

# O usuário do serviço precisa ler o .env (chmod 600, dono root).
chown root:www-data .env
chmod 640 .env

systemctl daemon-reload
systemctl enable ${SERVICE_NAME} >/dev/null 2>&1
systemctl restart ${SERVICE_NAME}
sleep 3

if systemctl is-active --quiet ${SERVICE_NAME}; then
  aviso "serviço ${SERVICE_NAME} ativo"
else
  erro "o serviço não subiu. Veja o log: journalctl -u ${SERVICE_NAME} -n 40"
fi

echo
journalctl -u ${SERVICE_NAME} -n 8 --no-pager || true

# --------------------------------------------------------------------------
log "5/5 · Proxy reverso"
# --------------------------------------------------------------------------
if ! command -v nginx >/dev/null 2>&1; then
  aviso "Nginx não encontrado."
  aviso "Se o seu servidor usa Apache, adicione ao VirtualHost:"
  aviso "    ProxyPreserveHost On"
  aviso "    ProxyPass        / http://127.0.0.1:${APP_PORT}/"
  aviso "    ProxyPassReverse / http://127.0.0.1:${APP_PORT}/"
  aviso "Depois: sudo systemctl restart apache2"
else
  if [ -z "$SITE_DOMAIN" ]; then
    erro "Informe o domínio:  SITE_DOMAIN=seu-dominio.com sudo bash deploy/deploy.sh"
  fi

  cat > /etc/nginx/sites-available/${SERVICE_NAME}.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${SITE_DOMAIN};

    client_max_body_size 4m;

    location / {
        proxy_pass         http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
EOF

  # Remove a implantação estática anterior da Hostinger, se existir.
  if [ -f /etc/nginx/sites-enabled/${SITE_DOMAIN}.conf ] && [ ! -L /etc/nginx/sites-enabled/${SERVICE_NAME}.conf ]; then
    aviso "removendo vhost estático anterior: ${SITE_DOMAIN}.conf"
    rm -f /etc/nginx/sites-enabled/${SITE_DOMAIN}.conf
  fi

  ln -sf /etc/nginx/sites-available/${SERVICE_NAME}.conf /etc/nginx/sites-enabled/${SERVICE_NAME}.conf
  rm -f /etc/nginx/sites-enabled/default

  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    aviso "Nginx configurado para ${SITE_DOMAIN} → 127.0.0.1:${APP_PORT}"
  else
    erro "configuração do Nginx inválida: nginx -t"
  fi
fi

# --------------------------------------------------------------------------
log "Verificação"
# --------------------------------------------------------------------------
echo
printf '  App:      curl -i http://127.0.0.1:%s/health\n' "$APP_PORT"
printf '  Público:  curl -i http://%s/health\n\n' "${SITE_DOMAIN:-SEU_DOMINIO}"

# --------------------------------------------------------------------------
log "Falta o banco de dados"
# --------------------------------------------------------------------------
cat <<'EOF'
O script não mexe no MySQL. Rode manualmente:

  # 1. Criar banco e usuário (ajuste a senha)
  sudo mysql <<SQL
  CREATE DATABASE IF NOT EXISTS lgrp
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER IF NOT EXISTS 'lgrp_user'@'localhost' IDENTIFIED BY 'SENHA_FORTE';
  GRANT ALL PRIVILEGES ON lgrp.* TO 'lgrp_user'@'localhost';
  FLUSH PRIVILEGES;
  SQL

  # 2. Criar o schema
  cd /var/www/lgrp
  sudo mysql lgrp < lgrp_mysql.sql

  # 3. Ajustar MYSQL_* no .env com a senha escolhida
  sudo nano /var/www/lgrp/.env

  # 4. Conferir tudo
  cd /var/www/lgrp
  sudo npm run check:db
  sudo npm run migrate

  # 5. Reiniciar
  sudo systemctl restart lgrp
  curl -i http://127.0.0.1:3000/health
EOF
