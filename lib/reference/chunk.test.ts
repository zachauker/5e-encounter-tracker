import { describe, it, expect } from "vitest";
import { chunkText, estimateTokens } from "./chunk";

describe("estimateTokens", () => {
  it("approximates ~4 chars/token", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("chunkText", () => {
  it("splits on headings and carries the heading as the citation label", () => {
    const md = `# Grappling\nWhen you want to grab a creature, you can use the Attack action.\n\n# Shoving\nUsing the Attack action, you can make a shove.`;
    const chunks = chunkText(md, { sourceLabel: "SRD", maxTokens: 500, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].sourceRef).toBe("SRD: Grappling");
    expect(chunks[0].content).toContain("grab a creature");
    expect(chunks.find((c) => c.sourceRef === "SRD: Shoving")).toBeTruthy();
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it("packs long sections into multiple chunks with overlap", () => {
    const body = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} about rules.`).join(" ");
    const md = `# Long Section\n${body}`;
    const chunks = chunkText(md, { sourceLabel: "SRD", maxTokens: 120, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    // overlap: consecutive chunks share some words
    const firstWords = chunks[0].content.split(" ");
    const lastWordOfFirst = firstWords[firstWords.length - 1];
    expect(chunks[1].content.split(" ")).toContain(lastWordOfFirst);
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(120 + 20);
  });

  it("uses a page label when given pageOf()", () => {
    const chunks = chunkText("Some body text without headings.", {
      sourceLabel: "EGtW",
      maxTokens: 500,
      overlapTokens: 0,
      pageOf: () => 142,
    });
    expect(chunks[0].sourceRef).toBe("EGtW p.142");
  });

  it("labels each chunk of a headingless section by its OWN char offset, not the section start", () => {
    // A headingless PDF is one section (startIndex 0). Per-piece page derivation
    // must give later chunks a later page — not p.1 for every chunk.
    const body = Array.from({ length: 80 }, (_, i) => `Word${i}`).join(" ");
    const chunks = chunkText(body, {
      sourceLabel: "EGtW",
      maxTokens: 40,
      overlapTokens: 0,
      pageOf: (i) => (i < 100 ? 1 : 2),
    });
    expect(chunks.length).toBeGreaterThan(1);
    const pages = new Set(chunks.map((c) => c.sourceRef));
    expect(pages.has("EGtW p.1")).toBe(true);
    expect(pages.has("EGtW p.2")).toBe(true);
  });
});
