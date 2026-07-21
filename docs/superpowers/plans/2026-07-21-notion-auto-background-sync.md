# Notion Auto Background Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing Notion campaign sync automatically in the background on a configurable interval, while keeping the manual "Sync now" button.

**Architecture:** Extract the sync orchestration currently inline in the manual API route into a reusable `runCampaignSync()` function. A server-side self-rescheduling `setTimeout` loop (started once from `instrumentation.ts`) reads config from the `settings` table each tick and runs `runCampaignSync()` for every campaign that has Notion sources. An in-process lock shared between the manual route and the scheduler prevents concurrent syncs of the same campaign.

**Tech Stack:** Next.js 16 (App Router, standalone server), TypeScript, better-sqlite3 + drizzle-orm, vitest.

---

## Background for the implementer

Read the design spec first: `docs/superpowers/specs/2026-07-21-notion-auto-background-sync-design.md`.

Key facts about this codebase:
- **Tests:** `npm test` runs `vitest run`. Test files live next to source (e.g. `lib/notion/sync.test.ts`) and use `createTestDb()` from `lib/notion/test-helpers.ts`, which returns `{ db, campaignId }` backed by a fresh migrated SQLite file.
- **DB access:** the singleton `db` is exported from `lib/db/index.ts`. It's a drizzle `BetterSQLite3Database` created with the full schema, so both `db.query.<table>.findFirst(...)` and `db.select().from(<table>)` work. The test db from `createTestDb()` has the same shape.
- **Settings storage:** a key/value table `settings` (`lib/db/schema.ts`). Values are strings. Read via `db.query.settings.findFirst({ where: eq(settings.key, "...") })`.
- **`syncCampaign()`** in `lib/notion/sync.ts` already takes an injected `queryRows` function and returns a `SyncSummary`. It already guards against mass-archival when Notion returns zero rows. Do not modify its behavior.
- Path alias `@/` maps to the repo root.
- Do NOT add new DB columns — this feature stores config as two new `settings` keys, so no migration is needed.

Type used throughout this plan for a drizzle db handle:

```typescript
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
type SyncDb = BetterSQLite3Database<typeof schema>;
```

---

## Task 1: In-process sync lock

Prevents the manual route and the background scheduler from syncing the same campaign at the same time. Both run in the same Node process, so a module-level `Set` is sufficient.

**Files:**
- Create: `lib/notion/sync-lock.ts`
- Test: `lib/notion/sync-lock.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/notion/sync-lock.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { tryAcquireSync, releaseSync, isSyncing } from "./sync-lock";

describe("sync-lock", () => {
  beforeEach(() => {
    // Ensure a clean lock state between tests.
    releaseSync("c1");
    releaseSync("c2");
  });

  it("acquires a free campaign and reports it as syncing", () => {
    expect(tryAcquireSync("c1")).toBe(true);
    expect(isSyncing("c1")).toBe(true);
  });

  it("refuses a second acquire until released", () => {
    expect(tryAcquireSync("c1")).toBe(true);
    expect(tryAcquireSync("c1")).toBe(false);
    releaseSync("c1");
    expect(tryAcquireSync("c1")).toBe(true);
  });

  it("tracks campaigns independently", () => {
    expect(tryAcquireSync("c1")).toBe(true);
    expect(tryAcquireSync("c2")).toBe(true);
    expect(isSyncing("c1")).toBe(true);
    expect(isSyncing("c2")).toBe(true);
  });

  it("releasing a non-held campaign is a no-op", () => {
    expect(() => releaseSync("never-held")).not.toThrow();
    expect(isSyncing("never-held")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- sync-lock`
Expected: FAIL — cannot resolve `./sync-lock`.

- [ ] **Step 3: Write the implementation**

Create `lib/notion/sync-lock.ts`:

