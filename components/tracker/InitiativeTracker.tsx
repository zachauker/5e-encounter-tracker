"use client";

import React, { useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { CombatantWithParsed } from "@/lib/types";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { CombatantCard } from "./CombatantCard";
import { ScrollArea } from "@/components/ui/scroll-area";

export function InitiativeTracker() {
  const { encounter, reorderCombatants } = useEncounterStore();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragItemRef = useRef<CombatantWithParsed | null>(null);

  if (!encounter) return null;

  const sorted = [...encounter.combatants].sort((a, b) => a.sortOrder - b.sortOrder);

  function handleDragStart(e: React.DragEvent, idx: number) {
    dragItemRef.current = sorted[idx];
    setDragIndex(idx);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverIndex(idx);
  }

  function handleDrop(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === idx) return;
    const items = [...sorted];
    const [moved] = items.splice(dragIndex, 1);
    items.splice(idx, 0, moved);
    reorderCombatants(items);
    setDragIndex(null);
    setOverIndex(null);
  }

  function handleDragEnd() {
    setDragIndex(null);
    setOverIndex(null);
    dragItemRef.current = null;
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-2">
        {sorted.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">No combatants yet.</p>
            <p className="text-xs mt-1">Add monsters, NPCs, or import characters.</p>
          </div>
        )}
        {sorted.map((combatant, idx) => (
          <div
            key={combatant.id}
            draggable
            onDragStart={(e) => handleDragStart(e, idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={(e) => handleDrop(e, idx)}
            onDragEnd={handleDragEnd}
            className={cn(
              "transition-transform duration-150",
              dragIndex === idx && "combatant-dragging",
              overIndex === idx && dragIndex !== idx && "translate-y-0.5"
            )}
          >
            <CombatantCard
              combatant={combatant}
              isActive={encounter.currentCombatantId === combatant.id}
              dragHandleProps={{
                onMouseDown: (e) => e.stopPropagation(),
              }}
            />
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
