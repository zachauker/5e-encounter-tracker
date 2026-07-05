#!/usr/bin/env bash
set -euo pipefail

# Copies the generated world artifacts into the serving directory.
# Prod: run on the host with WORLD_DATA_DIR pointing at the mounted volume
#   (e.g. WORLD_DATA_DIR=/data/world scripts/world/deploy-to-data.sh)
# Dev:  not needed — the app serves world-data/build directly by default.

SRC="world-data/build"
DEST="${WORLD_DATA_DIR:-world-data/build}"

if [ ! -f "$SRC/exandria.pmtiles" ]; then
  echo "error: $SRC/exandria.pmtiles not found — run the Plan 1 build scripts first." >&2
  exit 1
fi

if [ "$DEST" = "$SRC" ]; then
  echo "WORLD_DATA_DIR not set (or equals $SRC) — nothing to copy; the app serves $SRC directly."
  exit 0
fi

mkdir -p "$DEST"
cp "$SRC/exandria.pmtiles" "$DEST/"
rm -rf "$DEST/glyphs" "$DEST/styles"
cp -R "$SRC/glyphs" "$DEST/glyphs"
cp -R "$SRC/styles" "$DEST/styles"
echo "Deployed world artifacts to $DEST"
