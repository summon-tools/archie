#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PID_DIR="$PROJECT_DIR/.archie/pids"
LOG_DIR="$PROJECT_DIR/.archie/logs"

mkdir -p "$PID_DIR" "$LOG_DIR"

echo "=== Starting Archie ==="

# --- Check for systemd service in production ---
if [ -f /etc/systemd/system/archie.service ]; then
  # Load env to check mode
  if [ -f "$PROJECT_DIR/.env" ]; then
    set -a; source "$PROJECT_DIR/.env"; set +a
  fi
  if [ "${ARCHIE_MODE:-development}" = "production" ]; then
    echo ""
    echo "A systemd service is configured for production."
    echo "  Start:   sudo systemctl start archie"
    echo "  Stop:    sudo systemctl stop archie"
    echo "  Status:  sudo systemctl status archie"
    echo "  Logs:    sudo journalctl -u archie -f"
    echo ""
    read -rp "Continue with manual start anyway? [y/N]: " MANUAL_START
    if [[ ! "$MANUAL_START" =~ ^[Yy]$ ]]; then
      exit 0
    fi
  fi
fi

# --- Prerequisite checks ---
echo "Checking prerequisites..."

if ! command -v node &>/dev/null; then
  # Try to source NVM so node becomes available
  if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    . "$NVM_DIR/nvm.sh"
  elif [ -s "/opt/homebrew/opt/nvm/nvm.sh" ]; then
    export NVM_DIR="/opt/homebrew/opt/nvm"
    . "$NVM_DIR/nvm.sh"
  elif [ -s "/usr/local/opt/nvm/nvm.sh" ]; then
    export NVM_DIR="/usr/local/opt/nvm"
    . "$NVM_DIR/nvm.sh"
  fi

  if ! command -v node &>/dev/null; then
    echo "ERROR: node not found. Please install Node.js or configure NVM."
    exit 1
  fi
fi

if ! command -v npm &>/dev/null; then
  echo "ERROR: npm not found. Please install Node.js (npm is bundled with it)."
  exit 1
fi

echo "  node:    $(node --version 2>&1)"
echo "  npm:     $(npm --version 2>&1)"

# --- Load environment ---
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

ARCHIE_MODE="${ARCHIE_MODE:-development}"
PORT="${PORT:-8080}"
echo "  mode:    $ARCHIE_MODE"
echo "  port:    $PORT"
echo ""

# --- Install dependencies if needed ---
cd "$PROJECT_DIR/frontend"
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# --- Ensure Claude Code SDK can spawn claude subprocess ---
unset CLAUDECODE

# --- Start Next.js (single process) ---
echo "Starting Archie on port $PORT..."
if [ "$ARCHIE_MODE" = "production" ]; then
  # Build first if .next doesn't exist
  if [ ! -d ".next" ]; then
    echo "Building for production..."
    npx next build
  fi
  nohup npx next start -p "$PORT" \
    > "$LOG_DIR/archie.log" 2>&1 &
else
  nohup npx next dev -p "$PORT" \
    > "$LOG_DIR/archie.log" 2>&1 &
fi
echo $! > "$PID_DIR/archie.pid"
echo "  PID: $(cat "$PID_DIR/archie.pid")"

# Wait for server to start
sleep 3

echo ""
echo "=== Archie is running ==="
echo ""
echo "Access the dashboard at:  http://localhost:$PORT"
echo ""
echo "Logs:  $LOG_DIR/archie.log"
echo "PIDs:  $PID_DIR/"
echo ""
echo "To stop: $PROJECT_DIR/scripts/ubuntu/stop.sh"
