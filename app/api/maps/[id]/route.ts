import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maps } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { deleteMapImage } from "@/lib/maps/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const map = await db.query.maps.findFirst({ where: eq(maps.id, id) });
  if (!map) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const breadcrumb: { id: string; name: string }[] = [];
  let current = map;
  while (current.parentMapId) {
    const parent = await db.query.maps.findFirst({ where: eq(maps.id, current.parentMapId) });
    if (!parent) break;
    breadcrumb.unshift({ id: parent.id, name: parent.name });
    current = parent;
  }

  return NextResponse.json({ ...map, breadcrumb });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const existing = await db.query.maps.findFirst({ where: eq(maps.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .update(maps)
    .set({ name: body.name ?? existing.name, updatedAt: new Date() })
    .where(eq(maps.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await db.query.maps.findFirst({ where: eq(maps.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.delete(maps).where(eq(maps.id, id));
  await deleteMapImage(existing.imagePath);

  return NextResponse.json({ ok: true });
}
