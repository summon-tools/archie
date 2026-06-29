#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

# ============================================================
#  Archie — Ubuntu/Debian Server Deployment
#  Operator-run: installs system packages, nginx, systemd
# ============================================================

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; }

prompt_required() {
  local var_name="$1"
  local prompt="$2"
  local value=""
  while [ -z "$value" ]; do
    read -rp "$prompt" value
    if [ -z "$value" ]; then
      warn "This value is required."
    fi
  done
  printf -v "$var_name" '%s' "$value"
}

prompt_password() {
  local var_name="$1"
  local prompt="$2"
  local confirm_prompt="$3"
  local value=""
  local confirm=""

  while true; do
    read -srp "$prompt" value
    echo ""
    if [ "${#value}" -lt 6 ]; then
      warn "Password must be at least 6 characters."
      continue
    fi

    read -srp "$confirm_prompt" confirm
    echo ""
    if [ "$value" != "$confirm" ]; then
      warn "Passwords do not match."
      continue
    fi

    printf -v "$var_name" '%s' "$value"
    return 0
  done
}

echo ""
echo -e "${BOLD}=== Archie Server Installation (Ubuntu/Debian) ===${NC}"
echo ""

# --- Verify environment ---
if [ "$(uname -s)" != "Linux" ]; then
  err "This script requires Linux. Use scripts/bootstrap-local.sh for local development."
  exit 1
fi

if ! command -v apt-get &>/dev/null; then
  err "This script requires apt (Debian/Ubuntu). Other distros are not currently supported."
  exit 1
fi

# --- Install system packages ---
info "Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq git curl build-essential nginx
ok "System packages installed"

# --- Domain vs IP and SSL decision ---
echo ""
read -rp "Server domain or IP address: " SERVER_DOMAIN
if [ -z "$SERVER_DOMAIN" ]; then
  err "Domain/IP is required."
  exit 1
fi

# Detect whether it looks like a domain name (vs bare IP)
USE_SSL=false
if [[ "$SERVER_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  info "Bare IP detected — HTTPS is not available (certbot requires a domain)."
  SCHEME="http"
elif [[ "$SERVER_DOMAIN" == "localhost" ]]; then
  info "localhost — skipping HTTPS."
  SCHEME="http"
else
  read -rp "Set up HTTPS with certbot for $SERVER_DOMAIN? [Y/n]: " SETUP_SSL
  if [[ ! "$SETUP_SSL" =~ ^[Nn]$ ]]; then
    sudo apt-get install -y -qq certbot python3-certbot-nginx
    ok "certbot installed"
    USE_SSL=true
    SCHEME="https"
  else
    SCHEME="http"
  fi
fi

# Optional: ffmpeg
read -rp "Install ffmpeg for demo videos? [y/N]: " INSTALL_FFMPEG
if [[ "$INSTALL_FFMPEG" =~ ^[Yy]$ ]]; then
  sudo apt-get install -y -qq ffmpeg
  ok "ffmpeg installed"
fi
echo ""

# --- Create service user if needed ---
CURRENT_USER=$(whoami)
info "Running as: $CURRENT_USER"

# --- Install Node.js via nvm ---
info "Checking Node.js..."
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
set +eu
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null
set -eu

NEED_NODE=false
if ! command -v node &>/dev/null; then
  NEED_NODE=true
else
  NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -lt 22 ]; then
    NEED_NODE=true
  fi
fi

if [ "$NEED_NODE" = true ]; then
  if ! type nvm &>/dev/null 2>&1; then
    info "Installing nvm..."
    export NVM_DIR="$HOME/.nvm"
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    set +eu
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null
    set -eu
  fi
  info "Installing Node.js 22..."
  set +eu
  nvm install 22
  nvm use 22
  nvm alias default 22
  set -eu
fi
ok "Node.js $(node -v)"
echo ""

# --- Install frontend + build ---
info "Installing frontend dependencies..."
(cd frontend && npm install --silent)
ok "Dependencies installed"

info "Building Next.js for production..."
(cd frontend && npx next build)
ok "Production build complete"
echo ""

# --- Generate .env ---
if [ -f ".env" ]; then
  read -rp ".env already exists. Overwrite? [y/N]: " OVERWRITE_ENV
  if [[ ! "$OVERWRITE_ENV" =~ ^[Yy]$ ]]; then
    APP_PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || echo "8080")
    APP_PORT="${APP_PORT:-8080}"
    ok "Keeping existing .env (port: $APP_PORT)"
  fi
