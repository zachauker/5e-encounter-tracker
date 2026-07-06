# Marker Layer Toggles (Plan 9B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-map checkbox panel on all map viewers (`/world`, static, tiled) to show/hide markers by group — Locations (expandable by type: Cities / Towns / POIs / Regions / Other), Characters, Factions, Sub-maps, Notes — with visibility persisted per map.

**Architecture:** The markers API adds each location marker's subtype (`entitySubtype`) to its resolved data. A shared `marker-layers.ts` maps any marker to a layer key and derives the present groups+counts. A self-contained `MarkerLayerControl` (native checkboxes, no new UI dep) drives a `hidden: Set<string>` held by each viewer; the viewer filters markers before handing them to its canvas, and persists the set to `localStorage`.

**Tech Stack:** Next.js 16 / React 19 / Drizzle. No test framework — verify with `node -e` assertions and the browser. Depends on Plan 9A (the `locations.type` field is live).

---

## Context every task needs

- **Worktree root:** `/Users/zacharyauker/Development/encounter-tracker/.claude/worktrees/vigorous-hypatia-e1eb00`. Run commands there.
- **No test framework**; no `npm run build` inside tasks (the controller builds at the end).
- Marker `type` enum (on `map_markers`): `location | faction | character | submap | note`. Location markers also carry a linked `locations.type` subtype (`city|town|poi|region|other`).
- **Layer key** convention: non-location markers → their `type`; location markers → `location:<subtype>` (unlinked/legacy location → `location:other`).
- Both viewers load pins from `GET /api/maps/[id]/markers` (WorldMapViewer uses the world-map id). Canvases render exactly the markers passed to them, so filtering happens in the viewer.
- Only `components/ui/badge.tsx` and `button.tsx` exist — the control uses **native `<input type="checkbox">`**, no popover lib.
- Test campaign `0ab354d6-dd08-41a3-9987-fe876f768b51` has 198 location markers on its world map with subtypes region=83 / city=43 / poi=41 / town=31.

---

## Task 1: Markers API returns `entitySubtype`

**Files:**
- Modify: `app/api/maps/[id]/markers/route.ts`
- Modify: `components/maps/map-types.ts`

- [ ] **Step 1: Return the location subtype from `resolveMarkerLabel`**

In `app/api/maps/[id]/markers/route.ts`, change the function signature return type (line 8-9):

```ts
async function resolveMarkerLabel(
  marker: typeof mapMarkers.$inferSelect
): Promise<{ resolvedTitle: string; resolvedSubtitle: string | null; entitySubtype: string | null }> {
```

Update the three early `return`s (note/submap/no-entity) to include `entitySubtype: null`. Specifically:

```ts
  if (marker.type === "note") {
    return { resolvedTitle: marker.title || "Note", resolvedSubtitle: null, entitySubtype: null };
  }
  if (marker.type === "submap") {
    const target = marker.targetMapId
      ? await db.query.maps.findFirst({ where: eq(maps.id, marker.targetMapId) })
      : null;
    return {
      resolvedTitle: marker.title || target?.name || "Sub-map",
      resolvedSubtitle: target ? null : "Map not found",
      entitySubtype: null,
    };
  }
  if (!marker.entityId) {
    return { resolvedTitle: marker.title || "Untitled", resolvedSubtitle: "Entity not found", entitySubtype: null };
  }
```

Then capture the location's type. Change the location branch and final return:

```ts
  let entityName: string | undefined;
  let entitySubtype: string | null = null;
  if (marker.type === "character") {
    entityName = (await db.query.characters.findFirst({ where: eq(characters.id, marker.entityId) }))?.name;
  } else if (marker.type === "location") {
    const loc = await db.query.locations.findFirst({ where: eq(locations.id, marker.entityId) });
    entityName = loc?.name;
    entitySubtype = loc?.type ?? null;
  } else if (marker.type === "faction") {
    entityName = (await db.query.factions.findFirst({ where: eq(factions.id, marker.entityId) }))?.name;
  }
  return {
    resolvedTitle: marker.title || entityName || "Untitled",
    resolvedSubtitle: entityName ? null : "Entity not found",
    entitySubtype,
  };
```

