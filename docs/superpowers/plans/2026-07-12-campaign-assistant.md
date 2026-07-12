# Campaign Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an agentic, Claude-powered chat assistant over the campaign hub's unified data — it answers questions across entities/relationships/Notion/maps and proposes four write actions (encounters, entities, markers, Notion sync), each confirmed before it hits the existing hub routes.

**Architecture:** A server-only Next.js route (`/api/assistant`) runs the Anthropic SDK Tool Runner with `claude-opus-4-8`, streaming over SSE. Read tools query SQLite directly (campaign-scoped). Write tools return *proposal* objects — they never mutate; the browser renders a confirm card and, on confirm, replays the proposal payload to the existing validated hub routes. The Anthropic key lives in the `settings` table, never reaching the client. Entry point is the existing ⌘K palette, which hands a typed question to a slide-over chat panel.

**Tech Stack:** Next.js 16 (App Router, custom fork), TypeScript, Drizzle + better-sqlite3, `@anthropic-ai/sdk` (Tool Runner beta, Zod tools), Zustand (`lib/store/ui-store.ts`), Radix/shadcn UI, vitest.

**Read before coding:** This repo runs a **custom Next.js fork** — read the relevant guide in `node_modules/next/dist/docs/` before writing route/streaming code (per AGENTS.md). Spec: `docs/superpowers/specs/2026-07-12-campaign-assistant-design.md`.

**Shared conventions:**
- DB type used throughout: `import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"` and `import type * as schema from "@/lib/db/schema"` → `type AppDb = BetterSQLite3Database<typeof schema>`. Both the singleton `db` from `@/lib/db` and the test harness `createTestDb()` produce this exact type.
- Tests use the existing harness `createTestDb()` from `lib/notion/test-helpers.ts`, which returns `{ db, campaignId }` on a fresh migrated temp SQLite file. Run all tests with `npm test`.
- IDs via `generateId()` from `@/lib/utils`; timestamps are JS `Date` objects for `mode: "timestamp"` columns.

---

### Task 1: Install the Anthropic SDK and wire the API key into settings

**Files:**
- Modify: `package.json` (add dependency)
- Modify: `app/api/settings/route.ts:6-7` (allow + mask `anthropic_api_key`)

- [ ] **Step 1: Install the SDK**

Run: `npm install @anthropic-ai/sdk`
Expected: `@anthropic-ai/sdk` appears under `dependencies` in `package.json`; exits 0.

- [ ] **Step 2: Allow and mask the key in the settings route**

In `app/api/settings/route.ts`, update the two constants near the top:

```typescript
const ALLOWED_KEYS = ["campaign_name", "default_roll_advantage", "ddb_share_urls", "notion_token", "anthropic_api_key"];
const MASKED_KEYS = new Set(["ddb_cobalt_token", "notion_token", "anthropic_api_key"]);
```

- [ ] **Step 3: Verify it builds and the key round-trips masked**

Run: `npm run build`
Expected: build succeeds.

Then manually (dev server): `PUT /api/settings` with `{"anthropic_api_key":"sk-test"}` then `GET /api/settings` returns `anthropic_api_key: "configured"` (masked), not the raw value.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json app/api/settings/route.ts
git commit -m "feat: add anthropic sdk dep + anthropic_api_key setting (masked)"
```

---

### Task 2: Read tools — entity search, list, get, relationships

**Files:**
- Create: `lib/assistant/read-tools.ts`
- Test: `lib/assistant/read-tools.test.ts`

These are pure functions `(db, campaignId, input) => data`. They power the agent's read tools and are unit-testable with `createTestDb()`.

- [ ] **Step 1: Write the failing tests**

Create `lib/assistant/read-tools.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/notion/test-helpers";
import { characters, factions, characterFactions } from "@/lib/db/schema";
import { searchEntities, listEntities, getEntity, getRelationships } from "./read-tools";

function seedChar(db: ReturnType<typeof createTestDb>["db"], campaignId: string, over: Partial<typeof characters.$inferInsert> & { id: string; name: string }) {
  const now = new Date();
  db.insert(characters).values({
    campaignId, type: "npc", createdAt: now, updatedAt: now, ...over,
  }).run();
}

describe("searchEntities", () => {
  it("matches by name across kinds, scoped to campaign, excludes archived", () => {
    const { db, campaignId } = createTestDb();
    seedChar(db, campaignId, { id: "c1", name: "Lord Verin" });
    seedChar(db, campaignId, { id: "c2", name: "Sela", archived: true });
    db.insert(factions).values({ id: "f1", campaignId, name: "Clovis Concord", createdAt: new Date(), updatedAt: new Date() }).run();

    const hits = searchEntities(db, campaignId, { query: "verin" });
    expect(hits.map((h) => h.id)).toEqual(["c1"]);
    expect(hits[0]).toMatchObject({ kind: "character", name: "Lord Verin" });

    expect(searchEntities(db, campaignId, { query: "concord" })[0]).toMatchObject({ kind: "faction", id: "f1" });
    expect(searchEntities(db, campaignId, { query: "sela" })).toEqual([]); // archived excluded
    expect(searchEntities(db, "other-campaign", { query: "verin" })).toEqual([]); // scoped
  });
});

