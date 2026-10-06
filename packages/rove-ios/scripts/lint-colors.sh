#!/bin/bash
# Theme guard: colors are spelled only in Sources/RoveMobile/Shared/Theme.swift. Anywhere else a raw
# color, system color or material is a second palette creeping in (a page that is "almost" paper,
# a sheet with the system dim). Use a `Theme` token instead.
# Usage: scripts/lint-colors.sh   (from packages/rove-ios; exits 1 and lists offenders)
set -u
cd "$(dirname "$0")/.."
SRC=Sources/RoveMobile
THEME="$SRC/Shared/Theme.swift"

# Raw constructors, named/system colors, semantic system styles and materials.
PATTERN='(^|[^A-Za-z.])(Color|UIColor)\(|SwiftUI\.Color\(|Color\.(black|white|gray|red|green|blue|orange|yellow|pink|purple|brown|cyan|mint|teal|indigo|primary|secondary)\b|UIColor\.(black|white|gray|label|systemBackground|secondarySystemBackground)\b|[(:,=[:space:]]\.(black|white|gray|red|green|blue|orange|yellow|pink|purple|primary|secondary|tertiary)\b|Material\b|\.bar\b|systemBackground|\.ultraThin|\.thinMaterial|\.regularMaterial|\.thickMaterial'

offenders=$(grep -rnE --include='*.swift' "$PATTERN" "$SRC" | grep -v "^$THEME:" | grep -v 'SwiftTerm\.Color(red8:' || true)
if [ -n "$offenders" ]; then
  echo "Raw colors outside $THEME (use a Theme token):"
  echo "$offenders"
  exit 1
fi
echo "lint-colors: ok"