- [ ] **Step 2: Add `entitySubtype` to the `ResolvedMarker` type**

In `components/maps/map-types.ts`, extend the interface:

```ts
export interface ResolvedMarker extends MarkerData {
  resolvedTitle: string;
  resolvedSubtitle: string | null;
  entitySubtype?: string | null;
}
```

- [ ] **Step 3: Verify the API emits subtypes**

Ensure the dev server is running. Run:
```bash
node -e '
fetch("http://localhost:3000/api/world?campaignId=0ab354d6-dd08-41a3-9987-fe876f768b51")
 .then(r=>r.json()).then(m=>fetch(`http://localhost:3000/api/maps/${m.id}/markers`))
 .then(r=>r.json()).then(rows=>{
   const withSub=rows.filter(r=>r.type==="location"&&r.entitySubtype);
   const dist=withSub.reduce((a,r)=>((a[r.entitySubtype]=(a[r.entitySubtype]||0)+1),a),{});
   console.log("location markers with subtype:",withSub.length,"dist:",JSON.stringify(dist));
 });
'
```
Expected: `location markers with subtype: 198` and a dist like `{"region":83,"city":43,"poi":41,"town":31}`.

- [ ] **Step 4: Commit**

```bash
git add "app/api/maps/[id]/markers/route.ts" components/maps/map-types.ts
git commit -m "feat: markers API returns location entitySubtype"
```

---

## Task 2: Shared `marker-layers` module

**Files:**
- Create: `components/maps/marker-layers.ts`

- [ ] **Step 1: Write the module**

Create `components/maps/marker-layers.ts` with exactly:

```ts
import type { ResolvedMarker } from "@/components/maps/map-types";

// Groups a marker for the show/hide control.
// Non-location markers key on their type; location markers on location:<subtype>.
export function layerKeyOf(marker: ResolvedMarker): string {
  if (marker.type === "location") return `location:${marker.entitySubtype ?? "other"}`;
  return marker.type;
}

const LOCATION_SUBTYPE_ORDER = ["city", "town", "poi", "region", "other"] as const;
const LOCATION_SUBTYPE_LABELS: Record<string, string> = {
  city: "Cities",
  town: "Towns",
  poi: "POIs",
  region: "Regions",
  other: "Other",
};
const SIMPLE_GROUPS: { key: string; label: string }[] = [
  { key: "character", label: "Characters" },
  { key: "faction", label: "Factions" },
  { key: "submap", label: "Sub-maps" },
  { key: "note", label: "Notes" },
];

export interface LayerLeaf {
  key: string;
  label: string;
  count: number;
}
export interface LayerGroup {
  key: string;
  label: string;
  count: number;
  leaves: LayerLeaf[]; // empty for a single-toggle group
}

