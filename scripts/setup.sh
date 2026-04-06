#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# ============================================================
#  Archie Setup — Thin Wrapper
#  Routes to the appropriate setup script based on mode
# ============================================================

BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BOLD}=== Archie Setup ===${NC}"
echo ""
echo "  1) Development  — local dev, no root needed"
echo "  2) Production   — Ubuntu server with nginx + systemd"
echo ""
read -rp "Enter choice [1/2]: " MODE_CHOICE

case "$MODE_CHOICE" in
  2|production|prod)
    exec bash "$PROJECT_DIR/scripts/ubuntu/install.sh"
    ;;
  *)
    exec bash "$PROJECT_DIR/scripts/bootstrap-local.sh"
    ;;
esac
