# Seed Exandria Locations From World Data — Design

## Context

Sub-project 7 shipped a self-hosted MapLibre vector world map of Exandria (`/world`) whose base cartography includes ~198 named point features — settlements, points of interest, and regional labels — imported from the open-source-exandria GeoJSON. Those names currently exist **only as base-map labels**: they are not rows in our database, so they cannot be opened, described, linked to characters/factions, or annotated by the DM.

This sub-project (8) seeds the campaign's `locations` table from that same GeoJSON so every canonical Exandria place becomes a first-class entity with a detail page, and auto-places an entity-linked pin for each on the `/world` map. It gives the DM a complete baseline of places to interact with, reusing the marker + entity systems already built.

## Goals

- Turn the named point features from the world data into `locations` entities for a chosen campaign: **75 cities, 40 POIs, and 83 regions (after dedup) = ~198 locations.**
- Auto-place one entity-linked marker per location on that campaign's `/world` map, so each place shows as a pin and its detail page's "View on Map" back-link works.
- Deliver as a **re-runnable (idempotent) one-time seed script**, so running it twice never duplicates.
- Reuse existing systems unchanged: the `locations` table/API shape, the `map_markers` model, and the per-campaign get-or-create world-map record.

## Non-Goals

- **No `locations` schema change.** The table stays `{ name, description, notionUrl }`. Category (City/Town/Ruins/Region) and Population fold into the freetext `description`. *(Considered adding a `type` column for filterability; deferred — YAGNI until there's a UI that needs it. Called out as a clean future follow-up.)*
- **No linking base-map labels to entities.** The canonical map labels and the DM's entity pins remain two separate layers (same decision as sub-project 7). The pins sit on top of the labels.
- **No import of non-point layers** (land, landcover, roads, bathymetry, inland-water polygons). Only the three point layers carry names.
- **No Factions/Items/Characters seeding.** Locations only.
- **Not wired into any UI button.** A script, run from the host, is sufficient for a one-time baseline.

## Source Data

Six point-geometry GeoJSON files under `world-data/src/` (git-ignored but regenerable via `scripts/world/fetch-geojson.sh`), two per layer (Wildemount + Tal'Dorei). All features are `Point` geometry in EPSG:4326 (lng/lat), so no reprojection.

| Layer files | Count | Key properties |
|---|---|---|
| `{wildemount,taldorei}_cities.geojson` | 75 | `Name`, `Type` (City/Town/Village/Metropolis/Fortress/Outpost/Settlement/Ruins), `Population` (string, e.g. `"15,110"`), `Info` (lore blurb), sometimes `Organizations` |
| `{wildemount,taldorei}_pois.geojson` | 40 | `Name`, `Type` (e.g. `Ruins`), `Info` |
| `{wildemount,taldorei}_label_points.geojson` | 106 pts → 83 names | `Name`/`name`, `type` (style code: `big_ocean`, `sm_mountain`, `landscape_big`, …) |

**Idempotency reality:** every feature's `id` property is `null`, so there is no stable source key — dedup/idempotency must key on the (campaign, normalized name) pair (see below).

## Architecture

A single Node script: **`scripts/world/seed-locations.js`**, invoked as:

```
node scripts/world/seed-locations.js <campaignId>
```

It runs against the app's SQLite database using the project's existing DB layer (`lib/db`), the same way the other `scripts/world/*.js` scripts use Node. Steps:

1. **Validate the campaign.** Look up `<campaignId>`; if it doesn't exist, print an error listing available campaigns and exit non-zero.
2. **Get-or-create the world map record** for the campaign — replicate the logic in `app/api/world/route.ts`: find a `maps` row where `campaignId = <id> AND renderMode = 'world'`; if none, insert `{ name: "Exandria", imagePath: "world", renderMode: "world" }`. Capture its `id` as `worldMapId`.
3. **Load + normalize features** from the six source files into a single in-memory list of `{ name, lng, lat, description, category, minZoom }` records:
   - **Cities** → `category: "city"`, `description`: `"{Type} · {Continent} · Population {Population}\n\n{Info}"` (omit the Population clause if absent; append `"\n\nOrganizations: {Organizations}"` when present), `minZoom: null` (always visible).
   - **POIs** → `category: "poi"`, `description`: `"Point of Interest ({Type}) · {Continent}\n\n{Info}"`, `minZoom: 7` (matches the base style's POI reveal zoom).
   - **Regions** → `category: "region"`, `description`: `"Region — {ReadableKind} · {Continent}"`, `minZoom: 5`. `{ReadableKind}` maps the raw `type` code to a human word by keyword (strip `big_`/`sm_`/`_big`/`_small`): `ocean|water|reef → "Waters"`, `mountain → "Mountains"`, `forest|vermaloc → "Forest"`, `swamp → "Swamp"`, `snow → "Snowlands"`, `ash → "Ashlands"`, `landscape → "Landmark"`, else `"Region"`.
   - `{Continent}` is `"Wildemount"` or `"Tal'Dorei"`, derived from the source filename.
4. **Dedupe by normalized name** (trim + lowercase) across the whole list. For a name with multiple points (the 15 multi-point region labels, e.g. "The Emerald Gulch" ×3), collapse to **one record whose lng/lat is the centroid (arithmetic mean) of its points**. Cities and POIs have no duplicate names, so they pass through unchanged. If a name collides *across categories* (rare), cities win over POIs win over regions.
5. **Upsert each record** in a transaction per record (or one batch transaction):
   - **Location:** if a `locations` row already exists for `(campaignId, name)` (case-insensitive match), reuse its `id`; otherwise insert `{ id, campaignId, name, description, notionUrl: null }`.
   - **Marker:** ensure exactly one `map_markers` row exists for `(mapId = worldMapId, type = "location", entityId = location.id)`; if missing, insert `{ id, mapId: worldMapId, x: lng, y: lat, type: "location", entityId, title: name, minZoom }`. If it already exists, leave it (don't move a pin the DM may have repositioned).
6. **Print a summary:** counts of locations created vs. skipped-existing, markers created vs. skipped-existing, and the total per category.

**Why a per-(campaign,name) key rather than storing the source id:** the source ids are all null, and names are the only stable human-meaningful identifier. Keying on name also makes the script naturally merge with any locations the DM created by hand with the same name, instead of duplicating them.

## Data Model

No schema changes. Uses existing tables:
- `locations` — `{ id, campaignId, name, description, notionUrl }`.
- `maps` — the per-campaign `renderMode: "world"` record (created if absent).
- `map_markers` — `{ id, mapId, x (=lng), y (=lat), type: "location", entityId, title, minZoom }`, exactly the shape sub-project 7 established for world markers.

## Error Handling & Verification

- **Missing/invalid campaignId:** friendly error + list of campaigns + non-zero exit; no writes.
- **Missing source files:** if `world-data/src/*.geojson` are absent (they're git-ignored), print an instruction to run `scripts/world/fetch-geojson.sh` first, and exit non-zero before touching the DB.
- **No test framework exists** (established convention). Verification is:
  1. Run against a campaign; confirm the printed summary reports ~198 locations and ~198 markers created.
  2. `/locations` lists the new places; a city detail page shows its composed description.
  3. `/world` renders the pins; clicking one selects it; a city's "View on Map" link lands on `/world#marker-<id>` with the pin auto-selected (closing the loop with sub-project 7's back-link fix).
  4. **Re-run the script** and confirm the summary reports 0 created / all skipped — proving idempotency and no duplicate pins.

## Open Questions for the Implementation Plan

- Exact reuse mechanism for the get-or-create-world-map logic (inline in the script vs. a tiny shared helper both the API route and the script import) — pick during planning; a shared helper is cleaner if it doesn't drag in Next-only imports.
- Whether to batch all writes in one transaction or per-record — a performance/robustness detail for ~400 rows.
