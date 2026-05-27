"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { parseModifier, type StatBlock as StatBlockType } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@radix-ui/react-separator";

interface StatBlockProps {
  statBlock: StatBlockType;
  className?: string;
}

function AbilityScore({ label, score }: { label: string; score: number }) {
  const mod = parseModifier(score);
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className="text-base font-bold text-foreground">{score}</span>
      <span className="text-xs text-[var(--initiative)]">({mod})</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-bold uppercase tracking-wider text-primary">{title}</h4>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ActionEntry({ name, desc }: { name: string; desc: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const isLong = desc.length > 120;
  return (
    <div className="text-sm">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left"
      >
        <span className="font-semibold text-foreground">{name}.</span>{" "}
        <span className={cn("text-muted-foreground", !expanded && isLong && "line-clamp-2")}>
          {desc}
        </span>
        {isLong && (
          <span className="text-primary ml-1 text-xs">{expanded ? "less" : "more"}</span>
        )}
      </button>
    </div>
  );
}

export function StatBlock({ statBlock: s, className }: StatBlockProps) {
  return (
    <ScrollArea className={cn("h-full", className)}>
      <div className="p-4 space-y-4">
        {s.imageUrl && (
          <div className="flex justify-center">
            <img
              src={s.imageUrl}
              alt={s.name}
              className="w-32 h-32 object-cover rounded-lg border border-border"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
        )}

        <div>
          <h2 className="text-xl font-bold text-foreground">{s.name}</h2>
          <p className="text-sm text-muted-foreground italic">
            {[s.size, s.type, s.subtype ? `(${s.subtype})` : null, s.alignment]
              .filter(Boolean)
              .join(" ")}
          </p>
        </div>

        <div className="border-t border-primary/40 pt-2 space-y-1">
          {s.ac != null && (
            <p className="text-sm">
              <span className="text-muted-foreground">Armor Class</span>{" "}
              <span className="font-semibold">{s.ac}{s.acNote ? ` (${s.acNote})` : ""}</span>
            </p>
          )}
          {s.hp != null && (
            <p className="text-sm">
              <span className="text-muted-foreground">Hit Points</span>{" "}
              <span className="font-semibold">{s.hp}{s.hitDice ? ` (${s.hitDice})` : ""}</span>
            </p>
          )}
          {s.speed && (
            <p className="text-sm">
              <span className="text-muted-foreground">Speed</span>{" "}
              <span className="font-semibold">{s.speed}</span>
            </p>
          )}
        </div>

        {(s.str != null || s.dex != null || s.con != null) && (
          <div className="border-t border-primary/40 pt-2">
            <div className="grid grid-cols-6 gap-1">
              {s.str != null && <AbilityScore label="STR" score={s.str} />}
              {s.dex != null && <AbilityScore label="DEX" score={s.dex} />}
              {s.con != null && <AbilityScore label="CON" score={s.con} />}
              {s.int != null && <AbilityScore label="INT" score={s.int} />}
              {s.wis != null && <AbilityScore label="WIS" score={s.wis} />}
              {s.cha != null && <AbilityScore label="CHA" score={s.cha} />}
            </div>
          </div>
        )}

        <div className="border-t border-primary/40 pt-2 space-y-1">
          {s.savingThrows && Object.keys(s.savingThrows).length > 0 && (
            <p className="text-sm">
              <span className="text-muted-foreground">Saving Throws</span>{" "}
              <span>{Object.entries(s.savingThrows).map(([k, v]) => `${k} +${v}`).join(", ")}</span>
            </p>
          )}
          {s.skills && Object.keys(s.skills).length > 0 && (
            <p className="text-sm">
              <span className="text-muted-foreground">Skills</span>{" "}
              <span>{Object.entries(s.skills).map(([k, v]) => `${k} +${v}`).join(", ")}</span>
            </p>
          )}
          {s.damageVulnerabilities && (
            <p className="text-sm">
              <span className="text-muted-foreground">Vulnerabilities</span>{" "}
              <span>{s.damageVulnerabilities}</span>
            </p>
          )}
          {s.damageResistances && (
            <p className="text-sm">
              <span className="text-muted-foreground">Resistances</span>{" "}
              <span>{s.damageResistances}</span>
            </p>
          )}
          {s.damageImmunities && (
            <p className="text-sm">
              <span className="text-muted-foreground">Immunities</span>{" "}
              <span>{s.damageImmunities}</span>
            </p>
          )}
          {s.conditionImmunities && (
            <p className="text-sm">
              <span className="text-muted-foreground">Condition Immunities</span>{" "}
              <span>{s.conditionImmunities}</span>
            </p>
          )}
          {s.senses && (
            <p className="text-sm">
              <span className="text-muted-foreground">Senses</span>{" "}
              <span>{s.senses}</span>
            </p>
          )}
          {s.languages && (
            <p className="text-sm">
              <span className="text-muted-foreground">Languages</span>{" "}
              <span>{s.languages}</span>
            </p>
          )}
          {s.cr && (
            <p className="text-sm">
              <span className="text-muted-foreground">Challenge</span>{" "}
              <span className="font-semibold">{s.cr}{s.xp ? ` (${s.xp.toLocaleString()} XP)` : ""}</span>
            </p>
          )}
        </div>

        {s.abilities && s.abilities.length > 0 && (
          <Section title="Traits">
            {s.abilities.map((a) => (
              <ActionEntry key={a.name} name={a.name} desc={a.desc} />
            ))}
          </Section>
        )}

        {s.actions && s.actions.length > 0 && (
          <Section title="Actions">
            {s.actions.map((a) => (
              <ActionEntry key={a.name} name={a.name} desc={a.desc} />
            ))}
          </Section>
        )}

        {s.bonusActions && s.bonusActions.length > 0 && (
          <Section title="Bonus Actions">
            {s.bonusActions.map((a) => (
              <ActionEntry key={a.name} name={a.name} desc={a.desc} />
            ))}
          </Section>
        )}

        {s.reactions && s.reactions.length > 0 && (
          <Section title="Reactions">
            {s.reactions.map((a) => (
              <ActionEntry key={a.name} name={a.name} desc={a.desc} />
            ))}
          </Section>
        )}

        {s.legendaryActions && s.legendaryActions.length > 0 && (
          <Section title="Legendary Actions">
            {s.legendaryActions.map((a) => (
              <ActionEntry key={a.name} name={a.name} desc={a.desc} />
            ))}
          </Section>
        )}
      </div>
    </ScrollArea>
  );
}
