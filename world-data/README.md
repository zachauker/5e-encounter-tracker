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

## Property names

Recorded from actual `node` inspection of the fetched `world-data/src/*.geojson`
files (both Wildemount and Tal'Dorei checked where noted). These are the real
contracts the styling task must use — do not assume standard field names.

- **landcover** (`wildemount_landcover.geojson`, `taldorei_landcover.geojson`):
  properties are `id` (always `null` in the sample) and `type`. `type` is the
  usable category field.
  - Wildemount distinct `type` values: `forest`, `mountain`, `dead_forest`,
    `ashlands`, `penumbra`, `moorland`, `dirt`, `pallid`, `swamp`, `vermaloc`,
    `snow`
  - Tal'Dorei distinct `type` values: `mountain`, `grass`, `forest`, `snow`,
    `swamp`, `frosted_forest`, `grey valley`, `grey valley white area`
  - Note: category values are not identical between the two continents — the
    styling task must union both sets (and note the `grey valley` values
    contain spaces, not underscores).

- **roads** (`wildemount_roads.geojson`, `taldorei_roads.geojson`): the ONLY
  property present is `id`, and it is `null` on every feature checked in both
  files (43 features in Wildemount, all `MultiLineString` geometry). **There
  is no class/type field** — roads cannot be styled by category (e.g.
  highway vs. path) from properties alone. All roads must be styled
  identically, or the road-type distinction must come from a different
  source (e.g. splitting by file, since only one roads file exists per
  continent).

- **cities** (`wildemount_cities.geojson`): properties are `id` (null),
  `Name` (capital N — confirmed present, e.g. `"Tussoa"`, `"Port Damali"`,
  `"Vol'antim"`), `Type` (e.g. `"City"`, `"Settlement"`), `Population`
  (string, e.g. `"15,110"`), `Info` (freetext description), and
  `Organizations` (freetext, not present on every feature). Label property
  for map rendering is confirmed to be `Name`.

- **Coordinates**: sample from `wildemount_land.geojson` —
  `[[[[8.393082070171202,-4.276174672842822],[8.39720300807872,...` — small
  signed decimals, confirming lng/lat (EPSG:4326), no reprojection needed.
