import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readShowLabels, writeShowLabels } from "./marker-labels";

function fakeWindow() {
  const store = new Map<string, string>();
  return {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
}

describe("marker-labels persistence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to false when nothing is stored", () => {
    vi.stubGlobal("window", fakeWindow());
    expect(readShowLabels("map-1")).toBe(false);
  });

  it("round-trips a true value", () => {
    vi.stubGlobal("window", fakeWindow());
    writeShowLabels("map-1", true);
    expect(readShowLabels("map-1")).toBe(true);
  });

  it("round-trips a false value", () => {
    vi.stubGlobal("window", fakeWindow());
    writeShowLabels("map-1", true);
    writeShowLabels("map-1", false);
    expect(readShowLabels("map-1")).toBe(false);
  });

  it("keys are per-map", () => {
    vi.stubGlobal("window", fakeWindow());
    writeShowLabels("map-1", true);
    expect(readShowLabels("map-2")).toBe(false);
  });

  it("treats a malformed stored value as false", () => {
    const w = fakeWindow();
    w.localStorage.setItem("markerLabels:map-1", "garbage");
    vi.stubGlobal("window", w);
    expect(readShowLabels("map-1")).toBe(false);
  });
});

describe("marker-labels without window", () => {
  beforeEach(() => vi.stubGlobal("window", undefined));
  afterEach(() => vi.unstubAllGlobals());

  it("readShowLabels returns false and writeShowLabels is a no-op", () => {
    expect(readShowLabels("map-1")).toBe(false);
    expect(() => writeShowLabels("map-1", true)).not.toThrow();
  });
});
