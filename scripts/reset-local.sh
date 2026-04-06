#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# ============================================================
#  Archie — Local Development Reset
#  Lightweight reset: no sudo, no systemd/nginx teardown
# ============================================================

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }

echo ""
echo -e "${BOLD}=== Archie Local Reset ===${NC}"
echo ""
echo "Select reset type:"
echo "  1) Soft reset  — delete database and logs, keep .env and node_modules"
echo "  2) Full reset  — delete everything, back to fresh clone state"
echo ""
read -rp "Enter choice [1/2]: " RESET_CHOICE
echo ""

if [ "$RESET_CHOICE" = "2" ]; then
  echo -e "${RED}This will delete: database, logs, .env, node_modules, and build output.${NC}"
  echo "You will need to run scripts/setup.sh again."
else
  echo -e "${YELLOW}This will delete: database and logs.${NC}"
  echo "Your .env, dependencies, and build will be kept."
fi

echo ""
read -rp "Type 'reset' to confirm: " CONFIRM
if [ "$CONFIRM" != "reset" ]; then
  echo "Aborted."
  exit 0
fi
echo ""

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
fi

echo ""
echo -e "${BOLD}=== Reset complete ===${NC}"
echo ""
if [ "$RESET_CHOICE" = "2" ]; then
  echo "Run scripts/setup.sh to set up Archie again."
else
  echo "Start Archie with:  cd frontend && npm run dev"
fi
echo ""
