// components/entities/EntityQuickViewPopover.tsx
"use client";

import React, { useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { EntityQuickView } from "@/components/entities/EntityQuickView";
import type { EntityResourcePath, EntityDetailResponse } from "@/components/entities/entity-quick-view-model";

interface EntityQuickViewPopoverProps {
  resourcePath: EntityResourcePath;
  id: string;
  onEdit?: (entity: EntityDetailResponse) => void;
  children: React.ReactNode;
}

export function EntityQuickViewPopover({ resourcePath, id, onEdit, children }: EntityQuickViewPopoverProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" side="bottom">
        {open && (
          <EntityQuickView
            resourcePath={resourcePath}
            id={id}
            onEdit={(entity) => {
              setOpen(false);
              onEdit?.(entity);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
