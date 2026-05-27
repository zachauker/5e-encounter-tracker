import type { StatBlock } from "@/lib/types";

const OPEN5E_BASE = "https://api.open5e.com/v1";

export interface Open5eMonster {
  slug: string;
  name: string;
  size: string;
  type: string;
  subtype: string;
  alignment: string;
  armor_class: number;
  armor_desc: string;
  hit_points: number;
  hit_dice: string;
  speed: Record<string, number>;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  strength_save: number | null;
  dexterity_save: number | null;
  constitution_save: number | null;
  intelligence_save: number | null;
  wisdom_save: number | null;
  charisma_save: number | null;
  perception: number | null;
  skills: Record<string, number>;
  damage_vulnerabilities: string;
  damage_resistances: string;
  damage_immunities: string;
  condition_immunities: string;
  senses: string;
  languages: string;
  challenge_rating: string;
  cr: number;
  xp: number;
  special_abilities: Array<{ name: string; desc: string }>;
  actions: Array<{ name: string; desc: string }>;
  bonus_actions?: Array<{ name: string; desc: string }>;
  reactions: Array<{ name: string; desc: string }>;
  legendary_desc: string;
  legendary_actions: Array<{ name: string; desc: string }>;
  img_main?: string;
}

export async function searchMonsters(query: string): Promise<Open5eMonster[]> {
  const params = new URLSearchParams({ search: query, limit: "20" });
  const res = await fetch(`${OPEN5E_BASE}/monsters/?${params}`);
  if (!res.ok) throw new Error(`Open5e search failed: ${res.status}`);
  const json = await res.json();
  return json.results ?? [];
}

export async function getMonster(slug: string): Promise<Open5eMonster> {
  const res = await fetch(`${OPEN5E_BASE}/monsters/${slug}/`);
  if (!res.ok) throw new Error(`Monster not found: ${slug}`);
  return res.json();
}

export function open5eToStatBlock(m: Open5eMonster): StatBlock {
  const savingThrows: Record<string, number> = {};
  if (m.strength_save != null) savingThrows["STR"] = m.strength_save;
  if (m.dexterity_save != null) savingThrows["DEX"] = m.dexterity_save;
  if (m.constitution_save != null) savingThrows["CON"] = m.constitution_save;
  if (m.intelligence_save != null) savingThrows["INT"] = m.intelligence_save;
  if (m.wisdom_save != null) savingThrows["WIS"] = m.wisdom_save;
  if (m.charisma_save != null) savingThrows["CHA"] = m.charisma_save;

  const speedParts = Object.entries(m.speed ?? {})
    .map(([k, v]) => (k === "walk" ? `${v} ft.` : `${k} ${v} ft.`))
    .join(", ");

  return {
    name: m.name,
    size: m.size,
    type: m.type,
    subtype: m.subtype || undefined,
    alignment: m.alignment,
    ac: m.armor_class,
    acNote: m.armor_desc || undefined,
    hp: m.hit_points,
    hitDice: m.hit_dice,
    speed: speedParts || "30 ft.",
    str: m.strength,
    dex: m.dexterity,
    con: m.constitution,
    int: m.intelligence,
    wis: m.wisdom,
    cha: m.charisma,
    savingThrows: Object.keys(savingThrows).length > 0 ? savingThrows : undefined,
    skills: Object.keys(m.skills ?? {}).length > 0 ? m.skills : undefined,
    damageVulnerabilities: m.damage_vulnerabilities || undefined,
    damageResistances: m.damage_resistances || undefined,
    damageImmunities: m.damage_immunities || undefined,
    conditionImmunities: m.condition_immunities || undefined,
    senses: m.senses || undefined,
    languages: m.languages || undefined,
    cr: m.challenge_rating,
    xp: m.xp,
    abilities: m.special_abilities?.length ? m.special_abilities : undefined,
    actions: m.actions?.length ? m.actions : undefined,
    bonusActions: m.bonus_actions?.length ? m.bonus_actions : undefined,
    reactions: m.reactions?.length ? m.reactions : undefined,
    legendaryActions: m.legendary_actions?.length ? m.legendary_actions : undefined,
    imageUrl: m.img_main || undefined,
  };
}
