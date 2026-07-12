# Campaign Assistant — Design Spec

**Date:** 2026-07-12
**Status:** Approved for planning
**Sub-project:** #12 of the campaign hub expansion

## Summary

An agentic, Claude-powered chat assistant layered over the campaign hub's unified
data. It answers natural-language questions across all synced campaign data
(characters, locations, items, factions, relationships, live Notion page bodies,
D&D Beyond stats, maps/markers) **and** can take actions — building encounters,
creating/editing entities, placing map markers, and triggering a Notion sync —
with every write gated behind an explicit confirm-before-execute step.

This is the long-deferred original pillar #3 ("universal search / agentic
assistant"). It is the capstone that makes the data-unification work of
sub-projects #1–#11 pay off at the table.

## Goals

- Answer relational and prose questions about the campaign in natural language.
- Let the DM take the four highest-value write actions from chat, each confirmed.
- Reuse the existing hardened API routes as the real write path — no duplicate
  write logic, no way to bypass the guards those routes already enforce.
- Fit the app's "summoned, not persistent" ethos (no new permanent chrome).
- Ship without an embeddings/vector pipeline (YAGNI for a single-DM data volume).

## Non-goals (v1)

- Semantic/vector search over prose. Structured + keyword retrieval covers the
  overwhelming majority; embeddings are deferred until a real gap appears.
- Persisted conversation history. Sessions are in-memory per panel open; a
  history table can come later.
- Write actions beyond the four below (e.g. deleting entities, editing
  Notion-synced fields, hard deletes). Out of scope by design.
- Multi-user / player-facing access. DM-only.

## Retrieval decision

**Structured + keyword search over the existing SQLite data, with on-demand
full-record fetch (including live Notion page bodies via the existing
`/api/notion/page` route). No vector DB.** The data volume is modest and
single-campaign; keyword + relational tools cover almost everything, and this
avoids the whole embeddings tax (generate / store / re-embed on every sync).
Revisit only if a concrete recall gap shows up.

## Architecture

```
Browser (⌘K → chat panel)
   │  POST /api/assistant  { campaignId, messages }   ← SSE stream back
   ▼
Next.js API route (server-only)
   │  reads anthropic_api_key from the settings table
   │  Anthropic SDK Tool Runner (claude-opus-4-8, streaming, effort: high)
   │    ├─ READ tools  → query Drizzle/SQLite directly, return data
   │    └─ WRITE tools → return a PROPOSAL object (no mutation)
   ▼
Chat panel renders:
   • streamed assistant text
   • tool-result cards (entity lists, encounter preview)
   • CONFIRM CARD per proposal
        │  user clicks Confirm
        ▼
   POST/PATCH to the EXISTING hub route (/api/encounters,
   /api/maps/[id]/markers, /api/notion/sync, …)
```

### Principles

- **Server-only agent.** The `/api/assistant` route holds the Anthropic key and
  executes all tools. The browser only ever sees SSE events + proposal objects.
  The key never reaches the client.
- **Campaign-scoped.** Every request carries `campaignId`; every read and write
  tool filters by it — the same cross-campaign-leak guard sub-project #1's ⌘K
  search had to learn.
- **Reads are live SQLite queries** through the existing Drizzle layer, plus the
  existing `/api/notion/page` live-fetch for page bodies. No new data store.
- **Writes never mutate inside the agent.** A write tool returns
  `{ proposal, targetRoute, payload }`; the confirmed write replays `payload` to
  the existing route. The agent physically cannot clobber sync-managed fields or
  bypass FK/validation — the routes remain the single transaction boundary.

### Model & loop

- Anthropic SDK (`@anthropic-ai/sdk`), **Tool Runner** (`client.beta.messages.toolRunner`),
  server-side, streaming.
- Model `claude-opus-4-8`, `output_config: { effort: "high" }`, adaptive thinking.
- `max_iterations` cap so a confused agent can't spin.
- Tool descriptions are prescriptive about *when* to call each tool (Opus 4.8
  under-reaches for tools otherwise).

## Tool catalog

### Read tools (execute immediately, campaign-scoped)

| Tool | Purpose |
|---|---|
| `search_entities` | Keyword search across characters/locations/items/factions → name, type, id, snippet |
| `get_entity` | Full record for one entity incl. relationships + live Notion body + DDB stats |
| `list_entities` | Filtered list (e.g. "level-5+ characters in the Concord", "POIs on the Menagerie Coast") |
| `get_relationships` | Reverse lookups (faction→members, location→NPCs, etc.) |
| `list_monsters` | Query the monster library / Open5e cache for encounter building |
| `get_map_context` | Markers + locations for a map (world or uploaded) |

