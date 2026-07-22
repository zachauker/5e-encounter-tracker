# Editable Pin Appearance — Design

**Date:** 2026-07-22
**Status:** Approved (design), pending spec review

## Context — part of a larger UI/UX effort

**Sub-project 4 (SP4) of 4** — the final piece (see
`2026-07-21-entity-quick-view-design.md` for the full sequencing):

1. **SP1 (done, merged)** — Entity quick-view popover.
2. **SP2 (done, merged)** — Map pin quick-view slide-overs.
3. **SP3 (done, merged)** — Entity list filters + views + sorting.
4. **SP4 (this doc)** — Editable pin appearance.

## Problem

Every map pin's appearance is fixed by its **type**: `MapMarkerPin` draws a
hardcoded 28×36 teardrop with a fixed-size Lucide icon, and `marker-meta.ts`
supplies a fixed color + icon per marker type. The DM can't make an important
landmark stand out, restyle a whole type, or adjust label sizing — on either the
world map or local/city maps.

## Goal

Let the DM customize pin appearance on two levels:
- **Per-type defaults** — restyle a whole marker type at once (e.g. make every
  Location a large square).
- **Per-pin overrides** — customize an individual pin, falling back to its type
  default.

Editable properties: **size, shape, icon, label size, color**. Applies to both
map viewers.

## Decisions

- **Three-layer resolution.** Effective appearance =
  `built-in type meta (marker-meta)` ← `per-type override` ← `per-pin override`,
  each layer optional. A pure `resolveMarkerAppearance(marker, typeDefaults)`
  returns the effective `{ size, shape, icon, color, labelSize, labelHidden }`.
- **Per-pin overrides → `map_markers` columns.** Five new **nullable** columns:
  `size`, `shape`, `icon`, `label_size`, `color` (null = inherit). Added with the
  repo's `addColumnIfMissing` migration pattern; the marker create/update APIs
  accept them. Editable in the **Edit-pin dialog** (`MarkerFormDialog`).
- **Per-type defaults → `settings` JSON, global.** One `settings` row, key
  `marker_appearance`, value = JSON `{ [markerType]: { size?, shape?, icon?,
  color?, labelSize? } }`. Server-side (persists across devices/redeploys),
  **global/app-wide** (single-DM app; can become per-campaign later). Editable in
  a **"Pin styles" panel** opened from the map toolbar of both viewers.