```typescript
/**
 * In-process lock guarding against concurrent syncs of the same campaign.
 * The manual API route and the background scheduler both run inside the single
 * standalone Node server process, so a module-level Set is sufficient — no DB
 * or cross-process lock is needed.
 */
const inFlight = new Set<string>();

/** Returns true if the lock was acquired, false if the campaign is already syncing. */
export function tryAcquireSync(campaignId: string): boolean {
  if (inFlight.has(campaignId)) return false;
  inFlight.add(campaignId);
  return true;
}

/** Releases the lock for a campaign. Safe to call even if not held. */
export function releaseSync(campaignId: string): void {
  inFlight.delete(campaignId);
}

/** Whether a sync is currently running for this campaign. */
export function isSyncing(campaignId: string): boolean {
  return inFlight.has(campaignId);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- sync-lock`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/notion/sync-lock.ts lib/notion/sync-lock.test.ts
git commit -m "feat(notion): in-process sync lock"
```

---

## Task 2: Extract the shared sync core (`runCampaignSync`)

Move the orchestration currently inline in `app/api/notion/sync/route.ts` (load token → load sources → resolve data-source ids → `syncCampaign()` → write back `lastSyncedAt`/`lastStatus`) into a reusable function the route and scheduler both call. Also add a helper to list campaigns that have sources.

**Files:**
- Create: `lib/notion/run-sync.ts`
- Test: `lib/notion/run-sync.test.ts`
- (Route is refactored to use this in Task 3.)

- [ ] **Step 1: Write the failing test**

Create `lib/notion/run-sync.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-helpers";
import {
  runCampaignSync,
  listCampaignsWithSources,
  NotionTokenMissingError,
  NoNotionSourcesError,
} from "./run-sync";
import { notionSources, settings, characters } from "@/lib/db/schema";
import type { NotionRow } from "./client";

function seedToken(db: ReturnType<typeof createTestDb>["db"]) {
  db.insert(settings).values({ key: "notion_token", value: "tok_test" }).run();
}

function seedSource(
  db: ReturnType<typeof createTestDb>["db"],
  campaignId: string,
  entityType: "characters",
  dataSourceId: string | null,
) {
  db.insert(notionSources)
    .values({ campaignId, entityType, databaseUrl: "https://www.notion.so/deadbeefdeadbeefdeadbeefdeadbeef", dataSourceId })
    .run();
}

const chrRow = (id: string, name: string): NotionRow => ({
  id,
  url: `https://www.notion.so/${id}`,
  properties: { Name: { type: "title", title: [{ plain_text: name }] }, Type: { type: "select", select: { name: "Player" } } },
});

