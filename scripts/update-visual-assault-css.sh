#!/usr/bin/env bash
# Re-vendors src/renderer/themes.css from a specific VisualAssault tag.
# Usage: scripts/update-visual-assault-css.sh v0.2.0
set -euo pipefail

TAG="${1:?Usage: update-visual-assault-css.sh <tag, e.g. v0.2.0>}"
OUT="$(dirname "$0")/../src/renderer/themes.css"
URL="https://raw.githubusercontent.com/gerp93/VisualAssault/${TAG}/packages/css/themes.css"

{
  echo "/* Vendored from gerp93/VisualAssault packages/css/themes.css at tag ${TAG}."
  echo "   Do not hand-edit -- re-run scripts/update-visual-assault-css.sh <tag> to bump. */"
  echo ""
  curl -sf "$URL" | tail -n +2
} > "$OUT"

echo "Vendored themes.css from VisualAssault@${TAG} into $OUT"
