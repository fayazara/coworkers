#!/bin/sh
# Rebuilds public/icons/splash-*-dark.png, the iOS launch stills shown when
# the phone is in dark mode: launch-robot.png on the dark main surface
# (--brand-surface in src/theme/tokens.css), in the same place as on the
# light stills, so the CSS launch splash picks up without a jump.
# Needs ImageMagick 7 (`magick`). Run from the repository root.
set -eu

BG="#0f0f0f"
cd public/icons

# still  robot size  robot position (matched against the light stills)
while read -r still size pos; do
  magick -size "${still}" "xc:${BG}" \
    \( launch-robot.png -resize "${size}!" \) -geometry "${pos}" -composite \
    -strip -define png:compression-level=9 "splash-${still}-dark.png"
  echo "splash-${still}-dark.png"
done <<'EOF'
1125x2436 457x568 +334+893
1170x2532 457x568 +356+941
1179x2556 457x568 +361+953
1206x2622 457x568 +374+986
1242x2688 457x568 +392+1019
1290x2796 457x568 +416+1073
1320x2868 457x568 +431+1109
828x1792 305x379 +262+679
EOF
