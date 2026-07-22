import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { readEntityView, writeEntityView } from "./entity-view-store";

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

describe("entity-view-store", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to list when unset", () => {
    vi.stubGlobal("window", fakeWindow());
    expect(readEntityView("locations")).toBe("list");
  });
  it("round-trips a value per resource", () => {
    vi.stubGlobal("window", fakeWindow());
    writeEntityView("locations", "gallery");
    expect(readEntityView("locations")).toBe("gallery");
    expect(readEntityView("items")).toBe("list");
  });
  it("treats a malformed stored value as list", () => {
    const w = fakeWindow();
    w.localStorage.setItem("entityView:locations", "spreadsheet");
    vi.stubGlobal("window", w);
    expect(readEntityView("locations")).toBe("list");
  });
});

describe("entity-view-store without window", () => {
  beforeEach(() => vi.stubGlobal("window", undefined));
  afterEach(() => vi.unstubAllGlobals());
  it("reads default and write is a no-op", () => {
    expect(readEntityView("locations")).toBe("list");
    expect(() => writeEntityView("locations", "table")).not.toThrow();
  });
});
