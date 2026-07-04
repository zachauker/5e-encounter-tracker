# Vector World Map — Design

## Context

This is sub-project 6 of the campaign hub expansion, and a direct follow-on to sub-project 5 (see [2026-07-03-tiled-interactive-maps-design.md](2026-07-03-tiled-interactive-maps-design.md)), which shipped a Leaflet-based tiled viewer for large illustrated maps. That design explicitly called out freehand drawing/annotation — regions, roads, borders — as a non-goal, even though Leaflet supports it.

Having used the tiled viewer, the DM wants that capability after all, but specifically in the "hand-painted map with real cartographic behavior" style seen on fan sites like redgiantmaps.com: an illustrated background image (the same kind of art already uploaded — e.g. the Wildemount-style test map) with region borders, roads, and place-name labels rendered as structured vector data on top, so labels declutter and shapes scale correctly as the DM zooms, rather than being baked pixels in the source art.

Leaflet's `CRS.Simple` mode, while good for panning/zooming a flat image, has no equivalent for styled vector overlays with real cartographic rendering (label collision avoidance, data-driven line/fill styling). This is what MapLibre GL JS is built for, so this sub-project introduces MapLibre as a **third** map render mode, additive to the existing static and tiled Leaflet viewers, which are left unchanged.

## Goals

- Add a third way to view a map: an illustrated raster background (reusing the exact tile pyramid already built for sub-project 5) with a MapLibre vector overlay of region polygons, road lines, and text labels on top.
- Keep the existing entity-linking marker system (Location/Faction/Character/Sub-map/Note pins) fully intact and working identically on this new viewer.
- Provide an in-app authoring tool to draw and style regions, roads, and labels — no external GIS tooling required.
- This is a one-per-campaign "promotion," not a new parallel map-creation flow: any existing top-level tiled map can be flagged as the campaign's single World Map.

## Non-Goals

- **Live token tracking.** Still a prep/reference tool, not a virtual tabletop — unchanged from prior map sub-projects.
- **Freehand/pixel-brush drawing.** Regions and roads are vertex-based vector shapes (polygons/lines), not painted strokes.
- **Multiple World Maps per campaign.** Exactly one map can be promoted at a time; this is a deliberate constraint, not a placeholder for future multi-map support.
- **Feature versioning/history.** Editing a region's geometry overwrites it; no undo-after-save, no revision log.
- **Custom label decluttering algorithm.** MapLibre's built-in symbol-layer collision detection (`text-allow-overlap: false`) is sufficient for v1. A priority/LOD system for labels at different zoom levels is a possible future refinement.
- **New tile generation.** This design consumes the tile pyramid sub-project 5 already produces; it adds no new tiling code.
- **Marker clustering.** Same reasoning as prior map sub-projects — not needed at current marker counts.

## Architecture & Coexistence

The World Map is not a new kind of map creation flow — it's a promotion of an existing top-level `renderMode: "tiled"` map. The `maps` table gains one column:

```
maps (addition)
  isWorldMap    integer (boolean) not null default false
```

Only one map per campaign may have `isWorldMap = true`. Setting it on a map demotes any other World Map in the same campaign, in the same transaction (`PATCH /api/maps/[id]`). Demotion is non-destructive — the demoted map's region/road/label data is left in place, dormant, in case the DM promotes it again later.

`/maps/[id]` (`MapViewer`) picks its canvas component by `renderMode` **and** `isWorldMap`:
- `renderMode: "static"` → `StaticMapCanvas` (unchanged)
- `renderMode: "tiled"`, `isWorldMap: false` → `TiledMapCanvas` (unchanged, Leaflet)
- `renderMode: "tiled"`, `isWorldMap: true` → `VectorMapCanvas` (new, MapLibre)

The `/maps` list page sorts the World Map (if one exists for the active campaign) to the top of the list with a distinguishing badge, rather than living in a separate nav section — it's still fundamentally a map in the same list, just a pinned, special one.

## Data Model

One new table, alongside the existing `maps`/`map_markers` (unchanged):

```
map_features
  id          text primary key
  mapId       text not null references maps(id) on delete cascade
  type        text not null            -- 'region' | 'road' | 'label'
  name        text                     -- region/road name, or the label text itself
  geometry    text not null            -- JSON: GeoJSON geometry
                                        --   Polygon   for 'region'
                                        --   LineString for 'road'
                                        --   Point      for 'label'
  style       text not null default '{}'  -- JSON, shape depends on type:
                                        --   region: { fillColor, strokeColor }
                                        --   road:   { color, width, dash }
                                        --   label:  { fontSize, color }
  createdAt   integer not null
  updatedAt   integer not null
```

This is a single table with a `type` discriminator rather than three separate tables, because it maps directly onto MapLibre's rendering model: all features load as one GeoJSON `FeatureCollection` source, filtered by `properties.type` into three style layers. `map_markers` is untouched and remains the sole home of entity-linking pins — regions/roads/labels are purely cartographic, not entity links, and this is a deliberate conceptual split from markers.

## Coordinate System

