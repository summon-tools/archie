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
echo -e "${BOLD}=== Archie Reset ===${NC}"
echo ""
echo -e "${RED}WARNING: This will delete data and cannot be undone.${NC}"
echo ""
echo "Select reset type:"
echo "  1) Soft reset  — delete database and logs, keep config and build"
echo "  2) Full reset  — delete everything, back to fresh clone state"
echo ""
read -rp "Enter choice [1/2]: " RESET_CHOICE
echo ""

# Confirm
if [ "$RESET_CHOICE" = "2" ]; then
  echo -e "${RED}This will delete: database, logs, .env, node_modules, build output, and PIDs.${NC}"
  echo "You will need to run scripts/setup.sh again."
else
  echo -e "${YELLOW}This will delete: database, logs, and PIDs.${NC}"
  echo "Your .env, dependencies, and build will be kept."
fi

echo ""
read -rp "Type 'reset' to confirm: " CONFIRM
if [ "$CONFIRM" != "reset" ]; then
  echo "Aborted."
  exit 0
fi
echo ""

# Stop running services first
if [ -f ".archie/pids/archie.pid" ] || [ -f ".pids/archie.pid" ]; then
  info "Stopping Archie..."
  "$PROJECT_DIR/scripts/ubuntu/stop.sh" 2>/dev/null || true
  echo ""
fi

if [ -f /etc/systemd/system/archie.service ]; then
  info "Stopping systemd service..."
  sudo systemctl stop archie 2>/dev/null || true
fi

# --- Soft reset: data only ---

info "Removing database..."
rm -f data/dashboard.db data/dashboard.db-wal data/dashboard.db-shm
ok "Database deleted"

info "Removing logs and PIDs..."
rm -rf .archie/logs/ .archie/pids/ .logs/ .pids/
ok "Logs and PIDs deleted"

# --- Full reset: everything ---

if [ "$RESET_CHOICE" = "2" ]; then
  info "Removing .env..."
  rm -f .env
  ok ".env deleted"

  info "Removing frontend build..."
  rm -rf frontend/.next/
  ok "Build output deleted"

  info "Removing node_modules..."
  rm -rf frontend/node_modules/
  ok "node_modules deleted"

  info "Removing .archie directory..."
  rm -rf .archie/
  ok ".archie directory deleted"

  info "Removing Python venv (if present)..."
  rm -rf .venv/
  ok "Virtual environment deleted"

  if [ -f /etc/systemd/system/archie.service ]; then
    info "Removing systemd service..."
    sudo systemctl disable archie 2>/dev/null || true
    sudo rm -f /etc/systemd/system/archie.service
    sudo systemctl daemon-reload
    ok "systemd service removed"
  fi

  if [ -f /etc/nginx/sites-enabled/archie ]; then
    info "Removing nginx configuration..."
    sudo rm -f /etc/nginx/sites-enabled/archie
    sudo rm -f /etc/nginx/sites-available/archie
    sudo systemctl reload nginx 2>/dev/null || true
    ok "nginx configuration removed"
  fi
fi

echo ""
echo -e "${BOLD}=== Reset complete ===${NC}"
echo ""
if [ "$RESET_CHOICE" = "2" ]; then
  echo "Run scripts/ubuntu/install.sh to set up Archie again."
else
  echo "Start Archie and visit the web UI to create a new admin account."
  echo "  scripts/ubuntu/start.sh"
fi
echo ""
