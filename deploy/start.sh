#!/bin/bash
# deploy/start.sh — production start script for the trading-analyzer backend
# Run on the Oracle Cloud VM (Ubuntu). Uses pm2 for auto-restart + 24/7 uptime.
set -e

cd "$(dirname "$0")/.."

# Load env (API keys etc.) — ensure backend/.env exists with real keys
if [ ! -f backend/.env ]; then
  echo "ERROR: backend/.env missing. Copy backend/.env.example to backend/.env and fill in keys."
  exit 1
fi

export NODE_ENV=production
export PORT="${PORT:-5000}"
# Add your Tailscale IP here (find via `tailscale ip` on the VM) so mobile/laptop can reach it.
# Leave default if you only access via the VM's Tailscale IP directly.
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:5000}"

echo "Starting trading-analyzer on port $PORT (origins: $ALLOWED_ORIGINS)"

# pm2 keeps the process alive across reboots and crashes
if command -v pm2 >/dev/null 2>&1; then
  pm2 start backend/server.js --name trading-analyzer --cwd "$(pwd)/backend" --env production
  pm2 save
  echo "Started via pm2. Check status: pm2 status"
else
  echo "pm2 not found. Install with: npm install -g pm2"
  echo "Falling back to nohup..."
  nohup node backend/server.js > /var/log/trading-analyzer.log 2>&1 &
  echo "Started with nohup (PID $!). Logs: /var/log/trading-analyzer.log"
fi
