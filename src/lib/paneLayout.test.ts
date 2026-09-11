import { describe, expect, it } from "vitest";
import { computeLayout } from "./paneLayout";
import type { PaneNode } from "../types";

function term(id: string, terminalId = ""): PaneNode {
  return { type: "terminal", id, terminalId };
}

describe("computeLayout", () => {
  it("keeps the original leaf node identity across a split", () => {
    const original = term("pane-a", "term-1");

    const before = computeLayout(original);
    expect(before.leaves).toHaveLength(1);
    expect(before.leaves[0].node).toBe(original);

    const tree: PaneNode = {
      type: "split",
      id: "split-1",
      direction: "horizontal",
      ratio: 0.5,
      first: original,
      second: term("pane-b", "term-2"),
    };

    const after = computeLayout(tree);
    expect(after.leaves).toHaveLength(2);

    const leaf = after.leaves.find((l) => l.node.id === "pane-a");
    // Same object identity means the same React key, so the mounted
    // TerminalView is reused and the PTY session is never re-created.
    expect(leaf?.node).toBe(original);
    expect(after.leaves.find((l) => l.node.id === "pane-b")?.node).toBe(tree.second);
  });

  it("tiles the workspace with disjoint rects", () => {
    const tree: PaneNode = {
      type: "split",
      id: "split-1",
      direction: "horizontal",
      ratio: 0.4,
      first: term("pane-a"),
      second: {
        type: "split",
        id: "split-2",
        direction: "vertical",
        ratio: 0.5,
        first: term("pane-b"),
        second: term("pane-c"),
      },
    };

    const { leaves, splits } = computeLayout(tree);
    expect(splits).toHaveLength(2);
    expect(leaves).toHaveLength(3);

    const a = leaves.find((l) => l.node.id === "pane-a")!.rect;
    const b = leaves.find((l) => l.node.id === "pane-b")!.rect;
    const c = leaves.find((l) => l.node.id === "pane-c")!.rect;

    expect(a.x).toBe(0);
    expect(a.w).toBeCloseTo(0.4);
    expect(a.h).toBeCloseTo(1);
    expect(b.x).toBeCloseTo(0.4);
    expect(b.w).toBeCloseTo(0.6);
    expect(b.h).toBeCloseTo(0.5);
    expect(c.y).toBeCloseTo(0.5);
    expect(c.h).toBeCloseTo(0.5);
  });

  it("clamps pathological ratios", () => {
    const tree: PaneNode = {
      type: "split",
      id: "split-1",
      direction: "horizontal",
      ratio: 5,
      first: term("pane-a"),
      second: term("pane-b"),
    };
    const { leaves } = computeLayout(tree);
    const a = leaves.find((l) => l.node.id === "pane-a")!.rect;
    const b = leaves.find((l) => l.node.id === "pane-b")!.rect;
    expect(a.w).toBeCloseTo(0.95);
    expect(b.x).toBeCloseTo(0.95);
  });
});
