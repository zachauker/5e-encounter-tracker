import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maps } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { and, eq } from "drizzle-orm";

// GET /api/world?campaignId=<id> -> the campaign's world map record (created if absent).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId");
  if (!campaignId) {
    return NextResponse.json({ error: '"campaignId" is required' }, { status: 400 });
  }

  const existing = await db.query.maps.findFirst({
    where: and(eq(maps.campaignId, campaignId), eq(maps.renderMode, "world")),
  });
  if (existing) return NextResponse.json(existing);

  const now = new Date();
  try {
    const [created] = await db
      .insert(maps)
      .values({
        id: generateId(),
        campaignId,
        name: "Exandria",
        imagePath: "world", // no uploaded image; column is NOT NULL, so a sentinel
        parentMapId: null,
        renderMode: "world",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return NextResponse.json(created);
  } catch (err) {
    if (err instanceof Error && err.message.includes("FOREIGN KEY constraint failed")) {
      return NextResponse.json({ error: "Unknown campaign" }, { status: 400 });
    }
    throw err;
  }
}
