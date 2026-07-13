# In-App Reference Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the DM ingest reference sources (inbox PDFs/notes + the baked SRD) from the Settings UI, processed by the running container with a progress bar — no hand-copying the live database.

**Architecture:** Extract the existing CLI ingest logic into a shared `lib/reference/ingest.ts` (`ingestSource` / `ingestSrd`) taking a raw better-sqlite3 handle + an injectable embedder + an `onProgress` callback. A `GET /api/reference/inbox` lists files in a mounted inbox dir; `POST /api/reference/ingest` runs the core and streams SSE progress. The Settings panel lists inbox files, triggers ingest / Import SRD, and shows a progress bar. A path-traversal guard confines file access to the inbox dir; a module-level lock serializes ingests.

**Tech Stack:** Next.js 16 (custom fork), TypeScript, Drizzle + better-sqlite3, sqlite-vec, pdfjs-dist, @huggingface/transformers, vitest. No new deps.

**Read first:** Spec `docs/superpowers/specs/2026-07-13-in-app-reference-ingestion-design.md`. Custom Next.js fork — read `node_modules/next/dist/docs/` before route/streaming work. The current CLI logic to extract lives in `scripts/reference/ingest.ts` (parse → chunk → embed → atomic store); preserve every detail (pdfjs `standardFontDataUrl`/`cMapUrl`, per-chunk page citation, `INSERT OR REPLACE` vec write, note-preserving replace).

**Shared conventions:**
- `type Embedder = (texts: string[]) => Promise<number[][]>` (from `lib/reference/retrieve.ts`). The real one is `embed` from `lib/reference/embed.ts`; tests inject a 384-dim stub.
- Raw sqlite handle for vec ops: `getDbSqlite()` from `lib/db/raw.ts` (loads vec + `foreign_keys=ON`). `loadVec` from `lib/db/load-vec.ts`.
- Run tests: `npm test`. Build: `npm run build`.

---

### Task 1: Shared ingest core (`lib/reference/ingest.ts`) — TDD

**Files:**
- Create: `lib/reference/ingest.ts`
- Test: `lib/reference/ingest.test.ts`

`ingestSource(sqlite, opts)` takes a raw better-sqlite3 handle (vec loaded) and does parse/use-text → chunk → embed → atomic store, calling `onProgress(done, total)` per embed batch. `ingestSrd` concatenates the baked SRD markdown and delegates.

- [ ] **Step 1: Write the failing test**

Create `lib/reference/ingest.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import os from "os";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { referenceCollections, referenceChunks } from "@/lib/db/schema";
import { loadVec } from "@/lib/db/load-vec";
import { runMigrations } from "@/lib/db/migrate";
import { ingestSource, type Embedder } from "./ingest";

const DIMS = 384;
const stub: Embedder = async (texts) => texts.map(() => Array(DIMS).fill(0.01));

function freshDb() {
  const file = path.join(os.tmpdir(), `ingest-${crypto.randomUUID()}.db`);
  process.env.DB_PATH = file;
  runMigrations();
  const sqlite = new Database(file);
  sqlite.pragma("foreign_keys = ON");
  loadVec(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

describe("ingestSource", () => {
  it("chunks + embeds + stores a text file, reports progress", async () => {
    const { sqlite, db } = freshDb();
    const txt = path.join(os.tmpdir(), `src-${crypto.randomUUID()}.md`);
    fs.writeFileSync(txt, "# Grappling\nRules for grabbing a creature.\n\n# Shoving\nRules for shoving.");
    const onProgress = vi.fn();

    const res = await ingestSource(sqlite, { filePath: txt, collection: "Test Book", notes: "a note", embed: stub, onProgress });

    expect(res.chunkCount).toBeGreaterThanOrEqual(2);
    const col = db.select().from(referenceCollections).where(eq(referenceCollections.name, "Test Book")).get()!;
    expect(col.notes).toBe("a note");
    expect(col.chunkCount).toBe(res.chunkCount);
    const chunks = db.select().from(referenceChunks).where(eq(referenceChunks.collectionId, col.id)).all();
    expect(chunks.length).toBe(res.chunkCount);
    const vecCount = (sqlite.prepare("SELECT count(*) c FROM vec_reference_chunks").get() as { c: number }).c;
    expect(vecCount).toBe(res.chunkCount);
    expect(onProgress).toHaveBeenCalled();
  });

  it("re-ingest replaces the collection and preserves the existing note when none is given", async () => {
    const { sqlite, db } = freshDb();
    const txt = path.join(os.tmpdir(), `src-${crypto.randomUUID()}.md`);
    fs.writeFileSync(txt, "# A\nfirst.");
    await ingestSource(sqlite, { filePath: txt, collection: "Book", notes: "keep me", embed: stub });
    fs.writeFileSync(txt, "# A\nfirst.\n\n# B\nsecond.");
    const res2 = await ingestSource(sqlite, { filePath: txt, collection: "Book", embed: stub }); // no notes
    const cols = db.select().from(referenceCollections).where(eq(referenceCollections.name, "Book")).all();
    expect(cols.length).toBe(1); // replaced, not duplicated
    expect(cols[0].notes).toBe("keep me"); // preserved
    expect(cols[0].chunkCount).toBe(res2.chunkCount);
    // No orphaned vectors from the old copy:
    const vecCount = (sqlite.prepare("SELECT count(*) c FROM vec_reference_chunks").get() as { c: number }).c;
    expect(vecCount).toBe(res2.chunkCount);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- reference/ingest`
