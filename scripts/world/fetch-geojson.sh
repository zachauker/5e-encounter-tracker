#!/usr/bin/env bash
set -euo pipefail

# Fetches the Wildemount + Tal'Dorei overworld GeoJSON layers from
# RossThorn/open-source-exandria into world-data/src/.
# Data is already EPSG:4326 (WGS84 lng/lat) — no reprojection performed.

RAW="https://raw.githubusercontent.com/RossThorn/open-source-exandria/main/Data/OSE"
OUT="world-data/src"
mkdir -p "$OUT"

FILES=(
  wildemount_land wildemount_bathymetry wildemount_inland_water
  wildemount_landcover wildemount_roads wildemount_cities
  wildemount_pois wildemount_label_points
  taldorei_land taldorei_bathymetry taldorei_inland_water
  taldorei_landcover taldorei_roads taldorei_cities
  taldorei_pois taldorei_label_points
)

for f in "${FILES[@]}"; do
  echo "Fetching $f.geojson"
  curl -fsSL "$RAW/$f.geojson" -o "$OUT/$f.geojson"
done

echo "Done. $(ls "$OUT" | wc -l | tr -d ' ') files in $OUT"
