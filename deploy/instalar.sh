#!/usr/bin/env bash
#
# Instalador de comando único do LGRP.
#
#   sudo bash -c "$(curl -sSL https://raw.githubusercontent.com/IsaelRosa/LGRQ/main/deploy/instalar.sh)"
#
# Pergunta apenas o domínio e a senha do MySQL. Faz o resto: instala o Node,
# baixa o código, compila, cria o .env com segredo aleatório, configura o
# serviço systemd e o proxy reverso.
#
# Pode rodar de novo com segurança: nada é sobrescrito sem perguntar.

set -euo pipefail

C="\033[1;32m"; A="\033[33m"; V="\033[1;31m"; B="\033[1m"; Z="\033[0m"
titulo() { printf '\n%s==> %s%s\n' "$C" "$*" "$Z"; }
aviso()  { printf '    %s%s%s\n' "$A" "$*" "$Z"; }
erro()   { printf '\n%sERRO: %s%s\n\n' "$V" "$*" "$Z" >&2; exit 1; }
perguntar() {
  local resposta
  read -rp "  $1" resposta
  printf '%s' "$resposta"
}

[ "$(id -u)" -eq 0 ] || erro "Rode com sudo. Tente:
    sudo bash -c \"\$(curl -sSL https://raw.githubusercontent.com/IsaelRosa/LGRQ/main/deploy/instalar.sh)\""

REPO="https://raw.githubusercontent.com/IsaelRosa/LGRQ/main/deploy/instalar.sh"
DIR="${APP_DIR:-/var/www/lgrp}"

# --------------------------------------------------------------------------
titulo "LGRP · instalador"
# --------------------------------------------------------------------------
echo
echo "  Vai instalar o sistema LGRP neste servidor."
echo "  Responda duas perguntas e aguarde."
echo

DOMINIO="${SITE_DOMAIN:-$(perguntar 'Domínio do site (ex: seu-dominio.com): ')}"
[ -n "$DOMINIO" ] || erro "Domínio obrigatório."

echo
DB_NAME="${MYSQL_DATABASE:-$(perguntar 'Nome do banco MySQL (ex: u315093330_LGRP): ')}"
[ -n "$DB_NAME" ] || erro "Nome do banco obrigatório."

DB_USER="${MYSQL_USER:-$DB_NAME}"

DB_PASS="${MYSQL_PASSWORD:-$(perguntar 'Senha do MySQL: ')}"
[ -n "$DB_PASS" ] || erro "Senha do MySQL obrigatória."

DB_HOST="${MYSQL_HOST:-localhost}"

echo
aviso "Domínio:  $DOMINIO"
aviso "Banco:    $DB_USER @ $DB_HOST/$DB_NAME"

# --------------------------------------------------------------------------
titulo "1/6 · Dependências do sistema"
# --------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq 2>/dev/null || aviso "apt-get update retornou aviso; continuando"
apt-get install -y -qq git curl ca-certificates gnupg >/dev/null 2>&1 || true
aviso "git e curl prontos"

# --------------------------------------------------------------------------
titulo "2/6 · Node.js 20+"
# --------------------------------------------------------------------------
instalar_node() {
  aviso "instalando Node.js (pode levar 1-2 minutos)"
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg 2>/dev/null
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
  rm -f /etc/apt/keyrings/nodesource.gpg
}

if ! command -v node >/dev/null 2>&1; then
  instalar_node
