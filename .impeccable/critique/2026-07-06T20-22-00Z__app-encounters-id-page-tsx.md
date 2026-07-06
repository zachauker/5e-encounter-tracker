---
target: the combat tracker (app/encounters/[id]/page.tsx)
total_score: 31
p0_count: 0
p1_count: 1
timestamp: 2026-07-06T20-22-00Z
slug: app-encounters-id-page-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Save/sync/HP feedback now strong; stale badge lives only in the panel, not the list |
| 2 | Match System / Real World | 4 | Fluent D&D vocabulary throughout — round, active, temp HP, concentration, conditions |
| 3 | User Control and Freedom | 4 | Undo toast for removal, drag reorder, inline edit, reset round |
| 4 | Consistency and Standards | 3 | Three different rename affordances (pencil / single-click / double-click) |
| 5 | Error Prevention | 3 | Stale badge + save error + undo added; auto-save still fires overlapping PATCHes |
| 6 | Recognition Rather Than Recall | 3 | KB hints visible, semantic HP color, condition chips, type icons+labels |
| 7 | Flexibility and Efficiency of Use | 4 | N/P/A/S/⌘S shortcuts + global ⌘K palette; still no keyboard reorder |
| 8 | Aesthetic and Minimalist Design | 3 | Global hub TopBar persists during combat — ~120px of chrome, most unused mid-fight |
| 9 | Error Recovery | 3 | Save→Retry, load→Back, stale→refresh; save error is a quiet inline text |
| 10 | Help and Documentation | 1 | KB hints only; conditions unexplained; no contextual help |
| **Total** | | **31/40** | **Good — solid foundation, address the weak areas** |

---

## Anti-Patterns Verdict

**LLM assessment**: Not AI-generated, and more confidently so than the last pass. The semantic color system (gold = initiative/active, traffic-light HP, crimson primary/destructive) is deliberate and coherent. The dark theme is earned by the physical scene (a gaming table in dim light), not fashion. The initiative list correctly refuses to become a card grid, and the "war-room readout" — round number at `text-2xl` in gold with the active combatant beside it — is a specific, non-generic hierarchy move. No gradient text, no side-stripe borders, no tracked-uppercase eyebrows, no hero-metric SaaS template.

**Deterministic scan**: `detect.mjs --json components/tracker app/encounters` returned `[]`, exit 0 — completely clean. No gradient text, no eyebrows, no side-stripe borders, no numbered section markers.

**Visual overlays**: No live overlay produced. The target requires a Postgres `DATABASE_URL` (no `.env` present) and a seeded encounter with combatants; the interesting states — active glow, HP color ramp, the stale badge — can't render without seed data. Fallback: source review, same as the prior run.

---

## Overall Impression

This is a real recovery from 26 → 31. Four of the five issues from the last critique were genuinely fixed, not papered over: the undo toast, the save-error path with Retry, the `S` shortcut to the active combatant's stat block, and scroll-to-active on turn advance. The DDB stale-data warning now exists too.

The remaining opportunities all trace to a single principle in PRODUCT.md — **peripheral-vision design**. The tool now behaves correctly; the question is whether its most important signals reach the DM's *unfocused* eye during a live fight. Right now the two highest-stakes signals (a failed save, stale PC data) are technically present but visually quiet or hidden behind a panel, and the global hub navigation eats vertical space the initiative list should own.

---

## What's Working

**1. The fixes landed cleanly.** The `UndoToast` re-inserts a removed combatant with a 5s window — the right pattern for "the table doesn't wait" (no blocking dialog). The `S` shortcut folds the stat block into the existing keyboard vocabulary. Scroll-to-active on turn advance means the gold highlight never hides below the fold. These are correct, minimal solutions.

**2. Active-combatant treatment remains the star.** Gold background wash + layered glow (tight ring → inner bloom → diffuse 24px) + pulsing dot + gold name reads from across a table without being garish. The `.combatant-active` shadow recipe is doing real peripheral-vision work.

**3. Semantic state vocabulary is consistent and honest.** HP color is derived (`hpColor`), never decorative. Type gets both an icon *and* a label (never color alone — satisfies the AA "no color-only meaning" mandate). Save state cycles through Save → Saving… → Saved → Save failed with matching color.

---

## Priority Issues

### [P1] The global hub nav persists during combat, undermining peripheral-vision design

**What**: `app/layout.tsx` renders `<TopBar />` (48px, 7 section links + campaign selector + settings + ⌘K) above `<main>` on every route, including a live encounter. Stacked with the two-row `EncounterControls` (~72px), the initiative list doesn't begin until ~120px down. During a fight the DM never navigates to Factions / Items / Maps — that nav is pure dead weight exactly when vertical space matters most.

**Why it matters**: PRODUCT.md principle 3 is "key state should read without focus… glance at the tracker mid-conversation and instantly re-orient." Persistent global chrome that's irrelevant to combat competes with the one list that isn't. On a 768px laptop that's ~16% of height spent on navigation the DM is actively ignoring.

**Fix**: Give the encounter route a focus/combat mode. When `status === "active"`, collapse the TopBar to a thin strip (or hide it, leaving a hover/hotkey reveal). The back-arrow already lives in `EncounterControls`, so the hub nav has no combat-time job. This buys back the most valuable pixels on the screen for the initiative list.

**Suggested command**: `/impeccable layout`

---

### [P2] The save-failure signal is too quiet for the stakes it carries

**What**: On a failed PATCH, `EncounterControls` shows a small inline `AlertCircle` + "Save failed" + a `Retry` link in the top row. It's real feedback — a strict improvement over the old silent failure — but it's ~11px text competing with the encounter name and combat controls, in a spot the DM isn't looking during a fight.

