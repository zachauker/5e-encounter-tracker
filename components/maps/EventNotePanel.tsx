"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { X, Loader2, ExternalLink } from "lucide-react";
import { markerVisual } from "@/components/maps/marker-meta";
import { NotionBlocks } from "@/components/glossary/NotionBlocks";
import type { ResolvedMarker } from "@/components/maps/map-types";
import type { NotionBlockData } from "@/lib/notion/client";

interface NoteDetail {
  id: string;
  name: string;
  notionUrl: string | null;
  linkedLocations: { id: string; name: string }[];
  notionProps: { label: string; value: string }[];
}

interface EventNotePanelProps {
  marker: ResolvedMarker; // type === "event"
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

// Wide side panel for an event pin: properties, linked settings, and the full
// Notion page body rendered inline (fetched on open). Distinct from the compact
// MarkerInfoPanel used by every other marker type.
export function EventNotePanel({ marker, onClose, onEdit, onDelete }: EventNotePanelProps) {
  const meta = markerVisual(marker);
  const Icon = meta.icon;
  const [detail, setDetail] = useState<NoteDetail | null>(null);
  const [blocks, setBlocks] = useState<NotionBlockData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!marker.entityId) {
        if (!cancelled) { setLoading(false); setError("Session note not found."); }
        return;
      }
      setLoading(true);
      setError(null);
      setBlocks(null);
      try {
        const res = await fetch(`/api/sessions/${marker.entityId}`);
        if (!res.ok) { if (!cancelled) setError("Session note not found."); return; }
        const d: NoteDetail = await res.json();
        if (cancelled) return;
        setDetail(d);
        if (d.notionUrl) {
          const pageRes = await fetch(`/api/notion/page?url=${encodeURIComponent(d.notionUrl)}`);
          const pageData = await pageRes.json();
          if (cancelled) return;
          if (pageRes.ok) setBlocks(pageData.blocks);
          else setError(pageData.error ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [marker.entityId]);

  return (
    <div className="panel-in absolute top-4 left-4 bottom-4 w-96 max-w-[calc(100%-2rem)] flex flex-col rounded-xl border border-border bg-card shadow-2xl z-[1000]">
      <div className="flex items-start justify-between gap-2 p-3.5 border-b border-border flex-none">
        <div className="flex items-start gap-2.5 min-w-0">
          <Icon className="w-4 h-4 mt-1 flex-none" style={{ color: meta.color }} aria-hidden />
          <div className="min-w-0">
            <div className="font-display text-lg leading-tight">{marker.resolvedTitle}</div>
            <div className="mt-0.5 text-xs font-medium" style={{ color: meta.color }}>{meta.label}</div>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="flex-none text-muted-foreground hover:text-foreground">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {marker.resolvedSubtitle && <p className="text-xs text-destructive">{marker.resolvedSubtitle}</p>}
        {detail?.linkedLocations && detail.linkedLocations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {detail.linkedLocations.map((l) => (
              <Link key={l.id} href={`/locations/${l.id}`} className="rounded-full border border-border px-2 py-0.5 text-xs hover:border-muted-foreground/40">
                {l.name}
              </Link>
            ))}
          </div>
        )}
        {loading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        {error && <p className="text-sm text-muted-foreground">{error}</p>}
        {blocks && <NotionBlocks blocks={blocks} />}
        {!loading && !error && !blocks && detail && !detail.notionUrl && (
          <p className="text-sm text-muted-foreground">No Notion page linked.</p>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-border p-3 text-xs flex-none">
        {marker.entityId && (
          <Link href={`/sessions/${marker.entityId}`} className="font-medium text-primary hover:underline">Open page →</Link>
        )}
        {detail?.notionUrl && (
          <a href={detail.notionUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            Notion <ExternalLink className="w-3 h-3" />
          </a>
        )}
        <button onClick={onEdit} className="text-muted-foreground hover:text-foreground">Edit</button>
        <button onClick={onDelete} className="ml-auto text-destructive hover:underline">Delete</button>
      </div>
    </div>
  );
}
