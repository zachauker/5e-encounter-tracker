"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface Collection { id: string; name: string; sourceType: string; enabled: boolean; chunkCount: number; notes: string | null }

export function ReferenceLibraryPanel() {
  const [items, setItems] = useState<Collection[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Load on mount with a cancellation guard so a stale response can't set
  // state after the effect is torn down.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/reference/collections")
      .then((r) => r.json())
      .then((d: { items: Collection[] }) => {
        if (!cancelled) {
          const list = d.items ?? [];
          setItems(list);
          setDrafts(Object.fromEntries(list.map((c) => [c.id, c.notes ?? ""])));
        }
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
  async function saveNotes(c: Collection) {
    const notes = drafts[c.id] ?? "";
    const res = await fetch(`/api/reference/collections/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    if (res.ok) {
      const saved = (await res.json()) as Collection;
      setItems((list) => list.map((x) => (x.id === c.id ? { ...x, notes: saved.notes } : x)));
    }
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
          Indexed rulebooks and lore the assistant can cite. Add sources with <code>scripts/reference/ingest.ts</code>. A source&apos;s note tells the assistant what it is and how authoritative it is.
        </p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sources indexed yet.</p>
      ) : (
        <ul className="space-y-4">
          {items.map((c) => {
            const dirty = (drafts[c.id] ?? "") !== (c.notes ?? "");
            return (
              <li key={c.id} className="space-y-2 border-b border-border pb-4 last:border-b-0 last:pb-0">
                <div className="flex items-center gap-3 text-sm">
                  <span className="flex-1">
                    {c.name} <span className="text-muted-foreground">· {c.sourceType} · {c.chunkCount} chunks</span>
                  </span>
                  <Button size="sm" variant={c.enabled ? "default" : "ghost"} onClick={() => toggle(c)}>
                    {c.enabled ? "Enabled" : "Disabled"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(c)}>
                    Delete
                  </Button>
                </div>
                <div className="flex items-start gap-2">
                  <textarea
                    className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
                    rows={2}
                    placeholder="Context for the assistant, e.g. “official Wildemount setting book; authoritative for setting/lore”"
                    value={drafts[c.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                  />
                  <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => saveNotes(c)}>
                    Save note
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