**Why it matters**: PRODUCT.md calls lost encounter state "catastrophic." The undo toast for a *removed combatant* gets a full centered, shadowed floating treatment — but a *failed save*, which is strictly higher-stakes, gets less visual weight than the thing it's more important than. The severity hierarchy is inverted.

**Fix**: Promote save failure to the same or stronger treatment as `UndoToast` — a persistent (non-auto-dismissing) banner or toast with an amber/red edge and a Retry button, that stays until the save succeeds. This is the one failure the DM must not miss.

**Suggested command**: `/impeccable harden`

---

### [P2] The "Stale" DDB warning is hidden unless the stat panel is open

**What**: `StatBlockPanel` renders an amber `AlertTriangle` + "Stale" when `syncErrors` contains the combatant — but only inside the panel, which is closed most of the fight. A PC whose D&D Beyond sync silently failed shows *no* indicator in the initiative list; its HP/slots read as current.

**Why it matters**: Peripheral-vision design again. The DM makes live calls off the list, not the panel. "Aria has 3 slots" needs a doubt-flag the DM can see without opening anything, or the warning isn't protecting the decision it exists to protect.

**Fix**: Surface a small amber ⚠ on the combatant card in the list (on the avatar or beside the HP bar) whenever `syncErrors.has(c.id)`, with the same "data may be stale" tooltip. The panel badge stays as the detailed view.

**Suggested command**: `/impeccable harden`

---

### [P2] "Close (Esc)" is a promise the code doesn't keep

**What**: The stat-panel close button is `title="Close (Esc)"`, but nothing wires Escape to `showStatBlock(null)`. The only keydown handlers are `EncounterControls` (n/p/a/s/⌘s — no Escape) and `CommandPalette` (its own palette Esc). Pressing Esc with the panel open does nothing.

**Why it matters**: A tooltip that names a shortcut that doesn't exist erodes trust in *every* shortcut hint. A power-user DM who tries Esc once and finds it dead will stop trusting the `N/P/S` hints too. It also blocks the natural one-key dismissal that "the table doesn't wait" implies.

**Fix**: Add an Escape handler that calls `showStatBlock(null)` when the panel is open (guarded so it doesn't fire while an input/textarea is focused, matching the existing handler's guard). Cheap, and it makes the tooltip honest.

**Suggested command**: `/impeccable harden`

---

### [P3] Three different affordances to rename similar things

**What**: Editing the initiative value is a **single click**; editing the combatant name right beside it is a **double click**; editing the encounter name up top is a **pencil icon**. Three patterns for "edit this text," two of them inside the same card.

**Why it matters**: Recognition-over-recall: the DM has to remember which text responds to which gesture. Single-click-to-edit on the init number trains an expectation the adjacent name then violates.

**Fix**: Standardize. Simplest: make the combatant name single-click-to-edit like the initiative (or give both the pencil affordance). Pick one rename gesture for the whole surface.

**Suggested command**: `/impeccable clarify`

---

## Persona Red Flags

### Alex (Power User / the DM)
- Tries Esc to dismiss the stat panel → nothing happens; the "Close (Esc)" tooltip lied. Confidence in the other hints drops.
- Still no keyboard reorder for initiative — after a Readied Action changes order, Alex must drop to the trackpad and drag.
- A save silently "fails quietly": the inline "Save failed" is easy to blow past mid-fight; Alex may not realize the session is unsaved.

### Riley (Stress Tester)
- Rapid HP edits (damage → heal → temp) each mark dirty; auto-save fires a fresh PATCH every 2s with no in-flight guard or `AbortController` — overlapping requests can resolve out of order and clobber newer state.
- Removing the active combatant: undo now exists, but `nextTurn()` with a just-removed `currentCombatantId` is still an untested edge.
- "Close (Esc)" advertised but unimplemented — exactly the promise/behavior gap Riley hunts for.

### The Mid-Session DM (project-specific)
- 90 minutes in, panel closed, running off the list: a PC's DDB sync fails silently — the only warning is inside a panel they haven't opened.
- A failed autosave surfaces as quiet inline text they'll never catch between attack rolls.
- Conditions are chips with no rules text — recalling what "Frightened" mechanically does still means reaching for the book.

---

## Minor Observations

- **Auto-save has no request coalescing/abort.** `save` fires 2s after any `isDirty`; rapid changes queue overlapping PATCHes. Add an `AbortController` or in-flight guard so the latest write wins.
- **Help/documentation scores 1** — the lowest heuristic and unchanged. Condition chips carry no explanation; a hover tooltip with the 5e rules text would move recognition *and* help in one stroke.
- **Keyboard hint contrast**: `text-[9px] text-muted-foreground/60` is likely below AA at that size — and PRODUCT.md mandates high contrast for dim-lit tables. Verify or bump.
- **Empty-panel width transition**: `StatBlockPanel` animates `w-80 → w-0` (`transition-all`); animating width is layout-thrashy. A transform/translate off-canvas would be smoother, though at this size it's minor.
- **`hpColor`/`hpPercent` at 0 HP**: compact bar is empty and text reads `0/45` in white with a text-shadow over `bg-muted` — probably fine, but confirm 4.5:1 at the empty state.

---

## Questions to Consider

- What if `status === "active"` collapsed the global TopBar automatically — would a combat/focus mode feel like relief or like a missing escape hatch?
- The save-failure signal and the removal-undo toast have inverted visual weight relative to their stakes. Should *all* high-stakes, session-losing events share one loud, persistent toast channel?
- Conditions are the one place the tool still assumes book-knowledge. Is an inline rules tooltip the cheapest path from "tracker" to "reference," or does that clutter the peripheral-vision goal?
