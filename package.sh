#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$ROOT/dist"
OUT_FILE="$OUT_DIR/com.TechDecryptor.manggo.free-pack.mplugin"

mkdir -p "$OUT_DIR"
rm -f "$OUT_FILE"
cd "$ROOT"
zip -q -r "$OUT_FILE" \
  manggo.plugin.json \
  main.js \
  bing-edge-client.js \
  bing-token-cache.js \
  icon.jpeg \
  transmart.svg \
  youdao.svg \
  bing.svg \
  google.svg \
  README.md \
  LICENSE

echo "$OUT_FILE"