fi

if [ ! -f ".env" ] || [[ "${OVERWRITE_ENV:-}" =~ ^[Yy]$ ]]; then
  info "Generating .env..."
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  read -rp "Application port [8080]: " PORT_INPUT
  APP_PORT="${PORT_INPUT:-8080}"
  read -rp "Projects directory [~/Projects]: " PROJECTS_INPUT
  PROJECTS_DIR="${PROJECTS_INPUT:-~/Projects}"

  cat > .env << EOF
AUTH_SECRET_KEY=$SECRET
PROJECTS_DIR=$PROJECTS_DIR
HOST=127.0.0.1
PORT=$APP_PORT
APP_PORT_START=3001
PREVIEW_PORT_MIN=9001
PREVIEW_PORT_MAX=9050
ARCHIE_MODE=production
ALLOWED_ORIGINS=$SCHEME://$SERVER_DOMAIN
FORCE_SECURE_COOKIES=$USE_SSL
CLAUDE_DANGEROUS_PERMISSIONS=true
CODEX_READ_ONLY_MODE=bypass
EOF
  ok ".env generated"
else
  PROJECTS_DIR=$(grep -E '^PROJECTS_DIR=' .env 2>/dev/null | cut -d= -f2- | tr -d '"'"'" || echo "~/Projects")
fi
echo ""

# Make .env available to the direct bootstrap step.
set -a
source "$PROJECT_DIR/.env"
set +a

# --- Create initial admin before exposing the app ---
BOOTSTRAP_STATUS=$(PROJECT_DIR="$PROJECT_DIR" DATABASE_PATH="${DATABASE_PATH:-}" node "$PROJECT_DIR/scripts/ubuntu/bootstrap-admin.js" status)
if [ "$BOOTSTRAP_STATUS" = "ready" ]; then
  ok "Initial admin already exists — keeping existing setup"
