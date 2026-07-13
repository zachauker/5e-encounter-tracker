# In-App Reference Ingestion — Design Spec

**Date:** 2026-07-13
**Status:** Approved for planning
**Extends:** sub-project #13 (Reference Library) + per-source notes.

## Summary

Let the DM add reference sources (rulebook/setting PDFs, own notes, the SRD)
**from the Settings UI**, ingested by the **running container** — no copying the
live SQLite database around. The DM drops a file into a mounted inbox folder (or
clicks "Import SRD"), clicks Ingest, and watches a progress bar as the container
parses → chunks → embeds → stores it. This replaces the fragile
stop-container / copy-DB-out / run-CLI / copy-DB-back workflow that already caused
one accidental prod-DB overwrite.

## Goals

- Add reference sources entirely in-app; the live DB is never hand-copied.
- Handle large sourcebook PDFs reliably (50–100 MB+).
- Reuse the existing ingestion logic — one implementation shared by the CLI and
  the new route.
- Show progress for a multi-minute operation.

## Non-goals (v1)

- Browser file upload (rejected: reverse-proxy body-size caps + large-request
  memory). Files arrive via the mounted inbox folder instead.
- A durable background-job queue that survives tab-close (SSE "click and watch"
  is sufficient for a manual, occasional action).
- Concurrent ingests (one at a time; a second is rejected).

## File delivery — server inbox

The DM copies a file into `REFERENCE_INBOX_DIR` (default `<cwd>/reference-inbox`
in dev; `/data/reference-inbox` in prod, on the existing `/data` volume — added to
`docker-compose.yml`; created on demand if missing). Only `.pdf`, `.md`, `.txt`
are listed and ingestable. This never touches the live DB and has no upload caps.

## Architecture / flow

```
DM drops wildemount.pdf → <appdata>/data/reference-inbox/   (Unraid share)
   │
Settings → Reference Library:
   • Inbox list  ← GET /api/reference/inbox   (files in REFERENCE_INBOX_DIR)
   • click Ingest (optional collection name / note), or "Import SRD"
   │  POST /api/reference/ingest { file } | { srd: true } (+ collection?, notes?)
   ▼  ← SSE stream
   Shared ingest core runs in the container:
     parse (pdfjs) → chunk → embed (model on /data volume) → sqlite-vec upsert
     …emits { type:"progress", done, total }…
   ▼
   panel progress bar → { type:"done", collection, chunkCount }
   → collections list refreshes (note editable as today)
```

## Components

- **`lib/reference/ingest.ts` (new — shared core):**
  - `ingestSource({ db, filePath, collection?, notes?, replace?, onProgress? })`
    — the parse → chunk → embed → store logic, extracted verbatim from
    `scripts/reference/ingest.ts` (including the pdfjs `standardFontDataUrl`/`cMapUrl`
    fix, the per-chunk page citation, the atomic end-of-run transaction, and the
    `INSERT OR REPLACE` vec write). `onProgress(done, total)` is called per embed batch.
  - `ingestSrd({ db, onProgress? })` — concatenates the baked `reference-data/srd/*.md`
    (skipping `README.md`), then ingests as collection "SRD 5.1" with label "SRD".
  - `scripts/reference/ingest.ts` and `import-srd.ts` become thin CLI wrappers over these
    (argv parsing + console progress), so there is one implementation to maintain and test.
  - **Pulls `pdfjs` into a route's import graph**, so it is finally traced into the
    Next standalone image (today it lives only in the script and isn't in the prod build).
- **`lib/reference/inbox.ts` (new):** `inboxDir()` (reads `REFERENCE_INBOX_DIR`),
  `listInbox()` → `{ name, sizeBytes }[]` filtered to allowed extensions, and
  `resolveInboxFile(name)` → absolute path **guarded against traversal** (see Security).
- **`GET /api/reference/inbox`** → `{ files: {name, sizeBytes}[] }`.
- **`POST /api/reference/ingest`** → body `{ file?: string; srd?: boolean; collection?: string; notes?: string }`;
  streams SSE (same `data: {json}\n\n` framing as `/api/assistant`): `progress` events, then
  `done { collection, chunkCount }` or `error { message }`.
- **`components/settings/ReferenceLibraryPanel.tsx`** additions: an **Inbox** section
  (files with an **Ingest** button + optional collection/note inputs), an **Import SRD**
  button, and a progress bar driven by the SSE stream; on `done`, re-fetch the collections list.
- **`docker-compose.yml`:** add `REFERENCE_INBOX_DIR=/data/reference-inbox`.

## Security — path traversal (critical)

The route receives a **filename** from the client and must open it **only** from
inside the inbox dir. `resolveInboxFile(name)` takes `path.basename(name)`, resolves
it against `inboxDir()`, and confirms the resolved path starts with `inboxDir() + path.sep`;
anything else (`../`, absolute paths, symlink escape) is rejected. No client-supplied
path ever reaches `fs`/pdfjs. (Same guard the world asset route adopted.)

## Concurrency & re-ingest

- **One at a time:** a module-level in-flight flag; a second ingest returns HTTP 409
  ("an ingest is already running"). Embedding is CPU-heavy.
- **Re-ingest replaces:** ingesting a name that already exists replaces that collection,
  preserving its existing note (same behavior as the CLI's `--replace`).

## Error handling (all surfaced in the panel, never a bare 500)

- File not in inbox / bad name → 400 (path-traversal guard).
- Empty/unreadable file (e.g. image-only PDF) → `error`: "No text extracted."
- Model not loaded / sqlite-vec unavailable → `error` that degrades cleanly, not a crash.
- Concurrent ingest → 409.
- Mid-run abort (tab closed) → nothing persisted (single end-of-run transaction); re-run is clean.
- SRD import with empty `reference-data/srd/` → `error`: "No SRD markdown found."

## Testing

- **Unit (vitest, no model — stub embedder + temp DB):** `ingestSource` on a tiny
  text file asserts the collection + chunks + vectors are created, `onProgress` fires,
  and a re-ingest **replaces** while preserving the note. Focused test on the inbox
  **path-traversal guard** (rejects `../`, absolute; accepts a plain filename).
- **Route-level (mocked embedder):** `/api/reference/ingest` emits `progress` then `done`;
  a second concurrent call returns 409.
- **Manual smoke (post-deploy):** drop a small PDF in the inbox → Ingest → progress bar →
  collection appears → ⌘K a question that hits it → cited answer. Plus **Import SRD**.

## Dependencies & notes

- No new deps (`pdfjs-dist`, `@huggingface/transformers`, `sqlite-vec` already present).
- Builds on: the reference library (#13), the assistant's SSE framing, the settings-panel
  pattern, and the world route's path-traversal guard.
- Custom Next.js fork — read `node_modules/next/dist/docs/` before route/streaming work.
