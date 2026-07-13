import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { referenceCollections, referenceChunks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getDbSqlite } from "@/lib/db/raw";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean; notes?: string | null };
  const patch: { enabled?: boolean; notes?: string | null } = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.notes === "string" || body.notes === null) patch.notes = body.notes === null ? null : body.notes.trim() || null;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "provide enabled (boolean) and/or notes (string)" }, { status: 400 });
  }
  const [row] = await db
    .update(referenceCollections)
    .set(patch)
    .where(eq(referenceCollections.id, id))
    .returning();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chunkIds = await db
    .select({ id: referenceChunks.id })
    .from(referenceChunks)
    .where(eq(referenceChunks.collectionId, id));

  const sqlite = getDbSqlite();
  const del = sqlite.prepare("DELETE FROM vec_reference_chunks WHERE chunk_id = ?");
  const tx = sqlite.transaction((ids: string[]) => {
    for (const cid of ids) del.run(cid);
  });
  tx(chunkIds.map((c) => c.id));

  await db.delete(referenceCollections).where(eq(referenceCollections.id, id)); // cascades reference_chunks
  return NextResponse.json({ ok: true });
}