// Derive the layer groups present in a marker set, in display order, with counts.
// Only groups/leaves with at least one marker are returned.
export function deriveLayerGroups(markers: ResolvedMarker[]): LayerGroup[] {
  const counts = new Map<string, number>();
  for (const m of markers) {
    const k = layerKeyOf(m);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const groups: LayerGroup[] = [];

  const locLeaves: LayerLeaf[] = LOCATION_SUBTYPE_ORDER.map((st) => ({
    key: `location:${st}`,
    label: LOCATION_SUBTYPE_LABELS[st],
    count: counts.get(`location:${st}`) ?? 0,
  })).filter((l) => l.count > 0);
  if (locLeaves.length > 0) {
    groups.push({
      key: "location",
      label: "Locations",
      count: locLeaves.reduce((s, l) => s + l.count, 0),
      leaves: locLeaves,
    });
  }

  for (const g of SIMPLE_GROUPS) {
    const count = counts.get(g.key) ?? 0;
    if (count > 0) groups.push({ key: g.key, label: g.label, count, leaves: [] });
  }

  return groups;
}

// True when the marker should render given the hidden layer-key set.
export function isMarkerVisible(marker: ResolvedMarker, hidden: Set<string>): boolean {
  return !hidden.has(layerKeyOf(marker));
}
```

- [ ] **Step 2: Verify with assertions**

Run:
```bash
node -e '
const path=require("path");
require("esbuild")===undefined;
' 2>/dev/null; \
npx --yes tsx -e '
import { layerKeyOf, deriveLayerGroups, isMarkerVisible } from "./components/maps/marker-layers.ts";
import assert from "assert";
const mk = (type, entitySubtype) => ({ id: Math.random()+"", type, entitySubtype } as any);
assert.strictEqual(layerKeyOf(mk("location","city")), "location:city");
assert.strictEqual(layerKeyOf(mk("location",null)), "location:other");
assert.strictEqual(layerKeyOf(mk("character")), "character");
const groups = deriveLayerGroups([mk("location","city"),mk("location","city"),mk("location","region"),mk("character"),mk("note")]);
assert.strictEqual(groups[0].key,"location");
assert.strictEqual(groups[0].count,3);
assert.deepStrictEqual(groups[0].leaves.map(l=>l.key),["location:city","location:region"]);
assert.strictEqual(groups[0].leaves[0].count,2);
assert.ok(groups.some(g=>g.key==="character"&&g.count===1));
assert.ok(groups.some(g=>g.key==="note"));
assert.ok(!groups.some(g=>g.key==="faction")); // absent group omitted
assert.strictEqual(isMarkerVisible(mk("location","city"), new Set(["location:city"])), false);
assert.strictEqual(isMarkerVisible(mk("location","city"), new Set(["location:region"])), true);
console.log("OK marker-layers");
'
```
Expected: `OK marker-layers`. (If `tsx` is unavailable offline, transpile mentally is not an option — instead copy the three functions into a temp `.js` in the scratchpad with `require`-style exports and run the same assertions with `node`; the goal is proving the assertions pass.)

- [ ] **Step 3: Commit**

```bash
git add components/maps/marker-layers.ts
git commit -m "feat: shared marker-layers module (layer keys + group derivation)"
```

---

## Task 3: `MarkerLayerControl` component

**Files:**
- Create: `components/maps/MarkerLayerControl.tsx`

- [ ] **Step 1: Write the component**

Create `components/maps/MarkerLayerControl.tsx` with exactly:

```tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ResolvedMarker } from "@/components/maps/map-types";
import { deriveLayerGroups } from "@/components/maps/marker-layers";

interface MarkerLayerControlProps {
  markers: ResolvedMarker[];
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
}

// A checkbox whose "indeterminate" visual is set imperatively (native inputs
// can't take it as a prop).
function TriStateCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} className="accent-primary" />;
}

