# Vector World Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third map render mode — a MapLibre GL-based "World Map" — that overlays region polygons, road lines, and text labels (drawn in-app via Terra Draw) on top of the same illustrated raster tile pyramid the Leaflet-based tiled viewer already uses, while keeping the existing entity-linking marker system fully intact.

**Architecture:** Exactly one top-level `renderMode: "tiled"` map per campaign can be flagged `isWorldMap`. When set, `MapViewer` renders a new `VectorMapCanvas` (MapLibre) instead of `TiledMapCanvas` (Leaflet). Regions/roads/labels live in a new `map_features` table, rendered as one GeoJSON source split into three MapLibre style layers. Because MapLibre has no flat-plane CRS like Leaflet's `CRS.Simple`, a small coordinate-adapter module maps the image's existing `0-1` fractional coordinate convention onto a synthetic, near-equator lng/lat rectangle where Mercator distortion is negligible — this lets the exact same `sharp`-generated tile files be reused unchanged, through a new address-translating tile route.

**Tech Stack:** `maplibre-gl` (vector map rendering), `terra-draw` + `terra-draw-maplibre-gl-adapter` (in-app polygon/line/point drawing), `@types/geojson` (dev), existing Next.js/Drizzle/SQLite stack.

**Verification convention for this project:** there is no test framework in this codebase (confirmed: no jest/vitest, no `*.test.*` files, `package.json` has no `test` script). Every prior sub-project in this plan series was verified via `npm run build` (type-checking) plus a manual smoke test through the browser, not automated tests. This plan follows that same convention, with one addition: Task 4's coordinate math is also checked with a disposable `node -e` calculation showing concrete expected numbers, since it's the highest-risk part of this design and worth confirming by hand before it's relied on everywhere else.

**Working directory for every task below:** this plan builds directly on top of the (not yet merged) `worktree-tiled-interactive-maps` branch, per the dependency this design has on sub-project 5's `renderMode`/tiling code. All file paths are relative to that worktree's root (`.claude/worktrees/tiled-interactive-maps/` from the main repo checkout).

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the new dependencies**

Run:
```bash
npm install maplibre-gl terra-draw terra-draw-maplibre-gl-adapter
npm install -D @types/geojson
```
Expected: `package.json` gains `maplibre-gl`, `terra-draw`, `terra-draw-maplibre-gl-adapter` under `dependencies` and `@types/geojson` under `devDependencies`. `maplibre-gl` ships its own TypeScript types, so no separate `@types/maplibre-gl` package exists or is needed.

- [ ] **Step 2: Verify the project still builds**

