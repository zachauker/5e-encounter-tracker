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
