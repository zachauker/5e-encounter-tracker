import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { characterLibrary } from "@/lib/db/schema";
import { generateId } from "@/lib/utils";
import { validateCharacterUpload } from "@/lib/character-schema";
import { asc, like, or } from "drizzle-orm";
import type { CharacterUploadSchema } from "@/lib/character-schema";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");

  let rows;
  if (q && q.trim().length >= 1) {
    const pattern = `%${q.trim()}%`;
    rows = await db
      .select()
      .from(characterLibrary)
      .where(or(like(characterLibrary.name, pattern), like(characterLibrary.tags, pattern)))
      .orderBy(asc(characterLibrary.name));
  } else {
    rows = await db
      .select()
      .from(characterLibrary)
      .orderBy(asc(characterLibrary.name));
  }

  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      data: JSON.parse(r.data) as CharacterUploadSchema,
      tags: JSON.parse(r.tags) as string[],
    }))
  );
}

export async function POST(req: Request) {
  const body = await req.json() as CharacterUploadSchema & { tags?: string[] };

  const validation = validateCharacterUpload(body);
  if (!validation.valid) {
    return NextResponse.json({ error: "Invalid character data", errors: validation.errors }, { status: 400 });
  }

  const { tags, ...characterData } = body;
  const id = generateId();

  const [row] = await db
    .insert(characterLibrary)
    .values({
      id,
      name: body.name.trim(),
      type: body.type,
      data: JSON.stringify(characterData),
      tags: JSON.stringify(tags ?? []),
      createdAt: new Date(),
    })
    .returning();

  return NextResponse.json(
    { ...row, data: JSON.parse(row.data), tags: JSON.parse(row.tags) },
    { status: 201 }
  );
}
