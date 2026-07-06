# Location Types (Plan 9A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed, editable `type` category (`city · town · poi · region · other`) to `locations`, populated by the seed script (with backfill of the existing 198 rows), accepted by the API, editable in the location form, and shown as a badge on the detail page.

**Architecture:** A nullable-safe enum column with a `'other'` default, added via the existing idempotent migration helper. The seed script derives each place's type from its source layer and backfills rows it previously created. The shared entity form/detail components gain a location-only Type control + badge.

**Tech Stack:** Next.js 16 / React 19 / Drizzle ORM + better-sqlite3. No test framework — verify via `node -e`/SQL and the browser.

---

## Context every task needs

- **Worktree root:** `/Users/zacharyauker/Development/encounter-tracker/.claude/worktrees/vigorous-hypatia-e1eb00`. Run all commands there.
- **No test framework.** "Verify" = migration run + SQL query + browser check.
- The `type` enum is exactly `["city", "town", "poi", "region", "other"]`, `NOT NULL DEFAULT 'other'`.
- Integer timestamp columns store **Unix seconds** (the seed script's `nowSec()` already does this).
- `SimpleEntityFormDialog` and `SimpleEntityDetail` are **shared** across `locations | items | factions` via a `resourcePath` prop — the Type control/badge must appear **only** when `resourcePath === "locations"`.
- The test campaign is `My Campaign` = `0ab354d6-dd08-41a3-9987-fe876f768b51`, already seeded with 198 locations (currently no `type` column).

---

## Task 1: Schema column + migration

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/migrate.ts`

- [ ] **Step 1: Add the `type` column to the Drizzle `locations` table**

In `lib/db/schema.ts`, find the `locations` table's `description` line:

```ts
  description: text("description"),
```

Add immediately after it:

```ts
  type: text("type", { enum: ["city", "town", "poi", "region", "other"] }).notNull().default("other"),
```

- [ ] **Step 2: Add the idempotent migration**

In `lib/db/migrate.ts`, find the block of `addColumnIfMissing(...)` calls (they start around line 179). Add this line alongside the others (e.g. right after the `addColumnIfMissing("maps", ...)` group):

```ts
  addColumnIfMissing("locations", "type", "TEXT NOT NULL DEFAULT 'other'");
```

- [ ] **Step 3: Run the migration against a scratch DB to confirm it applies cleanly**

Run:
```bash
DB_PATH=/private/tmp/claude-501/-Users-zacharyauker-Development-encounter-tracker--claude-worktrees-vigorous-hypatia-e1eb00/cbb4f0c3-02f5-44bf-bf6a-f9e5622b1525/scratchpad/mig-test.db node -e '
const { execSync } = require("child_process");
' 2>/dev/null; echo "skip"; \
node --input-type=commonjs -e '
const Database = require("better-sqlite3");
const p = process.env.SCRATCH || "/private/tmp/claude-501/-Users-zacharyauker-Development-encounter-tracker--claude-worktrees-vigorous-hypatia-e1eb00/cbb4f0c3-02f5-44bf-bf6a-f9e5622b1525/scratchpad/mig-test.db";
const fs=require("fs"); try{fs.unlinkSync(p)}catch{}
const db=new Database(p);
db.exec("CREATE TABLE locations (id TEXT PRIMARY KEY, campaign_id TEXT, name TEXT, notion_url TEXT, description TEXT, created_at INTEGER, updated_at INTEGER)");
// simulate the migration helper
const cols=db.prepare("PRAGMA table_info(locations)").all().map(c=>c.name);
if(!cols.includes("type")) db.exec("ALTER TABLE locations ADD COLUMN type TEXT NOT NULL DEFAULT (\x27other\x27)");
db.prepare("INSERT INTO locations (id,campaign_id,name) VALUES (?,?,?)").run("x","c","Test");
console.log("type of new row:", db.prepare("SELECT type FROM locations WHERE id=?").get("x").type);
fs.unlinkSync(p);
'
```
Expected: prints `type of new row: other` (the default applies). (This mirrors what `addColumnIfMissing` does; the real migration runs on app start / next DB open.)

- [ ] **Step 4: Apply the migration to the real dev DB**

The app runs migrations on DB open. Trigger it directly:
```bash
node -e '
const Database=require("better-sqlite3");
const db=new Database("encounter-tracker.db");
const cols=db.prepare("PRAGMA table_info(locations)").all().map(c=>c.name);
if(!cols.includes("type")) db.exec("ALTER TABLE locations ADD COLUMN type TEXT NOT NULL DEFAULT (\x27other\x27)");
console.log("locations cols:", db.prepare("PRAGMA table_info(locations)").all().map(c=>c.name).join(","));
console.log("existing rows all default:", db.prepare("SELECT type, COUNT(*) n FROM locations GROUP BY type").all());
'
```
Expected: columns now include `type`; all existing 198 rows report `type = other` (they predate the column, so they take the default).

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts lib/db/migrate.ts
git commit -m "feat: add type enum column to locations"
```

---

## Task 2: Seed derivation + backfill

Teach `scripts/world/seed-locations.js` to compute each place's `type` and write it on insert, and to backfill `type` on rows it previously created (which currently default to `other`).

**Files:**
- Modify: `scripts/world/seed-locations.js`

- [ ] **Step 1: Add the `deriveType` helper**

In `scripts/world/seed-locations.js`, add this function immediately after the existing `composeDescription` function:

```js
// Coarse locations.type category from a source feature.
function deriveType(category, props) {
  if (category === "region") return "region";
  if (category === "poi") return "poi";
  const t = String(props.Type || "").toLowerCase();
  if (t === "metropolis" || t === "city") return "city";
  if (t === "ruins") return "poi";
  return "town";
}
```

- [ ] **Step 2: Carry `type` through `loadRecords`**

In `loadRecords`, the `raw.push({ ... })` call currently ends with `minZoom: MIN_ZOOM[layer.category],`. Add a `type` field to that pushed object:

```js
        minZoom: MIN_ZOOM[layer.category],
        type: deriveType(layer.category, ft.properties || {}),
```

- [ ] **Step 3: Carry `type` through `dedupe`**

In `dedupe`, the final `out.push({ ... })` builds an explicit object ending with `minZoom: r.minZoom,`. Add `type`:

```js
      minZoom: r.minZoom,
      type: r.type,
```

(The higher-priority-wins branch uses `{ ...r, _pts }`, so `type` already carries there.)

- [ ] **Step 4: Write `type` on insert and backfill existing rows**

In `seed()`, update the `insLoc` statement and add a backfill statement. Replace:

```js
  const insLoc = db.prepare(
    "INSERT INTO locations (id, campaign_id, name, notion_url, description, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
  );
```

with:

```js
  const insLoc = db.prepare(
    "INSERT INTO locations (id, campaign_id, name, notion_url, description, type, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
  );
  const backfillType = db.prepare(
    "UPDATE locations SET type = ?, updated_at = ? WHERE id = ? AND (type IS NULL OR type = 'other')"
  );
```

Then, still in `seed()`, add a `typeBackfilled` counter next to the other counters:

```js
  let mkSkipped = 0;
```

becomes:

```js
  let mkSkipped = 0;
  let typeBackfilled = 0;
```

In the transaction loop, the existing-location branch currently is:

```js
      if (existingLoc) {
        locId = existingLoc.id;
        locSkipped++;
      } else {
```

Replace it with (backfill type on rows still at the default):

```js
      if (existingLoc) {
        locId = existingLoc.id;
        locSkipped++;
        if (backfillType.run(r.type, nowSec(), locId).changes > 0) typeBackfilled++;
      } else {
```

And the insert call inside the `else` branch:

```js
        insLoc.run(locId, campaignId, r.name, null, r.description, t, t);
```

becomes:

```js
        insLoc.run(locId, campaignId, r.name, null, r.description, r.type, t, t);
```

Finally, extend the summary output. After the existing two `console.log` lines for Locations/Markers, add:

```js
  console.log(`Types:     ${typeBackfilled} backfilled on existing rows.`);
```

- [ ] **Step 5: Re-run the seed to backfill the 198 rows**

Run: `node scripts/world/seed-locations.js 0ab354d6-dd08-41a3-9987-fe876f768b51`
Expected: `Locations: 0 created, 198 existing.`, `Markers: 0 created, 198 existing.`, and `Types: 198 backfilled on existing rows.` (first backfill run touches all 198).

- [ ] **Step 6: Verify the type distribution**

Run:
```bash
node -e '
const D=require("better-sqlite3");const db=new D("encounter-tracker.db",{readonly:true});
const cid="0ab354d6-dd08-41a3-9987-fe876f768b51";
console.log(db.prepare("SELECT type, COUNT(*) n FROM locations WHERE campaign_id=? GROUP BY type ORDER BY n DESC").all(cid));
console.log("Emon:", db.prepare("SELECT type FROM locations WHERE campaign_id=? AND name=(\x27Emon\x27)").get(cid));
console.log("region sample:", db.prepare("SELECT name,type FROM locations WHERE campaign_id=? AND type=(\x27region\x27) LIMIT 2").all(cid));
'
```
Expected: a distribution across `city`/`town`/`poi`/`region` with `region`=83 and `poi`≈40 (poi count includes any city-file `Ruins`); `Emon` → `city` (it's a Metropolis); region samples show `type: region`. Essentially no seeded rows remain `other`.

- [ ] **Step 7: Confirm idempotency of the backfill**

Run the seed once more: `node scripts/world/seed-locations.js 0ab354d6-dd08-41a3-9987-fe876f768b51`
Expected: `Types: 0 backfilled on existing rows.` (all rows now have a non-`other` type, so the guarded UPDATE matches nothing).

- [ ] **Step 8: Commit**

```bash
git add scripts/world/seed-locations.js
git commit -m "feat: derive and backfill locations.type in seed script"
```

---

## Task 3: API accepts + validates `type`

**Files:**
- Modify: `app/api/locations/route.ts`
- Modify: `app/api/locations/[id]/route.ts`

- [ ] **Step 1: Add a shared valid-types guard usage in POST**

In `app/api/locations/route.ts`, inside `POST`, after the `campaignId` validation block and before `const now = new Date();`, add:

```ts
  const LOCATION_TYPES = ["city", "town", "poi", "region", "other"];
  if (body.type !== undefined && !LOCATION_TYPES.includes(body.type)) {
    return NextResponse.json({ error: `"type" must be one of ${LOCATION_TYPES.join(", ")}` }, { status: 400 });
  }
```

Then in the `.values({ ... })` object, add a `type` field (defaulting to `"other"`) after `description`:

```ts
      description: body.description ?? null,
      type: body.type ?? "other",
```

- [ ] **Step 2: Handle `type` in PATCH**

In `app/api/locations/[id]/route.ts`, inside `PATCH`, after `const existing = ...` not-found guard and before the `db.update(...)` call, add:

```ts
  const LOCATION_TYPES = ["city", "town", "poi", "region", "other"];
  if (body.type !== undefined && !LOCATION_TYPES.includes(body.type)) {
    return NextResponse.json({ error: `"type" must be one of ${LOCATION_TYPES.join(", ")}` }, { status: 400 });
  }
```

Then in the `.set({ ... })` object, add after the `description` line:

```ts
      description: body.description ?? existing.description,
      type: body.type ?? existing.type,
```

- [ ] **Step 3: Verify the API round-trips `type`**

Ensure the dev server is running (preview tooling), then:
```bash
# create a location with a type
curl -s -X POST http://localhost:3000/api/locations -H 'Content-Type: application/json' \
  -d '{"campaignId":"0ab354d6-dd08-41a3-9987-fe876f768b51","name":"ZZ Test Place","type":"town"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log("created type:",o.type,"id:",o.id);process.env.NEWID=o.id})'
# reject a bad type
curl -s -o /dev/null -w "bad-type status: %{http_code}\n" -X POST http://localhost:3000/api/locations -H 'Content-Type: application/json' \
  -d '{"campaignId":"0ab354d6-dd08-41a3-9987-fe876f768b51","name":"ZZ Bad","type":"nope"}'
```
Expected: `created type: town`, and `bad-type status: 400`.

Then clean up the test row:
```bash
node -e '
const D=require("better-sqlite3");const db=new D("encounter-tracker.db");
const r=db.prepare("DELETE FROM locations WHERE name=(\x27ZZ Test Place\x27)").run();
console.log("deleted test rows:", r.changes);
'
```
Expected: `deleted test rows: 1`.

- [ ] **Step 4: Commit**

```bash
git add app/api/locations/route.ts "app/api/locations/[id]/route.ts"
git commit -m "feat: accept and validate locations.type in API"
```

---

## Task 4: Type control in the form + badge on the detail page

**Files:**
- Modify: `components/entities/SimpleEntityFormDialog.tsx`
- Modify: `components/glossary/SimpleEntityDetail.tsx`

- [ ] **Step 1: Extend the `SimpleEntity` interface + form state**

In `components/entities/SimpleEntityFormDialog.tsx`, add `type` to the interface:

```ts
export interface SimpleEntity {
  id: string;
  name: string;
  description: string | null;
  notionUrl: string | null;
  type?: string | null;
}
```

Add a state hook next to the others (after the `notionUrl` state):

```ts
  const [type, setType] = useState(entity?.type ?? "other");
```

- [ ] **Step 2: Include `type` in the payload for locations only**

In the `save()` function, change the `payload` object so it includes `type` only when editing a location:

```ts
      const payload = {
        campaignId,
        name: name.trim(),
        description: description.trim() || null,
        notionUrl: notionUrl.trim() || null,
        ...(resourcePath === "locations" ? { type } : {}),
      };
```

- [ ] **Step 3: Render the Type select (locations only)**

In the dialog body, immediately after the `<textarea ... />` for description and before the Notion `<Input ... />`, add:

```tsx
          {resourcePath === "locations" && (
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="city">City</option>
              <option value="town">Town</option>
              <option value="poi">Point of Interest</option>
              <option value="region">Region</option>
              <option value="other">Other</option>
            </select>
          )}
```

- [ ] **Step 4: Add `type` to the detail data + render a badge**

In `components/glossary/SimpleEntityDetail.tsx`:

(a) Add `type` to the data interface (find `interface SimpleEntityDetailData {` and its `description: string | null;` line), add:

```ts
  description: string | null;
  type?: string | null;
```

(b) Add a Badge import. Find the existing UI imports near the top and add:

```ts
import { Badge } from "@/components/ui/badge";
```

(c) Add a label map above the component's `return` (e.g. just after the `if (!entity) { ... }` block, before `return (`):

```ts
  const LOCATION_TYPE_LABELS: Record<string, string> = {
    city: "City",
    town: "Town",
    poi: "Point of Interest",
    region: "Region",
    other: "Other",
  };
```

(d) Render the badge inside the `<h1>`, right after `{entity.name}`. Change:

```tsx
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Icon className="w-5 h-5 text-muted-foreground" /> {entity.name}
        </h1>
```

to:

```tsx
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Icon className="w-5 h-5 text-muted-foreground" /> {entity.name}
          {resourcePath === "locations" && entity.type && (
            <Badge variant="outline" className="text-xs font-normal uppercase tracking-wide">
              {LOCATION_TYPE_LABELS[entity.type] ?? entity.type}
            </Badge>
          )}
        </h1>
```

(The fetched entity row already includes `type` from the API, and it flows into the edit dialog via the existing `entity` prop, so no extra wiring is needed there. Factions/items have no `type` column, so `entity.type` is undefined for them and the badge/select never render.)

- [ ] **Step 5: Browser verification**

Ensure the dev server is running. Then:
1. Open a seeded city detail page (e.g. navigate to `/locations` and open **Rexxentrum**). Confirm a **City** badge shows next to the name.
2. Open a region (e.g. **Ashkeeper Peaks**) — confirm a **Region** badge.
3. Click **Edit** on a location — confirm the Type `<select>` shows the current value; change it (e.g. to Town), save, and confirm the badge updates after reload.
4. Open a **Faction** detail page and its edit dialog — confirm **no** Type badge and **no** Type select appear (shared component stays clean for non-locations).

Report observations; if any step fails, diagnose before proceeding.

- [ ] **Step 6: Commit**

```bash
git add components/entities/SimpleEntityFormDialog.tsx components/glossary/SimpleEntityDetail.tsx
git commit -m "feat: location type select in form + badge on detail page"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (Part A):** schema+migration → Task 1; seed derivation + backfill of the 198 → Task 2 (`deriveType` + guarded UPDATE + `Types: N backfilled` summary); API accept/validate → Task 3; form select + detail badge, location-only → Task 4. All Part-A spec bullets covered. (Part B is the separate Plan 9B.)
- **Placeholder scan:** every code step shows complete code; the enum value list `["city","town","poi","region","other"]` is repeated verbatim in schema, both API routes, the form `<option>`s, and the badge label map (intentional — no shared const exists across the server/client boundary; DRY-ing it would add an import for five short strings). No "TBD"/"handle validation"/"similar to".
- **Type consistency:** the enum is identical everywhere; `deriveType` only ever returns members of it; the seed record shape gains `type` in `loadRecords` and is preserved through both `dedupe` branches and the `insLoc`/`backfillType` statements; `SimpleEntity.type` and `SimpleEntityDetailData.type` are both `string | null | undefined`-tolerant and gated on `resourcePath === "locations"`.
- **Idempotency:** the backfill UPDATE is guarded by `(type IS NULL OR type = 'other')`, so a second run backfills 0 (Task 2 Step 7) and never clobbers a DM-edited type.
