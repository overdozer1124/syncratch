#!/bin/sh
# Ensure vendor/scratch-editor working tree exists for Docker/Railway builds.
# Railway git archives often omit submodule contents even when "submodules" is on.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor/scratch-editor"
URL="https://github.com/scratchfoundation/scratch-editor.git"
# Keep in sync with docs/gate0/SCRATCH_PIN.md / gitlink.
SHA="${SCRATCH_EDITOR_SHA:-7c172e469eb3c21c1e6326ea6cccea60bc14e3a8}"

if [ -f "$VENDOR/package.json" ]; then
  echo "[ensure-vendor] vendor/scratch-editor already present"
  exit 0
fi

echo "[ensure-vendor] cloning scratch-editor @$SHA"
rm -rf "$VENDOR"
mkdir -p "$ROOT/vendor"
git init "$VENDOR"
git -C "$VENDOR" remote add origin "$URL"
git -C "$VENDOR" fetch --depth 1 origin "$SHA"
git -C "$VENDOR" checkout --force FETCH_HEAD
test -f "$VENDOR/package.json"
echo "[ensure-vendor] ready"
