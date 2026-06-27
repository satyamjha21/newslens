#!/usr/bin/env bash
# ─────────────────────────────────────────────
#  NewsLens — Quick Start (Mac / Linux)
#  Run from the project root: bash start.sh
# ─────────────────────────────────────────────

set -e

BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"
FRONTEND_DIR="$(cd "$(dirname "$0")/frontend" && pwd)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  NewsLens Intelligence — Quick Start"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Create .env if not present
if [ ! -f "$BACKEND_DIR/.env" ]; then
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
  echo "✅ Created backend/.env — add your API keys!"
fi

# 2. Create venv if not present
if [ ! -d "$BACKEND_DIR/.venv" ]; then
  echo "📦 Creating virtual environment..."
  python3 -m venv "$BACKEND_DIR/.venv"
fi

# 3. Install deps
echo "📦 Installing dependencies..."
"$BACKEND_DIR/.venv/bin/pip" install -r "$BACKEND_DIR/requirements.txt" -q

# 4. Start backend
echo ""
echo "🚀 Starting backend at http://127.0.0.1:8000 ..."
cd "$BACKEND_DIR"
"$BACKEND_DIR/.venv/bin/uvicorn" main:app --reload --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

sleep 2
echo "✅ Backend running (PID $BACKEND_PID)"
echo "📰 Dashboard: http://127.0.0.1:8000/app/"
echo "📖 API Docs:  http://127.0.0.1:8000/docs"
echo ""
echo "Press Ctrl+C to stop."

# Open browser
if command -v xdg-open &>/dev/null; then
  xdg-open "http://127.0.0.1:8000/app/"
elif command -v open &>/dev/null; then
  open "http://127.0.0.1:8000/app/"
fi

wait $BACKEND_PID