Run: `npm run build`
Expected: build succeeds (these packages aren't used anywhere yet, so this just confirms `npm install` didn't break anything).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add maplibre-gl, terra-draw dependencies"
```

---

### Task 2: Extend Drizzle schema

**Files:**
- Modify: `lib/db/schema.ts:138-165`

- [ ] **Step 1: Add `isWorldMap` to `maps` and a new `mapFeatures` table**

Replace the `maps` and `mapMarkers` table definitions (`lib/db/schema.ts:138-165`) with:

```ts
export const maps = sqliteTable("maps", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  imagePath: text("image_path").notNull(),
  parentMapId: text("parent_map_id"),
  renderMode: text("render_mode", { enum: ["static", "tiled"] }).notNull().default("static"),
  width: integer("width"),
  height: integer("height"),
  maxZoom: integer("max_zoom"),
  isWorldMap: integer("is_world_map", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const mapMarkers = sqliteTable("map_markers", {
  id: text("id").primaryKey(),
  mapId: text("map_id").notNull().references(() => maps.id, { onDelete: "cascade" }),
  x: real("x").notNull(),
  y: real("y").notNull(),
  type: text("type", { enum: ["location", "faction", "character", "submap", "note"] }).notNull(),
  entityId: text("entity_id"),
  targetMapId: text("target_map_id"),
  title: text("title"),
  note: text("note"),
  minZoom: integer("min_zoom"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const mapFeatures = sqliteTable("map_features", {
  id: text("id").primaryKey(),
  mapId: text("map_id").notNull().references(() => maps.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["region", "road", "label"] }).notNull(),
  name: text("name"),
  geometry: text("geometry").notNull(),
  style: text("style").notNull().default("{}"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

- [ ] **Step 2: Add type exports**

At the bottom of `lib/db/schema.ts`, immediately after the existing `MapMarker`/`NewMapMarker` export lines, add:

```ts
export type MapFeature = typeof mapFeatures.$inferSelect;
export type NewMapFeature = typeof mapFeatures.$inferInsert;
```

- [ ] **Step 3: Verify types compile**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat: add isWorldMap to maps, new map_features table"
```

---

### Task 3: Extend the migration script

**Files:**
- Modify: `lib/db/migrate.ts:153-186`

- [ ] **Step 1: Add the `map_features` table to the base schema block**

In `lib/db/migrate.ts`, immediately after the `CREATE TABLE IF NOT EXISTS map_markers (...)` block (ending at line 165) and before the `CREATE INDEX IF NOT EXISTS idx_maps_campaign` line, add:

```sql
    CREATE TABLE IF NOT EXISTS map_features (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      name TEXT,
      geometry TEXT NOT NULL,
      style TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
```

Then add its index alongside the existing map indexes (immediately after `CREATE INDEX IF NOT EXISTS idx_map_markers_map ON map_markers(map_id);`):

```sql
    CREATE INDEX IF NOT EXISTS idx_map_features_map ON map_features(map_id);
```

- [ ] **Step 2: Add the `isWorldMap` column via the existing additive-migration helper**

Immediately after the existing `addColumnIfMissing("map_markers", "min_zoom", "INTEGER");` line, add:

```ts
  addColumnIfMissing("maps", "is_world_map", "INTEGER NOT NULL DEFAULT 0");
```

- [ ] **Step 3: Verify types compile and the app still starts**

Run: `npm run build`
Expected: succeeds. (The migration itself runs against the SQLite file at server startup, not at build time — full verification happens when the dev server starts in Task 15.)

- [ ] **Step 4: Commit**

```bash
git add lib/db/migrate.ts
git commit -m "feat: migrate map_features table and isWorldMap column"
```

---

### Task 4: Mercator coordinate adapter

**Files:**
- Create: `lib/maps/mercator-adapter.ts`

This is the one genuinely tricky piece of this design: MapLibre GL JS has no equivalent of Leaflet's `L.CRS.Simple` flat-plane mode — it's always real Web Mercator internally. The approach: pin every World Map's image to the same single, small, real Mercator tile (`z=10, x=512, y=512`, chosen because at that depth a tile spans about 0.35° near the equator — small enough that Mercator's distortion is imperceptible, big enough to give a sane, typical-looking zoom range once the image's own zoom levels are layered on top of it). The sharp-generated tile pyramid's own zoom 0 (a single tile representing the whole shrunk image, per `lib/maps/storage.ts`) is defined to line up exactly with that reference tile; each deeper sharp zoom level lines up with the corresponding deeper Mercator zoom, quadrant by quadrant, the same way both pyramids naturally subdivide.

One more wrinkle: `lib/maps/storage.ts`'s tiling call passes `background: { r: 0, g: 0, b: 0 }`, meaning sharp pads the zoom-0 tile out to a full 256x256 square with black — a non-square source image only occupies part of that square (whichever of width/height is smaller doesn't fully reach 256px once scaled). `fractionalToLngLat`/`lngLatToFractional` account for this so a marker or feature placed at image-relative `(0.5, 0.5)` doesn't end up in empty padding once converted to real lng/lat.

- [ ] **Step 1: Verify the tile-index math by hand before writing the module**

Run:
```bash
node -e '
const REFERENCE_ZOOM = 10;
const REFERENCE_TILE = 2 ** (REFERENCE_ZOOM - 1);
function sharpToMercatorTile(z, x, y) {
  const scale = 2 ** z;
  return { z: REFERENCE_ZOOM + z, x: REFERENCE_TILE * scale + x, y: REFERENCE_TILE * scale + y };
}
function mercatorToSharpTile(mz, mx, my) {
  const z = mz - REFERENCE_ZOOM;
  if (z < 0) return null;
  const scale = 2 ** z;
  return { z, x: mx - REFERENCE_TILE * scale, y: my - REFERENCE_TILE * scale };
}
console.log(sharpToMercatorTile(0, 0, 0));
console.log(sharpToMercatorTile(2, 3, 1));
console.log(mercatorToSharpTile(12, 2051, 2049));
console.log(mercatorToSharpTile(9, 500, 500));
'
```
Expected output (four lines):
```
{ z: 10, x: 512, y: 512 }
{ z: 12, x: 2051, y: 2049 }
{ z: 2, x: 3, y: 1 }
null
```
The third line round-trips the second line's output back to its original sharp z/x/y — confirming the two functions are true inverses. The fourth line confirms zoom levels shallower than the reference zoom (i.e., zoomed out past the whole image) correctly report "out of bounds" rather than a bogus negative index.

- [ ] **Step 2: Write the module**

Create `lib/maps/mercator-adapter.ts`:

```ts
const TILE_SIZE = 256;
const REFERENCE_ZOOM = 10;
const REFERENCE_TILE = 2 ** (REFERENCE_ZOOM - 1);

export interface MapDims {
  width: number;
  height: number;
  maxZoom: number;
}

/**
 * Converts the real Mercator z/x/y MapLibre requests back into the sharp
 * pyramid's own tile index. Returns null if mz is shallower than the
 * reference zoom (i.e. zoomed out past the whole image).
 */
export function mercatorToSharpTile(mz: number, mx: number, my: number) {
  const z = mz - REFERENCE_ZOOM;
  if (z < 0) return null;
  const scale = 2 ** z;
  return { z, x: mx - REFERENCE_TILE * scale, y: my - REFERENCE_TILE * scale };
}

function tileToLng(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

function tileToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** The lng/lat rectangle of the single reference tile every World Map is pinned to. */
export function getReferenceTileBounds(): { west: number; south: number; east: number; north: number } {
  return {
    west: tileToLng(REFERENCE_TILE, REFERENCE_ZOOM),
    east: tileToLng(REFERENCE_TILE + 1, REFERENCE_ZOOM),
    north: tileToLat(REFERENCE_TILE, REFERENCE_ZOOM),
    south: tileToLat(REFERENCE_TILE + 1, REFERENCE_ZOOM),
  };
}

export function getMercatorMinZoom(): number {
  return REFERENCE_ZOOM;
}

/**
 * A source image's sharp-generated tile pyramid always pads its zoom-0 tile out
 * to a full TILE_SIZE x TILE_SIZE square (see lib/maps/storage.ts's tile
 * background fill) - the real image only occupies the top-left corner of that
 * square, sized by whichever of width/height is smaller relative to the other.
 * These fractions describe how much of the padded square is real content.
 */
function contentFractions(dims: MapDims): { lngFrac: number; latFrac: number } {
  const alignedSize = TILE_SIZE * 2 ** dims.maxZoom;
  return { lngFrac: dims.width / alignedSize, latFrac: dims.height / alignedSize };
}

/** fx/fy are the existing 0-1 image-fraction convention already used by map_markers. */
export function fractionalToLngLat(fx: number, fy: number, dims: MapDims): [number, number] {
  const { west, south, east, north } = getReferenceTileBounds();
  const { lngFrac, latFrac } = contentFractions(dims);
  const lng = west + fx * lngFrac * (east - west);
  const lat = north - fy * latFrac * (north - south);
  return [lng, lat];
}

export function lngLatToFractional(lng: number, lat: number, dims: MapDims): { x: number; y: number } {
  const { west, south, east, north } = getReferenceTileBounds();
  const { lngFrac, latFrac } = contentFractions(dims);
  return {
    x: (lng - west) / (lngFrac * (east - west)),
    y: (north - lat) / (latFrac * (north - south)),
  };
}

function convertPosition(pos: GeoJSON.Position, dims: MapDims): GeoJSON.Position {
  return fractionalToLngLat(pos[0], pos[1], dims);
}

function convertPositionBack(pos: GeoJSON.Position, dims: MapDims): GeoJSON.Position {
  const { x, y } = lngLatToFractional(pos[0], pos[1], dims);
  return [x, y];
}

/** Converts a map_features geometry (stored in 0-1 image-fraction coordinates) into real lng/lat for rendering. */
export function geometryToLngLat(geometry: GeoJSON.Geometry, dims: MapDims): GeoJSON.Geometry {
  switch (geometry.type) {
    case "Point":
      return { type: "Point", coordinates: convertPosition(geometry.coordinates, dims) };
    case "LineString":
      return { type: "LineString", coordinates: geometry.coordinates.map((p) => convertPosition(p, dims)) };
    case "Polygon":
      return {
        type: "Polygon",
        coordinates: geometry.coordinates.map((ring) => ring.map((p) => convertPosition(p, dims))),
      };
    default:
      throw new Error(`Unsupported geometry type: ${geometry.type}`);
  }
}

/** Inverse of geometryToLngLat - converts a Terra Draw-emitted lng/lat geometry back into the 0-1 storage convention. */
export function geometryToFractional(geometry: GeoJSON.Geometry, dims: MapDims): GeoJSON.Geometry {
  switch (geometry.type) {
    case "Point":
      return { type: "Point", coordinates: convertPositionBack(geometry.coordinates, dims) };
    case "LineString":
      return { type: "LineString", coordinates: geometry.coordinates.map((p) => convertPositionBack(p, dims)) };
    case "Polygon":
      return {
        type: "Polygon",
        coordinates: geometry.coordinates.map((ring) => ring.map((p) => convertPositionBack(p, dims))),
      };
    default:
      throw new Error(`Unsupported geometry type: ${geometry.type}`);
  }
}
```

- [ ] **Step 3: Verify types compile**

Run: `npm run build`
Expected: succeeds. (`GeoJSON.Position`/`GeoJSON.Geometry` resolve via the `@types/geojson` global namespace installed in Task 1.)

- [ ] **Step 4: Commit**

```bash
git add lib/maps/mercator-adapter.ts
git commit -m "feat: add mercator coordinate adapter for the vector world map"
```

---

### Task 5: MapLibre tile-serving route

**Files:**
- Create: `app/api/maps/[id]/vtiles/[z]/[x]/[y]/route.ts`

This route lets MapLibre fetch the exact same tile files the Leaflet viewer uses, by translating the real Mercator z/x/y MapLibre requests back into the sharp pyramid's own z/x/y before reading the file.

- [ ] **Step 1: Write the route**

Create `app/api/maps/[id]/vtiles/[z]/[x]/[y]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maps } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { readMapTile } from "@/lib/maps/storage";
import { mercatorToSharpTile } from "@/lib/maps/mercator-adapter";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; z: string; x: string; y: string }> }
) {
  const { id, z, x, y } = await params;
  const map = await db.query.maps.findFirst({ where: eq(maps.id, id) });
  if (!map || map.renderMode !== "tiled" || !map.isWorldMap) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const yWithoutExt = y.replace(/\.\w+$/, "");
  const mz = Number(z);
  const mx = Number(x);
  const my = Number(yWithoutExt);
  if (!Number.isInteger(mz) || !Number.isInteger(mx) || !Number.isInteger(my)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sharpTile = mercatorToSharpTile(mz, mx, my);
  if (!sharpTile) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await readMapTile(id, String(sharpTile.z), String(sharpTile.x), String(sharpTile.y));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
```

Note: `readMapTile` already rejects any non-negative-integer-string z/x/y with an `ENOENT`-coded error (see `lib/maps/storage.ts`), which this route's existing `catch` turns into a clean 404 — so a negative `sharpTile.x`/`sharpTile.y` (a Mercator tile that falls outside the image's actual content bounds) is handled correctly without extra bounds-checking here.

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/api/maps/\[id\]/vtiles
git commit -m "feat: add MapLibre-compatible tile-serving route"
```

---

### Task 6: Map features list/create API

**Files:**
- Create: `app/api/maps/[id]/features/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/maps/[id]/features/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mapFeatures } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { eq } from "drizzle-orm";

const VALID_TYPES = ["region", "road", "label"];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await db.query.mapFeatures.findMany({ where: eq(mapFeatures.mapId, id) });
  return NextResponse.json(
    rows.map((f) => ({ ...f, geometry: JSON.parse(f.geometry), style: JSON.parse(f.style) }))
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  if (!VALID_TYPES.includes(body.type)) {
    return NextResponse.json({ error: `"type" must be one of ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }
  if (typeof body.geometry !== "object" || body.geometry === null) {
    return NextResponse.json({ error: '"geometry" must be a GeoJSON geometry object' }, { status: 400 });
  }

  const now = new Date();
  const [feature] = await db
    .insert(mapFeatures)
    .values({
      id: generateId(),
      mapId: id,
      type: body.type,
      name: body.name ?? null,
      geometry: JSON.stringify(body.geometry),
      style: JSON.stringify(body.style ?? {}),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return NextResponse.json(
    { ...feature, geometry: JSON.parse(feature.geometry), style: JSON.parse(feature.style) },
    { status: 201 }
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manually verify with the dev server**

Run: `npm run dev` (in a separate terminal, leave it running for the rest of this plan), then in another terminal:

```bash
curl -s -X POST http://localhost:3000/api/maps/nonexistent-map-id/features \
  -H "Content-Type: application/json" \
  -d '{"type":"region","name":"Test Region","geometry":{"type":"Polygon","coordinates":[[[0.1,0.1],[0.2,0.1],[0.2,0.2],[0.1,0.1]]]},"style":{"fillColor":"#4a7c59"}}'
```
Expected: a JSON response with a generated `id`, `type: "region"`, and the geometry/style echoed back parsed as objects (not strings) - a 500 here (e.g. a foreign-key failure) is fine for this smoke check since `nonexistent-map-id` isn't a real map; the important thing is a clean 500/insert-error, not a route-not-found 404.

- [ ] **Step 4: Commit**

```bash
git add app/api/maps/\[id\]/features/route.ts
git commit -m "feat: add map features list/create API"
```

---

### Task 7: Map feature update/delete API

**Files:**
- Create: `app/api/maps/features/[featureId]/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/maps/features/[featureId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mapFeatures } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const VALID_TYPES = ["region", "road", "label"];

export async function PATCH(req: Request, { params }: { params: Promise<{ featureId: string }> }) {
  const { featureId } = await params;
  const body = await req.json();
  const existing = await db.query.mapFeatures.findFirst({ where: eq(mapFeatures.id, featureId) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body.type !== undefined && !VALID_TYPES.includes(body.type)) {
    return NextResponse.json({ error: `"type" must be one of ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }

  await db
    .update(mapFeatures)
    .set({
      type: body.type ?? existing.type,
      name: body.name !== undefined ? body.name : existing.name,
      geometry: body.geometry !== undefined ? JSON.stringify(body.geometry) : existing.geometry,
      style: body.style !== undefined ? JSON.stringify(body.style) : existing.style,
      updatedAt: new Date(),
    })
    .where(eq(mapFeatures.id, featureId));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ featureId: string }> }) {
  const { featureId } = await params;
  await db.delete(mapFeatures).where(eq(mapFeatures.id, featureId));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/api/maps/features
git commit -m "feat: add map feature update/delete API"
```

---

### Task 8: `isWorldMap` promotion on the maps PATCH route

**Files:**
- Modify: `app/api/maps/[id]/route.ts:1-36`

- [ ] **Step 1: Update the PATCH handler**

Replace the full contents of `app/api/maps/[id]/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maps } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { deleteMapAssets } from "@/lib/maps/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const map = await db.query.maps.findFirst({ where: eq(maps.id, id) });
  if (!map) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const breadcrumb: { id: string; name: string }[] = [];
  let current = map;
  while (current.parentMapId) {
    const parent = await db.query.maps.findFirst({ where: eq(maps.id, current.parentMapId) });
    if (!parent) break;
    breadcrumb.unshift({ id: parent.id, name: parent.name });
    current = parent;
  }

  return NextResponse.json({ ...map, breadcrumb });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const existing = await db.query.maps.findFirst({ where: eq(maps.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const nextName = body.name ?? existing.name;

  if (body.isWorldMap === true) {
    db.transaction((tx) => {
      tx.update(maps)
        .set({ isWorldMap: false, updatedAt: new Date() })
        .where(and(eq(maps.campaignId, existing.campaignId), eq(maps.isWorldMap, true)))
        .run();
      tx.update(maps)
        .set({ name: nextName, isWorldMap: true, updatedAt: new Date() })
        .where(eq(maps.id, id))
        .run();
    });
  } else {
    await db
      .update(maps)
      .set({ name: nextName, isWorldMap: body.isWorldMap ?? existing.isWorldMap, updatedAt: new Date() })
      .where(eq(maps.id, id));
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await db.query.maps.findFirst({ where: eq(maps.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await db.delete(maps).where(eq(maps.id, id));
  } catch (err) {
    if (err instanceof Error && err.message.includes("FOREIGN KEY constraint failed")) {
      return NextResponse.json(
        { error: "This map is still referenced by a sub-map or marker. Remove those references first." },
        { status: 409 }
      );
    }
    throw err;
  }
  await deleteMapAssets(existing);

  return NextResponse.json({ ok: true });
}
```

The only changes from the existing file: the `and` import, and the PATCH handler branching on `body.isWorldMap === true` to demote any other World Map in the same campaign inside a transaction before promoting this one. `db.transaction`'s callback runs synchronously against `better-sqlite3` (this project's driver) - no `await` inside it, and each statement ends in `.run()` rather than being awaited, matching how this driver's transactions work.

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/api/maps/\[id\]/route.ts
git commit -m "feat: support isWorldMap promotion with same-campaign demotion"
```

---

### Task 9: Shared map-types.ts updates

**Files:**
- Modify: `components/maps/map-types.ts`

- [ ] **Step 1: Add feature types and `isWorldMap`**

Replace the full contents of `components/maps/map-types.ts` with:

```ts
export type MarkerType = "location" | "faction" | "character" | "submap" | "note";

export interface MarkerData {
  id: string;
  mapId: string;
  x: number;
  y: number;
  type: MarkerType;
  entityId: string | null;
  targetMapId: string | null;
  title: string | null;
  note: string | null;
  minZoom: number | null;
}

export interface ResolvedMarker extends MarkerData {
  resolvedTitle: string;
  resolvedSubtitle: string | null;
}

export type FeatureType = "region" | "road" | "label";

export interface RegionStyle {
  fillColor: string;
  strokeColor: string;
}

export interface RoadStyle {
  color: string;
  width: number;
  dash: boolean;
}

export interface LabelStyle {
  fontSize: number;
  color: string;
}

export interface MapFeatureData {
  id: string;
  mapId: string;
  type: FeatureType;
  name: string | null;
  geometry: GeoJSON.Geometry;
  style: RegionStyle | RoadStyle | LabelStyle;
}

export interface MapData {
  id: string;
  name: string;
  imagePath: string;
  parentMapId: string | null;
  breadcrumb: { id: string; name: string }[];
  renderMode: "static" | "tiled";
  width: number | null;
  height: number | null;
  maxZoom: number | null;
  isWorldMap: boolean;
}

export interface MapCanvasProps {
  map: MapData;
  markers: ResolvedMarker[];
  addMode: boolean;
  selectedId: string | null;
  onImageClick: (pos: { x: number; y: number }) => void;
  onMarkerClick: (marker: ResolvedMarker) => void;
  onMarkerDragMove: (markerId: string, pos: { x: number; y: number }) => void;
  onMarkerDragEnd: (markerId: string, pos: { x: number; y: number }) => void;
  onZoomChange?: (zoom: number) => void;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/maps/map-types.ts
git commit -m "feat: add MapFeatureData/FeatureType, isWorldMap on MapData"
```

---

### Task 10: VectorMapCanvas — base MapLibre viewer + entity markers

**Files:**
- Create: `components/maps/VectorMapCanvas.tsx`

This first pass gets the raster background rendering and the existing entity-linking markers working, with no region/road/label overlay yet (that's Task 11) and no drawing tool yet (Task 12).

- [ ] **Step 1: Write the component**

Create `components/maps/VectorMapCanvas.tsx`:

```tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { MapLibreMap, Marker, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { renderToStaticMarkup } from "react-dom/server";
import { MapMarkerPin } from "@/components/maps/MapMarkerPin";
import {
  fractionalToLngLat,
  lngLatToFractional,
  getReferenceTileBounds,
  getMercatorMinZoom,
  type MapDims,
} from "@/lib/maps/mercator-adapter";
import type { MapData, ResolvedMarker } from "@/components/maps/map-types";

export interface VectorMapCanvasProps {
  map: MapData;
  markers: ResolvedMarker[];
  addMode: boolean;
  selectedId: string | null;
  onImageClick: (pos: { x: number; y: number }) => void;
  onMarkerClick: (marker: ResolvedMarker) => void;
  onMarkerDragMove: (markerId: string, pos: { x: number; y: number }) => void;
  onMarkerDragEnd: (markerId: string, pos: { x: number; y: number }) => void;
}

export function VectorMapCanvas({
  map,
  markers,
  addMode,
  selectedId,
  onImageClick,
  onMarkerClick,
  onMarkerDragMove,
  onMarkerDragEnd,
}: VectorMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const glMapRef = useRef<MapLibreMap | null>(null);
  const markerInstancesRef = useRef<Map<string, Marker>>(new Map());
  const [ready, setReady] = useState(false);

  const dims: MapDims = { width: map.width ?? 0, height: map.height ?? 0, maxZoom: map.maxZoom ?? 0 };

  useEffect(() => {
    if (!containerRef.current) return;
    const { west, south, east, north } = getReferenceTileBounds();
    const bounds: [number, number, number, number] = [west, south, east, north];
    const referenceZoom = getMercatorMinZoom();

    const glMap = new MapLibreMap({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [] },
      bounds,
      maxBounds: bounds,
      minZoom: referenceZoom,
      maxZoom: referenceZoom + (map.maxZoom ?? 0),
      renderWorldCopies: false,
      attributionControl: false,
    });

    glMap.on("load", () => {
      glMap.addSource("base-tiles", {
        type: "raster",
        tiles: [`/api/maps/${map.id}/vtiles/{z}/{x}/{y}.jpg`],
        tileSize: 256,
        bounds,
        maxzoom: referenceZoom + (map.maxZoom ?? 0),
      });
      glMap.addLayer({ id: "base-tiles-layer", type: "raster", source: "base-tiles" });
      setReady(true);
    });

    glMapRef.current = glMap;
    return () => {
      glMap.remove();
      glMapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map.id/maxZoom are fixed for a mounted World Map
  }, [map.id]);

  const clickCallbacksRef = useRef({ addMode, onImageClick, dims });
  clickCallbacksRef.current = { addMode, onImageClick, dims };

  useEffect(() => {
    const glMap = glMapRef.current;
    if (!glMap) return;
    const el = glMap.getCanvasContainer();
    el.style.cursor = addMode ? "crosshair" : "";

    function handleClick(e: MapMouseEvent) {
      const { addMode: currentAddMode, onImageClick: currentOnImageClick, dims: currentDims } = clickCallbacksRef.current;
      if (!currentAddMode) return;
      const pos = lngLatToFractional(e.lngLat.lng, e.lngLat.lat, currentDims);
      currentOnImageClick(pos);
    }
    glMap.on("click", handleClick);
    return () => {
      glMap.off("click", handleClick);
    };
  }, [addMode]);

  const markerCallbacksRef = useRef({ onMarkerClick, onMarkerDragMove, onMarkerDragEnd });
  markerCallbacksRef.current = { onMarkerClick, onMarkerDragMove, onMarkerDragEnd };

  useEffect(() => {
    const glMap = glMapRef.current;
    if (!glMap || !ready) return;
    const instances = markerInstancesRef.current;
    const seenIds = new Set(markers.map((m) => m.id));

    for (const [id, instance] of instances) {
      if (!seenIds.has(id)) {
        instance.remove();
        instances.delete(id);
      }
    }

    for (const marker of markers) {
      const [lng, lat] = fractionalToLngLat(marker.x, marker.y, dims);
      let instance = instances.get(marker.id);
      if (!instance) {
        const el = document.createElement("div");
        el.innerHTML = renderToStaticMarkup(<MapMarkerPin type={marker.type} selected={marker.id === selectedId} />);
        el.addEventListener("click", (evt) => {
          evt.stopPropagation();
          markerCallbacksRef.current.onMarkerClick(marker);
        });
        instance = new Marker({ element: el, draggable: true, anchor: "bottom" }).setLngLat([lng, lat]).addTo(glMap);
        instance.on("drag", () => {
          const { lng: dLng, lat: dLat } = instance!.getLngLat();
          markerCallbacksRef.current.onMarkerDragMove(marker.id, lngLatToFractional(dLng, dLat, dims));
        });
        instance.on("dragend", () => {
          const { lng: dLng, lat: dLat } = instance!.getLngLat();
          markerCallbacksRef.current.onMarkerDragEnd(marker.id, lngLatToFractional(dLng, dLat, dims));
        });
        instances.set(marker.id, instance);
      } else {
        instance.setLngLat([lng, lat]);
        instance.getElement().innerHTML = renderToStaticMarkup(
          <MapMarkerPin type={marker.type} selected={marker.id === selectedId} />
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dims is derived fresh each render from stable map fields
  }, [markers, selectedId, ready]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-black/40">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/maps/VectorMapCanvas.tsx
git commit -m "feat: add VectorMapCanvas base raster viewer with entity markers"
```

---

### Task 11: VectorMapCanvas — region/road/label render layers

**Files:**
- Modify: `components/maps/VectorMapCanvas.tsx`

- [ ] **Step 1: Add a `features` prop and the three style layers**

In `components/maps/VectorMapCanvas.tsx`, update the imports at the top to add `geometryToLngLat`:

```ts
import {
  fractionalToLngLat,
  lngLatToFractional,
  geometryToLngLat,
  getReferenceTileBounds,
  getMercatorMinZoom,
  type MapDims,
} from "@/lib/maps/mercator-adapter";
import type { MapData, ResolvedMarker, MapFeatureData } from "@/components/maps/map-types";
```

Add `features` and `onFeatureClick` to `VectorMapCanvasProps`:

```ts
export interface VectorMapCanvasProps {
  map: MapData;
  markers: ResolvedMarker[];
  features: MapFeatureData[];
  addMode: boolean;
  selectedId: string | null;
  onImageClick: (pos: { x: number; y: number }) => void;
  onMarkerClick: (marker: ResolvedMarker) => void;
  onMarkerDragMove: (markerId: string, pos: { x: number; y: number }) => void;
  onMarkerDragEnd: (markerId: string, pos: { x: number; y: number }) => void;
  onFeatureClick: (featureId: string) => void;
}
```

Add `features` and `onFeatureClick` to the function's destructured parameters:

```ts
export function VectorMapCanvas({
  map,
  markers,
  features,
  addMode,
  selectedId,
  onImageClick,
  onMarkerClick,
  onMarkerDragMove,
  onMarkerDragEnd,
  onFeatureClick,
}: VectorMapCanvasProps) {
```

Add a callbacks ref for `onFeatureClick` right after the `clickCallbacksRef` declaration:

```ts
  const featureClickCallbackRef = useRef(onFeatureClick);
  featureClickCallbackRef.current = onFeatureClick;
```

Inside the `glMap.on("load", ...)` handler, immediately after the existing `glMap.addLayer({ id: "base-tiles-layer", ... })` line and before `setReady(true);`, add the features source, its three style layers, and their click handlers:

```ts
      glMap.addSource("features", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      glMap.addLayer({
        id: "region-fill",
        type: "fill",
        source: "features",
        filter: ["==", ["get", "type"], "region"],
        paint: { "fill-color": ["coalesce", ["get", "fillColor"], "#4a7c59"], "fill-opacity": 0.35 },
      });
      glMap.addLayer({
        id: "region-outline",
        type: "line",
        source: "features",
        filter: ["==", ["get", "type"], "region"],
        paint: { "line-color": ["coalesce", ["get", "strokeColor"], "#4a7c59"], "line-width": 2 },
      });
      glMap.addLayer({
        id: "road-line",
        type: "line",
        source: "features",
        filter: ["==", ["get", "type"], "road"],
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#8a6d3b"],
          "line-width": ["coalesce", ["get", "width"], 2],
          "line-dasharray": ["case", ["get", "dash"], ["literal", [2, 2]], ["literal", [1, 0]]],
        },
      });
      glMap.addLayer({
        id: "label-text",
        type: "symbol",
        source: "features",
        filter: ["==", ["get", "type"], "label"],
        layout: {
          "text-field": ["get", "name"],
          "text-size": ["coalesce", ["get", "fontSize"], 14],
          "text-allow-overlap": false,
        },
        paint: { "text-color": ["coalesce", ["get", "color"], "#e8e2d4"] },
      });

      for (const layerId of ["region-fill", "road-line", "label-text"]) {
        glMap.on("click", layerId, (e) => {
          const id = e.features?.[0]?.properties?.featureId;
          if (typeof id === "string") featureClickCallbackRef.current(id);
        });
      }
```

Add a new effect (after the existing markers-rendering effect) that keeps the `features` GeoJSON source in sync:

```ts
  useEffect(() => {
    const glMap = glMapRef.current;
    if (!glMap || !ready) return;
    const source = glMap.getSource("features");
    if (!source || source.type !== "geojson") return;
    source.setData({
      type: "FeatureCollection",
      features: features.map((f) => ({
        type: "Feature",
        id: f.id,
        geometry: geometryToLngLat(f.geometry, dims),
        properties: { featureId: f.id, type: f.type, name: f.name, ...f.style },
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dims is derived fresh each render from stable map fields
  }, [features, ready]);
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/maps/VectorMapCanvas.tsx
git commit -m "feat: render region/road/label layers on VectorMapCanvas"
```

---

### Task 12: VectorMapCanvas — Terra Draw wiring + FeatureFormDialog

**Files:**
- Modify: `components/maps/VectorMapCanvas.tsx`
- Create: `components/maps/FeatureFormDialog.tsx`

- [ ] **Step 1: Add Terra Draw to VectorMapCanvas**

In `components/maps/VectorMapCanvas.tsx`, add these imports:

```ts
import { TerraDraw, TerraDrawPolygonMode, TerraDrawLineStringMode, TerraDrawPointMode, TerraDrawRenderMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { FeatureType } from "@/components/maps/map-types";
```

Add `drawMode` and `onFeatureDrawn` to `VectorMapCanvasProps`:

```ts
  drawMode: FeatureType | null;
  onFeatureDrawn: (type: FeatureType, geometry: GeoJSON.Geometry) => void;
```

Add them to the destructured function parameters (after `onFeatureClick`):

```ts
  drawMode,
  onFeatureDrawn,
```

Add a ref to hold the Terra Draw instance and a callbacks ref, right after `featureClickCallbackRef`:

```ts
  const drawRef = useRef<TerraDraw | null>(null);
  const drawCallbacksRef = useRef({ drawMode, onFeatureDrawn, dims });
  drawCallbacksRef.current = { drawMode, onFeatureDrawn, dims };
```

Inside the `glMap.on("load", ...)` handler, immediately before `setReady(true);`, initialize Terra Draw:

```ts
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map: glMap }),
        modes: [new TerraDrawPolygonMode(), new TerraDrawLineStringMode(), new TerraDrawPointMode(), new TerraDrawRenderMode()],
      });
      draw.start();
      draw.setMode("render");
      draw.on("finish", (id) => {
        const snapshot = draw.getSnapshotFeature(id);
        const { drawMode: currentDrawMode, onFeatureDrawn: currentOnFeatureDrawn, dims: currentDims } = drawCallbacksRef.current;
        if (!snapshot || !currentDrawMode) return;
        const geometry = snapshot.geometry as GeoJSON.Geometry;
        currentOnFeatureDrawn(currentDrawMode, geometryToFractional(geometry, currentDims));
        draw.removeFeatures([id]);
        draw.setMode("render");
      });
      drawRef.current = draw;
```

Add `geometryToFractional` to the mercator-adapter import at the top of the file:

```ts
import {
  fractionalToLngLat,
  lngLatToFractional,
  geometryToLngLat,
  geometryToFractional,
  getReferenceTileBounds,
  getMercatorMinZoom,
  type MapDims,
} from "@/lib/maps/mercator-adapter";
```

In the mount effect's cleanup function, stop Terra Draw before removing the map (add this line right before `glMap.remove();`):

```ts
      drawRef.current?.stop();
      drawRef.current = null;
```

Add a new effect (after the features-sync effect) that switches Terra Draw's active mode when the `drawMode` prop changes:

```ts
  const TERRA_MODE_NAME: Record<FeatureType, string> = { region: "polygon", road: "linestring", label: "point" };

  useEffect(() => {
    const draw = drawRef.current;
    if (!draw || !ready) return;
    draw.setMode(drawMode ? TERRA_MODE_NAME[drawMode] : "render");
  }, [drawMode, ready]);
```

- [ ] **Step 2: Write FeatureFormDialog**

Create `components/maps/FeatureFormDialog.tsx`:

```tsx
"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { FeatureType, MapFeatureData, RegionStyle, RoadStyle, LabelStyle } from "@/components/maps/map-types";

interface FeatureFormDialogProps {
  mapId: string;
  type: FeatureType;
  geometry: GeoJSON.Geometry | null;
  feature: MapFeatureData | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

const TYPE_LABEL: Record<FeatureType, string> = { region: "Region", road: "Road", label: "Label" };

export function FeatureFormDialog({ mapId, type, geometry, feature, onClose, onSaved, onDeleted }: FeatureFormDialogProps) {
  const effectiveType = feature?.type ?? type;
  const [name, setName] = useState(feature?.name ?? "");

  const regionStyle = effectiveType === "region" ? (feature?.style as RegionStyle | undefined) : undefined;
  const roadStyle = effectiveType === "road" ? (feature?.style as RoadStyle | undefined) : undefined;
  const labelStyle = effectiveType === "label" ? (feature?.style as LabelStyle | undefined) : undefined;

  const [fillColor, setFillColor] = useState(regionStyle?.fillColor ?? "#4a7c59");
  const [strokeColor, setStrokeColor] = useState(regionStyle?.strokeColor ?? "#4a7c59");
  const [color, setColor] = useState(roadStyle?.color ?? labelStyle?.color ?? "#8a6d3b");
  const [width, setWidth] = useState(roadStyle?.width ?? 2);
  const [dash, setDash] = useState(roadStyle?.dash ?? false);
  const [fontSize, setFontSize] = useState(labelStyle?.fontSize ?? 14);
  const [saving, setSaving] = useState(false);

  function currentStyle(): RegionStyle | RoadStyle | LabelStyle {
    if (effectiveType === "region") return { fillColor, strokeColor };
    if (effectiveType === "road") return { color, width, dash };
    return { fontSize, color };
  }

  async function save() {
    setSaving(true);
    try {
      if (feature) {
        await fetch(`/api/maps/features/${feature.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() || null, style: currentStyle() }),
        });
      } else {
        await fetch(`/api/maps/${mapId}/features`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: effectiveType, name: name.trim() || null, geometry, style: currentStyle() }),
        });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!feature) return;
    setSaving(true);
    try {
      await fetch(`/api/maps/features/${feature.id}`, { method: "DELETE" });
      onDeleted();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{feature ? `Edit ${TYPE_LABEL[effectiveType]}` : `New ${TYPE_LABEL[effectiveType]}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />

          {effectiveType === "region" && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Fill
                <input type="color" value={fillColor} onChange={(e) => setFillColor(e.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Border
                <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} />
              </label>
            </div>
          )}

          {effectiveType === "road" && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Color
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Width
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  className="w-14 rounded-md border border-border bg-muted px-1.5 py-1 text-xs"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={dash} onChange={(e) => setDash(e.target.checked)} />
                Dashed
              </label>
            </div>
          )}

          {effectiveType === "label" && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Color
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Size
                <input
                  type="number"
                  min={8}
                  max={48}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-14 rounded-md border border-border bg-muted px-1.5 py-1 text-xs"
                />
              </label>
            </div>
          )}

          <div className="flex gap-2">
            <Button className="flex-1" onClick={save} disabled={saving}>
              {saving ? "Saving..." : feature ? "Save Changes" : "Create"}
            </Button>
            {feature && (
              <Button variant="destructive" onClick={remove} disabled={saving}>
                Delete
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Verify types compile**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/maps/VectorMapCanvas.tsx components/maps/FeatureFormDialog.tsx
git commit -m "feat: wire Terra Draw drawing tool and feature form dialog"
```

---

### Task 13: Wire MapViewer to dispatch VectorMapCanvas + draw-mode toolbar

**Files:**
- Modify: `components/maps/MapViewer.tsx`

- [ ] **Step 1: Replace the full file**

Replace the full contents of `components/maps/MapViewer.tsx` with:

```tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Plus, X, ChevronRight } from "lucide-react";
import { StaticMapCanvas } from "@/components/maps/StaticMapCanvas";
import { MarkerFormDialog } from "@/components/maps/MarkerFormDialog";
import { FeatureFormDialog } from "@/components/maps/FeatureFormDialog";
import { useCampaignStore } from "@/lib/store/campaign-store";
import type { MapData, ResolvedMarker, MapFeatureData, FeatureType } from "@/components/maps/map-types";

const TiledMapCanvas = dynamic(
  () => import("@/components/maps/TiledMapCanvas").then((mod) => mod.TiledMapCanvas),
  { ssr: false }
);
const VectorMapCanvas = dynamic(
  () => import("@/components/maps/VectorMapCanvas").then((mod) => mod.VectorMapCanvas),
  { ssr: false }
);

const ENTITY_PATH: Record<string, string> = { character: "characters", location: "locations", faction: "factions" };

const DRAW_MODE_LABEL: Record<FeatureType, string> = { region: "Draw Region", road: "Draw Road", label: "Place Label" };

export function MapViewer() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { activeCampaignId } = useCampaignStore();

  const [map, setMap] = useState<MapData | null>(null);
  const [markers, setMarkers] = useState<ResolvedMarker[]>([]);
  const [features, setFeatures] = useState<MapFeatureData[]>([]);
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState(false);
  const [drawMode, setDrawMode] = useState<FeatureType | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const match = window.location.hash.match(/^#marker-(.+)$/);
    return match ? match[1] : null;
  });
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null);
  const [editingMarker, setEditingMarker] = useState<ResolvedMarker | null>(null);
  const [pendingFeature, setPendingFeature] = useState<{ type: FeatureType; geometry: GeoJSON.Geometry } | null>(null);
  const [editingFeature, setEditingFeature] = useState<MapFeatureData | null>(null);
  const [viewZoom, setViewZoom] = useState<number | undefined>(undefined);

  const loadMarkers = useCallback(async () => {
    const res = await fetch(`/api/maps/${id}/markers`);
    if (res.ok) setMarkers(await res.json());
  }, [id]);

  const loadFeatures = useCallback(async () => {
    const res = await fetch(`/api/maps/${id}/features`);
    if (res.ok) setFeatures(await res.json());
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const [mapRes] = await Promise.all([fetch(`/api/maps/${id}`), loadMarkers()]);
        if (cancelled) return;
        const mapData: MapData | null = mapRes.ok ? await mapRes.json() : null;
        setMap(mapData);
        if (mapData?.isWorldMap) await loadFeatures();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [id, loadMarkers, loadFeatures]);

  function handleCanvasClick(pos: { x: number; y: number }) {
    setPendingPosition(pos);
    setAddMode(false);
  }

  function handleMarkerClick(marker: ResolvedMarker) {
    if (marker.type === "submap" && marker.targetMapId) {
      router.push(`/maps/${marker.targetMapId}`);
      return;
    }
    setSelectedId(marker.id === selectedId ? null : marker.id);
  }

  function handleMarkerDragMove(markerId: string, pos: { x: number; y: number }) {
    setMarkers((prev) => prev.map((m) => (m.id === markerId ? { ...m, ...pos } : m)));
  }

  function handleMarkerDragEnd(markerId: string, pos: { x: number; y: number }) {
    fetch(`/api/maps/markers/${markerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pos),
    });
  }

  function handleFeatureClick(featureId: string) {
    const feature = features.find((f) => f.id === featureId);
    if (feature) setEditingFeature(feature);
  }

  function handleFeatureDrawn(type: FeatureType, geometry: GeoJSON.Geometry) {
    setPendingFeature({ type, geometry });
    setDrawMode(null);
  }

  async function togglePromotion() {
    if (!map) return;
    const confirmed = map.isWorldMap
      ? confirm("Remove this map as the campaign's World Map?")
      : confirm("Set this as the campaign's World Map? Any other World Map in this campaign will be unset.");
    if (!confirmed) return;
    const nextIsWorldMap = !map.isWorldMap;
    await fetch(`/api/maps/${map.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isWorldMap: nextIsWorldMap }),
    });
    setMap({ ...map, isWorldMap: nextIsWorldMap });
    if (nextIsWorldMap) await loadFeatures();
  }

  const selectedMarker = markers.find((m) => m.id === selectedId) ?? null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!map) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Map not found.</p>
        <Button onClick={() => router.push("/maps")}>Back to Maps</Button>
      </div>
    );
  }

  const sharedCanvasProps = {
    map,
    markers,
    addMode,
    selectedId,
    onImageClick: handleCanvasClick,
    onMarkerClick: handleMarkerClick,
    onMarkerDragMove: handleMarkerDragMove,
    onMarkerDragEnd: handleMarkerDragEnd,
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border flex-none">
        <div className="flex items-center gap-1.5 text-sm min-w-0">
          <Link href="/maps" className="text-muted-foreground hover:text-foreground flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> Maps
          </Link>
          {map.breadcrumb.map((b) => (
            <React.Fragment key={b.id}>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              <Link href={`/maps/${b.id}`} className="text-muted-foreground hover:text-foreground truncate">
                {b.name}
              </Link>
            </React.Fragment>
          ))}
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-medium truncate">{map.name}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-none">
          {map.renderMode === "tiled" && map.parentMapId === null && (
            <Button size="sm" variant="outline" onClick={togglePromotion}>
              {map.isWorldMap ? "Remove World Map" : "Set as World Map"}
            </Button>
          )}
          {map.isWorldMap &&
            (["region", "road", "label"] as const).map((t) => (
              <Button
                key={t}
                size="sm"
                variant={drawMode === t ? "initiative" : "outline"}
                onClick={() => {
                  setDrawMode((cur) => (cur === t ? null : t));
                  setAddMode(false);
                }}
              >
                {DRAW_MODE_LABEL[t]}
              </Button>
            ))}
          <Button
            size="sm"
            variant={addMode ? "initiative" : "outline"}
            onClick={() => {
              setAddMode((v) => !v);
              setDrawMode(null);
            }}
            className="gap-1.5"
          >
            {addMode ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {addMode ? "Cancel" : "Add Marker"}
          </Button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {map.isWorldMap ? (
          <VectorMapCanvas
            {...sharedCanvasProps}
            features={features}
            drawMode={drawMode}
            onFeatureClick={handleFeatureClick}
            onFeatureDrawn={handleFeatureDrawn}
          />
        ) : map.renderMode === "tiled" ? (
          <TiledMapCanvas {...sharedCanvasProps} onZoomChange={setViewZoom} />
        ) : (
          <StaticMapCanvas {...sharedCanvasProps} />
        )}

        {selectedMarker && (
          <div className="absolute top-4 left-4 w-64 rounded-lg border border-border bg-card p-3 shadow-xl space-y-2 z-[1000]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium text-sm">{selectedMarker.resolvedTitle}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">{selectedMarker.type}</div>
              </div>
              <button onClick={() => setSelectedId(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {selectedMarker.type === "note" && selectedMarker.note && (
              <p className="text-sm text-muted-foreground">{selectedMarker.note}</p>
            )}
            {selectedMarker.resolvedSubtitle && (
              <p className="text-xs text-destructive">{selectedMarker.resolvedSubtitle}</p>
            )}
            <div className="flex gap-2 pt-1">
              {ENTITY_PATH[selectedMarker.type] && selectedMarker.entityId && (
                <Link
                  href={`/${ENTITY_PATH[selectedMarker.type]}/${selectedMarker.entityId}`}
                  className="text-xs text-primary hover:underline"
                >
                  View {selectedMarker.type} →
                </Link>
              )}
              <button
                onClick={() => {
                  setEditingMarker(selectedMarker);
                  setSelectedId(null);
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Edit
              </button>
              <button
                onClick={async () => {
                  await fetch(`/api/maps/markers/${selectedMarker.id}`, { method: "DELETE" });
                  setSelectedId(null);
                  loadMarkers();
                }}
                className="text-xs text-destructive hover:underline"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>

      {(pendingPosition || editingMarker) && (
        <MarkerFormDialog
          mapId={map.id}
          campaignId={activeCampaignId ?? ""}
          position={pendingPosition}
          marker={editingMarker}
          currentZoom={map.renderMode === "tiled" ? viewZoom : undefined}
          onClose={() => {
            setPendingPosition(null);
            setEditingMarker(null);
          }}
          onSaved={() => {
            setPendingPosition(null);
            setEditingMarker(null);
            loadMarkers();
          }}
        />
      )}

      {(pendingFeature || editingFeature) && (
        <FeatureFormDialog
          mapId={map.id}
          type={pendingFeature?.type ?? editingFeature!.type}
          geometry={pendingFeature?.geometry ?? null}
          feature={editingFeature}
          onClose={() => {
            setPendingFeature(null);
            setEditingFeature(null);
          }}
          onSaved={() => {
            setPendingFeature(null);
            setEditingFeature(null);
            loadFeatures();
          }}
          onDeleted={() => {
            setEditingFeature(null);
            loadFeatures();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/maps/MapViewer.tsx
git commit -m "feat: dispatch VectorMapCanvas for World Maps, add promote/draw toolbar"
```

---

### Task 14: Maps list page — pin World Map to top with a badge

**Files:**
- Modify: `app/maps/page.tsx`

- [ ] **Step 1: Replace the full file**

Replace the full contents of `app/maps/page.tsx` with:

```tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Map as MapIcon, Plus, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadMapDialog } from "@/components/maps/UploadMapDialog";
import { useCampaignStore } from "@/lib/store/campaign-store";

interface MapListItem {
  id: string;
  name: string;
  isWorldMap: boolean;
}

export default function MapsPage() {
  const { activeCampaignId } = useCampaignStore();
  const [maps, setMaps] = useState<MapListItem[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    fetch(`/api/maps?campaignId=${activeCampaignId}`).then((res) => {
      if (res.ok) res.json().then(setMaps);
    });
  }, [activeCampaignId]);

  useEffect(() => {
    load();
  }, [load]);

  const sortedMaps = [...maps].sort((a, b) => Number(b.isWorldMap) - Number(a.isWorldMap));

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <MapIcon className="w-5 h-5 text-muted-foreground" /> Maps
        </h1>
        <Button size="sm" onClick={() => setUploadOpen(true)} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Upload Map
        </Button>
      </div>

      {maps.length === 0 && <p className="text-sm text-muted-foreground">No maps yet. Upload one to get started.</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {sortedMaps.map((m) => (
          <Link
            key={m.id}
            href={`/maps/${m.id}`}
            className="group rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-colors relative"
          >
            {m.isWorldMap && (
              <div className="absolute top-2 left-2 z-10 flex items-center gap-1 rounded-full bg-card/90 border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                <Globe className="w-3 h-3" /> World Map
              </div>
            )}
            <div className="aspect-video bg-muted overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element -- locally-served map thumbnail */}
              <img
                src={`/api/maps/${m.id}/image`}
                alt={m.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
              />
            </div>
            <div className="px-3 py-2 text-sm font-medium truncate">{m.name}</div>
          </Link>
        ))}
      </div>

      <UploadMapDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        campaignId={activeCampaignId ?? ""}
        onUploaded={load}
      />
    </div>
  );
}
```

The only functional changes from the existing file: `MapListItem` gains `isWorldMap` (already returned by `GET /api/maps` automatically, since it's just a new column on the same `maps` row - no API change needed), a `sortedMaps` array puts any World Map first, and a small badge renders on its card.

- [ ] **Step 2: Verify types compile**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/maps/page.tsx
git commit -m "feat: pin World Map to top of maps list with a badge"
```

---

### Task 15: End-to-end smoke test

**Files:** none (manual verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server starts with no errors; the migration runs automatically at startup and adds `is_world_map` plus the new `map_features` table to the existing SQLite file.

- [ ] **Step 2: Promote an existing tiled map to World Map**

In the browser: go to `/maps`, open an existing top-level tiled map (or upload one via "Upload Map" → "Large-scale interactive" if none exists yet), and click "Set as World Map" in its header. Confirm the dialog.

Expected: the button now reads "Remove World Map"; going back to `/maps` shows this map first in the grid with a "World Map" badge.

- [ ] **Step 3: Confirm the raster background renders correctly**

Reload the World Map's page.

Expected: the illustrated map image renders (not a blank/black viewport), and it can be panned and zoomed smoothly with the mouse - this is the real end-to-end proof that the Mercator tile-address translation from Task 5 works, not just the isolated hand-computed check from Task 4.

- [ ] **Step 4: Draw one of each feature type**

Click "Draw Region", click 3-4 points on the map to outline a shape, click the first point again (or press Enter, depending on Terra Draw's default finish gesture) to close it. Fill in a name and colors in the dialog that appears, click "Create".

Repeat for "Draw Road" (click several points, then press Enter or double-click depending on Terra Draw's default finish gesture for lines) and "Place Label" (single click).

Expected: after each save, the shape/line/label renders on the map in the chosen style, and reloading the page still shows it (confirms it persisted, not just an in-memory Terra Draw artifact).

- [ ] **Step 5: Confirm existing markers still work unchanged**

Click "Add Marker", place a Location-type marker linked to an existing location, save it, then click the marker.

Expected: the same info card as the Leaflet-based tiled viewer appears, with a working "View location →" link.

- [ ] **Step 6: Confirm editing and deleting a drawn feature works**

Click on the region drawn in Step 4.

Expected: the `FeatureFormDialog` opens pre-filled with its existing name/colors ("Edit Region" title). Change the name, save, and confirm the label updates on the map. Then reopen it and click "Delete" - confirm it disappears from the map and stays gone after a reload.

- [ ] **Step 7: Confirm demotion is non-destructive**

Click "Remove World Map" on this map's page.

Expected: the map reverts to the normal Leaflet `TiledMapCanvas` view (existing entity markers still visible, unaffected). Click "Set as World Map" again.

Expected: the regions/roads/labels drawn earlier reappear exactly as left - confirming demotion didn't delete `map_features` rows.

- [ ] **Step 8: Confirm only one World Map per campaign**

If a second top-level tiled map exists (or upload one), promote it to World Map too.

Expected: the confirmation dialog mentions the existing World Map will be unset; after confirming, the *new* map is the only one badged "World Map" on `/maps`, and the previous one's header now reads "Set as World Map" again (demoted).

- [ ] **Step 9: Final build check**

Run: `npm run build`
Expected: succeeds with no type errors, confirming the whole feature is type-safe end-to-end.
