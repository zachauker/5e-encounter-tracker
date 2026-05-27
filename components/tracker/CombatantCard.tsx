"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import type { CombatantWithParsed } from "@/lib/types";
import { hpColor, hpPercent } from "@/lib/types";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { HPControls } from "./HPControls";
import { ConditionPicker, ConditionDisplay } from "./ConditionPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Shield,
  Eye,
  EyeOff,
  Trash2,
  BookOpen,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Zap,
  User,
  Sword,
} from "lucide-react";

interface CombatantCardProps {
  combatant: CombatantWithParsed;
  isActive: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}

const TYPE_COLORS = {
  pc: "var(--hp-high)",
  npc: "var(--initiative)",
  monster: "var(--hp-low)",
};

const TYPE_ICONS = {
  pc: <User className="w-3 h-3" />,
  npc: <Zap className="w-3 h-3" />,
  monster: <Sword className="w-3 h-3" />,
};

export function CombatantCard({ combatant: c, isActive, dragHandleProps }: CombatantCardProps) {
  const {
    setInitiative,
    toggleConcentration,
    removeCombatant,
    showStatBlock,
    updateCombatant,
    selectCombatant,
    selectedCombatantId,
  } = useEncounterStore();

  const isSelected = selectedCombatantId === c.id;
  const [editingInit, setEditingInit] = useState(false);
  const [initVal, setInitVal] = useState(String(c.initiative ?? ""));
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(c.name);

  const pct = hpPercent(c.hpCurrent, c.hpMax);
  const color = hpColor(c.hpCurrent, c.hpMax);
  const typeColor = TYPE_COLORS[c.type];
  const isDead = c.hpCurrent <= 0 && c.hpMax > 0;

  function commitInit() {
    const val = parseFloat(initVal);
    setInitiative(c.id, isNaN(val) ? null : val);
    setEditingInit(false);
  }

  function commitName() {
    if (nameVal.trim()) updateCombatant(c.id, { name: nameVal.trim() });
    setEditingName(false);
  }

  return (
    <div
      className={cn(
        "relative rounded-xl border transition-all duration-200 overflow-hidden",
        isActive && "combatant-active border-[var(--initiative)]",
        !isActive && "border-border",
        isDead && "opacity-60",
        isSelected && !isActive && "border-muted-foreground",
        c.color ? "border-l-[3px]" : ""
      )}
      style={c.color ? { borderLeftColor: c.color } : undefined}
      onClick={() => selectCombatant(isSelected ? null : c.id)}
    >
      {/* HP bar strip at top */}
      {c.hpMax > 0 && (
        <div className="h-1 bg-muted">
          <div
            className="hp-bar h-full"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
      )}

      <div className="p-3">
        {/* Header row */}
        <div className="flex items-start gap-2">
          {/* Drag handle */}
          <div
            {...dragHandleProps}
            className="mt-0.5 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
          >
            <GripVertical className="w-4 h-4" />
          </div>

          {/* Initiative */}
          <div className="flex-none">
            {editingInit ? (
              <Input
                autoFocus
                type="number"
                value={initVal}
                onChange={(e) => setInitVal(e.target.value)}
                onBlur={commitInit}
                onKeyDown={(e) => { if (e.key === "Enter") commitInit(); if (e.key === "Escape") setEditingInit(false); }}
                className="w-14 h-8 text-center text-sm font-bold px-1"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); setEditingInit(true); setInitVal(String(c.initiative ?? "")); }}
                className="w-14 h-8 flex flex-col items-center justify-center rounded-md bg-muted hover:bg-accent transition-colors"
                title="Click to set initiative"
              >
                <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Init</span>
                <span className="text-sm font-bold text-[var(--initiative)]">
                  {c.initiative ?? "—"}
                </span>
              </button>
            )}
          </div>

          {/* Avatar */}
          {c.avatarUrl ? (
            <img
              src={c.avatarUrl}
              alt={c.name}
              className="w-9 h-9 rounded-full object-cover border border-border flex-none"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div
              className="w-9 h-9 rounded-full border border-border flex items-center justify-center flex-none text-muted-foreground"
              style={{ backgroundColor: `${typeColor}22`, borderColor: typeColor }}
            >
              {TYPE_ICONS[c.type]}
            </div>
          )}

          {/* Name & type */}
          <div className="flex-1 min-w-0">
            {editingName ? (
              <Input
                autoFocus
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => { if (e.key === "Enter") commitName(); if (e.key === "Escape") setEditingName(false); }}
                className="h-7 text-sm font-semibold px-1"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingName(true); setNameVal(c.name); }}
                  className={cn(
                    "text-sm font-semibold truncate text-left hover:text-primary transition-colors",
                    isActive && "text-[var(--initiative)]",
                    isDead && "line-through text-muted-foreground"
                  )}
                >
                  {c.name}
                </button>
                {isActive && (
                  <span className="flex-none w-1.5 h-1.5 rounded-full bg-[var(--initiative)] animate-pulse" />
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className="text-[10px] font-medium capitalize flex items-center gap-0.5"
                style={{ color: typeColor }}
              >
                {TYPE_ICONS[c.type]} {c.type}
              </span>
              {c.playerName && (
                <span className="text-[10px] text-muted-foreground">• {c.playerName}</span>
              )}
              {c.isConcentrating && (
                <span className="text-[10px] text-blue-400 font-medium">● Concentrating</span>
              )}
            </div>
          </div>

          {/* AC */}
          <div className="flex-none flex flex-col items-center">
            <Shield className="w-3 h-3 text-muted-foreground" />
            <span className="text-sm font-bold">{c.ac}</span>
          </div>

          {/* HP compact */}
          <div className="flex-none" onClick={(e) => e.stopPropagation()}>
            <HPControls
              combatantId={c.id}
              hpCurrent={c.hpCurrent}
              hpMax={c.hpMax}
              hpTemp={c.hpTemp}
              compact={true}
            />
          </div>
        </div>

        {/* Conditions */}
        {c.conditions.length > 0 && (
          <div className="mt-2 pl-8">
            <ConditionDisplay conditions={c.conditions} compact />
          </div>
        )}

        {/* Expanded panel */}
        {isSelected && (
          <div
            className="mt-3 pt-3 border-t border-border space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <HPControls
              combatantId={c.id}
              hpCurrent={c.hpCurrent}
              hpMax={c.hpMax}
              hpTemp={c.hpTemp}
            />

            <ConditionPicker combatantId={c.id} conditions={c.conditions}>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 w-full">
                <span>Conditions</span>
                {c.conditions.length > 0 && (
                  <span className="text-muted-foreground">({c.conditions.length})</span>
                )}
              </Button>
            </ConditionPicker>

            <div className="flex gap-1 flex-wrap">
              <Button
                size="sm"
                variant={c.isConcentrating ? "initiative" : "ghost"}
                className="h-7 text-xs"
                onClick={() => toggleConcentration(c.id)}
              >
                Concentration
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => updateCombatant(c.id, { isVisible: !c.isVisible })}
              >
                {c.isVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                {c.isVisible ? "Visible" : "Hidden"}
              </Button>
              {c.statBlock && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => showStatBlock(c.id)}
                >
                  <BookOpen className="w-3 h-3" /> Stat Block
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={() => removeCombatant(c.id)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>

            {c.notes !== null && (
              <textarea
                className="w-full bg-muted rounded-md border border-border text-xs p-2 resize-none placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Notes..."
                rows={2}
                defaultValue={c.notes ?? ""}
                onBlur={(e) => useEncounterStore.getState().setNotes(c.id, e.target.value)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