describe("runCampaignSync", () => {
  it("throws NotionTokenMissingError when no token is configured", async () => {
    const { db, campaignId } = createTestDb();
    seedSource(db, campaignId, "characters", "ds1");
    await expect(runCampaignSync(campaignId, { db })).rejects.toBeInstanceOf(NotionTokenMissingError);
  });

  it("throws NoNotionSourcesError when the campaign has no sources", async () => {
    const { db, campaignId } = createTestDb();
    seedToken(db);
    await expect(runCampaignSync(campaignId, { db })).rejects.toBeInstanceOf(NoNotionSourcesError);
  });

  it("syncs rows, resolves+caches dataSourceId, and writes back lastSyncedAt/lastStatus", async () => {
    const { db, campaignId } = createTestDb();
    seedToken(db);
    seedSource(db, campaignId, "characters", null); // force a resolve

    const summary = await runCampaignSync(campaignId, {
      db,
      notion: {
        resolveDataSourceId: async () => "resolved-ds",
        queryDataSource: async () => [chrRow("chr1", "Shale")],
      },
    });

    expect(summary.characters.created).toBe(1);

    const src = db.select().from(notionSources).where(eq(notionSources.campaignId, campaignId)).get()!;
    expect(src.dataSourceId).toBe("resolved-ds"); // cached
    expect(src.lastSyncedAt).toBeTruthy();
    expect(JSON.parse(src.lastStatus!).created).toBe(1);

    expect(db.select().from(characters).where(eq(characters.campaignId, campaignId)).get()!.name).toBe("Shale");
  });

  it("records a friendly resolve error without throwing", async () => {
    const { db, campaignId } = createTestDb();
    seedToken(db);
    seedSource(db, campaignId, "characters", null);

    const summary = await runCampaignSync(campaignId, {
      db,
      notion: {
        resolveDataSourceId: async () => { throw new Error("Could not find data source"); },
        queryDataSource: async () => [],
      },
    });

    expect(summary.characters.error).toMatch(/isn't shared/i);
  });
});

describe("listCampaignsWithSources", () => {
  it("returns distinct campaign ids that have sources", async () => {
    const { db, campaignId } = createTestDb();
    seedSource(db, campaignId, "characters", "ds1");
    const ids = await listCampaignsWithSources(db);
    expect(ids).toEqual([campaignId]);
  });

  it("returns an empty array when no sources exist", async () => {
    const { db } = createTestDb();
    expect(await listCampaignsWithSources(db)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- run-sync`
Expected: FAIL — cannot resolve `./run-sync`.

- [ ] **Step 3: Write the implementation**

Create `lib/notion/run-sync.ts`. This lifts the logic from `app/api/notion/sync/route.ts` verbatim, parameterized by `db` and the Notion API functions so it can be tested without network access.

```typescript
import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import { db as defaultDb } from "@/lib/db";
import { notionSources, settings } from "@/lib/db/schema";
import {
  resolveDataSourceId as defaultResolveDataSourceId,
  queryDataSource as defaultQueryDataSource,
  extractNotionDatabaseId,
  type NotionRow,
} from "./client";
import { syncCampaign, type SourceConfig, type SyncSummary } from "./sync";

type SyncDb = BetterSQLite3Database<typeof schema>;

/** No Notion integration token configured in settings. */
export class NotionTokenMissingError extends Error {
  constructor() {
    super("Add a Notion integration token in Settings first");
    this.name = "NotionTokenMissingError";
  }
}

/** The campaign has no Notion databases configured. */
export class NoNotionSourcesError extends Error {
  constructor() {
    super("No Notion databases configured for this campaign");
    this.name = "NoNotionSourcesError";
  }
}

/** Injectable Notion network calls (real implementations used by default). */
export interface NotionApi {
  resolveDataSourceId: (dbId: string, token: string) => Promise<string>;
  queryDataSource: (dataSourceId: string, token: string) => Promise<NotionRow[]>;
}

export interface RunCampaignSyncOpts {
  db?: SyncDb;
  notion?: NotionApi;
}

function friendlyNotionError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "Sync failed";
  return /could not find|restricted|unauthorized|not shared/i.test(msg)
    ? "This database isn't shared with the integration (or doesn't exist)"
    : msg;
}

/**
 * Runs a full sync for one campaign: loads the token + configured sources,
 * resolves (and caches) each data-source id, runs syncCampaign, and writes back
 * lastSyncedAt / lastStatus per source. Shared by the manual API route and the
 * background scheduler so both behave identically.
 *
 * Throws NotionTokenMissingError / NoNotionSourcesError for the two
 * configuration failures; per-source resolve/query failures are captured in the
 * returned summary instead of throwing.
 */
export async function runCampaignSync(campaignId: string, opts: RunCampaignSyncOpts = {}): Promise<SyncSummary> {
  const db = opts.db ?? (defaultDb as unknown as SyncDb);
  const notion: NotionApi = opts.notion ?? {
    resolveDataSourceId: defaultResolveDataSourceId,
    queryDataSource: defaultQueryDataSource,
  };

  const tokenRow = await db.query.settings.findFirst({ where: eq(settings.key, "notion_token") });
  if (!tokenRow?.value) throw new NotionTokenMissingError();
  const token = tokenRow.value;

  const rows = await db.select().from(notionSources).where(eq(notionSources.campaignId, campaignId));
  if (rows.length === 0) throw new NoNotionSourcesError();

  const config: SourceConfig[] = [];
  const resolveErrors: Record<string, string> = {};
  for (const row of rows) {
    try {
      const dbId = extractNotionDatabaseId(row.databaseUrl);
      if (!dbId) throw new Error("Invalid database URL");
      const dataSourceId = row.dataSourceId ?? (await notion.resolveDataSourceId(dbId, token));
      if (dataSourceId !== row.dataSourceId) {
        await db.update(notionSources).set({ dataSourceId })
          .where(and(eq(notionSources.campaignId, campaignId), eq(notionSources.entityType, row.entityType)));
      }
      config.push({ entityType: row.entityType, dataSourceId });
    } catch (err) {
      resolveErrors[row.entityType] = friendlyNotionError(err);
    }
  }

  const summary = await syncCampaign({
    db: db as never,
    campaignId,
    sources: config,
    queryRows: (dataSourceId) => notion.queryDataSource(dataSourceId, token),
  });

  for (const [type, error] of Object.entries(resolveErrors)) {
    (summary as Record<string, { error?: string }>)[type].error = error;
  }

  const now = new Date();
  for (const row of rows) {
    await db.update(notionSources)
      .set({ lastSyncedAt: now, lastStatus: JSON.stringify(summary[row.entityType]) })
      .where(and(eq(notionSources.campaignId, campaignId), eq(notionSources.entityType, row.entityType)));
  }

  return summary;
}

/** Distinct campaign ids that have at least one Notion source configured. */
export async function listCampaignsWithSources(db: SyncDb = defaultDb as unknown as SyncDb): Promise<string[]> {
  const rows = await db.selectDistinct({ campaignId: notionSources.campaignId }).from(notionSources);
  return rows.map((r) => r.campaignId);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- run-sync`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/notion/run-sync.ts lib/notion/run-sync.test.ts
git commit -m "feat(notion): extract reusable runCampaignSync + listCampaignsWithSources"
```

---

## Task 3: Refactor the manual route to use the shared core + lock

Replace the inline orchestration in the route with a call to `runCampaignSync`, wrapped in the sync lock. On lock contention return HTTP 409 so the UI can say "already syncing". Map the two config errors to HTTP 400.

**Files:**
- Modify: `app/api/notion/sync/route.ts` (full rewrite of the file)

- [ ] **Step 1: Rewrite the route**

Replace the entire contents of `app/api/notion/sync/route.ts` with:

```typescript
import { NextResponse } from "next/server";
import {
  runCampaignSync,
  NotionTokenMissingError,
  NoNotionSourcesError,
} from "@/lib/notion/run-sync";
import { tryAcquireSync, releaseSync } from "@/lib/notion/sync-lock";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { campaignId?: string };
  const campaignId = body.campaignId;
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  if (!tryAcquireSync(campaignId)) {
    return NextResponse.json({ error: "A sync is already running for this campaign" }, { status: 409 });
  }
  try {
    const summary = await runCampaignSync(campaignId);
    return NextResponse.json({ summary });
  } catch (err) {
    if (err instanceof NotionTokenMissingError || err instanceof NoNotionSourcesError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  } finally {
    releaseSync(campaignId);
  }
}
```

- [ ] **Step 2: Verify existing behavior is preserved**

Run the full Notion test suite plus a typecheck:

Run: `npm test -- notion` then `npx tsc --noEmit`
Expected: all Notion tests PASS; no type errors.

- [ ] **Step 3: Manually confirm the route still returns `{ summary }`**

Read `app/api/notion/sync/route.ts` and confirm the success response shape is `{ summary }` (unchanged) and the error paths return `{ error }` — matching what `NotionSyncPanel.syncNow()` already reads (`data.summary`, `data.error`).

- [ ] **Step 4: Commit**

```bash
git add app/api/notion/sync/route.ts
git commit -m "refactor(notion): manual sync route uses runCampaignSync + lock"
```

---

## Task 4: Auto-sync config reader + tick logic

The testable core of the scheduler: read the enabled/interval config from settings (with defaults), and run one tick that syncs every campaign with sources, respecting the lock. Timer wiring comes in Task 5.

**Files:**
- Create: `lib/notion/scheduler.ts`
- Test: `lib/notion/scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/notion/scheduler.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./test-helpers";
import { readAutoSyncConfig, runAutoSyncTick } from "./scheduler";
import { settings } from "@/lib/db/schema";
import { tryAcquireSync, releaseSync } from "./sync-lock";

describe("readAutoSyncConfig", () => {
  it("defaults to enabled=true, interval=15 when unset", async () => {
    const { db } = createTestDb();
    expect(await readAutoSyncConfig(db)).toEqual({ enabled: true, intervalMinutes: 15 });
  });

  it("treats only the string 'false' as disabled", async () => {
    const { db } = createTestDb();
    db.insert(settings).values({ key: "notion_auto_sync_enabled", value: "false" }).run();
    expect((await readAutoSyncConfig(db)).enabled).toBe(false);
  });

  it("reads a custom interval and falls back to 15 on garbage/too-small values", async () => {
    const { db } = createTestDb();
    db.insert(settings).values({ key: "notion_auto_sync_interval_minutes", value: "30" }).run();
    expect((await readAutoSyncConfig(db)).intervalMinutes).toBe(30);

    db.update(settings).set({ value: "not-a-number" })
      .where(eq(settings.key, "notion_auto_sync_interval_minutes")).run();
    expect((await readAutoSyncConfig(db)).intervalMinutes).toBe(15);

    db.update(settings).set({ value: "0" })
      .where(eq(settings.key, "notion_auto_sync_interval_minutes")).run();
    expect((await readAutoSyncConfig(db)).intervalMinutes).toBe(15);
  });
});

describe("runAutoSyncTick", () => {
  it("runs each campaign returned by listCampaigns", async () => {
    const ran: string[] = [];
    const result = await runAutoSyncTick({
      listCampaigns: async () => ["a", "b"],
      runOne: async (id) => { ran.push(id); },
    });
    expect(ran).toEqual(["a", "b"]);
    expect(result.synced).toEqual(["a", "b"]);
    expect(result.skipped).toEqual([]);
  });

  it("skips a campaign whose lock is already held and never calls runOne for it", async () => {
    const ran: string[] = [];
    expect(tryAcquireSync("busy")).toBe(true);
    try {
      const result = await runAutoSyncTick({
        listCampaigns: async () => ["busy", "free"],
        runOne: async (id) => { ran.push(id); },
      });
      expect(ran).toEqual(["free"]);
      expect(result.synced).toEqual(["free"]);
      expect(result.skipped).toEqual(["busy"]);
    } finally {
      releaseSync("busy");
    }
  });

  it("isolates a failing campaign — the loop continues and the lock is released", async () => {
    const ran: string[] = [];
    const result = await runAutoSyncTick({
      listCampaigns: async () => ["boom", "ok"],
      runOne: async (id) => {
        ran.push(id);
        if (id === "boom") throw new Error("kaboom");
      },
    });
    expect(ran).toEqual(["boom", "ok"]);
    expect(result.synced).toEqual(["ok"]);
    expect(result.failed).toEqual(["boom"]);
    // Lock for the failed campaign must have been released.
    expect(tryAcquireSync("boom")).toBe(true);
    releaseSync("boom");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- scheduler`
Expected: FAIL — cannot resolve `./scheduler`.

- [ ] **Step 3: Write the config reader + tick (no timers yet)**

Create `lib/notion/scheduler.ts` with just the testable core for now (Task 5 appends the timer wiring):

```typescript
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import { db as defaultDb } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { runCampaignSync, listCampaignsWithSources } from "./run-sync";
import { tryAcquireSync, releaseSync } from "./sync-lock";

type SyncDb = BetterSQLite3Database<typeof schema>;

export const AUTO_SYNC_ENABLED_KEY = "notion_auto_sync_enabled";
export const AUTO_SYNC_INTERVAL_KEY = "notion_auto_sync_interval_minutes";
export const DEFAULT_INTERVAL_MINUTES = 15;

export interface AutoSyncConfig {
  enabled: boolean;
  intervalMinutes: number;
}

/** Reads auto-sync config from settings, tolerating missing/garbage values. */
export async function readAutoSyncConfig(db: SyncDb = defaultDb as unknown as SyncDb): Promise<AutoSyncConfig> {
  const rows = await db.query.settings.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));

  // Enabled unless explicitly the string "false".
  const enabled = map.get(AUTO_SYNC_ENABLED_KEY) !== "false";

  const parsed = Number.parseInt(map.get(AUTO_SYNC_INTERVAL_KEY) ?? "", 10);
  const intervalMinutes = Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_INTERVAL_MINUTES;

  return { enabled, intervalMinutes };
}

export interface TickDeps {
  listCampaigns?: () => Promise<string[]>;
  runOne?: (campaignId: string) => Promise<void>;
  log?: (message: string, err?: unknown) => void;
}

export interface TickResult {
  synced: string[];
  skipped: string[];
  failed: string[];
}

/**
 * Runs one auto-sync pass: for every campaign with sources, acquire the shared
 * lock and sync it. Campaigns already locked (e.g. a manual sync in progress)
 * are skipped. A campaign that throws is isolated — its lock is released and the
 * loop continues.
 */
export async function runAutoSyncTick(deps: TickDeps = {}): Promise<TickResult> {
  const listCampaigns = deps.listCampaigns ?? (() => listCampaignsWithSources());
  const runOne = deps.runOne ?? (async (id: string) => { await runCampaignSync(id); });
  const log = deps.log ?? ((message, err) => console.error(`[notion-auto-sync] ${message}`, err ?? ""));

  const result: TickResult = { synced: [], skipped: [], failed: [] };

  let campaigns: string[];
  try {
    campaigns = await listCampaigns();
  } catch (err) {
    log("failed to list campaigns", err);
    return result;
  }

  for (const campaignId of campaigns) {
    if (!tryAcquireSync(campaignId)) {
      result.skipped.push(campaignId);
      continue;
    }
    try {
      await runOne(campaignId);
      result.synced.push(campaignId);
    } catch (err) {
      result.failed.push(campaignId);
      log(`sync failed for campaign ${campaignId}`, err);
    } finally {
      releaseSync(campaignId);
    }
  }

  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- scheduler`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/notion/scheduler.ts lib/notion/scheduler.test.ts
git commit -m "feat(notion): auto-sync config reader + tick logic"
```

---

## Task 5: Scheduler timer wiring + start guard

Add the self-rescheduling `setTimeout` loop and a one-time start guard to `lib/notion/scheduler.ts`. This part is thin glue around the already-tested `readAutoSyncConfig` / `runAutoSyncTick`, so it isn't unit-tested (real timers).

**Files:**
- Modify: `lib/notion/scheduler.ts` (append)

- [ ] **Step 1: Append the timer wiring**

Add to the END of `lib/notion/scheduler.ts`:

```typescript
const MINUTE_MS = 60_000;
/** Delay before the first tick after boot — short so a fresh container refreshes promptly. */
export const FIRST_TICK_DELAY_MS = 30_000;

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function tickAndReschedule(): Promise<void> {
  let intervalMinutes = DEFAULT_INTERVAL_MINUTES;
  try {
    const config = await readAutoSyncConfig();
    intervalMinutes = config.intervalMinutes;
    if (config.enabled) {
      await runAutoSyncTick();
    }
  } catch (err) {
    // Never let a thrown error stop the reschedule loop.
    console.error("[notion-auto-sync] tick error", err);
  } finally {
    timer = setTimeout(() => void tickAndReschedule(), intervalMinutes * MINUTE_MS);
    // Don't keep the event loop alive purely for the sync timer.
    if (typeof timer.unref === "function") timer.unref();
  }
}

/**
 * Starts the background auto-sync loop. Idempotent — safe to call once at boot.
 * The first tick fires after FIRST_TICK_DELAY_MS; subsequent ticks use the
 * interval from settings (re-read every tick, so changes take effect live).
 */
export function startNotionAutoSync(): void {
  if (started) return;
  started = true;
  timer = setTimeout(() => void tickAndReschedule(), FIRST_TICK_DELAY_MS);
  if (typeof timer.unref === "function") timer.unref();
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Re-run the scheduler tests (still green)**

Run: `npm test -- scheduler`
Expected: PASS (the appended timer code doesn't affect the existing tests).

- [ ] **Step 4: Commit**

```bash
git add lib/notion/scheduler.ts
git commit -m "feat(notion): self-rescheduling auto-sync timer + start guard"
```

---

## Task 6: Start the scheduler at boot

Wire `startNotionAutoSync()` into `instrumentation.ts`, after migrations, Node runtime only.

**Files:**
- Modify: `instrumentation.ts`

- [ ] **Step 1: Update instrumentation**

Replace the contents of `instrumentation.ts` with:

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./lib/db/migrate");
    runMigrations();

    const { startNotionAutoSync } = await import("./lib/notion/scheduler");
    startNotionAutoSync();
  }
}
```

- [ ] **Step 2: Typecheck + full test suite**

Run: `npx tsc --noEmit` then `npm test`
Expected: no type errors; all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add instrumentation.ts
git commit -m "feat(notion): start background auto-sync at boot"
```

---

## Task 7: Allow the new settings keys through the settings API

The settings `PUT` handler only persists keys in its allowlist. Add the two auto-sync keys so the UI can save them.

**Files:**
- Modify: `app/api/settings/route.ts:6`

- [ ] **Step 1: Extend the allowlist**

In `app/api/settings/route.ts`, change the `ALLOWED_KEYS` line (line 6):

```typescript
const ALLOWED_KEYS = ["campaign_name", "default_roll_advantage", "ddb_share_urls", "notion_token", "anthropic_api_key"];
```

to:

```typescript
const ALLOWED_KEYS = ["campaign_name", "default_roll_advantage", "ddb_share_urls", "notion_token", "anthropic_api_key", "notion_auto_sync_enabled", "notion_auto_sync_interval_minutes"];
```

Leave `MASKED_KEYS` unchanged — these values are not secrets and the UI needs to read them back via GET.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/settings/route.ts
git commit -m "feat(settings): allow notion auto-sync config keys"
```

---

## Task 8: Auto-sync controls in the Notion sync panel

Add an on/off toggle and an interval selector to `NotionSyncPanel`, reading/writing the two settings keys via `/api/settings`. The manual button and "Last synced" display are untouched.

**Files:**
- Modify: `components/settings/NotionSyncPanel.tsx`

- [ ] **Step 1: Add state + load for auto-sync settings**

In `components/settings/NotionSyncPanel.tsx`, add these state hooks immediately after the existing `const [savingType, setSavingType] = useState<string | null>(null);` line (currently line 38):

```typescript
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [savingAuto, setSavingAuto] = useState(false);
```

Then add a new effect right after the existing load `useEffect` (the one that ends at line 66), to load the current auto-sync config:

```typescript
  // Load global auto-sync config (stored in the settings table, not per-source).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch("/api/settings");
      const data = await r.json();
      if (cancelled) return;
      setAutoEnabled(data.notion_auto_sync_enabled !== "false");
      const n = Number.parseInt(data.notion_auto_sync_interval_minutes ?? "", 10);
      setIntervalMinutes(Number.isFinite(n) && n >= 1 ? n : 15);
    })();
    return () => { cancelled = true; };
  }, []);
```

- [ ] **Step 2: Add the save handler**

Add this function inside the component, right after the existing `syncNow` function (after line 114):

```typescript
  async function saveAutoSync(next: { enabled?: boolean; interval?: number }) {
    const enabled = next.enabled ?? autoEnabled;
    const interval = next.interval ?? intervalMinutes;
    setAutoEnabled(enabled);
    setIntervalMinutes(interval);
    setSavingAuto(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notion_auto_sync_enabled: enabled ? "true" : "false",
          notion_auto_sync_interval_minutes: String(interval),
        }),
      });
      if (!res.ok) toast({ title: "Could not save auto-sync settings", variant: "error" });
    } finally {
      setSavingAuto(false);
    }
  }
