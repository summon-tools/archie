#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PID_DIR="$PROJECT_DIR/.archie/pids"

echo "=== Stopping Archie ==="

# Stop the single Next.js process (and legacy services if present)
for service in archie backend frontend proxy; do
  pidfile="$PID_DIR/$service.pid"
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      echo "Stopping $service (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      for i in $(seq 1 10); do
        if ! kill -0 "$pid" 2>/dev/null; then
          break
        fi
        sleep 0.5
      done
      if kill -0 "$pid" 2>/dev/null; then
        echo "  Force killing $service..."
        kill -9 "$pid" 2>/dev/null || true
      fi
      echo "  $service stopped."
    else
      echo "$service (PID $pid) is not running."
    fi
    rm -f "$pidfile"
  fi
done

echo "=== Archie stopped ==="
