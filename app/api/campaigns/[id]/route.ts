import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  if (body.name !== undefined && typeof body.name !== "string") {
    return NextResponse.json({ error: '"name" must be a string' }, { status: 400 });
  }

  const existing = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const name = typeof body.name === "string" ? body.name.trim() || existing.name : existing.name;
  await db.update(campaigns).set({ name }).where(eq(campaigns.id, id));
  return NextResponse.json({ ...existing, name });
}