### Write tools (return a proposal, never mutate — each maps to an existing route)

| Tool | Proposes → confirmed route |
|---|---|
| `propose_encounter` | Build encounter + combatants → `POST /api/encounters` |
| `propose_entity` | Create/update a character/location/item/faction (hub-authored fields only) → `POST`/`PATCH /api/{type}` |
| `propose_marker` | Place/move a marker, optionally entity-linked → `POST /api/maps/[id]/markers` |
| `propose_notion_sync` | Trigger a sync → `POST /api/notion/sync` |

### Write-tool guardrails

- **Hub-authored fields only.** `propose_entity`'s schema **omits** Notion-synced
  columns entirely, so the agent cannot even draft a value for a world-seeded
  location's `type` or an item's synced `description`. Structurally impossible to
  propose a clobber.
- **Preview == execute.** Each proposal carries a human-readable summary (rendered
  verbatim on the confirm card) plus the exact `payload`. What you approve is
  exactly what gets sent; nothing is re-generated between preview and execute.

## ⌘K integration & chat panel UX

### ⌘K

- ⌘K opens the palette exactly as today; typing shows matching
  commands/navigation, unchanged and synchronous.
- A persistent **"Ask the assistant: '<text>' ↵"** action sits at the bottom of
  the results. Selecting it (or pressing ⌘↵) hands the text to the chat panel.
  **No question-vs-command heuristic** — the user chooses, so a location literally
  named "Where is Verin" still navigates and the palette stays predictable.
- The typed text carries over as the first message: ⌘K → type → ⌘↵ → answer.

### Chat panel

- Slides over the right third; the current page stays visible behind it. Dismiss
  reclaims full screen. Summoned, not persistent — no new permanent chrome.
- Streams assistant text token-by-token via SSE.
- Renders **tool-result cards** inline: entity lists become clickable rows
  (deep-link to detail pages); an encounter proposal shows a combatant preview; a
  marker proposal shows location + coords.
- **Confirm cards** per write proposal: summary + Confirm / Dismiss. Confirm hits
  the real route and shows the result ("Created 'Ashkeep Ambush' → open in
  /encounters"). Errors surface in the card.
- **Context-aware:** the panel passes the current route/entity as ambient context
  so "add a marker for *this*" resolves the antecedent. Passed as context, not a
  command.
- Conversation is per-session in memory (no persistence in v1).

## Configuration

- New **Settings → "Assistant"** panel. `anthropic_api_key` stored in the
  `settings` table (same pattern as `ddb_cobalt_token` / `notion_token`). Masked
  "configured ✓" state + a "Test" button.
- If no key is set, ⌘K's Ask action is disabled with a "Configure in Settings"
  hint — the feature self-gates, like the Notion Sync panel.

## Error handling

- **No/invalid key** → clean 400 from the route; panel shows "Assistant isn't
  configured yet →" linking to Settings. Never a spinner-forever.
- **Anthropic API errors** (429, 5xx) → typed-exception chain on the server;
  panel shows a retriable message.
- **Refusal** (`stop_reason: "refusal"`) → surfaced as a plain "I can't help with
  that," not an error.
- **Tool execution errors** (bad campaignId, entity not found) → returned to the
  agent as `is_error: true` tool results so it recovers in-conversation.
- **Confirmed-write failures** (FK conflict, validation) → the existing route's
  error is shown in the confirm card; nothing half-applied, because the route is
  the single transaction boundary.

## Testing

- **Pure units (vitest — already wired in sub-project #11):** tool input/output
  mappers, proposal→payload builders, campaign-scope filters, and the
  hub-authored-field allowlist (assert synced columns are rejected).
- **Route-level:** `/api/assistant` with a mocked Anthropic client — assert read
  tools query correctly and write tools return proposals (never mutate).
- **Confirm-path:** each proposal payload round-trips through its real route in a
  test DB (create encounter, place marker, create/update entity, trigger sync).
- **Manual browser smoke** (standard final step): a read question, an entity
  lookup, and one full propose→confirm→verify per write type.

## Open questions / future work

- Persisted conversation history (table + `/assistant` history view).
- Semantic search over prose, if keyword retrieval proves insufficient.
- Additional write actions (delete/archive flows, map uploads).
- Streaming the agent's interim tool-use as visible "thinking" in the panel.

## Dependencies & notes

- New dep: `@anthropic-ai/sdk`.
- This repo runs a custom Next.js fork — read `node_modules/next/dist/docs/`
  before writing route/streaming code (per AGENTS.md).
- Reuses existing infrastructure: `settings` table, Drizzle/SQLite layer,
  `/api/notion/page` live-fetch, the four target write routes, the ⌘K palette
  component, and the vitest runner.