Expected: FAIL — `Cannot find module './ingest'`.

- [ ] **Step 3: Implement `lib/reference/ingest.ts`**

```typescript
import type DatabaseType from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { referenceCollections, referenceChunks } from "@/lib/db/schema";
import { chunkText, type Chunk } from "@/lib/reference/chunk";
import { embed as realEmbed, EMBED_DIMS } from "@/lib/reference/embed";
import type { Embedder } from "@/lib/reference/retrieve";

export type { Embedder };

interface TextItemLike { str?: string }

/** Extract text (+ per-page citation for PDFs) from a file. */
async function extractFile(file: string): Promise<{ text: string; pageOf?: (i: number) => number | null; sourceLabel: string }> {
  const ext = path.extname(file).toLowerCase();
  const label = path.basename(file, ext);
  if (ext === ".pdf") {
    const { createRequire } = await import("module");
    const requireFn = createRequire(import.meta.url);
    const pdfjsDir = path.resolve(path.dirname(requireFn.resolve("pdfjs-dist/legacy/build/pdf.mjs")), "..", "..");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(fs.readFileSync(file));
    const doc = await pdfjs.getDocument({
      data,
      standardFontDataUrl: path.join(pdfjsDir, "standard_fonts") + path.sep,
      cMapUrl: path.join(pdfjsDir, "cmaps") + path.sep,
      cMapPacked: true,
      useSystemFonts: false,
      verbosity: 0,
    }).promise;
    let text = "";
    const pageBoundaries: { index: number; page: number }[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      pageBoundaries.push({ index: text.length, page: p });
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map((it) => (it as TextItemLike).str ?? "").join(" ") + "\n";
    }
    const pageOf = (i: number) => { let cur = 1; for (const b of pageBoundaries) if (b.index <= i) cur = b.page; else break; return cur; };
    return { text, pageOf, sourceLabel: label };
  }
  return { text: fs.readFileSync(file, "utf8"), sourceLabel: label };
}

export interface IngestOptions {
  collection: string;
  notes?: string | null;
  embed?: Embedder;
  onProgress?: (done: number, total: number) => void;
  // Provide exactly one source: a file path, or pre-supplied text + a citation label.
  filePath?: string;
  text?: string;
  sourceLabel?: string;
}

export interface IngestResult { collectionId: string; chunkCount: number }

/** parse/use text -> chunk -> embed -> atomic store. `sqlite` must have vec loaded. */
export async function ingestSource(sqlite: DatabaseType.Database, opts: IngestOptions): Promise<IngestResult> {
  const embed = opts.embed ?? realEmbed;
  const db = drizzle(sqlite, { schema });

  let text: string, pageOf: ((i: number) => number | null) | undefined, sourceLabel: string, sourceType: "pdf" | "text";
  if (opts.filePath) {
    const ex = await extractFile(opts.filePath);
    text = ex.text; pageOf = ex.pageOf;
    sourceLabel = ex.sourceLabel;
    sourceType = path.extname(opts.filePath).toLowerCase() === ".pdf" ? "pdf" : "text";
  } else {
    text = opts.text ?? "";
    sourceLabel = opts.sourceLabel ?? opts.collection;
    sourceType = "text";
  }

  const chunks: Chunk[] = chunkText(text, { sourceLabel, pageOf });
  if (chunks.length === 0) throw new Error("No text extracted — nothing to ingest.");

  const embeddings: number[][] = [];
  const BATCH = 32;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const vecs = await embed(chunks.slice(i, i + BATCH).map((c) => c.content));
    embeddings.push(...vecs);
    opts.onProgress?.(Math.min(i + BATCH, chunks.length), chunks.length);
  }

  const existing = db.select().from(referenceCollections).where(eq(referenceCollections.name, opts.collection)).get();
  const collId = existing?.id ?? crypto.randomUUID();
  const tx = sqlite.transaction(() => {
    if (existing) {
      const oldIds = db.select({ id: referenceChunks.id }).from(referenceChunks).where(eq(referenceChunks.collectionId, existing.id)).all();
      for (const { id } of oldIds) sqlite.prepare("DELETE FROM vec_reference_chunks WHERE chunk_id = ?").run(id);
      db.delete(referenceCollections).where(eq(referenceCollections.id, existing.id)).run();
    }
    const notesToStore = (opts.notes ?? undefined) !== undefined ? opts.notes! : (existing?.notes ?? null);
    db.insert(referenceCollections).values({ id: collId, name: opts.collection, sourceType, enabled: true, chunkCount: chunks.length, notes: notesToStore, createdAt: new Date() }).run();
    const chunkRows = chunks.map((c) => ({ id: crypto.randomUUID(), collectionId: collId, content: c.content, sourceRef: c.sourceRef, ordinal: c.ordinal, tokenCount: c.tokenCount }));
    for (const row of chunkRows) db.insert(referenceChunks).values(row).run();
    for (let i = 0; i < chunkRows.length; i++) {
      const emb = embeddings[i];
      if (emb.length !== EMBED_DIMS) throw new Error(`embedding dim ${emb.length} != ${EMBED_DIMS}`);
      sqlite.prepare("INSERT OR REPLACE INTO vec_reference_chunks(chunk_id, embedding) VALUES (?, ?)").run(chunkRows[i].id, JSON.stringify(emb));
    }
  });
  tx();
  return { collectionId: collId, chunkCount: chunks.length };
}

/** Ingest the baked SRD markdown (reference-data/srd/*.md, excluding README) as "SRD 5.1". */
export async function ingestSrd(sqlite: DatabaseType.Database, opts: { embed?: Embedder; onProgress?: (d: number, t: number) => void } = {}): Promise<IngestResult> {
  const dir = path.join(process.cwd(), "reference-data", "srd");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md") : [];
  if (files.length === 0) throw new Error("No SRD markdown found in reference-data/srd/.");
  const text = files.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n\n");
  return ingestSource(sqlite, { collection: "SRD 5.1", text, sourceLabel: "SRD", embed: opts.embed, onProgress: opts.onProgress });
}
```

