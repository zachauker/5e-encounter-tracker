"use client";

import React, { useEffect, useState, useCallback } from "react";
import { MapPinOff, ChevronUp, ChevronDown } from "lucide-react";

interface UnpinnedNote {
  id: string;
  name: string;
  noteType: string | null;
}

interface UnpinnedNotesTrayProps {
  campaignId: string;
  date: string | null;       // selected session date; null = all dates
  reloadKey: number;         // bump to refetch after a pin is placed
  onPick: (noteId: string) => void;
}

// Collapsible strip listing session notes for the selected date that aren't
// pinned to any map yet. Clicking one hands its id up to start placement.
export function UnpinnedNotesTray({ campaignId, date, reloadKey, onPick }: UnpinnedNotesTrayProps) {
  const [notes, setNotes] = useState<UnpinnedNote[]>([]);
  const [open, setOpen] = useState(true);

  const load = useCallback(() => {
    if (!campaignId) return;
    const q = new URLSearchParams({ campaignId });
    if (date) q.set("date", date);
    fetch(`/api/sessions/unpinned?${q.toString()}`)
      .then((r) => r.json())
      .then((data) => setNotes(data.items ?? []));
  }, [campaignId, date]);

  useEffect(() => { load(); }, [load, reloadKey]);

  if (notes.length === 0) return null;

  return (
    <div className="absolute bottom-4 right-4 w-64 rounded-xl border border-border bg-card shadow-2xl z-[900]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold"
      >
        <MapPinOff className="w-3.5 h-3.5 text-muted-foreground" />
        Unplaced {date ? "this session" : "notes"} ({notes.length})
        {open ? <ChevronDown className="w-3.5 h-3.5 ml-auto" /> : <ChevronUp className="w-3.5 h-3.5 ml-auto" />}
      </button>
      {open && (
        <ul className="max-h-48 overflow-y-auto border-t border-border p-1.5 space-y-1">
          {notes.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => onPick(n.id)}
                className="w-full text-left rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
              >
                <span className="font-medium">{n.name}</span>
                {n.noteType && <span className="block text-[11px] text-muted-foreground">{n.noteType}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