export function MarkerLayerControl({ markers, hidden, onChange }: MarkerLayerControlProps) {
  const [open, setOpen] = useState(false);
  const groups = deriveLayerGroups(markers);

  if (groups.length === 0) return null;

  function setKeys(keys: string[], hide: boolean) {
    const next = new Set(hidden);
    for (const k of keys) {
      if (hide) next.add(k);
      else next.delete(k);
    }
    onChange(next);
  }

  return (
    <div className="relative">
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen((v) => !v)}>
        <Layers className="w-3.5 h-3.5" /> Layers
      </Button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 rounded-lg border border-border bg-card p-2 shadow-xl z-[1100] space-y-1">
          {groups.map((g) => {
            const leafKeys = g.leaves.length > 0 ? g.leaves.map((l) => l.key) : [g.key];
            const visibleLeaves = leafKeys.filter((k) => !hidden.has(k));
            const allOn = visibleLeaves.length === leafKeys.length;
            const someOn = visibleLeaves.length > 0;
            return (
              <div key={g.key}>
                <label className="flex items-center gap-2 px-1 py-1 text-sm cursor-pointer">
                  <TriStateCheckbox
                    checked={allOn}
                    indeterminate={someOn && !allOn}
                    onChange={() => setKeys(leafKeys, allOn)}
                  />
                  <span className="flex-1 font-medium">{g.label}</span>
                  <span className="text-xs text-muted-foreground">{g.count}</span>
                </label>
                {g.leaves.map((l) => (
                  <label key={l.key} className="flex items-center gap-2 pl-6 pr-1 py-0.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!hidden.has(l.key)}
                      onChange={() => setKeys([l.key], !hidden.has(l.key))}
                      className="accent-primary"
                    />
                    <span className="flex-1 text-muted-foreground">{l.label}</span>
                    <span className="text-xs text-muted-foreground">{l.count}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

Note the toggle semantics: `setKeys(leafKeys, allOn)` — when everything in the group is on, the click *hides* all; otherwise it *shows* all (removes from `hidden`). Leaf checkboxes toggle their own key.

- [ ] **Step 2: Commit**

```bash
git add components/maps/MarkerLayerControl.tsx
git commit -m "feat: MarkerLayerControl checkbox panel component"
```

---

## Task 4: Wire the control into `WorldMapViewer`

**Files:**
- Modify: `components/maps/WorldMapViewer.tsx`

- [ ] **Step 1: Add imports**

At the top of `components/maps/WorldMapViewer.tsx`, add after the existing imports:

```ts
import { MarkerLayerControl } from "@/components/maps/MarkerLayerControl";
import { isMarkerVisible } from "@/components/maps/marker-layers";
```

- [ ] **Step 2: Add hidden-layers state + persistence**

After the `const [viewZoom, setViewZoom] = useState<number | undefined>(undefined);` line, add:

```ts
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // Load persisted hidden layers once the world map id is known.
  useEffect(() => {
    if (!worldMapId || typeof window === "undefined") return;
    const raw = window.localStorage.getItem(`markerLayers:${worldMapId}`);
    if (raw) {
      try {
        setHidden(new Set(JSON.parse(raw) as string[]));
      } catch {
        // ignore malformed storage
      }
    }
  }, [worldMapId]);

  function updateHidden(next: Set<string>) {
    setHidden(next);
    if (worldMapId) window.localStorage.setItem(`markerLayers:${worldMapId}`, JSON.stringify([...next]));
  }

  const visibleMarkers = markers.filter((m) => isMarkerVisible(m, hidden));
```

- [ ] **Step 3: Render the control in the toolbar**

In the toolbar `<div className="flex items-center gap-2 flex-none">`, add the control immediately before the theme `<select>`:

```tsx
        <div className="flex items-center gap-2 flex-none">
          <MarkerLayerControl markers={markers} hidden={hidden} onChange={updateHidden} />
          <select
```

- [ ] **Step 4: Pass filtered markers to the canvas**

Change the `WorldMapCanvas` prop from `markers={markers}` to:

```tsx
          markers={visibleMarkers}
```

(Leave the `selectedMarker` lookup on the full `markers` list unchanged.)

- [ ] **Step 5: Verify in the browser**

Ensure the dev server is running; open `/world`. Confirm:
1. A **Layers** button appears in the toolbar; clicking it opens a panel listing **Locations** (with Cities / Towns / POIs / Regions sub-rows and counts) — Characters/Factions/etc. absent (no such markers).
2. Unchecking **Regions** removes the region pins (visibly fewer pins; counts unaffected); re-checking restores them.
3. Unchecking the **Locations** parent hides all location pins; the parent shows indeterminate when only some subtypes are on.
4. Reload the page — the hidden set persists (the layer you unchecked stays hidden).

Report observations; diagnose failures before committing.

- [ ] **Step 6: Commit**

```bash
git add components/maps/WorldMapViewer.tsx
git commit -m "feat: marker layer control on /world with per-map persistence"
```

---

## Task 5: Wire the control into `MapViewer` (static/tiled uploaded maps)

**Files:**
- Modify: `components/maps/MapViewer.tsx`

- [ ] **Step 1: Add imports**

At the top of `components/maps/MapViewer.tsx`, add after the existing imports:

```ts
import { MarkerLayerControl } from "@/components/maps/MarkerLayerControl";
import { isMarkerVisible } from "@/components/maps/marker-layers";
```

- [ ] **Step 2: Add hidden-layers state + persistence**

After the `const [viewZoom, setViewZoom] = useState<number | undefined>(undefined);` line, add:

```ts
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(`markerLayers:${id}`);
    if (raw) {
      try {
        setHidden(new Set(JSON.parse(raw) as string[]));
      } catch {
        // ignore malformed storage
      }
    }
  }, [id]);

  function updateHidden(next: Set<string>) {
    setHidden(next);
    window.localStorage.setItem(`markerLayers:${id}`, JSON.stringify([...next]));
  }
```

- [ ] **Step 3: Filter the markers passed to the canvas**

`MapViewer` builds a `sharedCanvasProps` object with `markers`. Change that property to the filtered list. Find:

```tsx
  const sharedCanvasProps = {
    map,
    markers,
    addMode,
```

and change it to:

```tsx
  const sharedCanvasProps = {
    map,
    markers: markers.filter((m) => isMarkerVisible(m, hidden)),
    addMode,
```

(The `selectedMarker` lookup stays on the full `markers` list.)

- [ ] **Step 4: Render the control in the toolbar**

In the header actions `<div className="flex items-center gap-1.5 flex-none">`, add the control immediately before the "Add Marker" `<Button>`:

```tsx
        <div className="flex items-center gap-1.5 flex-none">
          <MarkerLayerControl markers={markers} hidden={hidden} onChange={updateHidden} />
          <Button
            size="sm"
            variant={addMode ? "initiative" : "outline"}
```

- [ ] **Step 5: Verify in the browser**

Open an uploaded map that has markers (e.g. from `/maps`, open the Exandria static map if it has pins; otherwise place a couple of markers of different kinds first). Confirm:
1. The **Layers** button + panel appear and list only the groups present on this map with correct counts.
2. Unchecking a group hides those pins; reload persists the choice under this map's own key (independent of `/world`).

Report observations. If this map has no markers, note that the control correctly renders nothing (`deriveLayerGroups` returns `[]` → `MarkerLayerControl` returns `null`), and place at least one marker to confirm the panel then appears.

- [ ] **Step 6: Commit**

```bash
git add components/maps/MapViewer.tsx
git commit -m "feat: marker layer control on uploaded static/tiled maps"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (Part B):** resolved-marker subtype → Task 1; `layerKeyOf` + present-group derivation with counts → Task 2; `MarkerLayerControl` (grouped, expandable Locations, tri-state parent) → Task 3; filtering + per-map `localStorage` persistence wired into `/world` and uploaded maps → Tasks 4-5. "Only groups present" → `deriveLayerGroups` filters zero-count leaves/groups; control returns `null` when empty. All Part-B bullets covered.
- **Placeholder scan:** every code step is complete; no "TBD"/"handle later". The one non-code judgement (tsx availability in Task 2 Step 2) has an explicit fallback.
- **Type/name consistency:** `entitySubtype` is added in Task 1 (API + `ResolvedMarker`) and consumed by `layerKeyOf` (Task 2), which both the control (Task 3) and the two viewers (Tasks 4-5) import. The `hidden: Set<string>` shape, `updateHidden` signature, `isMarkerVisible`, and `deriveLayerGroups` are used identically across the control and both viewers. `localStorage` keys are `markerLayers:<mapId>` in both viewers (distinct from Plan-1's `worldMapTheme`).
- **Filtering placement:** both canvases already render only the markers they receive (established in sub-projects 6-8), so filtering upstream needs no canvas change — confirmed against `WorldMapViewer` (passes `markers` prop) and `MapViewer` (`sharedCanvasProps.markers`).
