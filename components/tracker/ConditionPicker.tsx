"use client";

import React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import {
  type Condition,
  CONDITION_COLORS,
  CONDITION_ICONS,
  CONDITION_RULES,
} from "@/lib/types";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

/** Name + 5e rules text shown on hover, so a DM never reaches for the book mid-fight. */
function ConditionTooltip({ condition }: { condition: Condition }) {
  const color = CONDITION_COLORS[condition];
  return (
    <TooltipContent side="top" className="max-w-[16rem] px-3 py-2">
      <p className="font-semibold capitalize mb-0.5" style={{ color }}>
        {CONDITION_ICONS[condition]} {condition}
      </p>
      <p className="text-muted-foreground leading-snug">{CONDITION_RULES[condition]}</p>
    </TooltipContent>
  );
}

const ALL_CONDITIONS: Condition[] = [
  "blinded", "charmed", "deafened", "exhaustion", "frightened",
  "grappled", "incapacitated", "invisible", "paralyzed", "petrified",
  "poisoned", "prone", "restrained", "stunned", "unconscious",
  "concentration", "dodging", "raging", "flying",
];

interface ConditionPillProps {
  condition: Condition;
  active: boolean;
  onClick: () => void;
}

function ConditionPill({ condition, active, onClick }: ConditionPillProps) {
  const color = CONDITION_COLORS[condition];
  const icon = CONDITION_ICONS[condition];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border transition-all",
            active
              ? "border-current opacity-100"
              : "border-border bg-muted opacity-60 hover:opacity-90"
          )}
          style={active ? { color, borderColor: color, backgroundColor: `${color}22` } : undefined}
        >
          <span>{icon}</span>
          <span className="capitalize">{condition}</span>
        </button>
      </TooltipTrigger>
      <ConditionTooltip condition={condition} />
    </Tooltip>
  );
}

interface ConditionDisplayProps {
  conditions: Condition[];
  compact?: boolean;
}

export function ConditionDisplay({ conditions, compact = false }: ConditionDisplayProps) {
  if (conditions.length === 0) return null;
  if (compact) {
    return (
      <div className="flex flex-wrap gap-0.5">
        {conditions.map((c) => (
          <Tooltip key={c}>
            <TooltipTrigger asChild>
              <span className="text-sm cursor-help">{CONDITION_ICONS[c]}</span>
            </TooltipTrigger>
            <ConditionTooltip condition={c} />
          </Tooltip>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {conditions.map((c) => {
        const color = CONDITION_COLORS[c];
        return (
          <Tooltip key={c}>
            <TooltipTrigger asChild>
              <span
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border cursor-help"
                style={{ color, borderColor: color, backgroundColor: `${color}22` }}
              >
                {CONDITION_ICONS[c]} <span className="capitalize">{c}</span>
              </span>
            </TooltipTrigger>
            <ConditionTooltip condition={c} />
          </Tooltip>
        );
      })}
    </div>
  );
}

interface ConditionPickerProps {
  combatantId: string;
  conditions: Condition[];
  children: React.ReactNode;
}

export function ConditionPicker({ combatantId, conditions, children }: ConditionPickerProps) {
  const { toggleCondition } = useEncounterStore();

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>{children}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="z-50 w-72 rounded-xl border border-border bg-popover p-3 shadow-xl"
          sideOffset={8}
        >
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
            Conditions
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_CONDITIONS.map((cond) => (
              <ConditionPill
                key={cond}
                condition={cond}
                active={conditions.includes(cond)}
                onClick={() => toggleCondition(combatantId, cond)}
              />
            ))}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
