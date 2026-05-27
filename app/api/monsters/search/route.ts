import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { monsterCache } from "@/lib/db/schema";
import { searchMonsters, getMonster, open5eToStatBlock } from "@/lib/monsters/open5e";
import { eq } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q");
  const slug = searchParams.get("slug");

  if (slug) {
    const cached = await db.query.monsterCache.findFirst({
      where: eq(monsterCache.slug, slug),
    });
    if (cached) {
      const data = JSON.parse(cached.data);
      return NextResponse.json({ statBlock: open5eToStatBlock(data), raw: data });
    }
    const monster = await getMonster(slug);
    await db
      .insert(monsterCache)
      .values({ slug, name: monster.name, data: JSON.stringify(monster), cachedAt: new Date() })
      .onConflictDoUpdate({ target: monsterCache.slug, set: { data: JSON.stringify(monster), cachedAt: new Date() } });
    return NextResponse.json({ statBlock: open5eToStatBlock(monster), raw: monster });
  }

  if (!query || query.trim().length < 2) {
    return NextResponse.json({ results: [] });
  }

  const monsters = await searchMonsters(query);
  return NextResponse.json({
    results: monsters.map((m) => ({
      slug: m.slug,
      name: m.name,
      cr: m.challenge_rating,
      type: m.type,
      size: m.size,
      hp: m.hit_points,
      ac: m.armor_class,
    })),
  });
}
