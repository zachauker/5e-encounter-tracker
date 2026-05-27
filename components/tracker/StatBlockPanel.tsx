"use client";

import React from "react";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { StatBlock } from "./StatBlock";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatBlockPanel() {
  const { encounter, statBlockCombatantId, showStatBlock } = useEncounterStore();

  const combatant = encounter?.combatants.find((c) => c.id === statBlockCombatantId);
  const isOpen = !!combatant?.statBlock;

  return (
    <div
      className={cn(
        "flex flex-col border-l border-border bg-card transition-all duration-300 overflow-hidden",
        isOpen ? "w-80 min-w-80" : "w-0 min-w-0"
      )}
    >
      {combatant?.statBlock && (
        <>
          <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-none">
            <span className="text-sm font-semibold">Stat Block</span>
            <Button size="icon-sm" variant="ghost" onClick={() => showStatBlock(null)}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="flex-1 overflow-hidden">
            <StatBlock statBlock={combatant.statBlock} />
          </div>
        </>
      )}
    </div>
  );
}
