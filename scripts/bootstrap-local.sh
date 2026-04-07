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

# Prompt the user with a yes/no question. Returns 0 for yes, 1 for no.
# In non-interactive shells (no TTY), defaults to "no" so the script fails
# loudly rather than silently installing system packages.
ask_yes_no() {
  local prompt="$1"
  local default="${2:-y}"
  local hint="[Y/n]"
  [ "$default" = "n" ] && hint="[y/N]"

  if [ ! -t 0 ]; then
    warn "Non-interactive shell — cannot prompt. Assuming \"no\" for: $prompt"
    return 1
  fi

  local reply
  while true; do
    echo -ne "${YELLOW}[?]${NC} $prompt $hint "
    read -r reply </dev/tty || return 1
    reply="${reply:-$default}"
    case "$reply" in
      [Yy]|[Yy][Ee][Ss]) return 0 ;;
      [Nn]|[Nn][Oo])     return 1 ;;
      *) echo "Please answer yes or no." ;;
    esac
  done
}

# Detect the OS / package manager so we know how to install things.
detect_pkg_manager() {
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "brew"
  elif command -v apt-get &>/dev/null; then
    echo "apt"
  elif command -v dnf &>/dev/null; then
    echo "dnf"
  elif command -v yum &>/dev/null; then
    echo "yum"
  elif command -v pacman &>/dev/null; then
    echo "pacman"
  else
    echo ""
  fi
}

PKG_MGR="$(detect_pkg_manager)"

# Install one or more system packages using the detected package manager.
# Returns non-zero if installation is not possible or fails.
install_packages() {
  local pkgs=("$@")
  case "$PKG_MGR" in
    brew)
      if ! command -v brew &>/dev/null; then
        err "Homebrew is not installed. Install it from https://brew.sh and re-run."
        return 1
      fi
      brew install "${pkgs[@]}"
      ;;
    apt)
      sudo apt-get update && sudo apt-get install -y "${pkgs[@]}"
      ;;
    dnf)    sudo dnf install -y "${pkgs[@]}" ;;
    yum)    sudo yum install -y "${pkgs[@]}" ;;
    pacman) sudo pacman -S --noconfirm "${pkgs[@]}" ;;
    *)
      err "Could not detect a supported package manager. Please install manually: ${pkgs[*]}"
      return 1
      ;;
  esac
}

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
  warn "The following required tools are missing: ${missing[*]}"
  if ask_yes_no "Would you like to install them now?" "y"; then
    if ! install_packages "${missing[@]}"; then
      err "Failed to install required tools. Please install them manually and re-run."
      exit 1
    fi
    ok "Installed: ${missing[*]}"
  else
    err "Required tools are missing: ${missing[*]}. Please install them and re-run."
    exit 1
  fi
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
  warn "Node.js (>= $MIN_NODE) is required but not installed, and nvm was not found."
  if ask_yes_no "Install nvm and Node.js $MIN_NODE now?" "y"; then
    info "Installing nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    set +eu
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    set -eu
    if ! type nvm &>/dev/null 2>&1; then
      err "nvm installation did not succeed. Please install it manually and re-run."
      exit 1
    fi
    info "Installing Node.js $MIN_NODE via nvm..."
    set +eu
    nvm install "$MIN_NODE"
    nvm use "$MIN_NODE"
    set -eu
  else
    err "Node.js >= $MIN_NODE is required. Aborting."
    exit 1
  fi
fi

# Final check
if ! command -v node &>/dev/null; then
  err "Node.js still not available after setup. Please install Node.js >= $MIN_NODE."
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt "$MIN_NODE" ]; then
  warn "Node.js v${NODE_MAJOR} is installed but Archie needs v${MIN_NODE} or newer."
  if type nvm &>/dev/null 2>&1; then
    if ask_yes_no "Install Node.js $MIN_NODE via nvm now?" "y"; then
      set +eu
      nvm install "$MIN_NODE"
      nvm use "$MIN_NODE"
      set -eu
      NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
    fi
  else
    warn "nvm is not available — please upgrade Node.js manually to v${MIN_NODE}+."
  fi
  if [ "$NODE_MAJOR" -lt "$MIN_NODE" ]; then
    err "Node.js is still below v${MIN_NODE}. Aborting."
    exit 1
  fi
fi
ok "Node.js $(node -v)"

# --- Optional tools ---
if command -v ffmpeg &>/dev/null; then
  ok "ffmpeg found (demo videos will work)"
else
  warn "ffmpeg is not installed (optional — needed for the demo video feature)."
  if ask_yes_no "Install ffmpeg now?" "n"; then
    if install_packages ffmpeg; then
      ok "ffmpeg installed"
    else
      warn "ffmpeg install failed — continuing without it."
    fi
  else
    info "Skipping ffmpeg install."
  fi
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
