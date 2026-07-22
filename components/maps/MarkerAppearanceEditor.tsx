// components/maps/MarkerAppearanceEditor.tsx
"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { MapMarkerPin } from "@/components/maps/MapMarkerPin";
import {
  resolveMarkerAppearance,
  SIZES, SHAPES, LABEL_SIZES, ICON_NAMES, ICON_SET, COLOR_OPTIONS,
  type MarkerAppearanceOverride, type MarkerSize, type MarkerShape, type MarkerLabelSize,
} from "@/components/maps/marker-appearance";
import type { MarkerType } from "@/components/maps/map-types";

interface Props {
  value: MarkerAppearanceOverride;
  onChange: (next: MarkerAppearanceOverride) => void;
  type: MarkerType;
  subtype?: string | null;
}

function Seg<T extends string>({ options, value, onChange, labels }: { options: (T | null)[]; value: T | null | undefined; onChange: (v: T | null) => void; labels?: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => {
        const active = (value ?? null) === opt;
        return (
          <button key={opt ?? "default"} type="button" onClick={() => onChange(opt)}
            className={cn("rounded-md border px-2 py-1 text-xs", active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
            {opt === null ? "Default" : (labels?.[opt] ?? opt)}
          </button>
        );
      })}
    </div>
  );
}

export function MarkerAppearanceEditor({ value, onChange, type, subtype }: Props) {
  const set = (patch: Partial<MarkerAppearanceOverride>) => onChange({ ...value, ...patch });
  const preview = resolveMarkerAppearance({ type, entitySubtype: subtype, ...value }, {});

  return (
    <div className="flex gap-4">
      <div className="flex-1 space-y-3">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Size</p>
          <Seg<MarkerSize> options={[null, ...SIZES]} value={value.size} onChange={(v) => set({ size: v })} labels={{ sm: "S", md: "M", lg: "L", xl: "XL" }} />
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Shape</p>
          <Seg<MarkerShape> options={[null, ...SHAPES]} value={value.shape} onChange={(v) => set({ shape: v })} labels={{ teardrop: "Pin", circle: "Circle", square: "Square", diamond: "Diamond" }} />
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Label</p>
          <Seg<MarkerLabelSize> options={[null, ...LABEL_SIZES]} value={value.labelSize} onChange={(v) => set({ labelSize: v })} labels={{ sm: "S", md: "M", lg: "L", hide: "Hide" }} />
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Color</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => set({ color: null })} className={cn("h-6 rounded-md border px-2 text-xs", !value.color ? "border-primary text-primary" : "border-border text-muted-foreground")}>Default</button>
            {COLOR_OPTIONS.map((c) => (
              <button key={c.value} type="button" aria-label={c.label} onClick={() => set({ color: c.value })}
                className={cn("h-6 w-6 rounded-md border-2", value.color === c.value ? "border-foreground" : "border-transparent")} style={{ backgroundColor: c.value }} />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Icon</p>
          <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
            <button type="button" onClick={() => set({ icon: null })} className={cn("rounded-md border px-2 py-1 text-xs", !value.icon ? "border-primary text-primary" : "border-border text-muted-foreground")}>Default</button>
            {ICON_NAMES.map((name) => {
              const Icon = ICON_SET[name];
              return (
                <button key={name} type="button" aria-label={name} onClick={() => set({ icon: name })}
                  className={cn("rounded-md border p-1.5", value.icon === name ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex-none w-24 text-center">
        <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">Preview</p>
        <div className="flex items-end justify-center h-16"><MapMarkerPin appearance={preview} /></div>
      </div>
    </div>
  );
}
