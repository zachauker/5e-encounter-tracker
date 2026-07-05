# Exandria World-Map Data Pipeline

Produces the static artifacts the in-app world map (Plan 2) serves:
`build/exandria.pmtiles`, `build/glyphs/`, and the committed `style.json`.

Everything under `src/` and `build/` is git-ignored and fully regenerable.
To rebuild from scratch:

    scripts/world/fetch-geojson.sh    # -> world-data/src/*.geojson
    scripts/world/build-tiles.sh      # -> world-data/build/exandria.pmtiles
    scripts/world/build-glyphs.js     # -> world-data/build/glyphs/<fontstack>/<range>.pbf
    scripts/world/serve-preview.sh    # open the standalone preview to eyeball/tune

Requires: tippecanoe (felt fork, >= v2.0.0), Node (for fontnik glyph build).

Source data: RossThorn/open-source-exandria (GeoJSON already in EPSG:4326).
Scope: Wildemount + Tal'Dorei overworld only. City-interior layers
(wildemount_city_*) and other continents are intentionally excluded.

Map data thanks to redgiants / RossThorn's open-source-exandria.
