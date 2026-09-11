import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyScore } from "./fuzzy";

describe("fuzzyScore", () => {
  it("matches exact and prefix hits", () => {
    expect(fuzzyScore("split", "Split Right")).not.toBeNull();
    expect(fuzzyScore("zzz", "Split Right")).toBeNull();
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(fuzzyScore("  SPLIT ", "Split Right")).not.toBeNull();
  });

  it("prefers start-of-word and consecutive matches", () => {
    const prefix = fuzzyScore("sb", "Sidebar")!;
    const midWord = fuzzyScore("sb", "New Sidebar")!;
    expect(prefix).toBeGreaterThan(midWord);
  });

  it("requires a true subsequence", () => {
    // "New Workspace" has no 'w' after its 's', so "sw" can't match.
    expect(fuzzyScore("sw", "New Workspace")).toBeNull();
  });

  it("returns neutral score for empty query", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
    expect(fuzzyScore("   ", "anything")).toBe(0);
  });
});

describe("fuzzyFilter", () => {
  const items = ["Split Right", "Split Down", "New Workspace", "Toggle Sidebar"];

  it("keeps everything on empty query, in order", () => {
    expect(fuzzyFilter("", items, (s) => s)).toEqual(items);
  });

  it("filters non-matches and ranks prefix hits first", () => {
    // Both match "spl" identically, so the shorter label wins (deterministic).
    expect(fuzzyFilter("spl", items, (s) => s)).toEqual([
      "Split Down",
      "Split Right",
    ]);
    expect(fuzzyFilter("tog", items, (s) => s)).toEqual(["Toggle Sidebar"]);
  });

  it("matches out-of-order characters", () => {
    expect(fuzzyFilter("nws", items, (s) => s)).toEqual(["New Workspace"]);
  });
});
