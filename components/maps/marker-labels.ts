// Per-map show/hide state for on-map marker labels, persisted in localStorage
// under `markerLabels:${mapId}`. Mirrors the readHiddenLayers pattern in
// marker-layers.ts: safe on the server and against malformed storage, so it can
// seed React state during render without a set-state-in-effect hydration step.

const keyFor = (mapId: string) => `markerLabels:${mapId}`;

// Read the persisted "show labels" flag for a map. Defaults to false (labels
// off). Returns false on the server or if storage is unavailable/malformed.
export function readShowLabels(mapId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(keyFor(mapId)) === "true";
  } catch {
    return false;
  }
}

// Persist the "show labels" flag for a map. No-op on the server or if storage
// is unavailable.
export function writeShowLabels(mapId: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(mapId), value ? "true" : "false");
  } catch {
    // ignore storage failures (quota, disabled, etc.)
  }
}
