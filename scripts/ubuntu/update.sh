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

echo ""
echo -e "${BOLD}=== Archie Update ===${NC}"
echo ""

# Verify we're in the right directory
if [ ! -f "frontend/package.json" ]; then
  err "frontend/package.json not found. Run this script from the Archie root directory."
  exit 1
fi

# Source nvm if available
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
fi

# Get current version
OLD_VERSION=$(node -e "console.log(require('./frontend/package.json').version)")
info "Current version: v${OLD_VERSION}"

# Load environment
if [ -f ".env" ]; then
  set -a
  source .env
  set +a
fi

ARCHIE_MODE="${ARCHIE_MODE:-development}"
APP_PORT="${PORT:-8080}"
SERVICE_EXECSTART_UPDATED=false

ensure_systemd_preserves_managed_servers() {
  local service_file="/etc/systemd/system/archie.service"
  local service_changed=false

  [ -f "$service_file" ] || return 0

  if sudo grep -q '^KillMode=' "$service_file"; then
    local kill_mode
    kill_mode=$(sudo awk -F= '/^KillMode=/{ gsub(/[[:space:]]/, "", $2); print $2; exit }' "$service_file")
    if [ "$kill_mode" != "process" ]; then
      info "Configuring systemd to keep app/preview servers alive across dashboard restarts..."
      sudo sed -i 's|^KillMode=.*|KillMode=process|' "$service_file"
      service_changed=true
      ok "Configured archie.service with KillMode=process"
    fi
  elif sudo grep -q '^\[Service\]' "$service_file"; then
    info "Configuring systemd to keep app/preview servers alive across dashboard restarts..."
    sudo sed -i '/^\[Service\]/a KillMode=process' "$service_file"
    service_changed=true
    ok "Configured archie.service with KillMode=process"
  else
    warn "Could not find [Service] in $service_file. Add KillMode=process manually to preserve app/preview servers."
  fi

  local node_bin
  local next_bin
  local expected_exec
  local current_exec
  node_bin=$(command -v node)
  next_bin="$PROJECT_DIR/frontend/node_modules/next/dist/bin/next"
  expected_exec="ExecStart=$node_bin $next_bin start --hostname 127.0.0.1 -p $APP_PORT"
  current_exec=$(sudo awk '/^ExecStart=/{ print; exit }' "$service_file" || true)

  if [ -f "$next_bin" ] && [ "$current_exec" != "$expected_exec" ]; then
    info "Configuring systemd to run the dashboard directly instead of through npx..."
    sudo sed -i "s|^ExecStart=.*|$expected_exec|" "$service_file"
    service_changed=true
    SERVICE_EXECSTART_UPDATED=true
    ok "Updated archie.service ExecStart"
  elif [ ! -f "$next_bin" ]; then
    warn "Next.js CLI not found at $next_bin. Leaving archie.service ExecStart unchanged."
  fi

  if [ "$service_changed" = true ]; then
    sudo systemctl daemon-reload
  fi
}

free_dashboard_port_after_execstart_migration() {
  [ "$SERVICE_EXECSTART_UPDATED" = true ] || return 0

  local pids=""
  if command -v lsof &>/dev/null; then
    pids=$(sudo lsof -ti :"$APP_PORT" 2>/dev/null || true)
  elif command -v ss &>/dev/null; then
    pids=$(sudo ss -tlnp "sport = :$APP_PORT" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u || true)
  fi

  [ -n "$pids" ] || return 0

  warn "Stopping stale dashboard process on port $APP_PORT before restarting archie.service..."
  for pid in $pids; do
    sudo kill "$pid" 2>/dev/null || true
  done
  sleep 1

  local remaining=""
  if command -v lsof &>/dev/null; then
    remaining=$(sudo lsof -ti :"$APP_PORT" 2>/dev/null || true)
  elif command -v ss &>/dev/null; then
    remaining=$(sudo ss -tlnp "sport = :$APP_PORT" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u || true)
  fi
  for pid in $remaining; do
    sudo kill -9 "$pid" 2>/dev/null || true
  done
}

# Pull latest changes
info "Pulling latest changes..."
git pull origin main
echo ""

# Get new version
NEW_VERSION=$(node -e "console.log(require('./frontend/package.json').version)")

if [ "$OLD_VERSION" = "$NEW_VERSION" ]; then
  ok "Already up to date (v${NEW_VERSION})"
else
  ok "Updated: v${OLD_VERSION} -> v${NEW_VERSION}"
fi
echo ""

# Install dependencies
info "Installing dependencies..."
(cd frontend && npm install --silent)
ok "Dependencies installed"
echo ""

# Production: rebuild and restart
if [ "$ARCHIE_MODE" = "production" ]; then
  info "Building for production..."
  (cd frontend && npx next build)
  ok "Production build complete"
  echo ""

  if [ -f /etc/systemd/system/archie.service ]; then
    ensure_systemd_preserves_managed_servers
    free_dashboard_port_after_execstart_migration
    info "Restarting service..."
    sudo systemctl restart archie
    ok "Service restarted"
  else
    warn "No systemd service found. Restart manually:"
    echo "  scripts/ubuntu/stop.sh && scripts/ubuntu/start.sh"
  fi
else
  warn "Development mode — restart manually to apply changes:"
  echo "  scripts/ubuntu/stop.sh && scripts/ubuntu/start.sh"
fi

echo ""
echo -e "${BOLD}=== Update complete: v${OLD_VERSION} -> v${NEW_VERSION} ===${NC}"
echo ""
