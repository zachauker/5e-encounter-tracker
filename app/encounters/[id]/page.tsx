"use client";

import React, { useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useEncounterStore } from "@/lib/store/encounter-store";
import { EncounterControls } from "@/components/tracker/EncounterControls";
import { InitiativeTracker } from "@/components/tracker/InitiativeTracker";
import { StatBlockPanel } from "@/components/tracker/StatBlockPanel";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EncounterWithCombatants } from "@/lib/types";

export default function EncounterPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { encounter, setEncounter, isDirty, markClean } = useEncounterStore();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`/api/encounters/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Encounter not found");
        return r.json();
      })
      .then((data: EncounterWithCombatants) => {
        setEncounter(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id, setEncounter]);

  const save = useCallback(async () => {
    if (!encounter) return;
    setSaving(true);
    try {
      await fetch(`/api/encounters/${encounter.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: encounter.status,
          round: encounter.round,
          currentCombatantId: encounter.currentCombatantId,
          notes: encounter.notes,
          combatants: encounter.combatants,
        }),
      });
      markClean();
    } finally {
      setSaving(false);
    }
  }, [encounter, markClean]);

  // Auto-save when dirty
  useEffect(() => {
    if (!isDirty) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(save, 2000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [isDirty, save]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-destructive">{error}</p>
        <Button onClick={() => router.push("/")}>Back to Encounters</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Nav */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-background/80 backdrop-blur-sm flex-none">
        <Button size="icon-sm" variant="ghost" onClick={() => router.push("/")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <span className="text-xs text-muted-foreground">Encounters</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Main column */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <EncounterControls onSave={save} saving={saving} />
          <div className="flex-1 overflow-hidden">
            <InitiativeTracker />
          </div>
        </div>

        {/* Stat block sidebar */}
        <StatBlockPanel />
      </div>
    </div>
  );
}
