import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const [chars, locs, itms, facs, encs] = await Promise.all([
    db.query.characters.findMany(),
    db.query.locations.findMany(),
    db.query.items.findMany(),
    db.query.factions.findMany(),
    db.query.encounters.findMany(),
  ]);

  const results = [
    ...chars.map((c) => ({ id: c.id, name: c.name, type: "character", href: `/characters?open=${c.id}` })),
    ...locs.map((l) => ({ id: l.id, name: l.name, type: "location", href: `/locations?open=${l.id}` })),
    ...itms.map((i) => ({ id: i.id, name: i.name, type: "item", href: `/items?open=${i.id}` })),
    ...facs.map((f) => ({ id: f.id, name: f.name, type: "faction", href: `/factions?open=${f.id}` })),
    ...encs.map((e) => ({ id: e.id, name: e.name, type: "encounter", href: `/encounters/${e.id}` })),
  ];

  return NextResponse.json(results);
}
