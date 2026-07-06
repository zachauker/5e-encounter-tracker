"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useEncounterStore } from "@/lib/store/encounter-store";
import type { DDBCharacter } from "@/lib/types";

const POLL_INTERVAL_MS = 30_000; // 30 seconds

export function useDDBSync() {
  const { encounter, updateDDBCharacter, syncErrors, setSyncErrors } = useEncounterStore();
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  const ddbPCs = encounter?.combatants.filter(
    (c) => c.type === "pc" && c.ddbCharacterId
  ) ?? [];

  const refreshAll = useCallback(async () => {
    if (!ddbPCs.length) return;
    if (syncing) return;

    setSyncing(true);
    try {
      // Each fetch catches its own errors so Promise.allSettled always fulfills
      const results = await Promise.allSettled(
        ddbPCs.map((c) =>
          fetch(`/api/ddb/characters/${c.ddbCharacterId}`)
            .then((r) => {
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              return r.json();
            })
            .then((data: { character?: DDBCharacter; error?: string }) => ({
              combatantId: c.id,
              character: data.character ?? null,
            }))
            .catch(() => ({ combatantId: c.id, character: null }))
        )
      );

      if (!isMounted.current) return;

      const newErrors = new Set<string>();
      for (const result of results) {
        if (result.status === "fulfilled") {
          const { combatantId, character } = result.value;
          if (character) {
            updateDDBCharacter(combatantId, character);
          } else {
            newErrors.add(combatantId);
          }
        }
      }
      setSyncErrors(newErrors);
      setLastSyncedAt(new Date());
    } finally {
      if (isMounted.current) setSyncing(false);
    }
  }, [ddbPCs, syncing, updateDDBCharacter]); // eslint-disable-line react-hooks/exhaustive-deps

  // The poll reschedules itself only after the previous refresh settles (so slow
  // networks never stack overlapping polls). Route the self-call through a ref to
  // avoid referencing scheduleNext before it's declared.
  const scheduleNextRef = useRef<() => void>(() => {});
  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!document.hidden) refreshAll().finally(() => scheduleNextRef.current());
      else scheduleNextRef.current();
    }, POLL_INTERVAL_MS);
  }, [refreshAll]);

  useEffect(() => {
    scheduleNextRef.current = scheduleNext;
  }, [scheduleNext]);

  useEffect(() => {
    function handleVisibility() {
      if (!document.hidden) refreshAll();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [refreshAll]);

  useEffect(() => {
    if (!ddbPCs.length) return;
    isMounted.current = true;

    const init = setTimeout(() => refreshAll().finally(scheduleNext), 800);

    return () => {
      isMounted.current = false;
      clearTimeout(init);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [ddbPCs.map((c) => c.ddbCharacterId).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  return { refreshAll, lastSyncedAt, syncing, syncErrors };
}
