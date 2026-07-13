import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { referenceCollections } from "@/lib/db/schema";

type AppDb = BetterSQLite3Database<typeof schema>;

/** Render enabled reference sources (name + optional note) as a one-line system-prompt briefing. */
export function buildReferenceBriefing(sources: { name: string; notes: string | null }[]): string {
  if (sources.length === 0) return "";
  const parts = sources.map((s) => {
    const note = s.notes?.trim();
    return note ? `${s.name} — ${note}` : s.name;
  });
  return `Reference sources available via search_reference: ${parts.join("; ")}.`;
}

/** Query enabled collections and build their briefing string (empty when none). */
export function getReferenceBriefing(db: AppDb): string {
  const rows = db
    .select({ name: referenceCollections.name, notes: referenceCollections.notes })
    .from(referenceCollections)
    .where(eq(referenceCollections.enabled, true))
    .all();
  return buildReferenceBriefing(rows);
}
