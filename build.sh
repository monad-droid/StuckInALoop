#!/usr/bin/env bash
# Builds a zip file ready for Chrome Web Store upload.
# Usage: ./build.sh

set -euo pipefail

VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
OUT="stuck-in-a-loop-v${VERSION}.zip"

rm -f "$OUT"

zip -r "$OUT" \
  manifest.json \
  background.js \
  content.js \
  autoplay-flag.js \
  autoplay-blocker.js \
  popup.html \
  popup.js \
  icons/icon16.png \
  icons/icon48.png \
  icons/icon128.png

echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