```

- [ ] **Step 3: Add the UI controls**

Insert this block immediately after the closing `</p>` of the instructions paragraph (currently line 129, the paragraph ending "Share each database with your integration first.") and before the `{SOURCES.map(...)}` block:

```tsx
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <div>
          <label htmlFor="auto-sync-toggle" className="text-sm font-medium">Automatic background sync</label>
          <p className="text-xs text-muted-foreground">
            Keeps this app up to date with Notion on a schedule. Manual sync stays available anytime.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            id="auto-sync-interval"
            value={intervalMinutes}
            disabled={!autoEnabled || savingAuto}
            onChange={(e) => saveAutoSync({ interval: Number(e.target.value) })}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
          >
            <option value={5}>Every 5 min</option>
            <option value={15}>Every 15 min</option>
            <option value={30}>Every 30 min</option>
            <option value={60}>Every 60 min</option>
          </select>
          <input
            id="auto-sync-toggle"
            type="checkbox"
            checked={autoEnabled}
            disabled={savingAuto}
            onChange={(e) => saveAutoSync({ enabled: e.target.checked })}
            className="h-5 w-5 accent-primary"
          />
        </div>
      </div>
```

Note: if the current `intervalMinutes` isn't one of 5/15/30/60, the `<select>` shows no selection; that's acceptable since the UI only ever writes those four values. Leave it as-is (YAGNI).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Visually verify in the browser**

Start the dev server (via the preview tool, `name` from `.claude/launch.json`, or `npm run dev` if none) and open the Settings page. Confirm:
- The "Automatic background sync" row appears in the Notion Sync panel with the interval dropdown defaulting to "Every 15 min" and the checkbox checked.
- Toggling the checkbox and changing the interval each trigger a save (no error toast); reloading the page preserves the chosen values.
- The "Sync now" button and per-source URL fields still work.

Take a screenshot for the record.

- [ ] **Step 6: Commit**

```bash
git add components/settings/NotionSyncPanel.tsx
git commit -m "feat(settings): auto-sync toggle + interval controls in Notion panel"
```

---

## Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests PASS, including the new `sync-lock`, `run-sync`, and `scheduler` suites and the pre-existing `sync.test.ts` / `reconcile.test.ts` / etc.

- [ ] **Step 2: Typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no type errors, no lint errors, standalone build succeeds.

- [ ] **Step 3: Manual end-to-end sanity (optional, needs a real Notion token)**

If a real token + sources are configured in a dev/prod instance: start the server, watch logs for `[notion-auto-sync]` activity, confirm a sync runs ~30s after boot, then again after the configured interval. Toggle auto-sync off in Settings and confirm ticks stop scheduling further syncs (the loop keeps re-checking config but performs no sync while disabled).

- [ ] **Step 4: Update the memory index**

The project memory tracks the Campaign Hub sub-projects. After merge, note this as a new sub-project (background Notion auto-sync) in the appropriate memory file so future sessions know it exists.

---

## Spec coverage check

- Trigger = periodic polling → Tasks 4–6. ✅
- Configurable on/off + interval, default 15 min → Tasks 7–8 (storage + UI), Task 4 (defaults). ✅
- Scope = all campaigns with sources → `listCampaignsWithSources` (Task 2), used in Task 4. ✅
- Auto-sync on by default → `readAutoSyncConfig` default + UI default (Tasks 4, 8). ✅
- First run ~30s after boot → `FIRST_TICK_DELAY_MS` (Task 5). ✅
- Overlap lock (manual + auto) → Task 1, used in Tasks 3 & 4. ✅
- Manual "Sync now" preserved → Task 3 keeps the route + response shape; UI button untouched. ✅
- Shared core so manual == auto → `runCampaignSync` (Task 2), used by both. ✅
- Data-safety zero-rows guard relied upon → unchanged `syncCampaign` (noted, no code change). ✅
- Testing (run-sync, scheduler, lock) → Tasks 1, 2, 4. ✅
