#!/usr/bin/env bash
set -euo pipefail

SRC="world-data/src"
OUT="world-data/build"
mkdir -p "$OUT"

tippecanoe -o "$OUT/exandria.pmtiles" -f \
  --name="Exandria (Wildemount + Tal'Dorei)" \
  --attribution="Map data: redgiants / RossThorn open-source-exandria" \
  -Z0 -z12 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --coalesce-densest-as-needed \
  --simplification=4 \
  --detect-shared-borders \
  -L"{\"layer\":\"land\",\"file\":\"$SRC/wildemount_land.geojson\"}" \
  -L"{\"layer\":\"land\",\"file\":\"$SRC/taldorei_land.geojson\"}" \
  -L"{\"layer\":\"bathymetry\",\"file\":\"$SRC/wildemount_bathymetry.geojson\"}" \
  -L"{\"layer\":\"bathymetry\",\"file\":\"$SRC/taldorei_bathymetry.geojson\"}" \
  -L"{\"layer\":\"inland_water\",\"file\":\"$SRC/wildemount_inland_water.geojson\"}" \
  -L"{\"layer\":\"inland_water\",\"file\":\"$SRC/taldorei_inland_water.geojson\"}" \
  -L"{\"layer\":\"landcover\",\"file\":\"$SRC/wildemount_landcover.geojson\"}" \
  -L"{\"layer\":\"landcover\",\"file\":\"$SRC/taldorei_landcover.geojson\"}" \
  -L"{\"layer\":\"roads\",\"file\":\"$SRC/wildemount_roads.geojson\"}" \
  -L"{\"layer\":\"roads\",\"file\":\"$SRC/taldorei_roads.geojson\"}" \
  -L"{\"layer\":\"cities\",\"file\":\"$SRC/wildemount_cities.geojson\"}" \
  -L"{\"layer\":\"cities\",\"file\":\"$SRC/taldorei_cities.geojson\"}" \
  -L"{\"layer\":\"pois\",\"file\":\"$SRC/wildemount_pois.geojson\"}" \
  -L"{\"layer\":\"pois\",\"file\":\"$SRC/taldorei_pois.geojson\"}" \
  -L"{\"layer\":\"labels\",\"file\":\"$SRC/wildemount_label_points.geojson\"}" \
  -L"{\"layer\":\"labels\",\"file\":\"$SRC/taldorei_label_points.geojson\"}"

echo "Built $OUT/exandria.pmtiles ($(du -h "$OUT/exandria.pmtiles" | cut -f1))"
