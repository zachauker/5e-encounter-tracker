# Marker Label Toggle — Design

**Date:** 2026-07-18
**Status:** Approved (design), pending spec review

## Problem

On both the world map and city/uploaded maps, a marker's title is only visible
after clicking the marker to open its card popup. The DM wants to read marker
titles (locations, event notes, etc.) directly on the map without clicking each
one.

## Goal

Add a toolbar toggle to show/hide text labels on markers. When on, each visible
marker renders its resolved title as a small chip attached below its pin. When
off (the default), maps render exactly as they do today.

## Decisions

- **Persistence:** per-map, in `localStorage` under key `markerLabels:${mapId}`,
  mirroring the existing per-map `markerLayers:${mapId}` layer-visibility pattern.
- **Scope:** labels appear only for *visible* markers. This falls out for free —
  each canvas already receives the pre-filtered marker list (layer filter + event
  date filter applied upstream in the viewers), so rendering a label for every
  marker the canvas is handed automatically respects those filters.
- **Placement:** chip centered just below the pin's teardrop point.
- **Long titles:** capped chip width with ellipsis truncation. The full title
  remains available in the click popup.
- **Label text source:** `marker.resolvedTitle` (the API-enriched title already
  consumed by the info panels). No new data model or API changes.

## Out of scope (YAGNI)

- Collision / overlap avoidance between nearby labels.
- Per-marker label opt-out.
- Zoom-based label gating beyond the marker-reveal (`minZoom`) the world map
  already applies to the pins themselves.
- Global (all-maps) preference — explicitly chose per-map.

## Components & changes

### New: `components/maps/marker-labels.ts`

A tiny, testable module isolating `localStorage` access, modeled on
`components/maps/marker-layers.ts`:

- `readShowLabels(mapId: string): boolean` — reads the persisted flag, defaults
  to `false` (labels off). Guards against SSR / missing `window` and malformed
  values, returning `false` on any error.
- `writeShowLabels(mapId: string, value: boolean): void` — persists the flag;
  no-op / swallow errors when `window`/`localStorage` is unavailable.

Storage key: `markerLabels:${mapId}`.

Unit tests (`marker-labels.test.ts`) cover: default when unset, round-trip
write→read, and malformed-value → default, following the existing test style in
the maps directory (e.g. `event-date-filter.test.ts`).

### Toolbar toggle — `MapViewer.tsx` and `WorldMapViewer.tsx`

- New local state `showLabels`, seeded once during render from
  `readShowLabels(mapId)` (same seeding approach as hidden layers).
- A toggle button using the lucide `Tag` icon, placed next to the existing
  Layers control in each toolbar. Reflects on/off state visually (active styling
  consistent with the viewers' other toggle buttons, e.g. Move Pins / Add
  Marker).
- On click: flip state and call `writeShowLabels(mapId, next)`.
- Pass `showLabels` as a prop to whichever canvas the viewer renders.

The world viewer passes the flag to `WorldMapCanvas`; the city viewer passes it
to either `TiledMapCanvas` or `StaticMapCanvas` depending on `map.renderMode`.

### Label rendering per canvas

All three receive a new `showLabels: boolean` prop and render a label only when
it is true. Each uses the shared appearance (below the pin, truncated,
`pointer-events-none` so pin hit-testing is unaffected).

- **`StaticMapCanvas.tsx`** (absolute CSS % positioning): add a truncated label
  `<span>` beneath each pin within the existing per-marker positioned wrapper.
  `pointer-events-none` on the label.
- **`TiledMapCanvas.tsx`** (react-leaflet, `divIcon` built via
  `renderToStaticMarkup`): extend the icon HTML to include the label chip below
  the pin when `showLabels` is on. The `divIcon` must be recomputed when
  `showLabels` (or a marker's `resolvedTitle`) changes so Leaflet re-renders the
  icons. Keep the icon anchor unchanged so the pin position does not shift.
- **`WorldMapCanvas.tsx`** (MapLibre imperative DOM markers): the marker's
  wrapper element already contains the `renderToStaticMarkup` pin; append a
  label `div` beneath it. The marker-build effect must re-run when `showLabels`
  changes so existing markers are rebuilt with/without labels.

### Label appearance (shared)

A single consistent style across canvases:

- Small rounded chip, subtle translucent background for legibility over varied
  map artwork, theme-aware text color.
- `max-width` cap with `overflow: hidden; text-overflow: ellipsis; white-space:
  nowrap`.
- Centered horizontally under the pin tip.
- `pointer-events: none` so clicks pass through to the pin / map.

Because two canvases build markup via `renderToStaticMarkup` (static string) and
one uses live JSX, the style is expressed as plain classes/inline style that
work in both contexts (no interactive React needed in the label itself).

## Data flow

```
localStorage(markerLabels:${mapId})
        │  readShowLabels / writeShowLabels
        ▼
   Viewer state: showLabels ──(prop)──▶ Canvas ──▶ per (visible) marker: label chip = resolvedTitle
        ▲
   Toolbar Tag toggle (onClick → flip + write)
```

No server, API, schema, or `MarkerData`/`ResolvedMarker` type changes. Labels
read the existing `resolvedTitle` already present on each marker.

## Testing

- Unit tests for `marker-labels.ts` (default / round-trip / malformed).
- Manual/browser verification via the dev server: toggle on each viewer variant
  (world, tiled city map, static city map); confirm labels appear only for
  visible markers, truncate, sit below the pin, persist across reload per-map,
  and do not block pin clicks.

## Risks / notes

- **Clutter on dense maps** is accepted — the toggle itself is the mitigation;
  the default is off.
- **`renderToStaticMarkup` cost:** the tiled/world canvases already stringify
  pins; adding a label node is negligible and only re-runs when the flag or
  marker set changes.
- Ensure the Leaflet `divIcon` `iconAnchor`/size accounts for the added label
  height only insofar as needed to keep the pin tip anchored to the coordinate;
  the label extends downward and should not move the pin.
