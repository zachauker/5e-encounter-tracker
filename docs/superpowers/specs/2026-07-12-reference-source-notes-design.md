# Reference Source Notes — Design + Plan

**Date:** 2026-07-12
**Status:** Approved
**Extends:** sub-project #13 (Reference Library), on branch `claude/dnd-hub-roadmap-df1c2e` (unmerged).

## Summary

Let the DM attach a free-text **note** to each reference collection (e.g. "official
Wildemount setting book; authoritative for setting/lore"). The assistant uses each
note two ways: a compact **source roster in the system prompt** (so it knows what
sources exist and their authority before searching) and a **per-passage tag** on
retrieved hits (so it frames cited answers correctly).

## Data model

Add a nullable `notes TEXT` column to `reference_collections`. Fresh DBs get it in
the `CREATE TABLE`; existing DBs get it via the idempotent `addColumnIfMissing`
helper already in `migrate.ts`.

## Setting the note

- **At ingest:** `ingest.ts … --notes "<text>"` stores it on the collection at
  create time.
- **Editing later:** the Settings → Reference Library panel gains a per-collection
  notes field, saved via `PATCH /api/reference/collections/[id]` (extended to
  accept an optional `notes` string alongside the existing `enabled`).

## How the assistant uses it

1. **System-prompt roster** (`lib/reference/briefing.ts`): a pure
   `buildReferenceBriefing(sources)` renders enabled collections as
   `"Reference sources: Wildemount — <note>; SRD 5.1 — <note>"` (sources with no
   note show just their name; empty when there are none). `agent.ts` fetches
   enabled collections and appends the briefing to the system prompt per request.
2. **Per-retrieval tag:** `searchReference` already joins `reference_collections`,
   so `RefHit` gains `note: string | null` (via `col.notes`). The `search_reference`
   tool result carries the note; the agent sees it beside each retrieved passage.
   Citation chips are unchanged (the note is model guidance, not chip text).

## Implementation steps

1. **Schema/migration:** `notes` on `referenceCollections` (schema.ts) + CREATE TABLE
   column + `addColumnIfMissing("reference_collections", "notes", "TEXT")`.
2. **retrieve.ts:** add `note` to `RefHit`; `SELECT col.notes AS note`. Extend
   `retrieve.test.ts` to assert the note is returned on a hit.
3. **briefing.ts (new, TDD):** `buildReferenceBriefing(sources: {name; notes}[])`
   pure builder + `getReferenceBriefing(db)` (queries enabled collections). Unit-test
   the builder: renders name+note, skips empty notes gracefully, empty string when none.
4. **agent.ts:** append `getReferenceBriefing(opts.db)` to the system prompt string
   used in `runAssistant` (build a per-request system = base SYSTEM + briefing).
5. **ingest.ts:** `--notes` flag → stored on the collection insert.
6. **PATCH route:** accept optional `notes` (string); update whichever of
   `enabled`/`notes` is provided; 400 only if neither is valid.
7. **ReferenceLibraryPanel.tsx:** show + edit each collection's note (textarea +
   Save), PATCH `{ notes }`; GET list already returns the row so `notes` comes for free.

## Testing

- Unit: `buildReferenceBriefing` (name+note render, empty-note skip, empty roster);
  `searchReference` returns `note` on hits.
- Manual smoke (DM, needs key + model + an ingested source with a note): add a note,
  ask a setting question, confirm the agent reaches for that source and treats it as
  authoritative; verify the note appears in the tool result.

## Non-goals

- Rich/structured metadata (tags, authority levels) — just free text.
- Surfacing the note in citation chips (it's model guidance).
