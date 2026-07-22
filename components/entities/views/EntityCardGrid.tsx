// components/entities/views/EntityCardGrid.tsx
"use client";

import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, ArrowUpRight } from "lucide-react";
import { EntityQuickViewPopover } from "@/components/entities/EntityQuickViewPopover";
import type { EntityViewProps } from "@/components/entities/views/EntityListRows";
import type { TypeConfig } from "@/lib/entities/entity-list-view";

function typeBadge(typeConfig: TypeConfig | null, type: string | null) {
  if (!typeConfig || !type) return null;
  const opt = typeConfig.options.find((o) => o.value === type);
  return { label: opt?.label ?? type, variant: (opt?.badgeVariant ?? "outline") as "hp" | "outline" | "secondary" };
}

export function EntityCardGrid({ items, resourcePath, singular, accent, typeConfig, onEdit, onDelete }: EntityViewProps) {
  return (
    <div className="mt-4 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((e) => {
        const badge = typeBadge(typeConfig, e.type);
        return (
          <div key={e.id} className="relative group rounded-xl border border-border bg-card p-3.5 hover:border-muted-foreground/40 transition-colors">
            <div className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full flex-none mt-2" style={{ backgroundColor: accent }} aria-hidden />
              <EntityQuickViewPopover resourcePath={resourcePath} id={e.id} onEdit={onEdit}>
                <button type="button" aria-label={`Preview ${singular}: ${e.name}`} className="flex-1 min-w-0 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <p className="font-medium text-[15px] leading-tight truncate">{e.name}</p>
                  {badge && <Badge variant={badge.variant} className="capitalize mt-1">{badge.label}</Badge>}
                </button>
              </EntityQuickViewPopover>
            </div>
            {e.description && <p className="mt-2 text-[13px] text-muted-foreground line-clamp-3">{e.description}</p>}
            <div className="mt-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <Link href={`/${resourcePath}/${e.id}`} aria-label={`Open ${singular}: ${e.name}`} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ArrowUpRight className="w-4 h-4" />
              </Link>
              <Button size="icon-sm" variant="ghost" aria-label={`Delete ${singular}: ${e.name}`} className="ml-auto text-destructive hover:text-destructive" onClick={(ev) => onDelete(e.id, ev)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
