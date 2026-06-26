#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

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

normalize_domain() {
  local raw="$1"
  raw="${raw#http://}"
  raw="${raw#https://}"
  raw="${raw%%/*}"
  raw="${raw%:}"
  printf '%s' "$raw" | tr '[:upper:]' '[:lower:]'
}

is_ipv4() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

upsert_env() {
  local key="$1"
  local value="$2"
  local file="$PROJECT_DIR/.env"

  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

echo ""
echo -e "${BOLD}=== Archie Domain Setup ===${NC}"
echo ""

if [ "$(uname -s)" != "Linux" ]; then
  err "This helper is for the Ubuntu/Debian deployment."
  exit 1
fi

if [ ! -f "frontend/package.json" ]; then
  err "frontend/package.json not found. Run this script from the Archie root directory."
  exit 1
fi

if [ ! -f ".env" ]; then
  err ".env not found. Run scripts/ubuntu/install.sh first."
  exit 1
fi

DOMAIN_INPUT="${1:-}"
if [ -z "$DOMAIN_INPUT" ]; then
  read -rp "Domain to attach (example: archie.example.com): " DOMAIN_INPUT
fi

DOMAIN=$(normalize_domain "$DOMAIN_INPUT")
if [ -z "$DOMAIN" ]; then
  err "Domain is required."
  exit 1
fi

if is_ipv4 "$DOMAIN" || [ "$DOMAIN" = "localhost" ]; then
  err "Enter a real domain name, not an IP address or localhost."
  exit 1
fi

if [[ "$DOMAIN" == *":"* ]]; then
  err "Do not include a port in the domain. Use a hostname like archie.example.com."
  exit 1
fi

if [[ ! "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]]; then
  err "Domain format looks invalid: $DOMAIN"
  exit 1
fi

set -a
source "$PROJECT_DIR/.env"
set +a

APP_PORT="${PORT:-8080}"
NGINX_AVAILABLE="/etc/nginx/sites-available/archie"
NGINX_ENABLED="/etc/nginx/sites-enabled/archie"
BACKUP_FILE=""

echo "Domain: $DOMAIN"
echo "Archie app port: $APP_PORT"
echo ""
warn "Make sure DNS for $DOMAIN points to this server before enabling HTTPS."
echo ""

read -rp "Set up HTTPS with certbot for $DOMAIN? [Y/n]: " SETUP_SSL
USE_SSL=true
if [[ "$SETUP_SSL" =~ ^[Nn]$ ]]; then
  USE_SSL=false
fi

if ! command -v nginx &>/dev/null; then
  if command -v apt-get &>/dev/null; then
    info "Installing nginx..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq nginx
    ok "nginx installed"
  else
    err "nginx is not installed and apt-get is unavailable."
    exit 1
  fi
fi

if [ -f "$NGINX_AVAILABLE" ]; then
  BACKUP_FILE=$(mktemp)
  sudo cp "$NGINX_AVAILABLE" "$BACKUP_FILE"
fi

info "Writing nginx configuration for $DOMAIN..."
sudo tee "$NGINX_AVAILABLE" > /dev/null <<NGINXEOF
upstream archie {
    server 127.0.0.1:$APP_PORT;
}

server {
    listen 80;
    server_name $DOMAIN;
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

sudo ln -sf "$NGINX_AVAILABLE" "$NGINX_ENABLED"
if ! sudo nginx -t; then
  if [ -n "$BACKUP_FILE" ]; then
    warn "Restoring previous nginx configuration..."
    sudo cp "$BACKUP_FILE" "$NGINX_AVAILABLE"
    sudo nginx -t >/dev/null 2>&1 || true
  fi
  err "nginx configuration failed. Check the output above."
  exit 1
fi

sudo systemctl enable nginx >/dev/null 2>&1 || true
sudo systemctl reload nginx 2>/dev/null || sudo systemctl restart nginx
ok "nginx configured for HTTP"
echo ""

SCHEME="http"
FORCE_SECURE="false"
if [ "$USE_SSL" = true ]; then
  if ! command -v certbot &>/dev/null; then
    if command -v apt-get &>/dev/null; then
      info "Installing certbot..."
      sudo apt-get update -qq
      sudo apt-get install -y -qq certbot python3-certbot-nginx
      ok "certbot installed"
    else
      warn "certbot is not installed and apt-get is unavailable. Leaving site HTTP-only."
      USE_SSL=false
    fi
  fi

  if [ "$USE_SSL" = true ]; then
    info "Requesting SSL certificate for $DOMAIN..."
    if sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect \
         --register-unsafely-without-email 2>/dev/null \
       || sudo certbot --nginx -d "$DOMAIN" --redirect; then
      SCHEME="https"
      FORCE_SECURE="true"
      ok "HTTPS configured with certbot"
    else
      warn "certbot failed. Archie will remain available over HTTP for now."
      echo "Retry later with:"
      echo "  sudo certbot --nginx -d $DOMAIN --redirect"
    fi
  fi
fi
echo ""

info "Updating Archie environment..."
upsert_env "ALLOWED_ORIGINS" "$SCHEME://$DOMAIN"
upsert_env "FORCE_SECURE_COOKIES" "$FORCE_SECURE"
ok ".env updated"

if [ -f /etc/systemd/system/archie.service ]; then
  info "Restarting Archie dashboard..."
  sudo systemctl restart archie
  ok "Archie restarted"
else
  warn "No archie systemd service found. Restart Archie manually for .env changes to apply."
fi

echo ""
echo -e "${BOLD}=== Domain setup complete ===${NC}"
echo ""
echo "Open: $SCHEME://$DOMAIN"
echo ""
