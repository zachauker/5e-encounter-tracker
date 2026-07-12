import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { referenceCollections, referenceChunks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getDbSqlite } from "@/lib/db/raw";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) required" }, { status: 400 });
  }
  const [row] = await db
    .update(referenceCollections)
    .set({ enabled: body.enabled })
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
