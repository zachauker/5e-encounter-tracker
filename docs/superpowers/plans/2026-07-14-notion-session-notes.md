# Notion Session Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync the Notion "Session Timeline" database into the hub as a fifth entity type, pin those notes to uploaded maps with a date-driven filter and per-Type pins, and browse them in a dedicated `/sessions` section.

**Architecture:** Reuse the existing four-entity Notion sync pipeline (`mapper → reconcile → repo → archiveUnseen`) by adding `sessionNotes` as a fifth entity type over a new `session_notes` table, with a `session_note_locations` join populated by name-matching the Notion `Setting(s)` multi-select against hub Locations. On maps, a new `event` marker type points at a session note; pins vary their icon by the note's Notion `Type`, and a date filter defaults to the next upcoming session. A dedicated `/sessions` browse section and an "Events here" list on location detail pages round it out.

**Tech Stack:** Next.js (App Router, breaking-change fork — read `node_modules/next/dist/docs/` before writing route/page code), Drizzle ORM over better-sqlite3, React client components, vitest, Tailwind. Notion source database: data source `collection://43bf8b9b-3af4-4668-b2ec-6e767664dafd`.

**Source schema (Session Timeline):** `Name` (title), `Type` (select: Story Outline, Session Notes, Character Event, Combat Encounter, RP Encounter), `Status` (select), `Date` (date-only), `Arc` (select), `Setting(s)` (multi-select place names), `Recording` (file). No relation links an event to its session — only a shared `Date`.

**Conventions to follow:**
- Date-only Notion values are stored as **text ISO strings** (`"2026-07-19"`), never integer timestamp columns (avoids timezone day-shift).
- Migrations are additive and idempotent (`CREATE TABLE IF NOT EXISTS`, `addColumnIfMissing`); the marker-type and entity-type enums are enforced in app code, not the DB, so no `ALTER` is needed for those.
- `session_notes` syncs **after** `locations` so the `Setting(s)`→location match resolves.
- Session notes are read-only in the hub (Notion is source of truth) — no create/edit/delete UI.

---

## Phase 1 — Data model & sync