- **Editable options:**
  - **Size** — `sm | md | lg | xl` → pixel scale (md = today's 28×36).
  - **Shape** — `teardrop | circle | square | diamond` (SVG; teardrop = today).
  - **Icon** — a curated ~24-icon set (fantasy/map-themed Lucide icons) plus
    "default (by type)". Stored as the Lucide icon **name** string.
  - **Label size** — `sm | md | lg` (md = today's `text-[10px]`) plus a per-pin
    **hide label** option.
  - **Color** — a fixed swatch palette (the marker CSS-var colors + a few
    extras) plus "default (by type)". Overrides the type's semantic color.
- **Rendering stays pure.** `MapMarkerPin` and `MarkerLabel` are consumed by two
  canvases via `renderToStaticMarkup`, so they must remain pure presentational
  components (no hooks). They gain appearance props; the resolver runs upstream in
  each viewer/canvas where the marker data + type defaults are available.
- **Shared editor.** One `MarkerAppearanceEditor` component powers both the
  per-pin (dialog) and per-type (panel) surfaces.

## Out of scope (YAGNI)

- Free rotation, opacity, drop-shadow tuning, pin animation.
- Custom-uploaded / arbitrary icons (curated set only).
- Per-map or per-campaign type defaults (global only for now).
- Bulk multi-pin selection/editing.
- Changing the built-in `marker-meta` defaults themselves.

## Data model & resolution

### New columns (migration): `map_markers`
`size TEXT`, `shape TEXT`, `icon TEXT`, `label_size TEXT`, `color TEXT` — all
nullable, null = inherit. Added via `addColumnIfMissing` in `lib/db/migrate.ts`
(fresh DBs get them from the schema; existing DBs get the guarded ALTERs).
`lib/db/schema.ts` `mapMarkers` gains the five optional columns; `MarkerData` /
`ResolvedMarker` (`components/maps/map-types.ts`) gain them so they flow to the
canvases.

### New setting: `marker_appearance`
Stored via the existing `settings` table + `GET/PUT /api/settings`
(`marker_appearance` added to `ALLOWED_KEYS`, not masked). Value is a JSON string
`{ [type]: { size?, shape?, icon?, color?, labelSize? } }`.

### Pure resolver: `components/maps/marker-appearance.ts`
- Types: `MarkerSize`, `MarkerShape`, `MarkerLabelSize`, `MarkerAppearanceOverride`
  (all fields optional), `ResolvedAppearance` (`{ sizePx: number; shape;
  icon: LucideIcon; color: string; labelSize; labelHidden: boolean }`),
  `TypeAppearanceMap` (the settings blob shape).
- `SIZE_PX`, curated `ICON_SET` (name→LucideIcon), swatch `COLOR_OPTIONS`,
  `SHAPE_OPTIONS`, `LABEL_SIZE_PX`.
- `resolveIcon(name)` — name → LucideIcon, falling back to null when unknown.
- `resolveMarkerAppearance(marker, typeDefaults)` — merges built-in
  `visualForType(...)` ← `typeDefaults[marker.type]` ← the marker's own columns,
  returning `ResolvedAppearance`. Pure; unit-tested.

## Components & changes

### New: `components/maps/marker-appearance.ts`
The pure model above (+ `.test.ts`).

### Change: `components/maps/MapMarkerPin.tsx`
Accept a `ResolvedAppearance` (or the raw inputs) instead of computing only from
type. Render the chosen **shape** as SVG at the chosen **size**, place the chosen
**icon** (scaled), fill with the chosen **color**. Keep the `selected` bloom.
Stays a pure component (safe for `renderToStaticMarkup`).

### Change: `components/maps/MarkerLabel.tsx`
Accept `labelSize` (→ text size) and honor `hidden`. Stays pure.

### Change: the three canvases
`StaticMapCanvas`, `TiledMapCanvas`, `WorldMapCanvas` compute each marker's
`ResolvedAppearance` (via the resolver + the loaded type defaults) and pass it to
`MapMarkerPin` / `MarkerLabel`. The tiled + world canvases must recompute their
`renderToStaticMarkup` icon HTML when appearance changes (same re-render trigger
they already use for `resolvedTitle` / `showLabels`). Leaflet `iconSize`/
`iconAnchor` must track the chosen size so the pin tip stays on its coordinate.

### New: `components/maps/MarkerAppearanceEditor.tsx`
The shared editor: Size (segmented), Shape (icon buttons), Icon (grid picker +
"default"), Label size (segmented + "hide"), Color (swatches + "default"), with a
live pin preview. Controlled — takes a value `MarkerAppearanceOverride` + onChange.
Used by both surfaces.

### Change: `components/maps/MarkerFormDialog.tsx`
Add an "Appearance" section rendering `MarkerAppearanceEditor` bound to the
marker's per-pin override fields; include them in the create/update payload. (For
`note`/`submap` pins this still works — appearance is type-agnostic.)

### New: `components/maps/PinStylesPanel.tsx` + toolbar wiring
A "Pin styles" toolbar button in `MapViewer` and `WorldMapViewer` opens a panel
listing each marker type with `MarkerAppearanceEditor` bound to
`marker_appearance[type]`. Saves via `PUT /api/settings`. Both viewers load
`marker_appearance` (once) and pass the type-defaults map down to their canvas so
edits reflect live.

### Change: marker APIs
`POST /api/maps/[id]/markers` and the marker update route accept + persist the
five appearance fields (validated against the allowed enum values; `icon`/`color`
validated against the curated sets; unknown → ignored/null).

## Data flow

```
settings.marker_appearance (JSON) ──load──▶ viewer holds typeDefaults: TypeAppearanceMap
map_markers row (+ appearance cols) ──▶ ResolvedMarker
        │
        ▼  per marker, in each canvas:
   resolveMarkerAppearance(marker, typeDefaults)
        = builtin(marker.type) ← typeDefaults[type] ← marker's own cols
        ▼
   MapMarkerPin(appearance)  +  MarkerLabel(labelSize, hidden)

Editing:
  Edit-pin dialog  → MarkerAppearanceEditor → marker create/update API (per-pin cols)
  Pin-styles panel → MarkerAppearanceEditor → PUT /api/settings marker_appearance (per-type)
```

## Testing

- Unit tests for `marker-appearance.ts`:
  - `resolveMarkerAppearance`: built-in only (no overrides) → matches
    `visualForType` size/color/icon defaults; type default applied; per-pin
    override beats type default beats built-in; unknown icon/color/enum values
    fall back safely; `labelHidden` from per-pin `labelSize: "hide"`.
  - `resolveIcon`: known name → component; unknown → null/fallback.
- Browser verification (dev server) on a **local/city map** and the **world map**:
  place pins, open Edit-pin → change size/shape/icon/label/color → the pin updates
  and persists across reload; open Pin styles → restyle a whole type → all pins of
  that type update, and a per-pin-overridden pin keeps its override; labels honor
  size + hide; the pin tip stays anchored to its coordinate at every size; no
  console errors.

## Risks / notes

- **`renderToStaticMarkup` purity:** `MapMarkerPin`/`MarkerLabel` must not use
  hooks; the resolver runs in the canvas, not the pin. Verify tiled + world pins
  re-render when type defaults or a pin's override change.
- **Anchor accuracy:** larger/differently-shaped pins must keep their visual tip
  (or center, per shape) on the coordinate — Leaflet `iconAnchor` and the static
  canvas's absolute offset must scale with size.
- **Icon registry vs. tree-shaking:** the curated `ICON_SET` imports a fixed
  ~24 Lucide icons by name — a bounded, explicit import list (no dynamic
  all-icons import).
- **Color vs. type coding:** overriding color can undercut the type color-coding;
  that's the DM's choice (they opted into it). "Default (by type)" is always
  available to revert.
- **Migration safety:** the five columns are additive + nullable; existing pins
  render exactly as today (all-null → built-in defaults). Follows the established
  `addColumnIfMissing` pattern; `migrate.ts` runtime-tested against a pre-existing
  DB.
- **Settings shape drift:** `marker_appearance` is parsed defensively (malformed
  / missing → empty map → built-in defaults), like other JSON settings.
