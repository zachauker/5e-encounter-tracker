export type Condition =
  | "blinded"
  | "charmed"
  | "deafened"
  | "exhaustion"
  | "frightened"
  | "grappled"
  | "incapacitated"
  | "invisible"
  | "paralyzed"
  | "petrified"
  | "poisoned"
  | "prone"
  | "restrained"
  | "stunned"
  | "unconscious"
  | "concentration"
  | "dodging"
  | "raging"
  | "flying";

export const CONDITION_COLORS: Record<Condition, string> = {
  blinded: "#6b7280",
  charmed: "#ec4899",
  deafened: "#6b7280",
  exhaustion: "#78716c",
  frightened: "#a855f7",
  grappled: "#f97316",
  incapacitated: "#ef4444",
  invisible: "#e2e8f0",
  paralyzed: "#eab308",
  petrified: "#94a3b8",
  poisoned: "#22c55e",
  prone: "#78716c",
  restrained: "#f97316",
  stunned: "#eab308",
  unconscious: "#ef4444",
  concentration: "#60a5fa",
  dodging: "#34d399",
  raging: "#f87171",
  flying: "#7dd3fc",
};

export const CONDITION_ICONS: Record<Condition, string> = {
  blinded: "👁️",
  charmed: "💜",
  deafened: "🔇",
  exhaustion: "😰",
  frightened: "😱",
  grappled: "🤝",
  incapacitated: "❌",
  invisible: "👻",
  paralyzed: "⚡",
  petrified: "🪨",
  poisoned: "☠️",
  prone: "⬇️",
  restrained: "⛓️",
  stunned: "💫",
  unconscious: "💀",
  concentration: "🔵",
  dodging: "🛡️",
  raging: "🔥",
  flying: "🦅",
};

export interface StatBlock {
  name: string;
  size?: string;
  type?: string;
  subtype?: string;
  alignment?: string;
  ac?: number;
  acNote?: string;
  hp?: number;
  hitDice?: string;
  speed?: string;
  str?: number;
  dex?: number;
  con?: number;
  int?: number;
  wis?: number;
  cha?: number;
  savingThrows?: Record<string, number>;
  skills?: Record<string, number>;
  damageVulnerabilities?: string;
  damageResistances?: string;
  damageImmunities?: string;
  conditionImmunities?: string;
  senses?: string;
  languages?: string;
  cr?: string;
  xp?: number;
  abilities?: Array<{ name: string; desc: string }>;
  actions?: Array<{ name: string; desc: string }>;
  bonusActions?: Array<{ name: string; desc: string }>;
  reactions?: Array<{ name: string; desc: string }>;
  legendaryActions?: Array<{ name: string; desc: string }>;
  spellcasting?: string;
  imageUrl?: string;
}

export interface DDBCharacter {
  id: number;
  name: string;
  race?: string;
  classes?: Array<{ name: string; level: number }>;
  level: number;
  ac: number;
  maxHp: number;
  currentHp?: number;
  tempHp?: number;
  initiativeBonus: number;
  speed: number;
  avatarUrl?: string;
  playerName?: string;
  stats: {
    str: number;
    dex: number;
    con: number;
    int: number;
    wis: number;
    cha: number;
  };
  spellSlots?: Record<string, { used: number; max: number }>;
  proficiencyBonus: number;
  passivePerception: number;
  savingThrows?: Record<string, number>;
  skills?: Record<string, number>;
}

export interface EncounterWithCombatants {
  id: string;
  name: string;
  status: "idle" | "active" | "completed";
  round: number;
  currentCombatantId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  combatants: CombatantWithParsed[];
}

export interface CombatantWithParsed {
  id: string;
  encounterId: string;
  name: string;
  type: "pc" | "npc" | "monster";
  initiative: number | null;
  initiativeBonus: number;
  hpCurrent: number;
  hpMax: number;
  hpTemp: number;
  ac: number;
  speed: number;
  conditions: Condition[];
  notes: string | null;
  isConcentrating: boolean;
  isVisible: boolean;
  sortOrder: number;
  ddbCharacterId: string | null;
  monsterSlug: string | null;
  statBlock: StatBlock | null;
  avatarUrl: string | null;
  playerName: string | null;
  color: string | null;
}

export function parseModifier(score: number): string {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

export function getModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function hpPercent(current: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (current / max) * 100));
}

export function hpColor(current: number, max: number): string {
  const pct = hpPercent(current, max);
  if (pct > 50) return "var(--hp-high)";
  if (pct > 25) return "var(--hp-med)";
  return "var(--hp-low)";
}