### Task 1: Schema + migration for `session_notes` and `session_note_locations`

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/migrate.ts`

- [ ] **Step 1: Add the two tables + types to the Drizzle schema**

In `lib/db/schema.ts`, after the `factions` table (near line 126) add:

```typescript
export const sessionNotes = sqliteTable("session_notes", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  notionUrl: text("notion_url"),
  notionPageId: text("notion_page_id"),
  notionProps: text("notion_props"),
  noteType: text("note_type"),          // Notion "Type" select
  status: text("status"),                // Notion "Status" select
  date: text("date"),                    // ISO date string "2026-07-19" — text, not a timestamp
  arc: text("arc"),                      // Notion "Arc" select
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  notionSyncedAt: integer("notion_synced_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const sessionNoteLocations = sqliteTable(
  "session_note_locations",
  {
    sessionNoteId: text("session_note_id").notNull().references(() => sessionNotes.id, { onDelete: "cascade" }),
    locationId: text("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.sessionNoteId, t.locationId] })]
);
```

Then update the `notionSources.entityType` enum (line ~132) to include the new type:

```typescript
    entityType: text("entity_type", { enum: ["characters", "items", "factions", "locations", "sessionNotes"] }).notNull(),
```

And update the `mapMarkers.type` enum (line ~187) to include `event`:

```typescript
    type: text("type", { enum: ["location", "faction", "character", "submap", "note", "event"] }).notNull(),
```

At the bottom of the file with the other type exports (near line 240) add:

```typescript
export type SessionNote = typeof sessionNotes.$inferSelect;
export type NewSessionNote = typeof sessionNotes.$inferInsert;
```

- [ ] **Step 2: Add the raw `CREATE TABLE` statements to the migration**

In `lib/db/migrate.ts`, inside the big `sqlite.exec(\`...\`)` block, after the `notion_sources` table (near line 147) add:

```sql
    CREATE TABLE IF NOT EXISTS session_notes (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      notion_url TEXT,
      notion_page_id TEXT,
      notion_props TEXT,
      note_type TEXT,
      status TEXT,
      date TEXT,
      arc TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      notion_synced_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_note_locations (
      session_note_id TEXT NOT NULL REFERENCES session_notes(id) ON DELETE CASCADE,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      PRIMARY KEY (session_note_id, location_id)
    );

    CREATE INDEX IF NOT EXISTS idx_session_notes_campaign ON session_notes(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_session_notes_date ON session_notes(date);
```

Note: because the migration `exec` block runs the entire schema in one call, the `session_note_locations` table's `REFERENCES locations(id)` requires `locations` to be created earlier in the same block — it is (near line 85). No change to `addColumnIfMissing` calls is needed.

- [ ] **Step 3: Verify the migration runs and the tables exist**

Run: `npx vitest run lib/notion/reconcile.test.ts` (any existing test that calls `createTestDb` exercises `runMigrations`).
Expected: PASS — the new `CREATE TABLE` statements are valid SQL and don't break existing tests.

If you want a direct check, run:
```bash
node -e "process.env.DB_PATH=require('os').tmpdir()+'/t.db'; require('tsx/cjs'); const {runMigrations}=require('./lib/db/migrate.ts'); runMigrations(); const db=new (require('better-sqlite3'))(process.env.DB_PATH); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('session_notes','session_note_locations')\").all());"
```
Expected: prints both table names. (If `tsx/cjs` isn't wired for this, skip — the vitest run above is the authoritative check.)

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts lib/db/migrate.ts
git commit -m "feat(db): session_notes + session_note_locations tables, event/sessionNotes enums"
```

---

### Task 2: `readDate` prop reader + `mapSessionNoteRow` mapper

**Files:**
- Modify: `lib/notion/props.ts`
- Modify: `lib/notion/map.ts`
- Test: `lib/notion/props.test.ts`, `lib/notion/map.test.ts`

- [ ] **Step 1: Write the failing test for `readDate`**

Append to `lib/notion/props.test.ts`:

```typescript
import { readDate } from "./props";

describe("readDate", () => {
  it("reads the start of a date property", () => {
    expect(readDate({ type: "date", date: { start: "2026-07-19", end: null } })).toBe("2026-07-19");
  });
  it("returns null for an empty or missing date", () => {
    expect(readDate({ type: "date", date: null })).toBeNull();
    expect(readDate(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/notion/props.test.ts`
Expected: FAIL — `readDate` is not exported.

- [ ] **Step 3: Implement `readDate`**

Add to `lib/notion/props.ts` (after `readNumber`):

```typescript
export function readDate(p: Prop): string | null {
  const d = p?.["date"] as { start?: string } | null | undefined;
  const start = d?.start;
  return typeof start === "string" && start.length > 0 ? start : null;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run lib/notion/props.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `mapSessionNoteRow`**

Append to `lib/notion/map.test.ts`:

```typescript
import { mapSessionNoteRow } from "./map";

describe("mapSessionNoteRow", () => {
  const page = (id: string, properties: Record<string, unknown>) => ({
    id, url: `https://www.notion.so/${id.replace(/-/g, "")}`, properties,
  });

  it("maps name, Type/Status/Date/Arc, setting names, and props", () => {
    const m = mapSessionNoteRow(page("39de996b-e66d-8127-92c0-f3b47e84af28", {
      Name: { type: "title", title: [{ plain_text: "Cobalt Soul Reunion" }] },
      Type: { type: "select", select: { name: "Character Event" } },
      Status: { type: "select", select: { name: "Not started" } },
      Date: { type: "date", date: { start: "2026-07-19", end: null } },
      Arc: { type: "select", select: { name: "Dangerous Designs Pt 2" } },
      "Setting(s)": { type: "multi_select", multi_select: [{ name: "Rexxentrum" }] },
    }));
    expect(m.name).toBe("Cobalt Soul Reunion");
    expect(m.archived).toBe(false);
    expect(m.settingNames).toEqual(["Rexxentrum"]);
    expect(m.extra).toEqual({
      noteType: "Character Event",
      status: "Not started",
      date: "2026-07-19",
      arc: "Dangerous Designs Pt 2",
    });
    expect(m.notionProps).toEqual([
      { label: "Type", value: "Character Event" },
      { label: "Status", value: "Not started" },
      { label: "Date", value: "2026-07-19" },
      { label: "Arc", value: "Dangerous Designs Pt 2" },
    ]);
  });

  it("handles a row with no Date and no Settings", () => {
    const m = mapSessionNoteRow(page("s2", {
      Name: { type: "title", title: [{ plain_text: "Untimed" }] },
      Type: { type: "select", select: { name: "Story Outline" } },
    }));
    expect(m.extra).toEqual({ noteType: "Story Outline", status: null, date: null, arc: null });
    expect(m.settingNames).toEqual([]);
    expect(m.notionProps).toEqual([{ label: "Type", value: "Story Outline" }]);
  });
});
```

- [ ] **Step 6: Run to confirm it fails**

Run: `npx vitest run lib/notion/map.test.ts`
Expected: FAIL — `mapSessionNoteRow` is not exported.

- [ ] **Step 7: Implement `mapSessionNoteRow`**

In `lib/notion/map.ts`, add `readDate` to the imports from `./props`:

```typescript
import {
  readTitle, readText, readSelect, readMultiSelect,
  readCheckbox, readNumber, readUrl, readRelationIds, extractDdbId, readDate,
} from "./props";
```

Add `settingNames` to the `MappedEntity` interface (after `notableNpcPageIds?`):

```typescript
  settingNames?: string[];
```

Add the mapper (after `mapLocationRow`):

```typescript
export function mapSessionNoteRow(row: NotionRow): MappedEntity {
  const noteType = readSelect(prop(row, "Type"));
  const status = readSelect(prop(row, "Status"));
  const date = readDate(prop(row, "Date"));
  const arc = readSelect(prop(row, "Arc"));

  const props: PropEntry[] = [];
  pushIf(props, "Type", noteType);
  pushIf(props, "Status", status);
  pushIf(props, "Date", date);
  pushIf(props, "Arc", arc);

  return {
    notionPageId: pageId(row),
    notionUrl: row.url,
    name: readTitle(prop(row, "Name")),
    archived: false, // Session Timeline has no Active flag; removal drives archival
    notionProps: props,
    extra: { noteType, status, date, arc },
    settingNames: readMultiSelect(prop(row, "Setting(s)")),
  };
}
```

- [ ] **Step 8: Run to confirm pass**

Run: `npx vitest run lib/notion/map.test.ts lib/notion/props.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/notion/props.ts lib/notion/map.ts lib/notion/props.test.ts lib/notion/map.test.ts
git commit -m "feat(notion): readDate reader + mapSessionNoteRow mapper"
```

---

### Task 3: `linkSessionNoteLocationsByName` linker

**Files:**
- Modify: `lib/notion/repos.ts`
- Test: `lib/notion/repos.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/notion/repos.test.ts` (extend the existing schema import to add `sessionNotes, sessionNoteLocations`, and the repos import to add `linkSessionNoteLocationsByName`):

```typescript
describe("linkSessionNoteLocationsByName", () => {
  it("links a session note to locations by case-insensitive name, additively", () => {
    const { db, campaignId } = createTestDb();
    const lRepo = makeEntityRepo(db, locations, campaignId);
    const nRepo = makeEntityRepo(db, sessionNotes, campaignId);
    const loc = reconcileEntity(lRepo, m({ name: "Rexxentrum", notionPageId: "l1" }));
    const note = reconcileEntity(nRepo, m({ name: "Cobalt Soul Reunion", notionPageId: "n1", extra: { noteType: "Character Event" } }));

    linkSessionNoteLocationsByName(db, campaignId, note.id, ["rexxentrum", "Travel"]);
    linkSessionNoteLocationsByName(db, campaignId, note.id, ["Rexxentrum"]); // re-run: no duplicate

    const links = db.select().from(sessionNoteLocations)
      .where(and(eq(sessionNoteLocations.sessionNoteId, note.id), eq(sessionNoteLocations.locationId, loc.id))).all();
    expect(links).toHaveLength(1);
  });

  it("returns unmatched setting names as warnings", () => {
    const { db, campaignId } = createTestDb();
    const nRepo = makeEntityRepo(db, sessionNotes, campaignId);
    const note = reconcileEntity(nRepo, m({ name: "On the Road", notionPageId: "n2", extra: { noteType: "RP Encounter" } }));
    const unmatched = linkSessionNoteLocationsByName(db, campaignId, note.id, ["Travel", "On the Road"]);
    expect(unmatched).toEqual(["Travel", "On the Road"]);
  });
});
```

Update the top-of-file imports:
```typescript
import { makeEntityRepo, linkCharacterFactionsByName, linkCharacterItemsByPageId, linkCharacterLocationsByPageId, linkSessionNoteLocationsByName } from "./repos";
import { characters, factions, items, characterFactions, characterItems, locations, characterLocations, sessionNotes, sessionNoteLocations } from "@/lib/db/schema";
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run lib/notion/repos.test.ts`
Expected: FAIL — `linkSessionNoteLocationsByName` is not exported.

- [ ] **Step 3: Implement the linker**

In `lib/notion/repos.ts`, extend the schema import to include `sessionNoteLocations, locations` (locations already imported) and `sessionNotes` isn't needed here. Add:

```typescript
/**
 * Additive: link a session note to hub Locations by matching each Setting(s)
 * name (case-insensitive). Never removes links. Returns the setting names that
 * matched no location, for surfacing as sync warnings.
 */
export function linkSessionNoteLocationsByName(
  db: Db, campaignId: string, sessionNoteId: string, settingNames: string[],
): string[] {
  const unmatched: string[] = [];
  for (const name of settingNames) {
    const loc = db.select().from(locations)
      .where(and(eq(locations.campaignId, campaignId), sql`lower(${locations.name}) = lower(${name})`))
      .get();
    if (!loc) { unmatched.push(name); continue; }
    db.insert(sessionNoteLocations).values({ sessionNoteId, locationId: loc.id }).onConflictDoNothing().run();
  }
  return unmatched;
}
```

Add `sessionNoteLocations` to the existing top import from `@/lib/db/schema`.

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run lib/notion/repos.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/notion/repos.ts lib/notion/repos.test.ts
git commit -m "feat(notion): linkSessionNoteLocationsByName additive linker"
```

---

### Task 4: Wire `sessionNotes` into the sync pipeline

**Files:**
- Modify: `lib/notion/sync.ts`
- Test: `lib/notion/sync.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/notion/sync.test.ts` (add `sessionNotes, sessionNoteLocations` to the schema import):

```typescript
describe("syncCampaign — session notes", () => {
  it("creates notes, links Setting(s) to locations, and archives removed notes", async () => {
    const { db, campaignId } = createTestDb();
    const now = new Date();
    db.insert(locations).values({
      id: "loc-rex", campaignId, name: "Rexxentrum", type: "city", createdAt: now, updatedAt: now,
    } as never).run();

    const dateProp = (s: string) => ({ type: "date", date: { start: s, end: null } });
    const ms = (n: string) => ({ type: "multi_select", multi_select: [{ name: n }] });
    const rows: Record<string, NotionRow[]> = {
      dsL: [page("locRex", { Name: title("Rexxentrum"), Type: sel("City") })],
      dsS: [page("noteCobalt", {
        Name: title("Cobalt Soul Reunion"), Type: sel("Character Event"),
        Status: sel("Not started"), Date: dateProp("2026-07-19"), "Setting(s)": ms("Rexxentrum"),
      })],
    };
    const config: SourceConfig[] = [
      { entityType: "locations", dataSourceId: "dsL" },
      { entityType: "sessionNotes", dataSourceId: "dsS" },
    ];
    const summary = await syncCampaign({ db, campaignId, sources: config, queryRows: async (id) => rows[id] ?? [] });

    expect(summary.sessionNotes.created).toBe(1);
    const note = db.select().from(sessionNotes).where(eq(sessionNotes.campaignId, campaignId)).get()!;
    expect(note.noteType).toBe("Character Event");
    expect(note.date).toBe("2026-07-19");
    const links = db.select().from(sessionNoteLocations).where(eq(sessionNoteLocations.sessionNoteId, note.id)).all();
    expect(links).toHaveLength(1);

    // Remove the note from Notion → archived, not deleted.
    const summary2 = await syncCampaign({
      db, campaignId, sources: config,
      queryRows: async (id) => (id === "dsL" ? rows.dsL : []),
    });
    expect(summary2.sessionNotes.archived).toBe(1);
    expect(Boolean(db.select().from(sessionNotes).where(eq(sessionNotes.id, note.id)).get()!.archived)).toBe(true);
  });

  it("adds unmatched Setting(s) names as warnings", async () => {
    const { db, campaignId } = createTestDb();
    const ms = (n: string) => ({ type: "multi_select", multi_select: [{ name: n }] });
    const rows: Record<string, NotionRow[]> = {
      dsS: [page("noteRoad", { Name: title("On the Road"), Type: sel("RP Encounter"), "Setting(s)": ms("Travel") })],
    };
    const summary = await syncCampaign({
      db, campaignId,
      sources: [{ entityType: "sessionNotes", dataSourceId: "dsS" }],
      queryRows: async (id) => rows[id] ?? [],
    });
    expect(summary.sessionNotes.warnings.join(" ")).toContain("Travel");
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run lib/notion/sync.test.ts`
Expected: FAIL — `sessionNotes` is not a valid entity type / `summary.sessionNotes` is undefined.

- [ ] **Step 3: Wire `sessionNotes` into `sync.ts`**

Edit `lib/notion/sync.ts`:

Imports:
```typescript
import { characters, items, factions, locations, sessionNotes } from "@/lib/db/schema";
import { mapFactionRow, mapCharacterRow, mapItemRow, mapLocationRow, mapSessionNoteRow, type MappedEntity } from "./map";
import {
  makeEntityRepo, linkCharacterFactionsByName, linkCharacterItemsByPageId,
  linkCharacterLocationsByPageId, linkSessionNoteLocationsByName,
} from "./repos";
```

Type + tables:
```typescript
export type EntityType = "characters" | "items" | "factions" | "locations" | "sessionNotes";
```

```typescript
const TABLES = { characters, items, factions, locations, sessionNotes } as const;
const MAPPERS: Record<EntityType, (row: NotionRow) => MappedEntity> = {
  factions: mapFactionRow, characters: mapCharacterRow, items: mapItemRow,
  locations: mapLocationRow, sessionNotes: mapSessionNoteRow,
};
// Dependency order: link targets before linkers. sessionNotes AFTER locations
// so Setting(s)→location name matching resolves.
const ORDER: EntityType[] = ["factions", "characters", "locations", "items", "sessionNotes"];
```

Update `emptySummary` seeding in `syncCampaign`:
```typescript
  const summary: SyncSummary = {
    characters: emptySummary(), items: emptySummary(), factions: emptySummary(),
    locations: emptySummary(), sessionNotes: emptySummary(),
  };
```

Inside the per-row loop, after the `locations` linking block, add:
```typescript
      if (type === "sessionNotes" && mapped.settingNames?.length) {
        const unmatched = linkSessionNoteLocationsByName(db, campaignId, result.id, mapped.settingNames);
        for (const name of unmatched) {
          if (!s.warnings.includes(`No hub location matches setting “${name}”`)) {
            s.warnings.push(`No hub location matches setting “${name}”`);
          }
        }
      }
```

Update the `archiveUnseen` `table` param type to include `sessionNotes`:
```typescript
function archiveUnseen(db: Db, table: typeof characters | typeof items | typeof factions | typeof locations | typeof sessionNotes, campaignId: string, seenPageIds: string[]): number {
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run lib/notion/sync.test.ts`
Expected: PASS (both new tests + the existing four).

- [ ] **Step 5: Run the full notion suite**

Run: `npx vitest run lib/notion`
Expected: PASS — all files green.

- [ ] **Step 6: Commit**

```bash
git add lib/notion/sync.ts lib/notion/sync.test.ts
git commit -m "feat(notion): sync sessionNotes entity type with location linking + warnings"
```

---

### Task 5: Expose `sessionNotes` as a Notion source in the API + Settings panel

**Files:**
- Modify: `app/api/notion/sources/route.ts`
- Modify: `components/settings/NotionSyncPanel.tsx`

- [ ] **Step 1: Add `sessionNotes` to the sources route's allowed types**

In `app/api/notion/sources/route.ts` change the `TYPES` tuple:

```typescript
const TYPES = ["characters", "items", "factions", "locations", "sessionNotes"] as const;
```

No other change — the GET/PUT logic is type-agnostic beyond this list.

- [ ] **Step 2: Add the row to the Settings panel**

In `components/settings/NotionSyncPanel.tsx` add to the `SOURCES` array:

```typescript
  { type: "sessionNotes", label: "Session Timeline" },
```

(The panel maps over `SOURCES` for both the URL inputs and the per-source status, so this is the only change needed.)

- [ ] **Step 3: Verify in the running app**

Start the dev server via the preview tool (`.claude/launch.json` "dev" config; create it if missing with `npm run dev`, port 3000). Navigate to `/settings`, confirm a "Session Timeline" URL field appears alongside the other four. Paste the Session Timeline database URL (`https://app.notion.com/p/bb49cd0e1f574d688cedbd0a606debb3`), save, and click Sync. Read the sync summary / `read_network_requests` on `/api/notion/sync` to confirm `sessionNotes` reports created counts and any unmatched-setting warnings.

- [ ] **Step 4: Commit**

```bash
git add app/api/notion/sources/route.ts components/settings/NotionSyncPanel.tsx
git commit -m "feat(notion): expose Session Timeline as a syncable source in settings"
```

---

## Phase 2 — Sessions API & browse section

### Task 6: `/api/sessions` list + `/api/sessions/[id]` detail routes

**Files:**
- Create: `app/api/sessions/route.ts`
- Create: `app/api/sessions/[id]/route.ts`

**Before writing:** read `node_modules/next/dist/docs/` for the current route-handler signature (this Next fork differs from training data). Mirror the exact shapes in `app/api/locations/route.ts` and `app/api/locations/[id]/route.ts`.

- [ ] **Step 1: Write the list route**

Create `app/api/sessions/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessionNotes } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const includeArchived = searchParams.get("includeArchived") === "1";

  const conditions = [];
  if (campaignId) conditions.push(eq(sessionNotes.campaignId, campaignId));
  if (!includeArchived) conditions.push(eq(sessionNotes.archived, false));

  const rows = await db.query.sessionNotes.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [desc(sessionNotes.date)],
  });

  const archivedConditions = [eq(sessionNotes.archived, true)];
  if (campaignId) archivedConditions.push(eq(sessionNotes.campaignId, campaignId));
  const archived = await db.query.sessionNotes.findMany({ where: and(...archivedConditions) });

  return NextResponse.json({ items: rows, archivedCount: archived.length });
}
```

- [ ] **Step 2: Write the detail route (with linked locations + pinned maps)**

Create `app/api/sessions/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessionNotes, sessionNoteLocations, locations, mapMarkers, maps } from "@/lib/db/schema";
import { eq, inArray, and } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await db.query.sessionNotes.findFirst({ where: eq(sessionNotes.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const locLinks = await db.query.sessionNoteLocations.findMany({
    where: eq(sessionNoteLocations.sessionNoteId, id),
  });
  const linkedLocations =
    locLinks.length > 0
      ? await db.query.locations.findMany({ where: inArray(locations.id, locLinks.map((l) => l.locationId)) })
      : [];

  const markerLinks = await db.query.mapMarkers.findMany({
    where: and(eq(mapMarkers.entityId, id), eq(mapMarkers.type, "event")),
  });
  const mapMarkersResolved = await Promise.all(
    markerLinks.map(async (link) => {
      const map = await db.query.maps.findFirst({ where: eq(maps.id, link.mapId) });
      return {
        mapId: link.mapId,
        mapName: map?.name ?? "Unknown map",
        markerId: link.id,
        renderMode: map?.renderMode ?? "static",
      };
    })
  );

  return NextResponse.json({
    ...row,
    linkedLocations: linkedLocations.map((l) => ({ id: l.id, name: l.name, type: l.type })),
    mapMarkers: mapMarkersResolved,
    notionProps: row.notionProps
      ? (JSON.parse(row.notionProps) as Array<{ label: string; value: string }>)
      : [],
  });
}
```

- [ ] **Step 3: Verify both routes**

With the dev server running and a sync completed (Task 5), use `read_network_requests`/browser to hit:
- `/api/sessions?campaignId=<id>` → returns `{ items: [...], archivedCount }` with notes sorted by date descending.
- `/api/sessions/<noteId>` → returns the note plus `linkedLocations` and `notionProps`.

- [ ] **Step 4: Commit**

```bash
git add app/api/sessions
git commit -m "feat(api): sessions list + detail routes with location + pinned-map links"
```

---

### Task 7: `/sessions` browse page

**Files:**
- Create: `app/sessions/page.tsx`
- Create: `components/sessions/SessionNotesBrowser.tsx`

Session notes are read-only and grouped by Type / sorted by Date, so they get a dedicated browser rather than reusing the editable `SimpleEntityManager` (which is hardcoded to `locations | items | factions`).

- [ ] **Step 1: Write the browser component**

Create `components/sessions/SessionNotesBrowser.tsx`:

```typescript
"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { useCampaignStore } from "@/lib/store/campaign-store";

interface SessionNote {
  id: string;
  name: string;
  noteType: string | null;
  status: string | null;
  date: string | null;
}

// Display order for the Type groups.
const TYPE_ORDER = ["Story Outline", "Session Notes", "Character Event", "Combat Encounter", "RP Encounter"];

export function SessionNotesBrowser() {
  const { activeCampaignId } = useCampaignStore();
  const [notes, setNotes] = useState<SessionNote[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);

  const load = useCallback(() => {
    if (!activeCampaignId) return;
    fetch(`/api/sessions?campaignId=${activeCampaignId}`)
      .then((r) => r.json())
      .then((data) => {
        setNotes(data.items ?? []);
        setArchivedCount(data.archivedCount ?? 0);
      });
  }, [activeCampaignId]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = TYPE_ORDER
    .map((type) => ({ type, items: notes.filter((n) => (n.noteType ?? "Uncategorized") === type) }))
    .filter((g) => g.items.length > 0);
  const uncategorized = notes.filter((n) => !n.noteType || !TYPE_ORDER.includes(n.noteType));
  if (uncategorized.length) groups.push({ type: "Uncategorized", items: uncategorized });

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="flex items-center gap-2 mb-6">
        <ScrollText className="w-5 h-5" style={{ color: "var(--marker-note)" }} />
        <h1 className="font-display text-2xl">Sessions</h1>
        {archivedCount > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">{archivedCount} archived</span>
        )}
      </div>

      {notes.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No session notes yet. Configure the Session Timeline database in{" "}
          <Link href="/settings" className="text-primary hover:underline">Settings</Link> and sync.
        </p>
      )}

      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.type}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{g.type}</h2>
            <ul className="space-y-1.5">
              {g.items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={`/sessions/${n.id}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 hover:border-muted-foreground/40 transition-colors"
                  >
                    <span className="font-medium truncate">{n.name}</span>
                    <span className="flex items-center gap-3 flex-none text-xs text-muted-foreground">
                      {n.status && <span>{n.status}</span>}
                      {n.date && <span>{n.date}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the page**

Create `app/sessions/page.tsx`:

```typescript
"use client";

import { SessionNotesBrowser } from "@/components/sessions/SessionNotesBrowser";

export default function SessionsPage() {
  return <SessionNotesBrowser />;
}
```

- [ ] **Step 3: Verify**

With the dev server running, navigate to `/sessions`. Confirm notes appear grouped by Type with Status/Date, and clicking one navigates to `/sessions/<id>` (404-ish until Task 8, which is fine for now — confirm the link href is correct via `read_page`).

- [ ] **Step 4: Commit**

```bash
git add app/sessions/page.tsx components/sessions/SessionNotesBrowser.tsx
git commit -m "feat(sessions): grouped read-only browse page"
```

---

### Task 8: `/sessions/[id]` detail page + nav entry

**Files:**
- Create: `app/sessions/[id]/page.tsx`
- Create: `components/sessions/SessionNoteDetail.tsx`
- Modify: `components/shell/TopBar.tsx`

- [ ] **Step 1: Write the detail component**

Create `components/sessions/SessionNoteDetail.tsx`. It renders the Notion body via the existing `/api/notion/page` route + `NotionBlocks`, mirroring the pattern in `components/glossary/SimpleEntityDetail.tsx` (fetch blocks in a cancellation-guarded effect):

```typescript
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, ScrollText, ExternalLink, MapPin } from "lucide-react";
import { NotionBlocks } from "@/components/glossary/NotionBlocks";
import { NotionPropsTable } from "@/components/glossary/NotionPropsTable";
import type { NotionBlockData } from "@/lib/notion/client";

interface DetailData {
  id: string;
  name: string;
  noteType: string | null;
  notionUrl: string | null;
  linkedLocations: { id: string; name: string; type: string }[];
  mapMarkers: { mapId: string; mapName: string; markerId: string }[];
  notionProps: { label: string; value: string }[];
}

export function SessionNoteDetail() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [note, setNote] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [blocks, setBlocks] = useState<NotionBlockData[] | null>(null);
  const [blocksError, setBlocksError] = useState<string | null>(null);
  const [blocksLoading, setBlocksLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/sessions/${id}`);
        if (cancelled) return;
        setNote(res.ok ? await res.json() : null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!note?.notionUrl) return;
    let cancelled = false;
    (async (url: string) => {
      setBlocksLoading(true);
      setBlocksError(null);
      setBlocks(null);
      try {
        const res = await fetch(`/api/notion/page?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) setBlocks(data.blocks);
        else setBlocksError(data.error ?? "Couldn’t load the Notion page.");
      } finally {
        if (!cancelled) setBlocksLoading(false);
      }
    })(note.notionUrl);
    return () => { cancelled = true; };
  }, [note?.notionUrl]);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!note) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <p className="text-muted-foreground">Session note not found.</p>
        <button onClick={() => router.push("/sessions")} className="text-primary hover:underline mt-2">Back to Sessions</button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <Link href="/sessions" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> Sessions
      </Link>
      <div className="flex items-center gap-2 mb-1">
        <ScrollText className="w-5 h-5" style={{ color: "var(--marker-note)" }} />
        <h1 className="font-display text-2xl">{note.name}</h1>
      </div>
      {note.noteType && <p className="text-sm text-muted-foreground mb-4">{note.noteType}</p>}

      {note.notionProps.length > 0 && <NotionPropsTable props={note.notionProps} />}

      {note.linkedLocations.length > 0 && (
        <div className="mt-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Settings</h2>
          <div className="flex flex-wrap gap-1.5">
            {note.linkedLocations.map((l) => (
              <Link key={l.id} href={`/locations/${l.id}`}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs hover:border-muted-foreground/40">
                <MapPin className="w-3 h-3" /> {l.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {note.mapMarkers.length > 0 && (
        <div className="mt-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Pinned on</h2>
          <div className="flex flex-wrap gap-1.5">
            {note.mapMarkers.map((mm) => (
              <Link key={mm.markerId} href={`/maps/${mm.mapId}#marker-${mm.markerId}`}
                className="rounded-full border border-border px-2 py-0.5 text-xs hover:border-muted-foreground/40">
                {mm.mapName}
              </Link>
            ))}
          </div>
        </div>
      )}

      {note.notionUrl && (
        <a href={note.notionUrl} target="_blank" rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline">
          Open in Notion <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}

      <div className="mt-6 border-t border-border pt-6">
        {blocksLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        {blocksError && <p className="text-sm text-muted-foreground">{blocksError}</p>}
        {blocks && <NotionBlocks blocks={blocks} />}
      </div>
    </div>
  );
}
```

Note: confirm the `NotionBlocks` prop name by opening `components/glossary/NotionBlocks.tsx` — pass whatever prop `SimpleEntityDetail.tsx` passes it. Adjust if it differs from `blocks`.

- [ ] **Step 2: Write the page**

Create `app/sessions/[id]/page.tsx`:

```typescript
"use client";

import { SessionNoteDetail } from "@/components/sessions/SessionNoteDetail";

export default function SessionDetailPage() {
  return <SessionNoteDetail />;
}
```

- [ ] **Step 3: Add the nav entry**

In `components/shell/TopBar.tsx`, add `ScrollText` to the lucide import and add to `SECTIONS` (after Factions):

```typescript
  { href: "/sessions", label: "Sessions", icon: ScrollText },
```

- [ ] **Step 4: Verify**

With the dev server running, click "Sessions" in the nav, open the Cobalt Soul note, and confirm: properties table, linked location chip (Rexxentrum → `/locations/...`), "Open in Notion" link, and the full rendered Notion body appear. Check `read_console_messages` for errors.

- [ ] **Step 5: Commit**

```bash
git add app/sessions/[id]/page.tsx components/sessions/SessionNoteDetail.tsx components/shell/TopBar.tsx
git commit -m "feat(sessions): detail page with rendered Notion body + nav entry"
```

---

### Task 9: "Events here" on location detail pages

**Files:**
- Modify: `app/api/locations/[id]/route.ts`
- Modify: `components/glossary/SimpleEntityDetail.tsx`

- [ ] **Step 1: Add linked session notes to the location detail API**

In `app/api/locations/[id]/route.ts`, extend the imports and the response. Add to imports:

```typescript
import { sessionNoteLocations, sessionNotes } from "@/lib/db/schema";
```

Before the final `return NextResponse.json(...)`, add:

```typescript
  const noteLinks = await db.query.sessionNoteLocations.findMany({
    where: eq(sessionNoteLocations.locationId, id),
  });
  const linkedSessionNotes =
    noteLinks.length > 0
      ? await db.query.sessionNotes.findMany({
          where: inArray(sessionNotes.id, noteLinks.map((l) => l.sessionNoteId)),
        })
      : [];
```

Add to the JSON payload:

```typescript
    linkedSessionNotes: linkedSessionNotes
      .filter((n) => !n.archived)
      .map((n) => ({ id: n.id, name: n.name, noteType: n.noteType, date: n.date })),
```

- [ ] **Step 2: Render "Events here" in the shared detail component**

In `components/glossary/SimpleEntityDetail.tsx`, add to the `SimpleEntityDetailData` interface:

```typescript
  linkedSessionNotes?: { id: string; name: string; noteType: string | null; date: string | null }[];
```

Find where `linkedCharacters` / related content renders (a `RelatedCard` or list) and add an adjacent block, shown only for locations that have events:

```tsx
{entity.linkedSessionNotes && entity.linkedSessionNotes.length > 0 && (
  <div className="mt-4">
    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Events here</h2>
    <ul className="space-y-1.5">
      {entity.linkedSessionNotes.map((n) => (
        <li key={n.id}>
          <Link href={`/sessions/${n.id}`}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 hover:border-muted-foreground/40 transition-colors">
            <span className="font-medium truncate">{n.name}</span>
            <span className="flex-none text-xs text-muted-foreground">
              {[n.noteType, n.date].filter(Boolean).join(" · ")}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  </div>
)}
```

(`Link` is already imported in that file. The block is keyed off `linkedSessionNotes` being present, so items/factions detail pages — which never receive it — render nothing.)

- [ ] **Step 3: Verify**

With the dev server running, open `/locations/<rexxentrum id>` and confirm an "Events here" section lists the Cobalt Soul note, linking to `/sessions/<id>`. Confirm an item/faction detail page shows no such section (no console errors).

- [ ] **Step 4: Commit**

```bash
git add app/api/locations/[id]/route.ts components/glossary/SimpleEntityDetail.tsx
git commit -m "feat(locations): Events here list from session_note_locations"
```

---

## Phase 3 — Pinning to maps

### Task 10: `event` marker type — resolution, validation, and resolved fields

**Files:**
- Modify: `components/maps/map-types.ts`
- Modify: `app/api/maps/[id]/markers/route.ts`

- [ ] **Step 1: Extend the marker types**

In `components/maps/map-types.ts`:

Add `event` to `MarkerType`:
```typescript
export type MarkerType = "location" | "faction" | "character" | "submap" | "note" | "event";
```

Add an event date field to `ResolvedMarker` (used by the date filter):
```typescript
export interface ResolvedMarker extends MarkerData {
  resolvedTitle: string;
  resolvedSubtitle: string | null;
  entitySubtype?: string | null; // location: loc.type; event: note's Notion Type
  eventDate?: string | null;     // event markers only: the note's Date (ISO), for filtering
}
```

- [ ] **Step 2: Resolve event markers in the markers route**

In `app/api/maps/[id]/markers/route.ts`:

Extend imports:
```typescript
import { mapMarkers, maps, characters, locations, factions, sessionNotes } from "@/lib/db/schema";
```

Widen the `resolveMarkerLabel` return type to carry `eventDate`:
```typescript
async function resolveMarkerLabel(
  marker: typeof mapMarkers.$inferSelect
): Promise<{ resolvedTitle: string; resolvedSubtitle: string | null; entitySubtype: string | null; eventDate: string | null }> {
```

Update every existing `return` in that function to include `eventDate: null` (note, submap, missing-entity, and the final entity return). Then add an event branch before the `if (!marker.entityId)` guard is reached — insert after the `submap` block:

```typescript
  if (marker.type === "event") {
    const note = marker.entityId
      ? await db.query.sessionNotes.findFirst({ where: eq(sessionNotes.id, marker.entityId) })
      : null;
    return {
      resolvedTitle: marker.title || note?.name || "Event",
      resolvedSubtitle: note ? null : "Session note not found",
      entitySubtype: note?.noteType ?? null,
      eventDate: note?.date ?? null,
    };
  }
```

The final entity return (characters/locations/factions) becomes:
```typescript
  return {
    resolvedTitle: marker.title || entityName || "Untitled",
    resolvedSubtitle: entityName ? null : "Entity not found",
    entitySubtype,
    eventDate: null,
  };
```

- [ ] **Step 3: Add `event` to POST validation**

In the same file's `POST`, extend `validTypes`:
```typescript
  const validTypes = ["location", "faction", "character", "submap", "note", "event"];
```

- [ ] **Step 4: Verify**

Type-check: `npx tsc --noEmit` (expect no errors from these files). Full behavior is exercised in Tasks 13–15.

- [ ] **Step 5: Commit**

```bash
git add components/maps/map-types.ts app/api/maps/[id]/markers/route.ts
git commit -m "feat(maps): event marker type — resolve session note title, subtype, date"
```

---

### Task 11: Per-Type pin visuals (`markerVisual`)

**Files:**
- Modify: `components/maps/marker-meta.ts`
- Test: `components/maps/marker-meta.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `components/maps/marker-meta.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Swords, StickyNote } from "lucide-react";
import { markerVisual } from "./marker-meta";
import type { ResolvedMarker } from "./map-types";

const marker = (over: Partial<ResolvedMarker>): ResolvedMarker => ({
  id: "m", mapId: "map", x: 0, y: 0, type: "note", entityId: null, targetMapId: null,
  title: null, note: null, minZoom: null, resolvedTitle: "x", resolvedSubtitle: null, ...over,
});

describe("markerVisual", () => {
  it("uses the Notion Type for an event marker", () => {
    const v = markerVisual(marker({ type: "event", entitySubtype: "Combat Encounter" }));
    expect(v.icon).toBe(Swords);
    expect(v.label).toBe("Combat Encounter");
  });

  it("falls back to a generic event visual for an unknown Type", () => {
    const v = markerVisual(marker({ type: "event", entitySubtype: null }));
    expect(v.label).toBe("Event");
  });

  it("falls back to MARKER_TYPE_META for non-event markers", () => {
    const v = markerVisual(marker({ type: "note" }));
    expect(v.icon).toBe(StickyNote);
    expect(v.label).toBe("Note");
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run components/maps/marker-meta.test.ts`
Expected: FAIL — `markerVisual` is not exported.

- [ ] **Step 3: Implement `markerVisual` + event visuals**

In `components/maps/marker-meta.ts`, extend the lucide import and add the event-type table + resolver:

```typescript
import {
  MapPin, Flag, UserRound, Layers, StickyNote,
  Swords, MessagesSquare, Drama, ScrollText, type LucideIcon,
} from "lucide-react";
import type { MarkerType, ResolvedMarker } from "@/components/maps/map-types";
```

Add `event` to `MARKER_TYPE_META` (generic fallback for the type as a whole) and `MARKER_TYPES`:

```typescript
  note: { label: "Note", color: "var(--marker-note)", icon: StickyNote },
  event: { label: "Event", color: "var(--marker-event)", icon: ScrollText },
};

export const MARKER_TYPES: MarkerType[] = ["location", "faction", "character", "submap", "note", "event"];
```

Then add per-Notion-Type visuals and both resolvers. `visualForType(type, subtype)`
is the pure primitive (used by `MapMarkerPin`, which only knows type+subtype);
`markerVisual(marker)` is the convenience wrapper for callers holding a full marker:

```typescript
// Per-Notion-"Type" visuals for event markers. Keys match the Session Timeline
// "Type" select. Falls back to the generic event visual for unknown values.
const EVENT_TYPE_META: Record<string, MarkerTypeMeta> = {
  "Combat Encounter": { label: "Combat Encounter", color: "var(--marker-event)", icon: Swords },
  "RP Encounter": { label: "RP Encounter", color: "var(--marker-event)", icon: MessagesSquare },
  "Character Event": { label: "Character Event", color: "var(--marker-event)", icon: Drama },
  "Story Outline": { label: "Story Outline", color: "var(--marker-event)", icon: ScrollText },
  "Session Notes": { label: "Session Notes", color: "var(--marker-event)", icon: ScrollText },
};

// Core resolver: the icon+color+label for a marker type and optional subtype.
// Event markers vary by the note's Notion Type; every other type uses
// MARKER_TYPE_META unchanged. Pure — safe under renderToStaticMarkup.
export function visualForType(type: MarkerType, subtype?: string | null): MarkerTypeMeta {
  if (type === "event") {
    return (subtype && EVENT_TYPE_META[subtype]) || MARKER_TYPE_META.event;
  }
  return MARKER_TYPE_META[type];
}

// Convenience wrapper for callers holding a full ResolvedMarker.
export function markerVisual(marker: ResolvedMarker): MarkerTypeMeta {
  return visualForType(marker.type, marker.entitySubtype);
}
```

Update the Task 11 test's import line to also pull `visualForType` if you add a
direct test for it (optional — `markerVisual` covers the same paths).

- [ ] **Step 4: Add the `--marker-event` CSS variable**

The `--marker-*` variables live in `app/globals.css`. Add a sibling `--marker-event`
next to `--marker-note` in **every** block where the other marker vars are declared
(there are light and dark theme blocks — grep `--marker-note` in that file to find
each). Use a purple that matches the Notion Character-Event color, e.g.
`--marker-event: #a855f7;`. If the dark block uses different values, pick a
dark-appropriate purple there.

- [ ] **Step 5: Run to confirm pass**

Run: `npx vitest run components/maps/marker-meta.test.ts`
Expected: PASS.

- [ ] **Step 6: Make `MapMarkerPin` accept a `subtype` and use `visualForType`**

`MapMarkerPin.tsx` currently has its own local `MARKER_META` (color+icon only, no
`event`) and receives only `type`. Replace it to use the shared resolver and take
an optional subtype. Rewrite the file to:

```typescript
"use client";

import { cn } from "@/lib/utils";
import type { MapMarker } from "@/lib/db/schema";
import { visualForType } from "@/components/maps/marker-meta";

export function MapMarkerPin({
  type, subtype, selected,
}: { type: MapMarker["type"]; subtype?: string | null; selected?: boolean }) {
  const meta = visualForType(type, subtype);
  const Icon = meta.icon;
  return (
    <div className={cn("relative", selected && "marker-selected marker-bloom")}>
      <svg width="28" height="36" viewBox="0 0 28 36" className="drop-shadow-md">
        <path
          d="M14 0C6.3 0 0 6.3 0 14c0 9.6 14 22 14 22s14-12.4 14-22c0-7.7-6.3-14-14-14z"
          fill={meta.color}
        />
        <circle cx="14" cy="14" r="9" fill="var(--card)" />
      </svg>
      <Icon
        className="absolute w-3.5 h-3.5"
        style={{ color: meta.color, top: "8px", left: "50%", transform: "translateX(-50%)" }}
      />
    </div>
  );
}
```

(`visualForType` returns `MarkerTypeMeta` which has `label` too, but the pin only
reads `icon`/`color` — fine. The old local lucide-icon import is dropped.)

- [ ] **Step 7: Thread `subtype` through the three canvases**

Each canvas renders `<MapMarkerPin type=...>` and now must pass the marker's
`entitySubtype`:

- `components/maps/StaticMapCanvas.tsx` (~line 105):
  `<MapMarkerPin type={m.type} subtype={m.entitySubtype} selected={m.id === selectedId} />`
- `components/maps/TiledMapCanvas.tsx` — change the `markerIcon` helper signature and its call site:
  ```typescript
  function markerIcon(type: ResolvedMarker["type"], subtype: string | null | undefined, selected: boolean) {
    return L.divIcon({
      className: "",
      html: renderToStaticMarkup(<MapMarkerPin type={type} subtype={subtype} selected={selected} />),
      iconSize: [28, 36],
      iconAnchor: [14, 36],
    });
  }
  ```
  Find where `markerIcon(` is called (per-marker `<Marker>` render) and pass `m.entitySubtype` as the middle argument. If icons are memoized by a key, include `subtype` in that key so a Combat and RP pin at the same type don't collide.
- `components/maps/WorldMapCanvas.tsx` (~lines 190 and 219):
  `renderToStaticMarkup(<MapMarkerPin type={marker.type} subtype={marker.entitySubtype} selected={sel} />)`

- [ ] **Step 8: Use `markerVisual` in `MarkerInfoPanel`**

In `components/maps/MarkerInfoPanel.tsx` change `const meta = MARKER_TYPE_META[marker.type]`
to `const meta = markerVisual(marker)` and import `markerVisual` (drop the
`MARKER_TYPE_META` import if now unused). This keeps every existing marker
identical (fallback path) while giving event markers their per-Type icon+label.
(Event markers get the wider `EventNotePanel` in Task 15, but `MarkerInfoPanel`
should still resolve correctly for safety.)

- [ ] **Step 9: Run the pin/panel changes past the type-checker**

Run: `npx tsc --noEmit`
Expected: no errors from the canvases or pin/panel.

- [ ] **Step 10: Commit**

```bash
git add components/maps/marker-meta.ts components/maps/marker-meta.test.ts components/maps/MapMarkerPin.tsx components/maps/StaticMapCanvas.tsx components/maps/TiledMapCanvas.tsx components/maps/WorldMapCanvas.tsx components/maps/MarkerInfoPanel.tsx app/globals.css
git commit -m "feat(maps): per-Notion-Type event pin visuals via visualForType"
```

---

### Task 12: Event layer group in the layer control

**Files:**
- Modify: `components/maps/marker-layers.ts`
- Test: `components/maps/marker-layers.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `components/maps/marker-layers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { layerKeyOf, deriveLayerGroups } from "./marker-layers";
import type { ResolvedMarker } from "./map-types";

const marker = (over: Partial<ResolvedMarker>): ResolvedMarker => ({
  id: Math.random().toString(), mapId: "map", x: 0, y: 0, type: "note", entityId: null,
  targetMapId: null, title: null, note: null, minZoom: null,
  resolvedTitle: "x", resolvedSubtitle: null, ...over,
});

describe("event layers", () => {
  it("keys an event marker on its Notion Type", () => {
    expect(layerKeyOf(marker({ type: "event", entitySubtype: "Combat Encounter" }))).toBe("event:Combat Encounter");
    expect(layerKeyOf(marker({ type: "event", entitySubtype: null }))).toBe("event:other");
  });

  it("groups events with per-Type leaves and counts", () => {
    const groups = deriveLayerGroups([
      marker({ type: "event", entitySubtype: "Combat Encounter" }),
      marker({ type: "event", entitySubtype: "RP Encounter" }),
      marker({ type: "event", entitySubtype: "Combat Encounter" }),
    ]);
    const events = groups.find((g) => g.key === "event")!;
    expect(events.count).toBe(3);
    expect(events.leaves.find((l) => l.key === "event:Combat Encounter")!.count).toBe(2);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run components/maps/marker-layers.test.ts`
Expected: FAIL — events key on bare `event` and have no leaves.

- [ ] **Step 3: Implement event grouping**

In `components/maps/marker-layers.ts`:

Update `layerKeyOf`:
```typescript
export function layerKeyOf(marker: ResolvedMarker): string {
  if (marker.type === "location") return `location:${marker.entitySubtype ?? "other"}`;
  if (marker.type === "event") return `event:${marker.entitySubtype ?? "other"}`;
  return marker.type;
}
```

Add an event ordering table near `LOCATION_SUBTYPE_ORDER`:
```typescript
const EVENT_TYPE_ORDER = ["Combat Encounter", "RP Encounter", "Character Event", "Story Outline", "Session Notes", "other"] as const;
const EVENT_TYPE_LABELS: Record<string, string> = {
  "Combat Encounter": "Combat", "RP Encounter": "RP", "Character Event": "Character",
  "Story Outline": "Story", "Session Notes": "Session", other: "Other",
};
```

Remove `event` from `SIMPLE_GROUPS` handling implicitly (it was never there). In `deriveLayerGroups`, after the location-group block and before the `SIMPLE_GROUPS` loop, add an events group built the same way:

```typescript
  const eventLeaves: LayerLeaf[] = EVENT_TYPE_ORDER.map((et) => ({
    key: `event:${et}`,
    label: EVENT_TYPE_LABELS[et],
    count: counts.get(`event:${et}`) ?? 0,
  })).filter((l) => l.count > 0);
  if (eventLeaves.length > 0) {
    groups.push({
      key: "event",
      label: "Events",
      count: eventLeaves.reduce((s, l) => s + l.count, 0),
      leaves: eventLeaves,
    });
  }
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run components/maps/marker-layers.test.ts`
Expected: PASS. Also run `npx vitest run components/maps` to be sure nothing else broke.

- [ ] **Step 5: Commit**

```bash
git add components/maps/marker-layers.ts components/maps/marker-layers.test.ts
git commit -m "feat(maps): Events layer group with per-Type leaves"
```

---

### Task 13: Place event pins from the marker form

**Files:**
- Modify: `components/maps/MarkerFormDialog.tsx`
- Modify: `components/maps/marker-meta.ts` (already has `event` in `MARKER_TYPES` from Task 11)

- [ ] **Step 1: Add an `event` branch to the form**

In `components/maps/MarkerFormDialog.tsx`, the type grid already renders every `MARKER_TYPES` entry (so `event` now appears). Extend the entity-loading effect and the picker to handle `event` like the character/location/faction case but hitting `/api/sessions`:

In the `useEffect` that loads options, change the first condition:
```typescript
      if (type === "character" || type === "location" || type === "faction" || type === "event") {
        const path =
          type === "character" ? "characters" :
          type === "location" ? "locations" :
          type === "faction" ? "factions" : "sessions";
        const res = await fetch(`/api/${path}?campaignId=${campaignId}`);
        const data = res.ok ? await res.json() : [];
        if (cancelled) return;
        setEntityOptions(Array.isArray(data) ? data : (data.items ?? []));
      } else if (type === "submap") {
```

Update the entity `<select>` render condition and the payload/`canSave` checks to treat `event` alongside the other entity-backed types. The select block:
```typescript
          {(type === "character" || type === "location" || type === "faction" || type === "event") && (
```

In `save()`, the payload `entityId`:
```typescript
        entityId: ["character", "location", "faction", "event"].includes(type) ? entityId || null : null,
```

`canSave`:
```typescript
  const canSave =
    (type === "note" && title.trim().length > 0) ||
    (["character", "location", "faction", "event"].includes(type) && entityId.length > 0) ||
    (type === "submap" && (targetMapId.length > 0 || (uploadFile !== null && uploadName.trim().length > 0)));
```

The `<option value="">Select a {type}…</option>` line already interpolates `type`; for events it will read "Select a event…". Change that one label to be type-aware:
```typescript
              <option value="">Select {type === "event" ? "a session note" : `a ${type}`}…</option>
```

- [ ] **Step 2: Verify**

With the dev server running and notes synced, open a map, click "Add Marker", choose the new **Event** type, confirm the dropdown lists session notes (Cobalt Soul etc.), place one, and confirm the pin appears with the Character-Event icon. Reload and confirm it persists. Check `read_console_messages`.

- [ ] **Step 3: Commit**

```bash
git add components/maps/MarkerFormDialog.tsx
git commit -m "feat(maps): place event markers backed by session notes"
```

---

### Task 14: Date filter for event pins

**Files:**
- Create: `components/maps/event-date-filter.ts`
- Test: `components/maps/event-date-filter.test.ts`
- Modify: `components/maps/MapViewer.tsx`
- Create: `components/maps/EventDateFilter.tsx`

- [ ] **Step 1: Write the failing test for the pure logic**

Create `components/maps/event-date-filter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { eventDatesOf, defaultEventDate, filterByEventDate } from "./event-date-filter";
import type { ResolvedMarker } from "./map-types";

const marker = (over: Partial<ResolvedMarker>): ResolvedMarker => ({
  id: Math.random().toString(), mapId: "map", x: 0, y: 0, type: "event", entityId: "n", targetMapId: null,
  title: null, note: null, minZoom: null, resolvedTitle: "x", resolvedSubtitle: null, ...over,
});

describe("eventDatesOf", () => {
  it("returns distinct sorted event dates, ignoring non-events and undated", () => {
    const dates = eventDatesOf([
      marker({ eventDate: "2026-07-19" }),
      marker({ eventDate: "2026-07-05" }),
      marker({ eventDate: "2026-07-19" }),
      marker({ eventDate: null }),
      marker({ type: "note", eventDate: undefined }),
    ]);
    expect(dates).toEqual(["2026-07-05", "2026-07-19"]);
  });
});

describe("defaultEventDate", () => {
  it("picks the earliest date on or after today", () => {
    expect(defaultEventDate(["2026-07-05", "2026-07-19", "2026-08-01"], "2026-07-14")).toBe("2026-07-19");
  });
  it("falls back to the latest past date when all are in the past", () => {
    expect(defaultEventDate(["2026-06-01", "2026-07-05"], "2026-07-14")).toBe("2026-07-05");
  });
  it("returns null when there are no dates", () => {
    expect(defaultEventDate([], "2026-07-14")).toBeNull();
  });
});

describe("filterByEventDate", () => {
  const markers = [
    marker({ eventDate: "2026-07-19" }),
    marker({ eventDate: "2026-07-05" }),
    marker({ eventDate: null }),
    marker({ type: "location", eventDate: undefined }),
  ];
  it("keeps non-events, undated events, and events on the selected date", () => {
    const kept = filterByEventDate(markers, "2026-07-19");
    expect(kept).toHaveLength(3); // the 07-19 event, the undated event, the location
  });
  it("keeps everything when the date is null (All dates)", () => {
    expect(filterByEventDate(markers, null)).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run components/maps/event-date-filter.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the pure logic**

Create `components/maps/event-date-filter.ts`:

```typescript
import type { ResolvedMarker } from "@/components/maps/map-types";

/** Distinct event dates present among markers, ascending. Ignores non-events and undated events. */
export function eventDatesOf(markers: ResolvedMarker[]): string[] {
  const set = new Set<string>();
  for (const m of markers) {
    if (m.type === "event" && m.eventDate) set.add(m.eventDate);
  }
  return [...set].sort();
}

/**
 * Default selected date: the earliest date on or after `today` (the next
 * upcoming session). If every date is in the past, the latest past date. Null
 * if there are no dates. `dates` is assumed ascending (from eventDatesOf).
 */
export function defaultEventDate(dates: string[], today: string): string | null {
  if (dates.length === 0) return null;
  const upcoming = dates.find((d) => d >= today);
  return upcoming ?? dates[dates.length - 1];
}

/**
 * Keep a marker when: it isn't an event; OR the date filter is off (null); OR
 * the event has no date (can't be filtered by a field it lacks); OR the event's
 * date equals the selected date.
 */
export function filterByEventDate(markers: ResolvedMarker[], selected: string | null): ResolvedMarker[] {
  if (selected === null) return markers;
  return markers.filter((m) => m.type !== "event" || !m.eventDate || m.eventDate === selected);
}

/** Today as an ISO date string in the viewer's local timezone. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run components/maps/event-date-filter.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the date-filter UI control**

Create `components/maps/EventDateFilter.tsx`:

```typescript
"use client";

import React from "react";
import { CalendarDays } from "lucide-react";

interface EventDateFilterProps {
  dates: string[];              // ascending, from eventDatesOf
  selected: string | null;      // null = All dates
  onChange: (date: string | null) => void;
}

// Compact selector shown only when a map has dated event pins. "All dates"
// clears the filter; each option is a session date.
export function EventDateFilter({ dates, selected, onChange }: EventDateFilterProps) {
  if (dates.length === 0) return null;
  return (
    <label className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs">
      <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
      <select
        aria-label="Filter events by session date"
        value={selected ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="bg-transparent focus:outline-none"
      >
        <option value="">All dates</option>
        {dates.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 6: Wire the filter into `MapViewer`**

In `components/maps/MapViewer.tsx`:

Imports:
```typescript
import { EventDateFilter } from "@/components/maps/EventDateFilter";
import { eventDatesOf, defaultEventDate, filterByEventDate, todayISO } from "@/components/maps/event-date-filter";
```

Add state seeded from the markers once loaded. Because `markers` load async, seed the selected date the React-recommended way (adjust-on-change during render, like the `hidden`/`hiddenLoadedFor` pattern already in the file):

```typescript
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dateSeededFor, setDateSeededFor] = useState<string>("");
  const eventDates = eventDatesOf(markers);
  const dateSignature = eventDates.join(",");
  if (dateSignature && dateSignature !== dateSeededFor) {
    setDateSeededFor(dateSignature);
    setSelectedDate(defaultEventDate(eventDates, todayISO()));
  }
```

Apply the date filter alongside the layer filter in `sharedCanvasProps.markers`:
```typescript
    markers: filterByEventDate(markers.filter((m) => isMarkerVisible(m, hidden)), selectedDate),
```

Render the control in the header toolbar, before `<MarkerLayerControl ...>`:
```typescript
          <EventDateFilter dates={eventDates} selected={selectedDate} onChange={setSelectedDate} />
```

- [ ] **Step 7: Verify**

With the dev server running, on a map with events across two dates, confirm the date selector shows both dates, defaults to the next upcoming one, and that switching to "All dates" reveals past-dated pins. Confirm undated event pins always show. Check console for errors.

- [ ] **Step 8: Commit**

```bash
git add components/maps/event-date-filter.ts components/maps/event-date-filter.test.ts components/maps/EventDateFilter.tsx components/maps/MapViewer.tsx
git commit -m "feat(maps): date filter for event pins, default to next session"
```

---

### Task 15: `EventNotePanel` — read the full note from a pin

**Files:**
- Create: `components/maps/EventNotePanel.tsx`
- Modify: `components/maps/MapViewer.tsx`

- [ ] **Step 1: Build the panel**

Create `components/maps/EventNotePanel.tsx`. It fetches the note detail + Notion body lazily on open, rendering `NotionBlocks` inline:

```typescript
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { X, Loader2, ExternalLink } from "lucide-react";
import { markerVisual } from "@/components/maps/marker-meta";
import { NotionBlocks } from "@/components/glossary/NotionBlocks";
import type { ResolvedMarker } from "@/components/maps/map-types";
import type { NotionBlockData } from "@/lib/notion/client";

interface NoteDetail {
  id: string;
  name: string;
  notionUrl: string | null;
  linkedLocations: { id: string; name: string }[];
  notionProps: { label: string; value: string }[];
}

interface EventNotePanelProps {
  marker: ResolvedMarker; // type === "event"
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

// Wide side panel for an event pin: properties, linked settings, and the full
// Notion page body rendered inline (fetched on open). Distinct from the compact
// MarkerInfoPanel used by every other marker type.
export function EventNotePanel({ marker, onClose, onEdit, onDelete }: EventNotePanelProps) {
  const meta = markerVisual(marker);
  const Icon = meta.icon;
  const [detail, setDetail] = useState<NoteDetail | null>(null);
  const [blocks, setBlocks] = useState<NotionBlockData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!marker.entityId) { setLoading(false); setError("Session note not found."); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setBlocks(null);
      try {
        const res = await fetch(`/api/sessions/${marker.entityId}`);
        if (!res.ok) { if (!cancelled) setError("Session note not found."); return; }
        const d: NoteDetail = await res.json();
        if (cancelled) return;
        setDetail(d);
        if (d.notionUrl) {
          const pageRes = await fetch(`/api/notion/page?url=${encodeURIComponent(d.notionUrl)}`);
          const pageData = await pageRes.json();
          if (cancelled) return;
          if (pageRes.ok) setBlocks(pageData.blocks);
          else setError(pageData.error ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [marker.entityId]);

  return (
    <div className="panel-in absolute top-4 left-4 bottom-4 w-96 max-w-[calc(100%-2rem)] flex flex-col rounded-xl border border-border bg-card shadow-2xl z-[1000]">
      <div className="flex items-start justify-between gap-2 p-3.5 border-b border-border flex-none">
        <div className="flex items-start gap-2.5 min-w-0">
          <Icon className="w-4 h-4 mt-1 flex-none" style={{ color: meta.color }} aria-hidden />
          <div className="min-w-0">
            <div className="font-display text-lg leading-tight">{marker.resolvedTitle}</div>
            <div className="mt-0.5 text-xs font-medium" style={{ color: meta.color }}>{meta.label}</div>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="flex-none text-muted-foreground hover:text-foreground">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {marker.resolvedSubtitle && <p className="text-xs text-destructive">{marker.resolvedSubtitle}</p>}
        {detail?.linkedLocations && detail.linkedLocations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {detail.linkedLocations.map((l) => (
              <Link key={l.id} href={`/locations/${l.id}`} className="rounded-full border border-border px-2 py-0.5 text-xs hover:border-muted-foreground/40">
                {l.name}
              </Link>
            ))}
          </div>
        )}
        {loading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        {error && <p className="text-sm text-muted-foreground">{error}</p>}
        {blocks && <NotionBlocks blocks={blocks} />}
      </div>

      <div className="flex items-center gap-3 border-t border-border p-3 text-xs flex-none">
        <Link href={`/sessions/${marker.entityId}`} className="font-medium text-primary hover:underline">Open page →</Link>
        {detail?.notionUrl && (
          <a href={detail.notionUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            Notion <ExternalLink className="w-3 h-3" />
          </a>
        )}
        <button onClick={onEdit} className="text-muted-foreground hover:text-foreground">Edit</button>
        <button onClick={onDelete} className="ml-auto text-destructive hover:underline">Delete</button>
      </div>
    </div>
  );
}
```

Confirm the `NotionBlocks` prop name against `components/glossary/NotionBlocks.tsx` and adjust if it isn't `blocks`.

- [ ] **Step 2: Route event pins to the new panel in `MapViewer`**

In `components/maps/MapViewer.tsx`, import the panel:
```typescript
import { EventNotePanel } from "@/components/maps/EventNotePanel";
```

Replace the single `{selectedMarker && (<MarkerInfoPanel .../>)}` block with a type switch:
```tsx
        {selectedMarker && selectedMarker.type === "event" && (
          <EventNotePanel
            key={selectedMarker.id}
            marker={selectedMarker}
            onClose={() => setSelectedId(null)}
            onEdit={() => { setEditingMarker(selectedMarker); setSelectedId(null); }}
            onDelete={async () => {
              await fetch(`/api/maps/markers/${selectedMarker.id}`, { method: "DELETE" });
              setSelectedId(null);
              loadMarkers();
            }}
          />
        )}
        {selectedMarker && selectedMarker.type !== "event" && (
          <MarkerInfoPanel
            key={selectedMarker.id}
            marker={selectedMarker}
            onClose={() => setSelectedId(null)}
            onEdit={() => { setEditingMarker(selectedMarker); setSelectedId(null); }}
            onDelete={async () => {
              await fetch(`/api/maps/markers/${selectedMarker.id}`, { method: "DELETE" });
              setSelectedId(null);
              loadMarkers();
            }}
          />
        )}
```

- [ ] **Step 3: Verify**

With the dev server running, click an event pin and confirm the wide panel opens with the note's properties, setting chips, and the full rendered Notion body, plus working "Open page" / "Notion" links. Click a non-event pin and confirm the original compact panel still appears. Check console.

- [ ] **Step 4: Commit**

```bash
git add components/maps/EventNotePanel.tsx components/maps/MapViewer.tsx
git commit -m "feat(maps): EventNotePanel renders full session note from a pin"
```

---

### Task 16: Unpinned-notes tray

**Files:**
- Create: `app/api/sessions/unpinned/route.ts`
- Create: `components/maps/UnpinnedNotesTray.tsx`
- Modify: `components/maps/MapViewer.tsx`

- [ ] **Step 1: Build the unpinned-notes API**

Create `app/api/sessions/unpinned/route.ts` — returns campaign session notes for a given date that have no `event` marker on any map:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessionNotes, mapMarkers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  const date = searchParams.get("date"); // optional; when present, filter to it
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  const conditions = [eq(sessionNotes.campaignId, campaignId), eq(sessionNotes.archived, false)];
  if (date) conditions.push(eq(sessionNotes.date, date));
  const notes = await db.query.sessionNotes.findMany({ where: and(...conditions) });

  const pinned = await db.query.mapMarkers.findMany({ where: eq(mapMarkers.type, "event") });
  const pinnedIds = new Set(pinned.map((m) => m.entityId).filter(Boolean));

  const unpinned = notes
    .filter((n) => !pinnedIds.has(n.id))
    .map((n) => ({ id: n.id, name: n.name, noteType: n.noteType, date: n.date }));

  return NextResponse.json({ items: unpinned });
}
```

- [ ] **Step 2: Build the tray component**

Create `components/maps/UnpinnedNotesTray.tsx`:

```typescript
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { MapPinOff, ChevronUp, ChevronDown } from "lucide-react";

interface UnpinnedNote {
  id: string;
  name: string;
  noteType: string | null;
}

interface UnpinnedNotesTrayProps {
  campaignId: string;
  date: string | null;       // selected session date; null = all dates
  reloadKey: number;         // bump to refetch after a pin is placed
  onPick: (noteId: string) => void;
}

// Collapsible strip listing session notes for the selected date that aren't
// pinned to any map yet. Clicking one hands its id up to start placement.
export function UnpinnedNotesTray({ campaignId, date, reloadKey, onPick }: UnpinnedNotesTrayProps) {
  const [notes, setNotes] = useState<UnpinnedNote[]>([]);
  const [open, setOpen] = useState(true);

  const load = useCallback(() => {
    if (!campaignId) return;
    const q = new URLSearchParams({ campaignId });
    if (date) q.set("date", date);
    fetch(`/api/sessions/unpinned?${q.toString()}`)
      .then((r) => r.json())
      .then((data) => setNotes(data.items ?? []));
  }, [campaignId, date]);

  useEffect(() => { load(); }, [load, reloadKey]);

  if (notes.length === 0) return null;

  return (
    <div className="absolute bottom-4 right-4 w-64 rounded-xl border border-border bg-card shadow-2xl z-[900]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold"
      >
        <MapPinOff className="w-3.5 h-3.5 text-muted-foreground" />
        Unplaced {date ? "this session" : "notes"} ({notes.length})
        {open ? <ChevronDown className="w-3.5 h-3.5 ml-auto" /> : <ChevronUp className="w-3.5 h-3.5 ml-auto" />}
      </button>
      {open && (
        <ul className="max-h-48 overflow-y-auto border-t border-border p-1.5 space-y-1">
          {notes.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => onPick(n.id)}
                className="w-full text-left rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
              >
                <span className="font-medium">{n.name}</span>
                {n.noteType && <span className="block text-[11px] text-muted-foreground">{n.noteType}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire the tray into `MapViewer` with click-to-place**

In `components/maps/MapViewer.tsx`:

Import:
```typescript
import { UnpinnedNotesTray } from "@/components/maps/UnpinnedNotesTray";
```

Add state for the pending note being placed and a reload key:
```typescript
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null);
  const [trayReloadKey, setTrayReloadKey] = useState(0);
```

When a tray note is picked, arm add-mode so the next canvas click places it:
```typescript
  function pickUnpinnedNote(noteId: string) {
    setPendingNoteId(noteId);
    setAddMode(true);
    setMoveMode(false);
  }
```

In `handleCanvasClick`, if a note is armed, POST an event marker directly instead of opening the form:
```typescript
  function handleCanvasClick(pos: { x: number; y: number }) {
    if (pendingNoteId) {
      const noteId = pendingNoteId;
      setPendingNoteId(null);
      setAddMode(false);
      fetch(`/api/maps/${id}/markers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: pos.x, y: pos.y, type: "event", entityId: noteId }),
      }).then(() => {
        loadMarkers();
        setTrayReloadKey((k) => k + 1);
      });
      return;
    }
    setPendingPosition(pos);
    setAddMode(false);
  }
```

Render the tray inside the map container (near the other absolutely-positioned overlays), only when a campaign is active:
```tsx
        {activeCampaignId && (
          <UnpinnedNotesTray
            campaignId={activeCampaignId}
            date={selectedDate}
            reloadKey={trayReloadKey}
            onPick={pickUnpinnedNote}
          />
        )}
```

Also bump `trayReloadKey` in the existing form `onSaved` and in the event-pin delete handler so the tray reflects placements/removals:
```typescript
          onSaved={() => {
            setPendingPosition(null);
            setEditingMarker(null);
            loadMarkers();
            setTrayReloadKey((k) => k + 1);
          }}
```

- [ ] **Step 4: Verify**

With the dev server running: place none of this session's notes, open the map, confirm the tray lists them; click one, then click the map, and confirm a pin drops and the tray entry disappears. Switch the date filter and confirm the tray tracks the selected date. Check console/network.

- [ ] **Step 5: Commit**

```bash
git add app/api/sessions/unpinned/route.ts components/maps/UnpinnedNotesTray.tsx components/maps/MapViewer.tsx
git commit -m "feat(maps): unpinned-notes tray with click-to-place"
```

---

## Phase 4 — Verification & polish

### Task 17: Full-suite + end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: PASS — all suites green, including the new `map.test.ts`, `props.test.ts`, `repos.test.ts`, `sync.test.ts`, `marker-meta.test.ts`, `marker-layers.test.ts`, `event-date-filter.test.ts`.

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint .`
Expected: no errors. Fix any that surface (common ones: a missed `eventDate: null` in a `resolveMarkerLabel` return, or an unused import).

- [ ] **Step 3: End-to-end drive in the running app**

With the dev server running and the Session Timeline synced, walk the whole feature and confirm each works, capturing a screenshot of the map with event pins as proof:
1. Settings → Session Timeline field syncs; summary shows created counts + any setting warnings.
2. `/sessions` lists notes grouped by Type; a detail page renders the Notion body.
3. `/locations/<rexxentrum>` shows "Events here".
4. On a city map: add an Event marker; pin shows the per-Type icon; the date filter defaults to the next session and hides other dates; clicking the pin opens the full note; the unpinned tray places a note by click.

- [ ] **Step 4: Update the campaign-hub memory note**

The project memory (`project-campaign-hub-expansion.md`) tracks sub-projects. Append a line noting sub-project #15 (Notion session-notes sync + map pinning) landed on this branch. (This is a memory-file edit, not a repo commit.)

- [ ] **Step 5: Final commit if any fixes were made**

```bash
git add -A
git commit -m "chore: session-notes verification fixes"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** every spec section maps to a task — data model (T1), mapper/date (T2), location linking (T3), sync wiring (T4), settings source (T5), sessions API (T6), browse (T7), detail + nav (T8), Events-here (T9), event marker + resolution (T10), per-Type visuals (T11), layer group (T12), placement (T13), date filter (T14), note panel (T15), unpinned tray (T16), verification (T17).
- **Type consistency:** `mapSessionNoteRow` writes `extra: { noteType, status, date, arc }` (T2) matching the `session_notes` columns (T1); `resolveMarkerLabel` sets `entitySubtype = noteType` and `eventDate = date` (T10), which `markerVisual` (T11), `layerKeyOf` (T12), and `filterByEventDate` (T14) consume. `linkSessionNoteLocationsByName` returns unmatched names (T3) that `sync.ts` turns into warnings (T4).
- **Verified while planning:** `NotionBlocks` takes a `blocks` prop; `--marker-*` variables live in `app/globals.css`; `MapMarkerPin` receives `type` (now also `subtype`) and is rendered by `StaticMapCanvas`, `TiledMapCanvas`, and `WorldMapCanvas`. No open confirmations remain.
