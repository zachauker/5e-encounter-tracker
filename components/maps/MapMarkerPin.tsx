// components/maps/MapMarkerPin.tsx
"use client";

import { cn } from "@/lib/utils";
import type { MarkerShape, ResolvedAppearance } from "@/components/maps/marker-appearance";

// Per-shape fixed viewBox, the shape path/element, the inner "card" disc, and the
// head-center as a fraction of the box (for the absolutely-positioned icon).
const SHAPE_GEOM: Record<MarkerShape, { vb: string; disc: { cx: number; cy: number; r: number }; headX: number; headY: number; el: (color: string) => React.ReactNode }> = {
  teardrop: {
    vb: "0 0 28 36",
    disc: { cx: 14, cy: 14, r: 9 },
    headX: 0.5,
    headY: 14 / 36,
    el: (color) => <path d="M14 0C6.3 0 0 6.3 0 14c0 9.6 14 22 14 22s14-12.4 14-22c0-7.7-6.3-14-14-14z" fill={color} />,
  },
  circle: {
    vb: "0 0 30 30",
    disc: { cx: 15, cy: 15, r: 9.6 },
    headX: 0.5,
    headY: 0.5,
    el: (color) => <circle cx="15" cy="15" r="14" fill={color} />,
  },
  square: {
    vb: "0 0 30 30",
    disc: { cx: 15, cy: 15, r: 9.6 },
    headX: 0.5,
    headY: 0.5,
    el: (color) => <rect x="1" y="1" width="28" height="28" rx="6" fill={color} />,
  },
  diamond: {
    vb: "0 0 30 30",
    disc: { cx: 15, cy: 15, r: 8.4 },
    headX: 0.5,
    headY: 0.5,
    el: (color) => <polygon points="15,1 29,15 15,29 1,15" fill={color} />,
  },
};

export function MapMarkerPin({
  appearance,
  selected,
}: {
  appearance: ResolvedAppearance;
  selected?: boolean;
}) {
  const { width, height, iconSize, shape, color, icon: Icon } = appearance;
  const g = SHAPE_GEOM[shape];

  return (
    <div className={cn("relative", selected && "marker-selected marker-bloom")} style={{ width, height }}>
      <svg width={width} height={height} viewBox={g.vb} className="drop-shadow-md">
        {g.el(color)}
        <circle cx={g.disc.cx} cy={g.disc.cy} r={g.disc.r} fill="var(--card)" />
      </svg>
      <Icon
        style={{
          position: "absolute",
          width: iconSize,
          height: iconSize,
          color,
          left: `${g.headX * 100}%`,
          top: `${g.headY * 100}%`,
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}
