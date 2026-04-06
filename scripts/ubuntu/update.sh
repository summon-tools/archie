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
