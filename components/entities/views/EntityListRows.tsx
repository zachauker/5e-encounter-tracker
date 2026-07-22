// components/entities/views/EntityListRows.tsx
"use client";

import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, ArrowUpRight } from "lucide-react";
import { EntityQuickViewPopover } from "@/components/entities/EntityQuickViewPopover";
import type { EntityListItem, TypeConfig } from "@/lib/entities/entity-list-view";
import type { EntityDetailResponse } from "@/components/entities/entity-quick-view-model";

export interface EntityViewProps {
  items: EntityListItem[];
  resourcePath: "characters" | "locations" | "items" | "factions";
  singular: string;
  accent: string;
  typeConfig: TypeConfig | null;
  onEdit: (entity: EntityDetailResponse) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

function typeBadge(typeConfig: TypeConfig | null, type: string | null) {
  if (!typeConfig || !type) return null;
  const opt = typeConfig.options.find((o) => o.value === type);
  return { label: opt?.label ?? type, variant: (opt?.badgeVariant ?? "outline") as "hp" | "outline" | "secondary" };
}

export function EntityListRows({ items, resourcePath, singular, accent, typeConfig, onEdit, onDelete }: EntityViewProps) {
  return (
    <div className="mt-3 divide-y divide-border/60">
      {items.map((e) => {
        const badge = typeBadge(typeConfig, e.type);
        return (
          <div key={e.id} className="relative flex items-center gap-3 px-2 py-3.5 hover:bg-accent/40 transition-colors group">
            <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ backgroundColor: accent }} aria-hidden />
            <EntityQuickViewPopover resourcePath={resourcePath} id={e.id} onEdit={onEdit}>
              <button type="button" aria-label={`Preview ${singular}: ${e.name}`} className="flex-1 min-w-0 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <p className="font-medium text-[15px] leading-tight truncate">{e.name}</p>
                {e.description && <p className="text-[13px] text-muted-foreground truncate mt-0.5">{e.description}</p>}
              </button>
            </EntityQuickViewPopover>
            {badge && <Badge variant={badge.variant} className="capitalize flex-none">{badge.label}</Badge>}
            <Link href={`/${resourcePath}/${e.id}`} aria-label={`Open ${singular}: ${e.name}`} className="flex-none rounded-md p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ArrowUpRight className="w-4 h-4" />
            </Link>
            <Button size="icon-sm" variant="ghost" aria-label={`Delete ${singular}: ${e.name}`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-destructive hover:text-destructive" onClick={(ev) => onDelete(e.id, ev)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
