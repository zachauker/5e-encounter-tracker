"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Plus, X, ChevronRight } from "lucide-react";
import { StaticMapCanvas } from "@/components/maps/StaticMapCanvas";
import { MarkerFormDialog } from "@/components/maps/MarkerFormDialog";
import { useCampaignStore } from "@/lib/store/campaign-store";
import type { MapData, ResolvedMarker } from "@/components/maps/map-types";

const TiledMapCanvas = dynamic(
  () => import("@/components/maps/TiledMapCanvas").then((mod) => mod.TiledMapCanvas),
  { ssr: false }
);

const ENTITY_PATH: Record<string, string> = { character: "characters", location: "locations", faction: "factions" };

export function MapViewer() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { activeCampaignId } = useCampaignStore();

  const [map, setMap] = useState<MapData | null>(null);
  const [markers, setMarkers] = useState<ResolvedMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const match = window.location.hash.match(/^#marker-(.+)$/);
    return match ? match[1] : null;
  });
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null);
  const [editingMarker, setEditingMarker] = useState<ResolvedMarker | null>(null);
  const [viewZoom, setViewZoom] = useState<number | undefined>(undefined);

  const loadMarkers = useCallback(async () => {
    const res = await fetch(`/api/maps/${id}/markers`);
    if (res.ok) setMarkers(await res.json());
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const [mapRes] = await Promise.all([fetch(`/api/maps/${id}`), loadMarkers()]);
        if (cancelled) return;
        setMap(mapRes.ok ? await mapRes.json() : null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [id, loadMarkers]);

  function handleCanvasClick(pos: { x: number; y: number }) {
    setPendingPosition(pos);
    setAddMode(false);
  }

  function handleMarkerClick(marker: ResolvedMarker) {
    if (marker.type === "submap" && marker.targetMapId) {
      router.push(`/maps/${marker.targetMapId}`);
      return;
    }
    setSelectedId(marker.id === selectedId ? null : marker.id);
  }

  function handleMarkerDragMove(markerId: string, pos: { x: number; y: number }) {
    setMarkers((prev) => prev.map((m) => (m.id === markerId ? { ...m, ...pos } : m)));
  }

  function handleMarkerDragEnd(markerId: string, pos: { x: number; y: number }) {
    fetch(`/api/maps/markers/${markerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pos),
    });
  }

  const selectedMarker = markers.find((m) => m.id === selectedId) ?? null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!map) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Map not found.</p>
        <Button onClick={() => router.push("/maps")}>Back to Maps</Button>
      </div>
    );
  }

  const canvasProps = {
    map,
    markers,
    addMode,
    selectedId,
    onImageClick: handleCanvasClick,
    onMarkerClick: handleMarkerClick,
    onMarkerDragMove: handleMarkerDragMove,
    onMarkerDragEnd: handleMarkerDragEnd,
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border flex-none">
        <div className="flex items-center gap-1.5 text-sm min-w-0">
          <Link href="/maps" className="text-muted-foreground hover:text-foreground flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> Maps
          </Link>
          {map.breadcrumb.map((b) => (
            <React.Fragment key={b.id}>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              <Link href={`/maps/${b.id}`} className="text-muted-foreground hover:text-foreground truncate">
                {b.name}
              </Link>
            </React.Fragment>
          ))}
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-medium truncate">{map.name}</span>
        </div>
        <Button
          size="sm"
          variant={addMode ? "initiative" : "outline"}
          onClick={() => setAddMode((v) => !v)}
          className="gap-1.5 flex-none"
        >
          {addMode ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {addMode ? "Cancel" : "Add Marker"}
        </Button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {map.renderMode === "tiled" ? (
          <TiledMapCanvas {...canvasProps} onZoomChange={setViewZoom} />
        ) : (
          <StaticMapCanvas {...canvasProps} />
        )}

        {selectedMarker && (
          <div className="absolute top-4 left-4 w-64 rounded-lg border border-border bg-card p-3 shadow-xl space-y-2 z-[1000]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium text-sm">{selectedMarker.resolvedTitle}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">{selectedMarker.type}</div>
              </div>
              <button onClick={() => setSelectedId(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {selectedMarker.type === "note" && selectedMarker.note && (
              <p className="text-sm text-muted-foreground">{selectedMarker.note}</p>
            )}
            {selectedMarker.resolvedSubtitle && (
              <p className="text-xs text-destructive">{selectedMarker.resolvedSubtitle}</p>
            )}
            <div className="flex gap-2 pt-1">
              {ENTITY_PATH[selectedMarker.type] && selectedMarker.entityId && (
                <Link
                  href={`/${ENTITY_PATH[selectedMarker.type]}/${selectedMarker.entityId}`}
                  className="text-xs text-primary hover:underline"
                >
                  View {selectedMarker.type} →
                </Link>
              )}
              <button
                onClick={() => {
                  setEditingMarker(selectedMarker);
                  setSelectedId(null);
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Edit
              </button>
              <button
                onClick={async () => {
                  await fetch(`/api/maps/markers/${selectedMarker.id}`, { method: "DELETE" });
                  setSelectedId(null);
                  loadMarkers();
                }}
                className="text-xs text-destructive hover:underline"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>

      {(pendingPosition || editingMarker) && (
        <MarkerFormDialog
          mapId={map.id}
          campaignId={activeCampaignId ?? ""}
          position={pendingPosition}
          marker={editingMarker}
          currentZoom={map.renderMode === "tiled" ? viewZoom : undefined}
          onClose={() => {
            setPendingPosition(null);
            setEditingMarker(null);
          }}
          onSaved={() => {
            setPendingPosition(null);
            setEditingMarker(null);
            loadMarkers();
          }}
        />
      )}
    </div>
  );
}
