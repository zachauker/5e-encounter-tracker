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
