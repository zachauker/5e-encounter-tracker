// Per-resource entity list view choice (list/gallery/table), persisted in
// localStorage under `entityView:${resourcePath}`. Mirrors the
// readShowLabels/writeShowLabels pattern in components/maps/marker-labels.ts:
// safe on the server and against malformed storage, so it can seed React
// state during render without a set-state-in-effect hydration step.

import type { EntityView } from "@/lib/entities/entity-list-view";

const KEY = (resourcePath: string) => `entityView:${resourcePath}`;
const ALLOWED: EntityView[] = ["list", "gallery", "table"];

// Read the persisted view choice for a resource. Defaults to "list".
// Returns "list" on the server or if storage is unavailable/malformed.
export function readEntityView(resourcePath: string): EntityView {
  try {
    if (typeof window === "undefined") return "list";
    const raw = window.localStorage.getItem(KEY(resourcePath));
    return ALLOWED.includes(raw as EntityView) ? (raw as EntityView) : "list";
  } catch {
    return "list";
  }
}

// Persist the view choice for a resource. No-op on the server or if storage
// is unavailable.
export function writeEntityView(resourcePath: string, view: EntityView): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(KEY(resourcePath), view);
  } catch {
    // ignore storage failures (quota, disabled, etc.)
  }
}
