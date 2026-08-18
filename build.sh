#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Building Apitomy Flow ==="
echo ""

echo "--- Engine (Java) ---"
cd "$SCRIPT_DIR/engine"
mvn clean install -q
echo "Engine build complete."
echo ""

echo "--- UI (React) ---"
cd "$SCRIPT_DIR/ui"
npm install --silent
npm run lint
npm run build
echo "UI build complete."
echo ""

echo "=== Build successful ==="
