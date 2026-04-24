#!/usr/bin/env bash
# lint-theme.sh — enforce Nostalgia theme forbidden patterns in terminal/scenes/
# Run via: npm run lint:theme
# Exits 1 if any violation is found.
#
# These guards prevent three specific regressions:
#   1. Solid all-sides borders using semantic accent colors in JS style objects
#      (interrupt shells must use buildStaticCard; accent bars must use borderLeft)
#   2. CSS text color assigned to T.card (invisible on card surface)
#   3. Hand-rolled button divs with action label text (must use buildPillButton)

set -euo pipefail
SCENES="terminal/scenes"
FAIL=0

# 1. Solid border with a semantic accent color as a JS style-object property.
#    Dashed borders (decorative outlines) and T.border (structural) are allowed.
#    Flags: border: 'Npx solid ' + T.green/gold/verm/elec in Object.assign blocks.
if grep -rPn "^\s+border:\s+'[0-9.]+px solid" "$SCENES" 2>/dev/null \
   | grep -E "T\.(green|greenWarm|gold|verm|elec|lavender)" \
   | grep -v "\.test\."; then
  echo "FAIL: solid all-sides border with accent color in style object — use borderLeft for accents, buildStaticCard for shells"
  FAIL=1
fi

# 2. CSS text color directly assigned to T.card — produces invisible text on
#    card surface. buildPillButton({ color: T.card }) is fine (that's the fill).
if grep -rn "\.style\.color\s*=.*T\.card" "$SCENES" 2>/dev/null; then
  echo "FAIL: element.style.color = T.card makes text invisible on card surface"
  FAIL=1
fi

# 3. Hand-rolled button divs with action label text via textContent.
#    All interactive action labels must go through buildPillButton.
if grep -rEn 'textContent\s*=\s*['"'"'"][[:space:]]*(CANCEL|CONFIRM|APPLY|VOID|DONE)[[:space:]]*['"'"'"]' "$SCENES" 2>/dev/null; then
  echo "FAIL: hand-rolled button div with action label — use buildPillButton instead"
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "lint:theme passed — no violations found"
fi

exit "$FAIL"