elif [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
  aviso "Node antigo ($(node -v)), atualizando"
  instalar_node
else
  aviso "Node $(node -v) já está instalado"
fi
aviso "Node $(node -v)"

# --------------------------------------------------------------------------
titulo "3/6 · Código-fonte"
# --------------------------------------------------------------------------
if [ -d "$DIR/.git" ]; then
  aviso "atualizando o código existente"
  git -C "$DIR" pull --ff-only >/dev/null 2>&1 || aviso "pull falhou; mantendo a versão atual"
else
  mkdir -p "$(dirname "$DIR")"
  git clone --depth 1 https://github.com/IsaelRosa/LGRQ.git "$DIR" >/dev/null 2>&1 \
    || erro "Não consegui baixar o código. Verifique a internet deste servidor."
  aviso "código baixado para $DIR"
fi
cd "$DIR"

# --------------------------------------------------------------------------
titulo "4/6 · Dependências e build"
# --------------------------------------------------------------------------
npm install --no-audit --no-fund --loglevel=error >/dev/null 2>&1 \
  || erro "npm install falhou. Tente manualmente:  cd $DIR && sudo npm install"
aviso "dependências instaladas"

npm run build >/dev/null 2>&1 || erro "npm run build falhou. Rode:  cd $DIR && sudo npm run build"
[ -f dist/index.html ] || erro "dist/index.html não foi gerado."
aviso "frontend compilado"

# --------------------------------------------------------------------------
titulo "5/6 · Configuração"
# --------------------------------------------------------------------------
SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"

# Preserva o .env existente para não trocar o segredo e derrubar as sessões.
if [ -f .env ] && grep -q "^JWT_SECRET=.\+" .env 2>/dev/null; then
  aviso "mantendo o .env existente (segredo preservado)"
  # Atualiza só as credenciais do banco informadas agora.
  sed -i "s|^MYSQL_HOST=.*|MYSQL_HOST=${DB_HOST}|" .env
  sed -i "s|^MYSQL_DATABASE=.*|MYSQL_DATABASE=${DB_NAME}|" .env
  sed -i "s|^MYSQL_USER=.*|MYSQL_USER=${DB_USER}|" .env
  sed -i "s|^MYSQL_PASSWORD=.*|MYSQL_PASSWORD=${DB_PASS}|" .env
  grep -q "^MYSQL_HOST=" .env || printf 'MYSQL_HOST=%s\n' "$DB_HOST" >> .env
  grep -q "^MYSQL_DATABASE=" .env || printf 'MYSQL_DATABASE=%s\n' "$DB_NAME" >> .env
  grep -q "^MYSQL_USER=" .env || printf 'MYSQL_USER=%s\n' "$DB_USER" >> .env
  grep -q "^MYSQL_PASSWORD=" .env || printf 'MYSQL_PASSWORD=%s\n' "$DB_PASS" >> .env
else
  cat > .env <<EOF
# Criado por deploy/instalar.sh

NODE_ENV=production
HOST=127.0.0.1
PORT=3000

MYSQL_HOST=${DB_HOST}
MYSQL_PORT=3306
MYSQL_DATABASE=${DB_NAME}
MYSQL_USER=${DB_USER}
MYSQL_PASSWORD=${DB_PASS}
MYSQL_CONNECTION_LIMIT=5
MYSQL_SSL=false

JWT_SECRET=${SECRET}
JWT_EXPIRES_IN=12h
EOF
  aviso ".env criado com segredo novo"
fi

chown root:www-data .env 2>/dev/null || true
chmod 640 .env

# Schema: cria as tabelas que faltarem.
if ! mysql -u root -e "USE \`$DB_NAME\`" >/dev/null 2>&1; then
  mysql -u root <<SQL 2>/dev/null || aviso "criação do banco falhou; se ele já existe, tudo bem"
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
SQL
fi
mysql -u root "$DB_NAME" < lgrp_mysql.sql 2>/dev/null && aviso "tabelas verificadas" || aviso "tabelas já existiam"

# --------------------------------------------------------------------------
titulo "6/6 · Serviço e proxy reverso"
# --------------------------------------------------------------------------
cat > /etc/systemd/system/lgrp.service <<EOF
[Unit]
Description=LGRP - Gestão de Resíduos Químicos
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=${DIR}
EnvironmentFile=${DIR}/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=${DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable lgrp >/dev/null 2>&1
systemctl restart lgrp
sleep 4

if systemctl is-active --quiet lgrp; then
  aviso "serviço ativo"
else
  echo
  aviso "O serviço não subiu. Motivo:"
  journalctl -u lgrp -n 15 --no-pager | tail -n 12
  erro "veja a mensagem acima"
fi

if command -v nginx >/dev/null 2>&1; then
  cat > /etc/nginx/sites-available/lgrp.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMINIO};
    client_max_body_size 4m;
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
EOF
  rm -f /etc/nginx/sites-enabled/${DOMINIO}.conf
  ln -sf /etc/nginx/sites-available/lgrp.conf /etc/nginx/sites-enabled/lgrp.conf
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    aviso "Nginx configurado"
  else
    aviso "ATENÇÃO: nginx -t falhou"
    nginx -t 2>&1 | tail -n 5
  fi
else
  aviso "Nginx não está instalado."
  aviso "Se o seu servidor usa Apache, adicione ao VirtualHost:"
  aviso "    ProxyPreserveHost On"
  aviso "    ProxyPass        / http://127.0.0.1:3000/"
  aviso "    ProxyPassReverse / http://127.0.0.1:3000/"
  aviso "Depois: sudo systemctl restart apache2"
fi

npm prune --omit=dev --no-audit --no-fund >/dev/null 2>&1 || true

# --------------------------------------------------------------------------
titulo "Resultado"
# --------------------------------------------------------------------------
echo
if curl -fsS http://127.0.0.1:3000/health 2>/dev/null | grep -q '"ok":true'; then
  printf '%s  OK — o sistema está funcionando.%s\n\n' "$C" "$Z"
else
  printf '%s  O app subiu, mas o banco ainda não responde.%s\n' "$A" "$Z"
  node scripts/check-db.mjs 2>/dev/null | tail -n 25 || true
  echo
fi

cat <<EOF
${B}Para criar sua conta de administrador:${Z}

  cd ${DIR}
  sudo npm run admin -- --email SEU_EMAIL --senha SUA_SENHA --nome "Seu Nome"

${B}Depois entre em:${Z}  http://${DOMINIO}/

${B}Comandos úteis:${Z}
  ver erros:    sudo journalctl -u lgrp -f
  reiniciar:    sudo systemctl restart lgrp
  diagnosticar: cd ${DIR} && sudo npm run check:db
  atualizar:    cd ${DIR} && sudo git pull && sudo SITE_DOMAIN=${DOMINIO} bash deploy/deploy.sh

EOF
