#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CALLER_DIR="$PWD"
REQUESTED_PORT="${CODEX_EXCALIDRAW_PORT:-43218}"
PORT="$(node -e 'const net = require("net"); const start = Number(process.argv[1]) || 43218; function probe(port) { const server = net.createServer(); server.unref(); server.on("error", () => probe(port + 1)); server.listen(port, "127.0.0.1", () => { const selected = server.address().port; server.close(() => console.log(selected)); }); } probe(start);' "$REQUESTED_PORT")"
PROJECT_DIR="${CODEX_EXCALIDRAW_PROJECT_DIR:-${1:-$CALLER_DIR}}"
CANVAS_DIR="${CODEX_EXCALIDRAW_CANVAS_DIR:-$PROJECT_DIR/canvas/excalidraw}"

export CODEX_EXCALIDRAW_PROJECT_DIR="$PROJECT_DIR"
export CODEX_EXCALIDRAW_CANVAS_DIR="$CANVAS_DIR"
export CODEX_EXCALIDRAW_API_URL="http://127.0.0.1:${PORT}"

mkdir -p "$CANVAS_DIR"
node -e "const fs=require('fs'); const [apiBaseUrl, projectDir, canvasDir, pid]=process.argv.slice(1); fs.writeFileSync(require('path').join(canvasDir, 'session.json'), JSON.stringify({ apiBaseUrl, projectDir, canvasDir, pid: Number(pid), updatedAt: new Date().toISOString() }, null, 2) + '\n')" "$CODEX_EXCALIDRAW_API_URL" "$PROJECT_DIR" "$CANVAS_DIR" "$$"

cd "$ROOT_DIR"

if [ ! -d node_modules ] || [ ! -x node_modules/.bin/vite ]; then
  npm install
fi

if [ "$PORT" != "$REQUESTED_PORT" ]; then
  echo "Codex Excalidraw requested port ${REQUESTED_PORT} is busy; using ${PORT}"
fi
echo "Codex Excalidraw canvas: http://127.0.0.1:${PORT}"
echo "Codex Excalidraw scene: ${CANVAS_DIR}/scene.excalidraw"
echo "Codex Excalidraw exports: ${CANVAS_DIR}/exports"
exec npm run dev -- --host 127.0.0.1 --port "$PORT" --strictPort
