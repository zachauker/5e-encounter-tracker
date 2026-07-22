// components/maps/MarkerLabel.tsx
"use client";

import { LABEL_TEXT_PX } from "@/components/maps/marker-appearance";

// A small text chip rendered under a map marker pin. Pure (stringified via
// renderToStaticMarkup by two canvases). Font size follows labelSize.
export function MarkerLabel({ text, labelSize = "md" }: { text: string; labelSize?: "sm" | "md" | "lg" }) {
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-full mt-0.5 -translate-x-1/2 max-w-[7.5rem] truncate rounded bg-card/85 px-1.5 py-0.5 font-medium leading-tight text-foreground ring-1 ring-border"
      style={{ fontSize: LABEL_TEXT_PX[labelSize] }}
    >
      {text}
    </div>
  );
}
