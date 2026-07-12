"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface Collection { id: string; name: string; sourceType: string; enabled: boolean; chunkCount: number }

export function ReferenceLibraryPanel() {
  const [items, setItems] = useState<Collection[]>([]);

  // Load on mount with a cancellation guard so a stale response can't set
  // state after the effect is torn down.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/reference/collections")
      .then((r) => r.json())
      .then((d: { items: Collection[] }) => {
        if (!cancelled) setItems(d.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(c: Collection) {
    const res = await fetch(`/api/reference/collections/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !c.enabled }),
    });
    if (res.ok) setItems((list) => list.map((x) => (x.id === c.id ? { ...x, enabled: !x.enabled } : x)));
  }
  async function remove(c: Collection) {
    const res = await fetch(`/api/reference/collections/${c.id}`, { method: "DELETE" });
    if (res.ok) setItems((list) => list.filter((x) => x.id !== c.id));
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div>
        <h2 className="font-display text-xl">Reference Library</h2>
        <p className="text-sm text-muted-foreground">
          Indexed rulebooks and lore the assistant can cite. Add sources with <code>scripts/reference/ingest.ts</code>.
        </p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sources indexed yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.id} className="flex items-center gap-3 text-sm">
              <span className="flex-1">
                {c.name} <span className="text-muted-foreground">· {c.sourceType} · {c.chunkCount} chunks</span>
              </span>
              <Button size="sm" variant={c.enabled ? "default" : "ghost"} onClick={() => toggle(c)}>
                {c.enabled ? "Enabled" : "Disabled"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => remove(c)}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
