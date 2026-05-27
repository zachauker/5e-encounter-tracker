"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Play,
  SkipForward,
  SkipBack,
  Square,
  RotateCcw,
  Save,
  Plus,
  Swords,
  Edit2,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AddCombatantDialog } from "./AddCombatantDialog";

interface EncounterControlsProps {
  onSave: () => Promise<void>;
  saving: boolean;
}

export function EncounterControls({ onSave, saving }: EncounterControlsProps) {
  const {
    encounter,
    nextTurn,
    prevTurn,
    startEncounter,
    endEncounter,
    resetRound,
    isDirty,
    updateCombatant,
  } = useEncounterStore();

  const [addOpen, setAddOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(encounter?.name ?? "");

  useEffect(() => {
    setNameVal(encounter?.name ?? "");
  }, [encounter?.name]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
      if (e.key === "n" || e.key === "ArrowRight") { e.preventDefault(); nextTurn(); }
      if (e.key === "p" || e.key === "ArrowLeft") { e.preventDefault(); prevTurn(); }
      if (e.key === "a") { e.preventDefault(); setAddOpen(true); }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); onSave(); }
    },
    [nextTurn, prevTurn, onSave]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!encounter) return null;

  const isActive = encounter.status === "active";
  const currentCombatant = encounter.combatants.find(
    (c) => c.id === encounter.currentCombatantId
  );

  async function saveName() {
    if (nameVal.trim() && nameVal !== encounter?.name) {
      await fetch(`/api/encounters/${encounter!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameVal.trim() }),
      });
    }
    setEditingName(false);
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3 border-b border-border bg-card/50 backdrop-blur-sm">
      {/* Top row: title + save */}
      <div className="flex items-center gap-2">
        {editingName ? (
          <div className="flex items-center gap-1 flex-1">
            <Input
              autoFocus
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }}
              className="h-8 text-base font-bold"
            />
            <Button size="icon-sm" variant="ghost" onClick={saveName}>
              <Check className="w-3.5 h-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Swords className="w-4 h-4 text-primary flex-none" />
            <h1 className="text-base font-bold truncate">{encounter.name}</h1>
            <Button
              size="icon-sm"
              variant="ghost"
              className="flex-none opacity-50 hover:opacity-100"
              onClick={() => setEditingName(true)}
            >
              <Edit2 className="w-3 h-3" />
            </Button>
          </div>
        )}

        <Button
          size="sm"
          variant="ghost"
          onClick={onSave}
          disabled={saving || !isDirty}
          className={cn("gap-1.5 flex-none", isDirty && "text-primary")}
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? "Saving..." : isDirty ? "Save" : "Saved"}
        </Button>
      </div>

      {/* Bottom row: combat controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Round/turn counter */}
        <div className="flex items-center gap-3 bg-muted rounded-lg px-3 py-1.5">
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Round</p>
            <p className="text-lg font-bold text-[var(--initiative)] leading-none">{encounter.round}</p>
          </div>
          {isActive && currentCombatant && (
            <div className="border-l border-border pl-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Active</p>
              <p className="text-sm font-semibold truncate max-w-28">{currentCombatant.name}</p>
            </div>
          )}
        </div>

        {/* Combat buttons */}
        <div className="flex items-center gap-1">
          {!isActive ? (
            <Button
              size="sm"
              onClick={startEncounter}
              disabled={encounter.combatants.length === 0}
              className="gap-1.5"
            >
              <Play className="w-3.5 h-3.5" /> Start
            </Button>
          ) : (
            <>
              <Button size="icon-sm" variant="ghost" onClick={prevTurn} title="Previous turn (← or P)">
                <SkipBack className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="sm"
                onClick={nextTurn}
                className="gap-1.5 bg-[var(--initiative)]/20 text-[var(--initiative)] border border-[var(--initiative)]/40 hover:bg-[var(--initiative)]/30"
                title="Next turn (→ or N)"
              >
                <SkipForward className="w-3.5 h-3.5" /> Next Turn
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={endEncounter} title="End encounter">
                <Square className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
          <Button size="icon-sm" variant="ghost" onClick={resetRound} title="Reset">
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex-1" />

        <Button
          size="sm"
          variant="outline"
          onClick={() => setAddOpen(true)}
          className="gap-1.5"
          title="Add combatant (A)"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </Button>
      </div>

      {/* Keyboard shortcut hint */}
      <p className="text-[10px] text-muted-foreground">
        <kbd className="px-1 rounded bg-muted border border-border">N</kbd> next ·{" "}
        <kbd className="px-1 rounded bg-muted border border-border">P</kbd> prev ·{" "}
        <kbd className="px-1 rounded bg-muted border border-border">A</kbd> add ·{" "}
        <kbd className="px-1 rounded bg-muted border border-border">⌘S</kbd> save
      </p>

      <AddCombatantDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
