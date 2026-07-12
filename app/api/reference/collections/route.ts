import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { referenceCollections } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const rows = await db.select().from(referenceCollections).orderBy(desc(referenceCollections.createdAt));
  return NextResponse.json({ items: rows });
}
