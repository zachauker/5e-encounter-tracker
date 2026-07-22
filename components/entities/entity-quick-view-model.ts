export type EntityResourcePath = "characters" | "locations" | "items" | "factions";

/** How many Notion props the compact popover shows before truncating. */
export const PROP_LIMIT = 4;

export interface RelatedItem {
  id: string;
  name: string;
  href: string;
  type?: string;
}

export interface RelatedGroup {
  label: string;
  items: RelatedItem[];
}

export interface EntityQuickViewModel {
  id: string;
  name: string;
  typeLabel: string | null;
  description: string | null;
  props: { label: string; value: string }[];
  related: RelatedGroup[];
  fullHref: string;
}

/** The union of fields the four `/api/{resourcePath}/{id}` GET endpoints return. */
export interface EntityDetailResponse {
  id: string;
  name: string;
  description?: string | null;
  type?: string | null;
  notionUrl?: string | null;
  notionProps?: { label: string; value: string }[];
  // Simple entities (locations/items/factions):
  linkedCharacters?: { id: string; name: string; type: string }[];
  // Characters:
  relatedFactions?: { id: string; name: string }[];
  relatedLocations?: { id: string; name: string }[];
  relatedItems?: { id: string; name: string }[];
}

const LOCATION_TYPE_LABELS: Record<string, string> = {
  city: "City",
  town: "Town",
  poi: "Point of Interest",
  region: "Region",
  other: "Other",
};

function resolveTypeLabel(resourcePath: EntityResourcePath, type?: string | null): string | null {
  if (!type) return null;
  if (resourcePath === "locations") return LOCATION_TYPE_LABELS[type] ?? type;
  if (resourcePath === "characters") {
    if (type === "pc") return "PC";
    if (type === "npc") return "NPC";
    return null;
  }
  return null;
}

function group(label: string, rows: { id: string; name: string }[], hrefBase: string): RelatedGroup[] {
  if (!rows || rows.length === 0) return [];
  return [{ label, items: rows.map((r) => ({ id: r.id, name: r.name, href: `${hrefBase}/${r.id}` })) }];
}

function buildRelated(resourcePath: EntityResourcePath, raw: EntityDetailResponse): RelatedGroup[] {
  if (resourcePath === "characters") {
    return [
      ...group("Factions", raw.relatedFactions ?? [], "/factions"),
      ...group("Locations", raw.relatedLocations ?? [], "/locations"),
      ...group("Items", raw.relatedItems ?? [], "/items"),
    ];
  }
  const chars = raw.linkedCharacters ?? [];
  if (chars.length === 0) return [];
  return [
    {
      label: "Characters",
      items: chars.map((c) => ({
        id: c.id,
        name: c.name,
        href: `/characters/${c.id}`,
        type: c.type === "pc" ? "PC" : "NPC",
      })),
    },
  ];
}

export function buildEntityQuickView(
  resourcePath: EntityResourcePath,
  raw: EntityDetailResponse,
): EntityQuickViewModel {
  return {
    id: raw.id,
    name: raw.name,
    typeLabel: resolveTypeLabel(resourcePath, raw.type),
    description: raw.description ?? null,
    props: (raw.notionProps ?? []).slice(0, PROP_LIMIT),
    related: buildRelated(resourcePath, raw),
    fullHref: `/${resourcePath}/${raw.id}`,
  };
}
