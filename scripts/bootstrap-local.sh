#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# ============================================================
#  Archie — Local Development Bootstrap
#  Lightweight setup: no root, no infra
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

echo ""
echo -e "${BOLD}=== Archie Local Bootstrap ===${NC}"
echo ""

# --- Check prerequisites ---
info "Checking prerequisites..."

missing=()
for cmd in git curl; do
  if ! command -v "$cmd" &>/dev/null; then
    missing+=("$cmd")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  err "Missing required tools: ${missing[*]}"
  err "Please install them and re-run this script."
  exit 1
fi
ok "git, curl OK"

# Check Node.js — find nvm, pick the best version, install if needed
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
set +eu
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null
set -eu

MIN_NODE=22

if type nvm &>/dev/null 2>&1; then
  # nvm is available — find the best installed version (>= MIN_NODE)
  BEST=""
  for v in $(nvm ls --no-colors 2>/dev/null | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | sort -t. -k1,1rn -k2,2rn -k3,3rn); do
    MAJOR=$(echo "$v" | sed 's/v//' | cut -d. -f1)
    if [ "$MAJOR" -ge "$MIN_NODE" ]; then
      BEST="$v"
      break
    fi
  done

  if [ -n "$BEST" ]; then
    info "Switching to Node.js $BEST..."
    set +eu; nvm use "$BEST" 2>/dev/null; set -eu
  else
    info "No Node.js >= $MIN_NODE found. Installing Node.js $MIN_NODE via nvm..."
    set +eu
    nvm install "$MIN_NODE"
    nvm use "$MIN_NODE"
    set -eu
  fi
elif ! command -v node &>/dev/null; then
  warn "Node.js not found. Install nvm first:"
  echo ""
  echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
  echo "  source ~/.bashrc"
  echo "  nvm install $MIN_NODE"
  echo ""
  err "Then re-run: bash scripts/setup.sh"
  exit 1
fi

# Final check
if ! command -v node &>/dev/null; then
  err "Node.js still not available after setup. Please install Node.js >= $MIN_NODE."
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt "$MIN_NODE" ]; then
  warn "Node.js v${NODE_MAJOR} is below the minimum (v${MIN_NODE}). Things may not work correctly."
fi
ok "Node.js $(node -v)"

# --- Optional tools ---
if command -v ffmpeg &>/dev/null; then
  ok "ffmpeg found (demo videos will work)"
else
  warn "ffmpeg not found (optional — needed for demo video feature)"
fi

echo ""

# --- Install frontend dependencies ---
info "Installing frontend dependencies..."
(cd frontend && npm install --silent)
ok "Frontend dependencies installed"

# Rebuild native modules for the current architecture
info "Rebuilding native modules..."
(cd frontend && npm rebuild better-sqlite3 --silent 2>/dev/null || true)
ok "Native modules ready"
echo ""

# --- Create .env if missing ---
if [ ! -f ".env" ]; then
  info "Creating .env with local defaults..."
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

  cat > .env << EOF
# ===== REQUIRED =====
AUTH_SECRET_KEY=$SECRET

# ===== CORE =====
PROJECTS_DIR=~/Projects
HOST=127.0.0.1
PORT=8080
APP_PORT_START=3001
PREVIEW_PORT_MIN=9001
PREVIEW_PORT_MAX=9050

# ===== DEPLOYMENT =====
ARCHIE_MODE=development
ALLOWED_ORIGINS=http://localhost:8080,http://localhost:3000
FORCE_SECURE_COOKIES=false

# ===== CLAUDE PERMISSIONS =====
CLAUDE_DANGEROUS_PERMISSIONS=true
EOF

  ok ".env created with sensible local defaults"
else
  ok ".env already exists"
fi

# --- Create data directory ---
mkdir -p data
ok "Data directory ready"

echo ""
echo -e "${BOLD}=== Bootstrap Complete ===${NC}"
echo ""
echo -e "${GREEN}Development setup ready.${NC}"
echo ""
echo "  Start:  cd frontend && npm run dev"
echo ""
echo -e "  ${BOLD}Then open http://localhost:8080 to complete setup.${NC}"
echo ""
echo -e "${YELLOW}Make sure you have Claude CLI or Codex CLI installed and authenticated.${NC}"
echo ""
