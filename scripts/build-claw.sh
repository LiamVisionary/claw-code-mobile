#!/usr/bin/env bash
set -euo pipefail

CLAW_DIR="$(cd "$(dirname "$0")/.." && pwd)/claw-code"
BINARY="$CLAW_DIR/rust/target/debug/claw"

if [ -f "$BINARY" ]; then
  echo "[claw] Binary already exists at $BINARY"
  exit 0
fi

echo "[claw] Cloning ultraworkers/claw-code..."
if [ ! -d "$CLAW_DIR" ]; then
  git clone --depth=1 https://github.com/ultraworkers/claw-code "$CLAW_DIR"
fi

echo "[claw] Building Rust workspace (this takes a few minutes on first run)..."
cd "$CLAW_DIR/rust"
cargo build -p rusty-claude-cli 2>&1

echo "[claw] Build complete: $BINARY"
