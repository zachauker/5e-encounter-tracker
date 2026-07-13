import { describe, it, expect } from "vitest";
import { buildReferenceBriefing } from "./briefing";

describe("buildReferenceBriefing", () => {
  it("renders each source as name — note, joined", () => {
    const s = buildReferenceBriefing([
      { name: "Wildemount", notes: "official campaign setting book; authoritative for setting/lore" },
      { name: "SRD 5.1", notes: "core rules" },
    ]);
    expect(s).toContain("Reference sources available via search_reference:");
    expect(s).toContain("Wildemount — official campaign setting book; authoritative for setting/lore");
    expect(s).toContain("SRD 5.1 — core rules");
  });

  it("shows just the name when a source has no note", () => {
    const s = buildReferenceBriefing([
      { name: "Homebrew", notes: null },
      { name: "SRD 5.1", notes: "  " },
    ]);
    expect(s).toContain("Homebrew");
    expect(s).not.toContain("Homebrew —");
    expect(s).not.toContain("SRD 5.1 —"); // whitespace-only note treated as no note
  });

  it("returns an empty string when there are no sources", () => {
    expect(buildReferenceBriefing([])).toBe("");
  });
});
