"use client";

import React, { useMemo, useCallback, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { renderToStaticMarkup } from "react-dom/server";
import "leaflet/dist/leaflet.css";
import { MapMarkerPin } from "@/components/maps/MapMarkerPin";
import type { MapCanvasProps, ResolvedMarker } from "@/components/maps/map-types";

const CRS = L.CRS.Simple;

function markerIcon(type: ResolvedMarker["type"], selected: boolean) {
  return L.divIcon({
    className: "",
    html: renderToStaticMarkup(<MapMarkerPin type={type} selected={selected} />),
    iconSize: [28, 36],
    iconAnchor: [14, 36],
  });
}

function ClickHandler({
  addMode,
  onImageClick,
  width,
  height,
  maxZoom,
}: {
  addMode: boolean;
  onImageClick: (pos: { x: number; y: number }) => void;
  width: number;
  height: number;
  maxZoom: number;
}) {
  useMapEvents({
    click(e) {
      if (!addMode) return;
      const point = CRS.latLngToPoint(e.latlng, maxZoom);
      onImageClick({ x: point.x / width, y: point.y / height });
    },
  });
  return null;
}

function ZoomReporter({ onZoomChange }: { onZoomChange?: (zoom: number) => void }) {
  const map = useMap();
  useMapEvents({
    zoomend() {
      onZoomChange?.(map.getZoom());
    },
  });
  return null;
}

function MarkerWithReveal({
  marker,
  selected,
  position,
  onMarkerClick,
  onMarkerDragMove,
  onMarkerDragEnd,
  width,
  height,
  maxZoom,
}: {
  marker: ResolvedMarker;
  selected: boolean;
  position: L.LatLng;
  onMarkerClick: (marker: ResolvedMarker) => void;
  onMarkerDragMove: (markerId: string, pos: { x: number; y: number }) => void;
  onMarkerDragEnd: (markerId: string, pos: { x: number; y: number }) => void;
  width: number;
  height: number;
  maxZoom: number;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({
    zoomend() {
      setZoom(map.getZoom());
    },
  });

  if (marker.minZoom !== null && zoom < marker.minZoom) return null;

  return (
    <Marker
      position={position}
      icon={markerIcon(marker.type, selected)}
      draggable
      eventHandlers={{
        click: () => onMarkerClick(marker),
        drag: (e) => {
          const point = CRS.latLngToPoint((e.target as L.Marker).getLatLng(), maxZoom);
          onMarkerDragMove(marker.id, { x: point.x / width, y: point.y / height });
        },
        dragend: (e) => {
          const point = CRS.latLngToPoint((e.target as L.Marker).getLatLng(), maxZoom);
          onMarkerDragEnd(marker.id, { x: point.x / width, y: point.y / height });
        },
      }}
    />
  );
}

export function TiledMapCanvas({
  map,
  markers,
  addMode,
  selectedId,
  onImageClick,
  onMarkerClick,
  onMarkerDragMove,
  onMarkerDragEnd,
  onZoomChange,
}: MapCanvasProps) {
  const width = map.width ?? 0;
  const height = map.height ?? 0;
  const maxZoom = map.maxZoom ?? 0;

  const bounds = useMemo(
    () =>
      L.latLngBounds(
        CRS.pointToLatLng(L.point(0, height), maxZoom),
        CRS.pointToLatLng(L.point(width, 0), maxZoom)
      ),
    [width, height, maxZoom]
  );

  const fractionalToLatLng = useCallback(
    (x: number, y: number) => CRS.pointToLatLng(L.point(x * width, y * height), maxZoom),
    [width, height, maxZoom]
  );

  return (
    <div className="relative flex-1 overflow-hidden bg-black/40" style={{ cursor: addMode ? "crosshair" : "" }}>
      <MapContainer
        crs={CRS}
        bounds={bounds}
        maxBounds={bounds}
        minZoom={0}
        maxZoom={maxZoom}
        zoomControl={false}
        attributionControl={false}
        className="!w-full !h-full !bg-black/40"
      >
        <TileLayer
          url={`/api/maps/${map.id}/tiles/{z}/{x}/{y}.jpg`}
          tileSize={256}
          noWrap
          bounds={bounds}
          maxNativeZoom={maxZoom}
          minZoom={0}
          maxZoom={maxZoom}
        />
        <ClickHandler addMode={addMode} onImageClick={onImageClick} width={width} height={height} maxZoom={maxZoom} />
        <ZoomReporter onZoomChange={onZoomChange} />
        {markers.map((m) => (
          <MarkerWithReveal
            key={m.id}
            marker={m}
            selected={m.id === selectedId}
            position={fractionalToLatLng(m.x, m.y)}
            onMarkerClick={onMarkerClick}
            onMarkerDragMove={onMarkerDragMove}
            onMarkerDragEnd={onMarkerDragEnd}
            width={width}
            height={height}
            maxZoom={maxZoom}
          />
        ))}
      </MapContainer>
    </div>
  );
}