MapLibre GL JS, unlike Leaflet, has no built-in "flat plane" CRS (no equivalent of `L.CRS.Simple`) — it is always Web Mercator internally. The established workaround for non-geographic content (fictional/game maps built on Mapbox/MapLibre) is to map the image's fractional `0–1` coordinates onto a synthetic lng/lat rectangle centered at `(0, 0)`, sized so the whole map sits within roughly ±10° of the equator, where Mercator distortion is negligible enough to behave like a flat plane in practice:

```
lngSpan = SPAN                          // arbitrary constant, e.g. 10 degrees
latSpan = SPAN * (imageHeight / imageWidth)   // preserves aspect ratio

lng(px, imageWidth)  = (px / imageWidth  - 0.5) * lngSpan
lat(py, imageHeight) = (0.5 - py / imageHeight) * latSpan
```

This conversion is isolated to one small utility module used only at the MapLibre render boundary. The `x`/`y` fractional convention already used by `map_markers`, and the new `geometry` field on `map_features`, stay in plain `0–1` image-fraction terms — same source of truth, same convention as the existing tiled and static viewers. Only `VectorMapCanvas` converts to/from synthetic lng/lat, mirroring how `TiledMapCanvas` already isolates its own `CRS.Simple` conversions today.

The existing tile-serving endpoint (`/api/maps/[id]/tiles/{z}/{x}/{y}.jpg`) is reused as-is for the MapLibre `raster` source, with its `bounds` option set to the synthetic lng/lat rectangle computed above.

## Rendering — Layer Stack

Bottom to top:

1. **Raster base** — MapLibre `raster` source pointed at the existing tile endpoint.
2. **Region layer** — fill + outline, styled per-feature from `style.fillColor`/`style.strokeColor`.
3. **Road layer** — line, styled per-feature from `style.color`/`style.width`/`style.dash`.
4. **Label layer** — MapLibre `symbol` layer using `style.fontSize`/`style.color`, with `text-allow-overlap: false` for basic collision avoidance.
5. **Markers** — MapLibre `Marker` instances using the same `MapMarkerPin` component rendered to an `HTMLElement` (MapLibre's marker API accepts a raw element, same as Leaflet's `divIcon`), preserving existing click-to-select, drag-to-reposition, and "View {type} →" reverse-link behavior unchanged.

## Authoring / Drawing Tool

Regions, roads, and labels are all authored in-app from the start (not phased). Drawing uses **Terra Draw**, a maintained, map-library-agnostic drawing library with a first-class MapLibre GL adapter — chosen over hand-rolling vertex placement/undo/snapping, and over the older `mapbox-gl-draw` (which has friction under MapLibre since it expects a global `mapboxgl`). Same reasoning as choosing Leaflet itself for the tiled viewer: proven library over custom interaction code for a fiddly UI problem.

- A mode switcher in the World Map's toolbar offers "Draw Region" (polygon: click vertices, close by clicking the first point or a Finish button), "Draw Road" (line: click vertices, Finish to end), and "Place Label" (single click).
- On completing a shape, Terra Draw emits its GeoJSON geometry. A form dialog (following the existing `MarkerFormDialog`/`Dialog` pattern) prompts for a name and type-appropriate style (color picker, line width, etc.), then saves via the features API.
- Existing features are clickable/selectable (Terra Draw's select mode) to reopen the same form for renaming/restyling, plus a delete action.

## API Surface

```
GET    /api/maps/[id]/features          list all features for a map
POST   /api/maps/[id]/features          create a region/road/label
PATCH  /api/maps/features/[featureId]   update name/geometry/style
DELETE /api/maps/features/[featureId]   delete a feature

PATCH  /api/maps/[id]                   gains { isWorldMap: boolean }
                                         setting true demotes any other
                                         World Map in the same campaign,
                                         in the same transaction
```

## Open Questions for the Implementation Plan

- Whether `react-map-gl` (a React wrapper for MapLibre, mirroring how `react-leaflet` was evaluated for sub-project 5) is worth adopting versus a thin hand-rolled MapLibre wrapper — a decision for implementation time based on React 19/Next 16 compatibility.
- Exact synthetic `SPAN` constant (degrees) — needs to be picked empirically once real tile pyramids are tested in MapLibre, balancing "far enough from ±90° lat to avoid edge clipping" against "small enough that distortion stays negligible."
- Whether Terra Draw's default vertex/edge styling needs visual overrides to match the app's existing dark UI, or whether its defaults are acceptable as shipped.
- Exact color-picker component for region/road styling — reuse an existing UI primitive if one exists in the codebase, otherwise a minimal new one.

## Dependency Note

This sub-project builds on the `maps`/`map_markers` schema and tile-serving route introduced in sub-project 5, which at time of writing is implemented on the `worktree-tiled-interactive-maps` branch but not yet merged to `main`. Implementation of this design should not begin until that branch is merged, since the `isWorldMap` column and `VectorMapCanvas`'s render-mode dispatch both depend on sub-project 5's `renderMode`/tiling code already existing on `main`.
