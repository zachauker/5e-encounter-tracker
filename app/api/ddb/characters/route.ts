import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { fetchDDBCharacters, fetchPublicCharacter } from "@/lib/ddb/client";
import { eq } from "drizzle-orm";

export async function GET() {
  const tokenRow = await db.query.settings.findFirst({
    where: eq(settings.key, "ddb_cobalt_token"),
  });
  if (!tokenRow) {
    return NextResponse.json({ error: "No DDB token configured", characters: [] }, { status: 401 });
  }

  try {
    const characters = await fetchDDBCharacters(tokenRow.value);
    return NextResponse.json({ characters });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch characters", characters: [] },
      { status: 502 }
    );
  }
}

export async function POST(req: Request) {
  const body = await req.json();

  if (body.shareUrl) {
    try {
      const character = await fetchPublicCharacter(body.shareUrl);
      return NextResponse.json({ character });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch character" },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ error: "Provide shareUrl" }, { status: 400 });
}
