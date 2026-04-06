#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PID_DIR="$PROJECT_DIR/.archie/pids"
PORT="${PORT:-8080}"

echo "=== Force killing Archie ==="

# Kill processes from PID files
for pidfile in "$PID_DIR"/*.pid; do
  [ -f "$pidfile" ] || continue
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    echo "Killing PID $pid ($(basename "$pidfile" .pid))..."
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
done

# Kill anything still on the port (cross-platform)
if [ "$(uname)" = "Darwin" ]; then
  pids=$(lsof -ti :"$PORT" 2>/dev/null || true)
else
  pids=$(ss -tlnp 2>/dev/null | grep ":$PORT " | awk -F'pid=' '{print $2}' | awk -F',' '{print $1}' || true)
fi
if [ -n "$pids" ]; then
  for pid in $pids; do
    echo "Killing process $pid on port $PORT..."
    kill -9 "$pid" 2>/dev/null || true
  done
fi

# Kill any remaining next/node processes from this project
pgrep -f "$PROJECT_DIR/frontend" 2>/dev/null | while read -r pid; do
  echo "Killing leftover process $pid..."
  kill -9 "$pid" 2>/dev/null || true
done

# Clean up PID files
rm -f "$PID_DIR"/*.pid

echo "=== Archie killed. Port $PORT is free. ==="
