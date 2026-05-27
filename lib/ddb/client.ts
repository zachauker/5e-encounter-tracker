import type { DDBCharacter, StatBlock } from "@/lib/types";

const AUTH_SERVICE = "https://auth-service.dndbeyond.com/v1/cobalt-token";
const CHARACTER_SERVICE = "https://character-service.dndbeyond.com/character/v5";

export async function exchangeCobaltForJWT(cobaltToken: string): Promise<string> {
  const res = await fetch(AUTH_SERVICE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `CobaltSession=${cobaltToken}`,
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`DDB auth exchange failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const token = json.token ?? json.jwt ?? json.access_token;
  if (!token) throw new Error("DDB auth response missing token field");
  return token as string;
}

function decodeJWTPayload(jwt: string): Record<string, unknown> {
  try {
    const payload = jwt.split(".")[1];
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(padded, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return {};
  }
}

function getUserIdFromJWT(jwt: string): string | null {
  const payload = decodeJWTPayload(jwt);
  return (payload.sub ?? payload.userId ?? payload.nameid ?? null) as string | null;
}

export async function fetchDDBCharacters(cobaltToken: string): Promise<DDBCharacter[]> {
  const jwt = await exchangeCobaltForJWT(cobaltToken);
  const userId = getUserIdFromJWT(jwt);
  if (!userId) throw new Error("Could not determine user ID from DDB token");

  const url = `${CHARACTER_SERVICE}/characters?userId=${encodeURIComponent(userId)}&skip=0&take=50`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`DDB character fetch failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const characters = json.data ?? json.characters ?? json ?? [];
  return (Array.isArray(characters) ? characters : []).map(parseDDBCharacter);
}

export async function fetchDDBCharacterById(
  characterId: string | number,
  cobaltToken: string
): Promise<DDBCharacter> {
  const jwt = await exchangeCobaltForJWT(cobaltToken);
  const res = await fetch(`${CHARACTER_SERVICE}/character/${characterId}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch character ${characterId}: ${res.status}`);
  const json = await res.json();
  return parseDDBCharacter(json.data ?? json);
}

export async function fetchPublicCharacter(shareUrl: string): Promise<DDBCharacter> {
  const idMatch = shareUrl.match(/\/characters\/(\d+)/);
  if (!idMatch) throw new Error("Invalid D&D Beyond character URL");
  const id = idMatch[1];
  const res = await fetch(`https://www.dndbeyond.com/character/${id}/json`);
  if (!res.ok) throw new Error(`Failed to fetch public character: ${res.status}`);
  const json = await res.json();
  return parseDDBCharacter(json);
}

function parseDDBCharacter(raw: Record<string, unknown>): DDBCharacter {
  const stats = (raw.stats as Array<{ id: number; value: number | null }>) ?? [];
  const getStatValue = (id: number) => stats.find((s) => s.id === id)?.value ?? 10;

  const statValues = {
    str: getStatValue(1),
    dex: getStatValue(2),
    con: getStatValue(3),
    int: getStatValue(4),
    wis: getStatValue(5),
    cha: getStatValue(6),
  };

  const classes =
    (raw.classes as Array<{ definition: { name: string }; level: number }>) ?? [];
  const totalLevel = classes.reduce((sum, c) => sum + c.level, 0);
  const dexMod = Math.floor(((statValues.dex ?? 10) - 10) / 2);
  const preferences = (raw.preferences as Record<string, unknown>) ?? {};

  return {
    id: raw.id as number,
    name: (raw.name as string) ?? "Unknown",
    race: ((raw.race as Record<string, unknown>)?.fullName as string) ?? undefined,
    classes: classes.map((c) => ({ name: c.definition.name, level: c.level })),
    level: totalLevel || 1,
    ac: calculateAC(raw),
    maxHp: calculateMaxHP(raw),
    currentHp:
      raw.removedHitPoints != null
        ? calculateMaxHP(raw) - (raw.removedHitPoints as number)
        : undefined,
    tempHp: (raw.temporaryHitPoints as number) ?? 0,
    initiativeBonus: dexMod + ((preferences.initiativeBonus as number) ?? 0),
    speed: getBaseSpeed(raw),
    avatarUrl: (raw.avatarUrl as string) ?? undefined,
    playerName:
      ((raw.campaign as Record<string, unknown>)?.dmUsername as string) ?? undefined,
    stats: statValues,
    proficiencyBonus: getProficiencyBonus(totalLevel),
    passivePerception: 10 + Math.floor(((statValues.wis ?? 10) - 10) / 2),
  };
}

function calculateMaxHP(raw: Record<string, unknown>): number {
  const baseHp = (raw.baseHitPoints as number) ?? 0;
  const bonusHp = (raw.bonusHitPoints as number) ?? 0;
  const overrideHp = raw.overrideHitPoints as number;
  if (overrideHp) return overrideHp;
  const classes =
    (raw.classes as Array<{ definition: { name: string }; level: number }>) ?? [];
  const totalLevel = classes.reduce((sum, c) => sum + c.level, 0);
  const stats = (raw.stats as Array<{ id: number; value: number | null }>) ?? [];
  const conScore = stats.find((s) => s.id === 3)?.value ?? 10;
  const conMod = Math.floor((conScore - 10) / 2);
  return baseHp + bonusHp + conMod * totalLevel;
}

function calculateAC(raw: Record<string, unknown>): number {
  const inventory =
    (raw.inventory as Array<{
      equipped: boolean;
      definition: { armorClass?: number };
    }>) ?? [];
  const armorItems = inventory.filter(
    (i) => i.equipped && i.definition?.armorClass != null
  );
  if (armorItems.length > 0) return armorItems[0].definition.armorClass! + 10;
  const stats = (raw.stats as Array<{ id: number; value: number | null }>) ?? [];
  const dex = stats.find((s) => s.id === 2)?.value ?? 10;
  return 10 + Math.floor((dex - 10) / 2);
}

function getBaseSpeed(raw: Record<string, unknown>): number {
  const race = (raw.race as Record<string, unknown>) ?? {};
  return ((race.weightSpeeds as Record<string, unknown>)?.normal as number) ?? 30;
}

function getProficiencyBonus(level: number): number {
  return Math.ceil(level / 4) + 1;
}

export function ddbCharacterToStatBlock(char: DDBCharacter): StatBlock {
  return {
    name: char.name,
    type: char.classes?.map((c) => `${c.name} ${c.level}`).join(" / ") ?? "Character",
    ac: char.ac,
    hp: char.maxHp,
    speed: `${char.speed} ft.`,
    str: char.stats.str,
    dex: char.stats.dex,
    con: char.stats.con,
    int: char.stats.int,
    wis: char.stats.wis,
    cha: char.stats.cha,
    imageUrl: char.avatarUrl,
  };
}