Note on the note-preservation logic: `opts.notes` is `string | null | undefined`. `undefined` = "not provided" → keep existing; an explicit `string`/`null` overrides. The test's second call omits `notes` (undefined) → preserves "keep me".

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- reference/ingest`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/reference/ingest.ts lib/reference/ingest.test.ts
git commit -m "feat: shared reference ingest core (ingestSource + ingestSrd)"
```

---

### Task 2: Refactor the CLI scripts onto the shared core

**Files:**
- Modify: `scripts/reference/ingest.ts` (thin wrapper)
- Modify: `scripts/reference/import-srd.ts` (thin wrapper)

- [ ] **Step 1: Rewrite `scripts/reference/ingest.ts` as a wrapper**

Replace the whole file with:

```typescript
import Database from "better-sqlite3";
import path from "path";
import { loadVec } from "@/lib/db/load-vec";
import { runMigrations } from "@/lib/db/migrate";
import { ingestSource } from "@/lib/reference/ingest";

async function main() {
  const [file, ...rest] = process.argv.slice(2);
  const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  const collection = flag("--collection") ?? path.basename(file ?? "");
  const notes = rest.includes("--notes") ? (flag("--notes") ?? null) : undefined;
  const dryRun = rest.includes("--dry-run");
  if (!file) { console.error('usage: tsx scripts/reference/ingest.ts <file> --collection "<name>" [--notes "<context>"] [--dry-run]'); process.exit(1); }

  runMigrations();
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "encounter-tracker.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  if (!loadVec(sqlite)) { console.error("sqlite-vec failed to load"); process.exit(1); }

  if (dryRun) {
    // Parse + chunk only, no embed/store: reuse ingestSource with a no-op embedder against a throwaway path is overkill;
    // for a dry run just report that the file is readable.
    console.log(`Dry run: would ingest "${file}" into collection "${collection}".`);
    return;
  }
  const res = await ingestSource(sqlite, { filePath: file, collection, notes, onProgress: (d, t) => console.log(`  embedded ${d}/${t}`) });
  console.log(`Ingested "${collection}" — ${res.chunkCount} chunks.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