else
  info "Creating initial admin account..."
  prompt_required ADMIN_NAME "Admin name: "

  while true; do
    read -rp "Admin email: " ADMIN_EMAIL
    if [[ "$ADMIN_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
      break
    fi
    warn "Enter a valid email address."
  done

  prompt_password ADMIN_PASSWORD "Admin password (min 6 chars): " "Confirm admin password: "

  read -rp "Git user name [$ADMIN_NAME]: " GIT_NAME_INPUT
  GIT_NAME="${GIT_NAME_INPUT:-$ADMIN_NAME}"

  read -rp "Git user email [$ADMIN_EMAIL]: " GIT_EMAIL_INPUT
  GIT_EMAIL="${GIT_EMAIL_INPUT:-$ADMIN_EMAIL}"

  read -rp "Generate an SSH key for this host now? [y/N]: " GENERATE_SSH_INPUT
  GENERATE_SSH_KEY=false
  if [[ "$GENERATE_SSH_INPUT" =~ ^[Yy]$ ]]; then
    GENERATE_SSH_KEY=true
  fi

  PROJECTS_DIR="${PROJECTS_DIR/#\~/$HOME}"

  PROJECT_DIR="$PROJECT_DIR" \
  DATABASE_PATH="${DATABASE_PATH:-}" \
  PROJECTS_DIR="$PROJECTS_DIR" \
  ADMIN_NAME="$ADMIN_NAME" \
  ADMIN_EMAIL="$ADMIN_EMAIL" \
  ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  GIT_NAME="$GIT_NAME" \
  GIT_EMAIL="$GIT_EMAIL" \
  GENERATE_SSH_KEY="$GENERATE_SSH_KEY" \
  node "$PROJECT_DIR/scripts/ubuntu/bootstrap-admin.js" create

  if [ $? -ne 0 ]; then
    err "Admin bootstrap failed — see output above"
    exit 1
  fi

  ok "Initial admin account created"
fi
echo ""

# --- Configure nginx ---
info "Configuring nginx..."

# Remove stale nginx configs for Archie (avoids conflicts)
for stale in /etc/nginx/sites-enabled/archie /etc/nginx/sites-enabled/archibald \
             /etc/nginx/sites-available/archibald; do
  [ -f "$stale" ] && sudo rm -f "$stale" && warn "Removed stale config: $stale"
done

sudo tee /etc/nginx/sites-available/archie > /dev/null << NGINXEOF
upstream archie {
    server 127.0.0.1:$APP_PORT;
}

server {
    listen 80;
    server_name $SERVER_DOMAIN;
    client_max_body_size 50M;

    proxy_connect_timeout 300s;
    proxy_send_timeout    300s;
    proxy_read_timeout    300s;

    location / {
        proxy_pass http://archie;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_cache off;
    }
}
NGINXEOF

sudo ln -sf /etc/nginx/sites-available/archie /etc/nginx/sites-enabled/archie
[ -f /etc/nginx/sites-enabled/default ] && sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx
ok "nginx configured (HTTP)"
echo ""

# --- SSL via certbot ---
if [ "$USE_SSL" = true ]; then
  info "Requesting SSL certificate for $SERVER_DOMAIN..."
  if sudo certbot --nginx -d "$SERVER_DOMAIN" --non-interactive --agree-tos --redirect \
       --register-unsafely-without-email 2>/dev/null \
     || sudo certbot --nginx -d "$SERVER_DOMAIN" --redirect; then
    ok "HTTPS configured with certbot"
  else
    warn "certbot failed — site will remain HTTP-only. You can retry later with:"
    echo "  sudo certbot --nginx -d $SERVER_DOMAIN"
    SCHEME="http"
    USE_SSL=false
    # Update .env to reflect the fallback
    sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=http://$SERVER_DOMAIN|" "$PROJECT_DIR/.env"
    sed -i "s|^FORCE_SECURE_COOKIES=.*|FORCE_SECURE_COOKIES=false|" "$PROJECT_DIR/.env"
  fi
  echo ""
fi

# --- Create systemd service ---
info "Creating systemd service..."
NODE_BIN=$(command -v node)
NEXT_BIN="$PROJECT_DIR/frontend/node_modules/next/dist/bin/next"
NVM_DIR_RESOLVED="${NVM_DIR:-$HOME/.nvm}"

sudo tee /etc/systemd/system/archie.service > /dev/null << SERVICEEOF
[Unit]
Description=Archie AI DevOps Dashboard
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$PROJECT_DIR/frontend
EnvironmentFile=$PROJECT_DIR/.env
Environment=NODE_ENV=production
Environment=PATH=$NVM_DIR_RESOLVED/versions/node/$(node -v)/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$NODE_BIN $NEXT_BIN start --hostname 127.0.0.1 -p $APP_PORT
Restart=on-failure
RestartSec=5
# Archie starts user app and preview servers as managed child processes. Keep
# those processes alive when only the dashboard service is restarted for updates.
KillMode=process
StandardOutput=append:$PROJECT_DIR/data/archie.log
StandardError=append:$PROJECT_DIR/data/archie.log

[Install]
WantedBy=multi-user.target
SERVICEEOF

mkdir -p "$PROJECT_DIR/data"
sudo systemctl daemon-reload
sudo systemctl enable archie
sudo systemctl start archie
ok "systemd service created, enabled, and started"
echo ""

# --- Firewall ---
if command -v ufw &>/dev/null; then
  UFW_STATUS=$(sudo ufw status | head -1)
  if [[ "$UFW_STATUS" == *"active"* ]]; then
    info "Configuring firewall..."
    sudo ufw allow 80/tcp comment "Archie HTTP"
    sudo ufw allow 443/tcp comment "Archie HTTPS"
    sudo ufw allow 22/tcp comment "SSH"
    ok "Firewall rules added"
    echo ""
  fi
fi

# --- Done ---
echo ""
echo -e "${BOLD}=== Installation Complete ===${NC}"
echo ""
echo -e "${GREEN}Production deployment ready.${NC}"
echo ""
echo "  Start:    sudo systemctl start archie"
echo "  Stop:     sudo systemctl stop archie"
echo "  Status:   sudo systemctl status archie"
echo "  Logs:     sudo journalctl -u archie -f"
echo "  Domain:   scripts/ubuntu/domain.sh"
echo ""
echo -e "  ${BOLD}Open $SCHEME://$SERVER_DOMAIN to sign in with the admin account you just created.${NC}"
echo ""
echo -e "${YELLOW}Make sure you have Claude CLI or Codex CLI installed and authenticated, and that the GitHub gh CLI is authenticated.${NC}"
echo ""
