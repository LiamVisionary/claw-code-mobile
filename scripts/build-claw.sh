#!/usr/bin/env bash
set -euo pipefail

# Build the claw binary into a cache directory OUTSIDE the project tree.
# Keeping cargo's target/ out of the project prevents Metro's file watcher
# from stumbling on transient cargo temp files (ENOENT on .../deps/rustc*)
# and crashing the expo dev server.
CLAW_DIR="$(cd "$(dirname "$0")/.." && pwd)/claw-code"
TARGET_DIR="${CLAW_TARGET_DIR:-$HOME/.cache/claw-code-mobile/target}"
BINARY="$TARGET_DIR/debug/claw"

export CARGO_TARGET_DIR="$TARGET_DIR"

if [ -f "$BINARY" ]; then
  echo "[claw] Binary already exists at $BINARY"
  exit 0
fi

echo "[claw] Cloning ultraworkers/claw-code..."
if [ ! -d "$CLAW_DIR" ]; then
  git clone --depth=1 https://github.com/ultraworkers/claw-code "$CLAW_DIR"
fi

mkdir -p "$TARGET_DIR"

echo "[claw] Building Rust workspace into $TARGET_DIR (takes a few minutes on first run)..."
cd "$CLAW_DIR/rust"
cargo build -p rusty-claude-cli 2>&1

echo "[claw] Build complete: $BINARY"