describe("listEntities", () => {
  it("lists a kind filtered by type, excluding archived", () => {
    const { db, campaignId } = createTestDb();
    seedChar(db, campaignId, { id: "c1", name: "Fjord", type: "pc" });
    seedChar(db, campaignId, { id: "c2", name: "Guard", type: "npc" });

    const pcs = listEntities(db, campaignId, { kind: "character", type: "pc" });
    expect(pcs.map((e) => e.id)).toEqual(["c1"]);
  });
});

describe("getEntity + getRelationships", () => {
  it("returns full record and reverse faction membership", () => {
    const { db, campaignId } = createTestDb();
    seedChar(db, campaignId, { id: "c1", name: "Fjord", description: "A half-orc warlock" });
    db.insert(factions).values({ id: "f1", campaignId, name: "Concord", createdAt: new Date(), updatedAt: new Date() }).run();
    db.insert(characterFactions).values({ characterId: "c1", factionId: "f1" }).run();

    const ent = getEntity(db, campaignId, { kind: "character", id: "c1" });
    expect(ent).toMatchObject({ name: "Fjord", description: "A half-orc warlock" });

    const rels = getRelationships(db, campaignId, { kind: "faction", id: "f1" });
    expect(rels.characters.map((c) => c.id)).toEqual(["c1"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- read-tools`
Expected: FAIL — `Cannot find module './read-tools'`.

- [ ] **Step 3: Implement `lib/assistant/read-tools.ts`**

```typescript
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, like } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { characters, locations, items, factions, characterFactions, characterLocations, characterItems } from "@/lib/db/schema";

export type AppDb = BetterSQLite3Database<typeof schema>;
export type EntityKind = "character" | "location" | "item" | "faction";

const TABLES = { character: characters, location: locations, item: items, faction: factions } as const;

export interface EntityHit { kind: EntityKind; id: string; name: string; type: string | null }

export function searchEntities(db: AppDb, campaignId: string, input: { query: string }): EntityHit[] {
  const q = `%${input.query.trim().toLowerCase()}%`;
  const out: EntityHit[] = [];
  for (const kind of Object.keys(TABLES) as EntityKind[]) {
    const t = TABLES[kind];
    const rows = db.select().from(t).where(and(eq(t.campaignId, campaignId), eq(t.archived, false), like(t.name, q))).all();
    for (const r of rows) out.push({ kind, id: r.id, name: r.name, type: "type" in r ? (r.type as string) : null });
  }
  return out;
}

export function listEntities(db: AppDb, campaignId: string, input: { kind: EntityKind; type?: string }): EntityHit[] {
  const t = TABLES[input.kind];
  const rows = db.select().from(t).where(and(eq(t.campaignId, campaignId), eq(t.archived, false))).all();
  return rows
    .filter((r) => !input.type || ("type" in r && r.type === input.type))
    .map((r) => ({ kind: input.kind, id: r.id, name: r.name, type: "type" in r ? (r.type as string) : null }));
}

export function getEntity(db: AppDb, campaignId: string, input: { kind: EntityKind; id: string }) {
  const t = TABLES[input.kind];
  const row = db.select().from(t).where(and(eq(t.campaignId, campaignId), eq(t.id, input.id))).get();
  if (!row) return null;
  const { notionProps, ...rest } = row as Record<string, unknown>;
  return { ...rest, notionProps: notionProps ? JSON.parse(notionProps as string) : null };
}

export function getRelationships(db: AppDb, campaignId: string, input: { kind: EntityKind; id: string }) {
  // Reverse lookups via the join tables. Faction/location/item -> member characters.
  const linkedCharIds = (() => {
    if (input.kind === "faction") return db.select().from(characterFactions).where(eq(characterFactions.factionId, input.id)).all().map((r) => r.characterId);
    if (input.kind === "location") return db.select().from(characterLocations).where(eq(characterLocations.locationId, input.id)).all().map((r) => r.characterId);
    if (input.kind === "item") return db.select().from(characterItems).where(eq(characterItems.itemId, input.id)).all().map((r) => r.characterId);
    return [];
  })();
  const chars = linkedCharIds
    .map((cid) => db.select().from(characters).where(and(eq(characters.campaignId, campaignId), eq(characters.id, cid))).get())
    .filter((c): c is NonNullable<typeof c> => Boolean(c) && !c!.archived)
    .map((c) => ({ id: c.id, name: c.name, type: c.type }));
  return { characters: chars };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- read-tools`
Expected: PASS (3 files/blocks green).

- [ ] **Step 5: Commit**

```bash
git add lib/assistant/read-tools.ts lib/assistant/read-tools.test.ts
git commit -m "feat: campaign-scoped entity read tools (search/list/get/relationships)"
```

---

### Task 3: Read tools — monsters and map context

**Files:**
- Modify: `lib/assistant/read-tools.ts`
- Modify: `lib/assistant/read-tools.test.ts`

- [ ] **Step 1: Write the failing tests (append)**

Append to `lib/assistant/read-tools.test.ts`:

```typescript
import { monsterCache, maps, mapMarkers } from "@/lib/db/schema";
import { listMonsters, getMapContext } from "./read-tools";

describe("listMonsters", () => {
  it("matches cached monsters by name (global cache, not campaign-scoped)", () => {
    const { db } = createTestDb();
    db.insert(monsterCache).values({ slug: "goblin", name: "Goblin", data: JSON.stringify({ challenge_rating: "1/4" }), cachedAt: new Date() }).run();
    const hits = listMonsters(db, { query: "gob" });
    expect(hits[0]).toMatchObject({ slug: "goblin", name: "Goblin", cr: "1/4" });
  });
});

describe("getMapContext", () => {
  it("returns markers for a campaign's map", () => {
    const { db, campaignId } = createTestDb();
    db.insert(maps).values({ id: "m1", campaignId, name: "World", imagePath: "x", renderMode: "world", createdAt: new Date(), updatedAt: new Date() }).run();
    db.insert(mapMarkers).values({ id: "mk1", mapId: "m1", x: 1, y: 2, type: "location", title: "Nicodranas", createdAt: new Date(), updatedAt: new Date() }).run();
    const ctx = getMapContext(db, campaignId, { mapId: "m1" });
    expect(ctx.map?.name).toBe("World");
    expect(ctx.markers.map((mk) => mk.title)).toEqual(["Nicodranas"]);
  });

  it("returns null map for another campaign's map id (scoped)", () => {
    const { db, campaignId } = createTestDb();
    db.insert(maps).values({ id: "m1", campaignId, name: "World", imagePath: "x", createdAt: new Date(), updatedAt: new Date() }).run();
    expect(getMapContext(db, "other", { mapId: "m1" }).map).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- read-tools`
Expected: FAIL — `listMonsters`/`getMapContext` not exported.

- [ ] **Step 3: Implement (append to `lib/assistant/read-tools.ts`)**

```typescript
import { monsterCache, maps, mapMarkers } from "@/lib/db/schema";

export function listMonsters(db: AppDb, input: { query: string }) {
  const q = `%${input.query.trim().toLowerCase()}%`;
  return db.select().from(monsterCache).where(like(monsterCache.name, q)).all().map((r) => {
    let cr: string | null = null;
    try { cr = (JSON.parse(r.data) as { challenge_rating?: string }).challenge_rating ?? null; } catch { /* ignore */ }
    return { slug: r.slug, name: r.name, cr };
  });
}

export function getMapContext(db: AppDb, campaignId: string, input: { mapId: string }) {
  const map = db.select().from(maps).where(and(eq(maps.campaignId, campaignId), eq(maps.id, input.mapId))).get() ?? null;
  if (!map) return { map: null, markers: [] as { id: string; type: string; title: string | null; entityId: string | null }[] };
  const markers = db.select().from(mapMarkers).where(eq(mapMarkers.mapId, map.id)).all()
    .map((m) => ({ id: m.id, type: m.type, title: m.title, entityId: m.entityId }));
  return { map: { id: map.id, name: map.name, renderMode: map.renderMode }, markers };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- read-tools`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/assistant/read-tools.ts lib/assistant/read-tools.test.ts
git commit -m "feat: monster + map-context read tools"
```

---

### Task 4: Proposal builders + hub-authored-field guard

**Files:**
- Create: `lib/assistant/proposals.ts`
- Test: `lib/assistant/proposals.test.ts`

A proposal is `{ summary, targetRoute, method, payload }`. Builders never touch the DB. `assertHubAuthored` is the structural guard that keeps Notion-synced columns out of entity writes.

- [ ] **Step 1: Write the failing tests**

Create `lib/assistant/proposals.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildEncounterProposal, buildEntityProposal, buildMarkerProposal, buildNotionSyncProposal, assertHubAuthored } from "./proposals";

describe("assertHubAuthored", () => {
  it("rejects Notion-synced fields", () => {
    expect(() => assertHubAuthored("location", { name: "X", type: "city" })).toThrow(/not hub-authored: type/);
    expect(() => assertHubAuthored("item", { description: "shiny" })).toThrow(/not hub-authored: description/);
  });
  it("allows hub-authored fields", () => {
    expect(() => assertHubAuthored("character", { name: "Sela", description: "a spy" })).not.toThrow();
  });
});

describe("buildEncounterProposal", () => {
  it("targets the encounters route with combatants", () => {
    const p = buildEncounterProposal("camp1", { name: "Ashkeep Ambush", combatants: [{ name: "Goblin", type: "monster", hpMax: 7, ac: 15 }] });
    expect(p).toMatchObject({ targetRoute: "/api/encounters", method: "POST" });
    expect(p.payload).toMatchObject({ campaignId: "camp1", name: "Ashkeep Ambush" });
    expect(p.payload.combatants).toHaveLength(1);
    expect(p.summary).toContain("Ashkeep Ambush");
  });
});

describe("buildEntityProposal", () => {
  it("create -> POST /api/{kind}s with campaignId", () => {
    const p = buildEntityProposal("camp1", { kind: "character", fields: { name: "Sela Vord", description: "Concord spy" } });
    expect(p).toMatchObject({ targetRoute: "/api/characters", method: "POST" });
    expect(p.payload).toMatchObject({ campaignId: "camp1", name: "Sela Vord" });
  });
  it("update -> PATCH /api/{kind}s/{id}", () => {
    const p = buildEntityProposal("camp1", { kind: "faction", id: "f1", fields: { description: "updated" } });
    expect(p).toMatchObject({ targetRoute: "/api/factions/f1", method: "PATCH" });
  });
  it("throws when fields include a synced column", () => {
    expect(() => buildEntityProposal("camp1", { kind: "location", fields: { name: "X", type: "poi" } })).toThrow(/not hub-authored/);
  });
});

describe("buildMarkerProposal + buildNotionSyncProposal", () => {
  it("marker -> POST /api/maps/{mapId}/markers", () => {
    const p = buildMarkerProposal({ mapId: "m1", x: 1, y: 2, type: "location", title: "Hideout" });
    expect(p).toMatchObject({ targetRoute: "/api/maps/m1/markers", method: "POST" });
    expect(p.payload).toMatchObject({ x: 1, y: 2, type: "location" });
  });
  it("sync -> POST /api/notion/sync", () => {
    const p = buildNotionSyncProposal("camp1");
    expect(p).toMatchObject({ targetRoute: "/api/notion/sync", method: "POST", payload: { campaignId: "camp1" } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- proposals`
Expected: FAIL — `Cannot find module './proposals'`.

- [ ] **Step 3: Implement `lib/assistant/proposals.ts`**

```typescript
import type { EntityKind } from "./read-tools";

export interface Proposal {
  summary: string;
  targetRoute: string;
  method: "POST" | "PATCH";
  payload: Record<string, unknown>;
}

// Only these fields may be written per entity kind. Notion-synced columns
// (type on locations, description on items, notionProps, etc.) are deliberately absent.
const HUB_AUTHORED: Record<EntityKind, string[]> = {
  character: ["name", "description", "notionUrl"], // NOT `type`/`ddbCharacterId` — both Notion-sync-managed (mapCharacterRow writes them); new NPCs default to `npc` in the POST route
  location: ["name", "description", "notionUrl"], // NOT `type` — world-derived, drives map layering
  item: ["name", "notionUrl"],                    // NOT `description` — synced from Notion
  faction: ["name", "description", "notionUrl"],
};

export function assertHubAuthored(kind: EntityKind, fields: Record<string, unknown>): void {
  const allowed = HUB_AUTHORED[kind];
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key)) throw new Error(`Field not hub-authored: ${key} (kind: ${kind})`);
  }
}

export function buildEncounterProposal(campaignId: string, input: { name: string; notes?: string; combatants?: Array<Record<string, unknown>> }): Proposal {
  const combatants = input.combatants ?? [];
  return {
    summary: `Create encounter "${input.name}" with ${combatants.length} combatant(s).`,
    targetRoute: "/api/encounters",
    method: "POST",
    payload: { campaignId, name: input.name, notes: input.notes ?? null, combatants },
  };
}

export function buildEntityProposal(campaignId: string, input: { kind: EntityKind; id?: string; fields: Record<string, unknown> }): Proposal {
  assertHubAuthored(input.kind, input.fields);
  const base = `/api/${input.kind}s`;
  if (input.id) {
    return { summary: `Update ${input.kind} ${input.id}: ${Object.keys(input.fields).join(", ")}.`, targetRoute: `${base}/${input.id}`, method: "PATCH", payload: { ...input.fields } };
  }
  return { summary: `Create ${input.kind} "${String(input.fields.name ?? "?")}".`, targetRoute: base, method: "POST", payload: { campaignId, ...input.fields } };
}

export function buildMarkerProposal(input: { mapId: string; x: number; y: number; type: string; title?: string; entityId?: string; note?: string }): Proposal {
  const { mapId, ...payload } = input;
  return { summary: `Place a ${input.type} marker${input.title ? ` "${input.title}"` : ""} on map ${mapId}.`, targetRoute: `/api/maps/${mapId}/markers`, method: "POST", payload };
}

export function buildNotionSyncProposal(campaignId: string): Proposal {
  return { summary: "Run a Notion → hub sync for this campaign.", targetRoute: "/api/notion/sync", method: "POST", payload: { campaignId } };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- proposals`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/assistant/proposals.ts lib/assistant/proposals.test.ts
git commit -m "feat: proposal builders + hub-authored-field guard"
```

---

### Task 5: Tool definitions (Zod tools wiring reads + proposals)

**Files:**
- Create: `lib/assistant/tools.ts`
- Test: `lib/assistant/tools.test.ts`

Read tools run their query and return JSON. Write ("propose_*") tools run the builder and return the proposal — so the *agent* sees the proposal as the tool result and describes it, while the browser gets the structured proposal to render as a confirm card.

- [ ] **Step 1: Write the failing test**

Create `lib/assistant/tools.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/notion/test-helpers";
import { buildTools } from "./tools";

describe("buildTools", () => {
  it("exposes the read + propose tool set bound to a campaign", () => {
    const { db, campaignId } = createTestDb();
    const tools = buildTools(db, campaignId);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "get_entity", "get_map_context", "get_relationships",
      "list_entities", "list_monsters",
      "propose_encounter", "propose_entity", "propose_marker", "propose_notion_sync",
      "search_entities",
    ]);
  });

  it("propose_notion_sync returns a proposal object, does not mutate", async () => {
    const { db, campaignId } = createTestDb();
    const tools = buildTools(db, campaignId);
    const tool = tools.find((t) => t.name === "propose_notion_sync")!;
    const result = await tool.run({}, {} as never);
    expect(JSON.parse(result as string)).toMatchObject({ proposal: { targetRoute: "/api/notion/sync" } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tools`
Expected: FAIL — `Cannot find module './tools'`.

- [ ] **Step 3: Implement `lib/assistant/tools.ts`**

```typescript
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { AppDb, EntityKind } from "./read-tools";
import { searchEntities, listEntities, getEntity, getRelationships, listMonsters, getMapContext } from "./read-tools";
import { buildEncounterProposal, buildEntityProposal, buildMarkerProposal, buildNotionSyncProposal } from "./proposals";

const kindEnum = z.enum(["character", "location", "item", "faction"]);
const j = (v: unknown) => JSON.stringify(v);

export function buildTools(db: AppDb, campaignId: string) {
  return [
    betaZodTool({
      name: "search_entities",
      description: "Search characters, locations, items, and factions by name. Call this whenever the user names a person, place, thing, or group so you can resolve it to an id before answering.",
      inputSchema: z.object({ query: z.string() }),
      run: async ({ query }) => j(searchEntities(db, campaignId, { query })),
    }),
    betaZodTool({
      name: "list_entities",
      description: "List all entities of one kind for the campaign, optionally filtered by type. Use for 'list all X' questions.",
      inputSchema: z.object({ kind: kindEnum, type: z.string().optional() }),
      run: async ({ kind, type }) => j(listEntities(db, campaignId, { kind: kind as EntityKind, type })),
    }),
    betaZodTool({
      name: "get_entity",
      description: "Get the full record for one entity by kind + id, including description and Notion properties. Call after search_entities to answer detail questions.",
      inputSchema: z.object({ kind: kindEnum, id: z.string() }),
      run: async ({ kind, id }) => j(getEntity(db, campaignId, { kind: kind as EntityKind, id })),
    }),
    betaZodTool({
      name: "get_relationships",
      description: "Reverse relationship lookup: which characters belong to a faction, are in a location, or hold an item.",
      inputSchema: z.object({ kind: kindEnum, id: z.string() }),
      run: async ({ kind, id }) => j(getRelationships(db, campaignId, { kind: kind as EntityKind, id })),
    }),
    betaZodTool({
      name: "list_monsters",
      description: "Search the cached monster library by name for encounter building. Returns slug, name, and challenge rating.",
      inputSchema: z.object({ query: z.string() }),
      run: async ({ query }) => j(listMonsters(db, { query })),
    }),
    betaZodTool({
      name: "get_map_context",
      description: "Get a map's markers and linked entities by map id. Use when the user asks about what is on a map or wants to place a marker.",
      inputSchema: z.object({ mapId: z.string() }),
      run: async ({ mapId }) => j(getMapContext(db, campaignId, { mapId })),
    }),
    betaZodTool({
      name: "propose_encounter",
      description: "Propose creating a combat encounter with combatants. Does NOT create it — returns a proposal the user must confirm. Use monster stats from list_monsters where possible.",
      inputSchema: z.object({
        name: z.string(),
        notes: z.string().optional(),
        combatants: z.array(z.object({ name: z.string(), type: z.enum(["pc", "npc", "monster"]), hpMax: z.number().optional(), ac: z.number().optional(), initiativeBonus: z.number().optional(), monsterSlug: z.string().optional() })).optional(),
      }),
      run: async (input) => j({ proposal: buildEncounterProposal(campaignId, input) }),
    }),
    betaZodTool({
      name: "propose_entity",
      description: "Propose creating (omit id) or updating (include id) a character/location/item/faction. Only hub-authored fields are accepted; Notion-synced fields are rejected. Returns a proposal to confirm.",
      inputSchema: z.object({ kind: kindEnum, id: z.string().optional(), fields: z.record(z.string(), z.unknown()) }),
      run: async ({ kind, id, fields }) => j({ proposal: buildEntityProposal(campaignId, { kind: kind as EntityKind, id, fields: fields as Record<string, unknown> }) }),
    }),
    betaZodTool({
      name: "propose_marker",
      description: "Propose placing a marker on a map. Returns a proposal to confirm. Get the mapId from get_map_context first.",
      inputSchema: z.object({ mapId: z.string(), x: z.number(), y: z.number(), type: z.enum(["location", "faction", "character", "submap", "note"]), title: z.string().optional(), entityId: z.string().optional(), note: z.string().optional() }),
      run: async (input) => j({ proposal: buildMarkerProposal(input) }),
    }),
    betaZodTool({
      name: "propose_notion_sync",
      description: "Propose running a Notion → hub sync for this campaign. Returns a proposal to confirm.",
      inputSchema: z.object({}),
      run: async () => j({ proposal: buildNotionSyncProposal(campaignId) }),
    }),
  ];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tools`
Expected: PASS. (If `betaZodTool`'s run signature differs in the installed SDK version, check `node_modules/@anthropic-ai/sdk/helpers/beta/zod` for the exact `run` arity and adjust the test's `tool.run(...)` call accordingly — the tool `name` assertions are the load-bearing part.)

- [ ] **Step 5: Commit**

```bash
git add lib/assistant/tools.ts lib/assistant/tools.test.ts
git commit -m "feat: assistant tool definitions (read + propose)"
```

---

### Task 6: Agent orchestration + SSE route

**Files:**
- Create: `lib/assistant/agent.ts`
- Create: `app/api/assistant/route.ts`

**Read first:** the streaming/route guide in `node_modules/next/dist/docs/` (custom fork).

- [ ] **Step 1: Implement the agent runner `lib/assistant/agent.ts`**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { AppDb } from "./read-tools";
import { buildTools } from "./tools";

export interface AssistantEvent {
  type: "text" | "proposal" | "done" | "error";
  text?: string;
  proposal?: unknown;
  message?: string;
}

const SYSTEM = `You are the Dungeon Master's assistant for a D&D campaign hub.
Answer questions about the campaign by calling the read tools; resolve names with search_entities before answering.
To take an action (build an encounter, create/edit an entity, place a marker, run a Notion sync), call the matching propose_* tool. Proposals are NOT applied until the DM confirms in the UI — after proposing, briefly tell the DM what you proposed and that it needs confirmation. Never claim you have created or changed anything yourself.
Be concise and grounded: only state facts you retrieved via tools.`;

/** Runs the agent loop, invoking onEvent for each streamed text chunk and each proposal. */
export async function runAssistant(
  opts: { apiKey: string; db: AppDb; campaignId: string; messages: Anthropic.Beta.BetaMessageParam[] },
  onEvent: (e: AssistantEvent) => void,
): Promise<void> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const tools = buildTools(opts.db, opts.campaignId);

  const runner = client.beta.messages.toolRunner({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    max_iterations: 12,
    output_config: { effort: "high" },
    system: SYSTEM,
    tools,
    messages: opts.messages,
  });

  for await (const message of runner) {
    for (const block of message.content) {
      if (block.type === "text" && block.text) onEvent({ type: "text", text: block.text });
    }
    // Surface any proposal a tool produced this turn by reading its tool_result content.
    // The tool run() returns JSON; the runner will have appended tool_result blocks — but
    // the simplest source of truth is to re-derive from tool_use inputs is unreliable, so
    // instead we inspect the runner's appended messages below.
  }

  // After the loop, scan the full transcript for proposals emitted as tool results.
  for (const m of runner.messages) {
    if (m.role !== "user" || typeof m.content === "string") continue;
    for (const block of m.content) {
      if (block.type === "tool_result") {
        const raw = Array.isArray(block.content) ? block.content.map((c) => (c.type === "text" ? c.text : "")).join("") : "";
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.proposal) onEvent({ type: "proposal", proposal: parsed.proposal });
        } catch { /* not a proposal */ }
      }
    }
  }

  onEvent({ type: "done" });
}
```

Note: `runner.messages` exposes the accumulated transcript after iteration; if the installed SDK names it differently, check `node_modules/@anthropic-ai/sdk/helpers/beta/*` for the tool-runner's message accessor and adjust.

- [ ] **Step 2: Implement the SSE route `app/api/assistant/route.ts`**

```typescript
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runAssistant, type AssistantEvent } from "@/lib/assistant/agent";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { campaignId?: string; messages?: unknown };
  const campaignId = body.campaignId;
  const messages = body.messages;
  if (!campaignId || !Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: "campaignId and messages required" }), { status: 400, headers: { "content-type": "application/json" } });
  }

  const keyRow = await db.query.settings.findFirst({ where: eq(settings.key, "anthropic_api_key") });
  if (!keyRow?.value) {
    return new Response(JSON.stringify({ error: "Add an Anthropic API key in Settings first" }), { status: 400, headers: { "content-type": "application/json" } });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AssistantEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await runAssistant({ apiKey: keyRow.value, db, campaignId, messages: messages as never }, send);
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Assistant failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
}
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: build succeeds (route + agent typecheck clean).

- [ ] **Step 4: Smoke-test the route (real key required)**

Set a key: `PUT /api/settings` with `{"anthropic_api_key":"<your real key>"}`.
Then: `curl -N -X POST localhost:3000/api/assistant -H 'content-type: application/json' -d '{"campaignId":"<real campaign id>","messages":[{"role":"user","content":"List all factions"}]}'`
Expected: `data: {"type":"text",...}` chunks stream in, ending with `data: {"type":"done"}`. With no key set, a 400 JSON body instead.

- [ ] **Step 5: Commit**

```bash
git add lib/assistant/agent.ts app/api/assistant/route.ts
git commit -m "feat: assistant agent runner + SSE route"
```

---

### Task 7: Settings — Assistant config panel

**Files:**
- Create: `components/settings/AssistantPanel.tsx`
- Modify: the settings page that renders `NotionSyncPanel` (find with the command below) to also render `<AssistantPanel />`

- [ ] **Step 1: Locate the settings page**

Run: `grep -rn "NotionSyncPanel" app/`
Expected: one page file (e.g. `app/settings/page.tsx`). Note its path and how it imports/renders panels — mirror that for `AssistantPanel`.

- [ ] **Step 2: Implement `components/settings/AssistantPanel.tsx`**

Mirror `NotionSyncPanel`'s load/save pattern (cancellation-guarded load effect per the repo's `set-state-in-effect` rule). Full component:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function AssistantPanel() {
  const [configured, setConfigured] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s: Record<string, string>) => { if (!cancelled) setConfigured(s.anthropic_api_key === "configured"); })
      .catch(() => { if (!cancelled) setConfigured(false); });
    return () => { cancelled = true; };
  }, []);

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ anthropic_api_key: value }) });
      setConfigured(Boolean(value));
      setValue("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Assistant</h2>
        <p className="text-sm text-muted-foreground">
          Anthropic API key for the campaign assistant. {configured ? "Configured ✓" : "Not configured."}
        </p>
      </div>
      <div className="flex gap-2">
        <Input type="password" placeholder="sk-ant-..." value={value} onChange={(e) => setValue(e.target.value)} />
        <Button onClick={save} disabled={saving || !value}>{saving ? "Saving..." : "Save"}</Button>
      </div>
    </section>
  );
}
```

If `@/components/ui/button` doesn't exist, check `components/ui/` for the button primitive's actual name (Step 1's page will show the import style) and use that.

- [ ] **Step 3: Render it on the settings page**

Add `import { AssistantPanel } from "@/components/settings/AssistantPanel";` and place `<AssistantPanel />` next to `<NotionSyncPanel />` in the page located in Step 1.

- [ ] **Step 4: Browser-verify**

Start the dev server (preview tool). Navigate to `/settings`. Confirm the Assistant panel renders, shows "Not configured," accepts a key, saves, and reloads to "Configured ✓". Check the console for errors.

- [ ] **Step 5: Commit**

```bash
git add components/settings/AssistantPanel.tsx app/settings/page.tsx
git commit -m "feat: Assistant settings panel (API key config)"
```

---

### Task 8: Chat panel store state + component

**Files:**
- Modify: `lib/store/ui-store.ts`
- Create: `components/assistant/ChatPanel.tsx`
- Modify: `app/layout.tsx` (mount `<ChatPanel />` beside `<CommandPalette />`)

- [ ] **Step 1: Add assistant state to the UI store**

Read `lib/store/ui-store.ts` first to match its exact shape. Add these fields to the store interface and initial state:

```typescript
// in the store's state type:
assistantOpen: boolean;
assistantPending: string | null; // a question queued from ⌘K, consumed by ChatPanel on open
setAssistantOpen: (open: boolean) => void;
openAssistantWith: (question: string) => void;
```

```typescript
// in the create(...) body, alongside the existing setters:
assistantOpen: false,
assistantPending: null,
setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
openAssistantWith: (question) => set({ assistantOpen: true, assistantPending: question }),
```

- [ ] **Step 2: Implement `components/assistant/ChatPanel.tsx`**

A right-side slide-over that streams from `/api/assistant`, renders messages + proposal confirm cards. Full component:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useUIStore } from "@/lib/store/ui-store";
import { useCampaignStore } from "@/lib/store/campaign-store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface ChatMessage { role: "user" | "assistant"; content: string }
interface Proposal { summary: string; targetRoute: string; method: "POST" | "PATCH"; payload: Record<string, unknown> }

export function ChatPanel() {
  const open = useUIStore((s) => s.assistantOpen);
  const setOpen = useUIStore((s) => s.setAssistantOpen);
  const pending = useUIStore((s) => s.assistantPending);
  const { activeCampaignId } = useCampaignStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const consumed = useRef<string | null>(null);

  async function ask(question: string) {
    if (!question.trim() || !activeCampaignId) return;
    const nextMsgs: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages([...nextMsgs, { role: "assistant", content: "" }]);
    setProposals([]);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: activeCampaignId, messages: nextMsgs.map((m) => ({ role: m.role, content: m.content })) }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Assistant failed" }));
        setMessages((m) => { const copy = [...m]; copy[copy.length - 1] = { role: "assistant", content: err.error ?? "Assistant failed" }; return copy; });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let assistantText = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line) continue;
          const evt = JSON.parse(line) as { type: string; text?: string; proposal?: Proposal; message?: string };
          if (evt.type === "text" && evt.text) {
            assistantText += evt.text;
            setMessages((m) => { const copy = [...m]; copy[copy.length - 1] = { role: "assistant", content: assistantText }; return copy; });
          } else if (evt.type === "proposal" && evt.proposal) {
            setProposals((p) => [...p, evt.proposal!]);
          } else if (evt.type === "error") {
            assistantText += `\n\n⚠️ ${evt.message ?? "error"}`;
            setMessages((m) => { const copy = [...m]; copy[copy.length - 1] = { role: "assistant", content: assistantText }; return copy; });
          }
        }
      }
    } finally {
      setBusy(false);
    }
  }

  // Consume a question queued from ⌘K exactly once.
  useEffect(() => {
    if (open && pending && consumed.current !== pending) {
      consumed.current = pending;
      void ask(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending]);

  async function confirm(p: Proposal) {
    setProposals((list) => list.filter((x) => x !== p));
    const res = await fetch(p.targetRoute, { method: p.method, headers: { "content-type": "application/json" }, body: JSON.stringify(p.payload) });
    const ok = res.ok;
    setMessages((m) => [...m, { role: "assistant", content: ok ? `✓ Done: ${p.summary}` : `⚠️ Failed: ${p.summary} (${res.status})` }]);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="font-semibold">Assistant</span>
        <button onClick={() => setOpen(false)} aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <div className={`inline-block whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{m.content || (busy ? "…" : "")}</div>
          </div>
        ))}
        {proposals.map((p, i) => (
          <div key={`p${i}`} className="rounded-lg border border-border p-3 text-sm">
            <p className="mb-2">{p.summary}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => confirm(p)}>Confirm</Button>
              <Button size="sm" variant="ghost" onClick={() => setProposals((list) => list.filter((x) => x !== p))}>Dismiss</Button>
            </div>
          </div>
        ))}
      </div>
      <form className="flex gap-2 border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); const q = input; setInput(""); void ask(q); }}>
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your campaign…" disabled={busy} />
        <Button type="submit" disabled={busy || !input.trim()}>Send</Button>
      </form>
    </div>
  );
}
```

Adjust `Button`'s `size`/`variant` props to match the repo's button primitive (check `components/ui/`). If there's no `variant="ghost"`, use whatever secondary style exists.

- [ ] **Step 3: Mount it in `app/layout.tsx`**

Next to the existing `<CommandPalette />` (line ~51), add:

```tsx
import { ChatPanel } from "@/components/assistant/ChatPanel";
// ...
<CommandPalette />
<ChatPanel />
```

- [ ] **Step 4: Browser-verify**

Dev server. Set `useUIStore.getState().setAssistantOpen(true)` via the console (or wait for Task 9's ⌘K wiring). Confirm the panel slides in from the right, the current page stays visible behind it, and closing works. With a real key + campaign, type a read question and confirm streaming text appears. Check console for errors.

- [ ] **Step 5: Commit**

```bash
git add lib/store/ui-store.ts components/assistant/ChatPanel.tsx app/layout.tsx
git commit -m "feat: slide-over assistant chat panel with proposal confirm cards"
```

---

### Task 9: ⌘K "Ask the assistant" action

**Files:**
- Modify: `components/shell/CommandPalette.tsx`

- [ ] **Step 1: Wire an Ask action into the palette**

In `CommandPalette.tsx`: import `openAssistantWith` from the UI store and add an always-present "Ask" row at the bottom of results that fires when clicked or when the user presses ⌘Enter. Add near the other store selectors:

```tsx
const openAssistantWith = useUIStore((s) => s.openAssistantWith);
```

Add the ask handler:

```tsx
function ask() {
  const q = query.trim();
  if (!q) return;
  setOpen(false);
  openAssistantWith(q);
}
```

Add a ⌘Enter handler on the input (alongside the existing `onChange`):

```tsx
onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); ask(); } }}
```

And render an Ask row beneath the results list (only when there's text):

```tsx
{query.trim() && (
  <button onClick={ask} className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm hover:bg-muted">
    <span className="text-muted-foreground">Ask the assistant:</span>
    <span className="truncate">“{query.trim()}”</span>
    <span className="ml-auto text-xs text-muted-foreground">⌘↵</span>
  </button>
)}
```

- [ ] **Step 2: Browser-verify the full read path**

Dev server, real key + active campaign. Press ⌘K, type "list all factions", press ⌘Enter. Expected: palette closes, chat panel opens, the question streams an answer. Also verify clicking the Ask row works. Confirm a location literally named like a question still appears as a navigation result above the Ask row.

- [ ] **Step 3: Browser-verify one full write round-trip per type**

With the chat panel, exercise each proposal→confirm→verify:
1. "Build a goblin ambush encounter called Ashkeep Ambush with 4 goblins" → a proposal card appears → Confirm → check `/encounters` shows it.
2. "Add an NPC named Sela Vord with description 'a Concord spy'" → confirm → check `/characters`.
3. "Place a note marker titled 'Hideout' on the world map" (agent calls get_map_context then propose_marker) → confirm → check `/world`.
4. "Sync my latest Notion changes" → confirm → sync runs (or returns the existing route's clean error if Notion isn't configured).

Also verify a rejection path: ask it to "change the type of <a world location> to city" — the agent's `propose_entity` call should error (hub-authored guard), surfaced as an in-conversation message, not a crash.

- [ ] **Step 4: Commit**

```bash
git add components/shell/CommandPalette.tsx
git commit -m "feat: ⌘K 'Ask the assistant' action opens the chat panel"
```

---

## Final verification

- [ ] Run the full suite: `npm test` — all green.
- [ ] Run `npm run build` — clean.
- [ ] Run `npm run lint` — no new errors in `lib/assistant/`, `components/assistant/`, `components/settings/AssistantPanel.tsx`, `components/shell/CommandPalette.tsx`. (Note: a pre-existing stale worktree may inject unrelated lint errors — confirm any errors are outside the files this plan touched.)
- [ ] Manual smoke: the four write round-trips above each succeed, and the hub-authored guard rejects a synced-field edit.

---

## Notes for the implementer

- **SDK surface drift:** the Tool Runner is a beta helper. If `betaZodTool`, `client.beta.messages.toolRunner`, or `runner.messages` don't match the installed `@anthropic-ai/sdk` version, check `node_modules/@anthropic-ai/sdk/helpers/beta/` and `.../resources/beta/messages/` for the exact names — the plan's structure holds; only the accessor names may shift.
- **No `level` column:** `characters` has no level field (`type` is only `pc|npc`). "Level 5+" style filters aren't a direct column query — the agent leans on `description`/`notionProps`. Don't add a level filter to `list_entities`.
- **Single transaction boundary:** never have a proposal write directly to the DB. All writes go through the existing routes so their validation, FK handling, and sync-field guards apply unchanged.
- **Encounters route accepts combatants:** Task 4 extended `POST /api/encounters` to insert an optional `body.combatants[]` in the same handler (backward-compatible), so the single-call encounter proposal actually creates the combatants it promises. The Task 9 smoke test verifies this end-to-end.
- **Character `type`/`ddbCharacterId` are sync-managed:** the review of Task 4 corrected the plan — these were removed from the character allowlist. New assistant-created NPCs default to `npc` via the characters POST route; PC typing and D&D Beyond links come from their proper flows, not the assistant.
- **Custom Next.js fork:** read `node_modules/next/dist/docs/` before the route (Task 6) and layout (Task 8) changes.