(The `--label`/`--replace` flags are dropped: label now derives from the filename inside the core, and re-ingest always replaces. If you want to keep `--dry-run` showing sample chunks, that's optional — the smoke test below only needs the readable-file confirmation.)

- [ ] **Step 2: Rewrite `scripts/reference/import-srd.ts` as a wrapper**

```typescript
import Database from "better-sqlite3";
import path from "path";
import { loadVec } from "@/lib/db/load-vec";
import { runMigrations } from "@/lib/db/migrate";
import { ingestSrd } from "@/lib/reference/ingest";

async function main() {
  runMigrations();
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "encounter-tracker.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  if (!loadVec(sqlite)) { console.error("sqlite-vec failed to load"); process.exit(1); }
  const res = await ingestSrd(sqlite, { onProgress: (d, t) => console.log(`  embedded ${d}/${t}`) });
  console.log(`Ingested SRD 5.1 — ${res.chunkCount} chunks.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Verify scripts typecheck + a text-file ingest works end to end via the CLI**

Run: `npx tsc --noEmit` → clean.
Create `/tmp/ref.md` with `# Test\nHello grappling world.` then:
`DB_PATH=/tmp/ref-cli-$(date +%s).db npx tsx scripts/reference/ingest.ts /tmp/ref.md --collection "CliTest"`
Expected: prints `embedded …` then `Ingested "CliTest" — N chunks.` (this loads the real model on first run — a few seconds). Then `npm test` → all green.

- [ ] **Step 4: Commit**

```bash
git add scripts/reference/ingest.ts scripts/reference/import-srd.ts
git commit -m "refactor: CLI reference scripts delegate to the shared ingest core"
```

---

### Task 3: Inbox module + path-traversal guard (`lib/reference/inbox.ts`) — TDD

**Files:**
- Create: `lib/reference/inbox.ts`
- Test: `lib/reference/inbox.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/reference/inbox.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { listInbox, resolveInboxFile } from "./inbox";

let dir: string;
beforeEach(() => {
  dir = path.join(os.tmpdir(), `inbox-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  process.env.REFERENCE_INBOX_DIR = dir;
  fs.writeFileSync(path.join(dir, "book.pdf"), "x");
  fs.writeFileSync(path.join(dir, "notes.md"), "x");
  fs.writeFileSync(path.join(dir, "ignore.zip"), "x"); // unsupported ext
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("listInbox", () => {
  it("lists only .pdf/.md/.txt files", () => {
    const names = listInbox().map((f) => f.name).sort();
    expect(names).toEqual(["book.pdf", "notes.md"]);
  });
});

describe("resolveInboxFile", () => {
  it("resolves a plain filename inside the inbox", () => {
    expect(resolveInboxFile("book.pdf")).toBe(path.join(dir, "book.pdf"));
  });
  it("rejects traversal / absolute paths", () => {
    expect(() => resolveInboxFile("../secret")).toThrow();
    expect(() => resolveInboxFile("/etc/passwd")).toThrow();
    expect(() => resolveInboxFile("sub/../../x")).toThrow();
  });
  it("throws if the file does not exist or has an unsupported ext", () => {
    expect(() => resolveInboxFile("missing.pdf")).toThrow();
    expect(() => resolveInboxFile("ignore.zip")).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- reference/inbox`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/reference/inbox.ts`**

```typescript
import path from "path";
import fs from "fs";

const ALLOWED = new Set([".pdf", ".md", ".txt"]);

export function inboxDir(): string {
  return process.env.REFERENCE_INBOX_DIR || path.join(process.cwd(), "reference-inbox");
}

export function listInbox(): { name: string; sizeBytes: number }[] {
  const dir = inboxDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => ALLOWED.has(path.extname(name).toLowerCase()))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return st.isFile() ? { name, sizeBytes: st.size } : null;
    })
    .filter((f): f is { name: string; sizeBytes: number } => f !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve a client-supplied filename to an absolute path, confined to the inbox dir. */
export function resolveInboxFile(name: string): string {
  const dir = path.resolve(inboxDir());
  // Only a bare filename is allowed — no directory components.
  if (name !== path.basename(name)) throw new Error("Invalid file name");
  if (!ALLOWED.has(path.extname(name).toLowerCase())) throw new Error("Unsupported file type");
  const full = path.resolve(dir, name);
  if (full !== path.join(dir, name) || !full.startsWith(dir + path.sep)) throw new Error("Invalid file path");
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error("File not found");
  return full;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- reference/inbox`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/reference/inbox.ts lib/reference/inbox.test.ts
git commit -m "feat: reference inbox listing + path-traversal-guarded file resolution"
```

---

### Task 4: `GET /api/reference/inbox`

**Files:**
- Create: `app/api/reference/inbox/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
import { NextResponse } from "next/server";
import { listInbox } from "@/lib/reference/inbox";

export async function GET() {
  return NextResponse.json({ files: listInbox() });
}
```

- [ ] **Step 2: Verify build + a manual check**

Run: `npm run build` → clean. `npx tsc --noEmit` → clean.
Manual (dev server): create `reference-inbox/x.md` in the repo root, `GET /api/reference/inbox` → `{ files: [{ name: "x.md", sizeBytes: … }] }`.

- [ ] **Step 3: Commit**

```bash
git add app/api/reference/inbox/route.ts
git commit -m "feat: GET /api/reference/inbox lists ingestable files"
```

---

### Task 5: `POST /api/reference/ingest` (SSE progress + concurrency lock)

**Files:**
- Create: `app/api/reference/ingest/route.ts`

**Read first:** the streaming route pattern in `app/api/assistant/route.ts` (ReadableStream + `data: {json}\n\n`), and `node_modules/next/dist/docs/` for route handlers.

- [ ] **Step 1: Implement the route**

```typescript
import { getDbSqlite } from "@/lib/db/raw";
import { resolveInboxFile } from "@/lib/reference/inbox";
import { ingestSource, ingestSrd } from "@/lib/reference/ingest";

// Module-level lock: embedding is CPU-heavy; one ingest at a time.
let ingesting = false;

interface Evt { type: "progress" | "done" | "error"; done?: number; total?: number; collection?: string; chunkCount?: number; message?: string }

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { file?: string; srd?: boolean; collection?: string; notes?: string };

  if (ingesting) {
    return new Response(JSON.stringify({ error: "An ingest is already running." }), { status: 409, headers: { "content-type": "application/json" } });
  }

  // Resolve the source up front so bad input returns a clean 400 (not an SSE error).
  let filePath: string | undefined;
  let collection: string;
  if (body.srd) {
    collection = "SRD 5.1";
  } else if (body.file) {
    try {
      filePath = resolveInboxFile(body.file);
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Invalid file" }), { status: 400, headers: { "content-type": "application/json" } });
    }
    collection = body.collection?.trim() || body.file.replace(/\.[^.]+$/, "");
  } else {
    return new Response(JSON.stringify({ error: "Provide a file or srd: true" }), { status: 400, headers: { "content-type": "application/json" } });
  }

  ingesting = true;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: Evt) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        const sqlite = getDbSqlite();
        const onProgress = (done: number, total: number) => send({ type: "progress", done, total });
        const res = body.srd
          ? await ingestSrd(sqlite, { onProgress })
          : await ingestSource(sqlite, { filePath: filePath!, collection, notes: body.notes?.trim() || undefined, onProgress });
        send({ type: "done", collection, chunkCount: res.chunkCount });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Ingest failed" });
      } finally {
        ingesting = false;
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
}
```

- [ ] **Step 2: Verify build + typecheck**

Run: `npm run build` (clean — `/api/reference/ingest` registers as dynamic). `npx tsc --noEmit` (clean). `npm test` (65+ still green).

- [ ] **Step 3: Manual SSE smoke (dev, loads the real model on first call)**

With `reference-inbox/ref.md` present (`# Test\nHello grappling world.`):
`curl -N -X POST localhost:3000/api/reference/ingest -H 'content-type: application/json' -d '{"file":"ref.md","collection":"Smoke"}'`
Expected: `data: {"type":"progress",…}` then `data: {"type":"done","collection":"Smoke","chunkCount":…}`. A second concurrent call → HTTP 409. A bad name (`{"file":"../x"}`) → HTTP 400.

- [ ] **Step 4: Commit**

```bash
git add app/api/reference/ingest/route.ts
git commit -m "feat: POST /api/reference/ingest — SSE progress, concurrency lock, path guard"
```

---

### Task 6: Reference Library panel — inbox list, ingest, Import SRD, progress

**Files:**
- Modify: `components/settings/ReferenceLibraryPanel.tsx`

- [ ] **Step 1: Add inbox + ingest UI to the panel**

Read the current panel first. Add: inbox state, a fetch of `/api/reference/inbox`, an ingest handler that consumes the SSE stream and drives a progress bar, an Import SRD button, and a refresh of the collections list on `done`. Add this inside the component (alongside the existing collection list), using the existing `Button` and the SSE-parsing shape from `ChatPanel`:

```tsx
// --- add to imports (top of file) ---
import { useCallback } from "react";

// --- add interfaces near Collection ---
interface InboxFile { name: string; sizeBytes: number }

// --- add state inside the component ---
const [inbox, setInbox] = useState<InboxFile[]>([]);
const [busy, setBusy] = useState<string | null>(null); // label of the in-flight ingest
const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
const [ingestError, setIngestError] = useState<string | null>(null);

const loadCollections = useCallback(() => {
  fetch("/api/reference/collections").then((r) => r.json())
    .then((d: { items: Collection[] }) => { setItems(d.items ?? []); setDrafts(Object.fromEntries((d.items ?? []).map((c) => [c.id, c.notes ?? ""]))); })
    .catch(() => {});
}, []);

const loadInbox = useCallback(() => {
  fetch("/api/reference/inbox").then((r) => r.json()).then((d: { files: InboxFile[] }) => setInbox(d.files ?? [])).catch(() => setInbox([]));
}, []);

useEffect(() => { loadInbox(); }, [loadInbox]);

async function runIngest(label: string, body: Record<string, unknown>) {
  setBusy(label); setProgress(null); setIngestError(null);
  try {
    const res = await fetch("/api/reference/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok || !res.body) { setIngestError((await res.json().catch(() => ({}))).error ?? `Failed (${res.status})`); return; }
    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = "";
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.replace(/^data: /, "").trim(); if (!line) continue;
        const evt = JSON.parse(line) as { type: string; done?: number; total?: number; message?: string };
        if (evt.type === "progress") setProgress({ done: evt.done ?? 0, total: evt.total ?? 0 });
        else if (evt.type === "error") setIngestError(evt.message ?? "Ingest failed");
      }
    }
    loadCollections(); loadInbox();
  } finally {
    setBusy(null); setProgress(null);
  }
}
```

Replace the existing `useEffect` that loads collections so it uses `loadCollections` (keep the cancellation guard idea, but `loadCollections` is fine to call directly on mount):

```tsx
useEffect(() => { loadCollections(); }, [loadCollections]);
```

Add this JSX block inside the `<section>`, above the collections `<ul>` (or below the header):

```tsx
<div className="space-y-2">
  <div className="flex items-center gap-2">
    <h3 className="text-sm font-medium">Inbox</h3>
    <span className="text-xs text-muted-foreground">drop files in reference-inbox/ on the server</span>
    <Button size="sm" variant="ghost" className="ml-auto" disabled={!!busy} onClick={() => runIngest("SRD 5.1", { srd: true })}>
      {busy === "SRD 5.1" ? "Importing…" : "Import SRD"}
    </Button>
  </div>
  {inbox.length === 0 ? (
    <p className="text-xs text-muted-foreground">No files in the inbox.</p>
  ) : (
    <ul className="space-y-1">
      {inbox.map((f) => (
        <li key={f.name} className="flex items-center gap-2 text-sm">
          <span className="flex-1">{f.name} <span className="text-muted-foreground">· {(f.sizeBytes / 1_000_000).toFixed(1)} MB</span></span>
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => runIngest(f.name, { file: f.name })}>
            {busy === f.name ? "Ingesting…" : "Ingest"}
          </Button>
        </li>
      ))}
    </ul>
  )}
  {busy && progress && (
    <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
      <div className="h-full bg-primary transition-all" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
    </div>
  )}
  {ingestError && <p className="text-xs text-red-500">{ingestError}</p>}
</div>
```

Adapt class names / `Button` props to the repo's primitives if needed (they were confirmed during the reference-library work: `Button` has `size="sm"` and `variant="ghost"`/`"default"`; `--primary`/`--muted` CSS vars exist).

- [ ] **Step 2: Verify**

Run: `npm run build` (clean), `npx tsc --noEmit` (clean), `npx eslint components/settings/ReferenceLibraryPanel.tsx` (no new errors; the effects use `useCallback` deps so the set-state-in-effect rule is satisfied). `npm test` green.

- [ ] **Step 3: Commit**

```bash
git add components/settings/ReferenceLibraryPanel.tsx
git commit -m "feat: inbox ingest + Import SRD + progress in the Reference Library panel"
```

---

### Task 7: docker-compose inbox env + final verification

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add the inbox dir env**

In `docker-compose.yml`, under `environment:` (next to `REFERENCE_MODEL_DIR`), add:

```yaml
      - REFERENCE_INBOX_DIR=/data/reference-inbox
```

(The dir lives on the existing `./data:/data` volume — the DM creates `…/data/reference-inbox/` and drops files there. `listInbox` returns `[]` if it doesn't exist yet, so nothing errors before it's created.)

- [ ] **Step 2: Final verification**

Run: `npm test` — all green (existing + new ingest/inbox tests). `npm run build` + `npx tsc --noEmit` — clean. `npx eslint lib/reference app/api/reference components/settings/ReferenceLibraryPanel.tsx scripts/reference` — no new errors.

- [ ] **Step 3: Browser smoke (controller, dev)**

Create `reference-inbox/ref.md` in the repo root, start the dev server, Settings → Reference Library: the Inbox shows `ref.md`; click **Ingest** → progress bar → the collection appears in the list with an editable note. **Import SRD** works if `reference-data/srd/*.md` is present (else a clean error).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: REFERENCE_INBOX_DIR on the /data volume"
```

---

## Final verification checklist

- [ ] `npm test` — all green (new: `reference/ingest`, `reference/inbox`).
- [ ] `npm run build` + `npx tsc --noEmit` — clean.
- [ ] `npx eslint lib/reference app/api/reference components/settings/ReferenceLibraryPanel.tsx scripts/reference` — no new errors.
- [ ] Browser smoke: inbox ingest (progress → collection), Import SRD, path-traversal 400, concurrent 409.
- [ ] Deploy note for the DM: after redeploy, create `…/data/reference-inbox/`, drop a PDF, ingest from Settings. No DB copying.

## Notes for the implementer

- **One connection for the transaction.** `ingestSource` takes a raw `Database` handle and derives Drizzle over it, so the chunk inserts + vec inserts share one connection/transaction. The route passes `getDbSqlite()`; the CLI opens its own. Never mix the app singleton (`@/lib/db`) drizzle with a separate raw handle inside the same transaction.
- **Note tri-state:** `IngestOptions.notes` is `string | null | undefined`. `undefined` = keep existing on replace; explicit value overrides. Don't collapse `undefined` and `null`.
- **pdfjs now ships in the image:** because `lib/reference/ingest.ts` is imported by the route, pdfjs enters the standalone trace. If a runtime "cannot find module pdfjs-dist/legacy/build/pdf.mjs" appears, overlay `pdfjs-dist` in the Dockerfile like the other native/dynamic packages.
- **Custom Next.js fork:** read `node_modules/next/dist/docs/` before Task 4/5 routes.
