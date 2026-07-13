import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import type * as schema from "@/lib/db/schema";

type AppDb = BetterSQLite3Database<typeof schema>;
export type Embedder = (texts: string[]) => Promise<number[][]>;

export interface RefHit { content: string; sourceRef: string; collection: string; note: string | null; distance: number }

export async function upsertVectors(db: AppDb, rows: { chunkId: string; embedding: number[] }[], dims: number): Promise<void> {
  for (const r of rows) {
    if (r.embedding.length !== dims) throw new Error(`embedding dim ${r.embedding.length} != ${dims}`);
    const json = JSON.stringify(r.embedding);
    // vec0 virtual tables don't support ON CONFLICT upsert syntax; INSERT OR REPLACE works instead.
    db.run(sql`INSERT OR REPLACE INTO vec_reference_chunks(chunk_id, embedding) VALUES (${r.chunkId}, ${json})`);
  }
}

export async function searchReference(
  db: AppDb,
  opts: { query: string; embed: Embedder; collection?: string; k?: number; dims?: number },
): Promise<RefHit[]> {
  const k = opts.k ?? 6;
  const [queryVec] = await opts.embed([opts.query]);
  if (opts.dims != null && queryVec.length !== opts.dims) {
    throw new Error(`embedding dim ${queryVec.length} != ${opts.dims}`);
  }
  const json = JSON.stringify(queryVec);
  // vec0 applies the `k =` KNN limit BEFORE any join filter, so filtering on
  // col.enabled/col.name in the outer query can drop rows the KNN already spent,
  // yielding fewer than k (or zero) results even when good enabled matches exist.
  // Over-fetch KNN candidates first, then filter + limit around them.
  const overfetch = Math.max(k * 8, 50);
  const rows = db.all(sql`
    SELECT rc.content AS content, rc.source_ref AS sourceRef, col.name AS collection, col.notes AS note, v.distance AS distance
    FROM (
      SELECT chunk_id AS chunk_id, distance AS distance FROM vec_reference_chunks
      WHERE embedding MATCH ${json} AND k = ${overfetch}
    ) v
    JOIN reference_chunks rc ON rc.id = v.chunk_id
    JOIN reference_collections col ON col.id = rc.collection_id
    WHERE col.enabled = 1
      ${opts.collection ? sql`AND col.name = ${opts.collection}` : sql``}
    ORDER BY v.distance
    LIMIT ${k}
  `) as RefHit[];
  return rows;
}
