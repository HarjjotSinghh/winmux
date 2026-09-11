import { describe, expect, it } from "vitest";
import { computeLayout, findPaneInDirection } from "./paneLayout";
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

describe("findPaneInDirection", () => {
  function split(
    direction: "horizontal" | "vertical",
    first: PaneNode,
    second: PaneNode,
    id = "split"
  ): PaneNode {
    return { type: "split", id, direction, ratio: 0.5, first, second };
  }

  it("navigates across a horizontal split", () => {
    const tree = split("horizontal", term("pane-a"), term("pane-b"));

    expect(findPaneInDirection(tree, "pane-a", "right")?.id).toBe("pane-b");
    expect(findPaneInDirection(tree, "pane-b", "left")?.id).toBe("pane-a");
    expect(findPaneInDirection(tree, "pane-a", "left")).toBeNull();
    expect(findPaneInDirection(tree, "pane-b", "right")).toBeNull();
    expect(findPaneInDirection(tree, "pane-a", "up")).toBeNull();
    expect(findPaneInDirection(tree, "pane-a", "down")).toBeNull();
  });

  it("navigates across a vertical split", () => {
    const tree = split("vertical", term("pane-top"), term("pane-bottom"));

    expect(findPaneInDirection(tree, "pane-top", "down")?.id).toBe("pane-bottom");
    expect(findPaneInDirection(tree, "pane-bottom", "up")?.id).toBe("pane-top");
    expect(findPaneInDirection(tree, "pane-top", "right")).toBeNull();
  });

  it("navigates a 2x2 grid", () => {
    const tree = split(
      "vertical",
      split("horizontal", term("tl"), term("tr"), "top"),
      split("horizontal", term("bl"), term("br"), "bottom")
    );

    expect(findPaneInDirection(tree, "tl", "right")?.id).toBe("tr");
    expect(findPaneInDirection(tree, "tl", "down")?.id).toBe("bl");
    expect(findPaneInDirection(tree, "br", "left")?.id).toBe("bl");
    expect(findPaneInDirection(tree, "br", "up")?.id).toBe("tr");
    expect(findPaneInDirection(tree, "tl", "up")).toBeNull();
    expect(findPaneInDirection(tree, "tr", "right")).toBeNull();
  });

  it("picks the nearest pane in a three-column layout", () => {
    const tree = split(
      "horizontal",
      term("first"),
      split("horizontal", term("middle"), term("last"), "right-side"),
      "root"
    );

    expect(findPaneInDirection(tree, "middle", "left")?.id).toBe("first");
    expect(findPaneInDirection(tree, "middle", "right")?.id).toBe("last");
    expect(findPaneInDirection(tree, "first", "right")?.id).toBe("middle");
    expect(findPaneInDirection(tree, "last", "left")?.id).toBe("middle");
  });

  it("prefers an edge-sharing pane over a closer diagonal one", () => {
    // Left column is split in two; the single right pane shares no vertical
    // edge with the top-left half, but a down-navigation from tl should still
    // find bl (overlap) rather than the right pane.
    const tree = split(
      "horizontal",
      split("vertical", term("tl"), term("bl"), "left-col"),
      term("right"),
      "root"
    );

    expect(findPaneInDirection(tree, "tl", "down")?.id).toBe("bl");
    // Right-navigation from either left pane crosses to the right pane.
    expect(findPaneInDirection(tree, "tl", "right")?.id).toBe("right");
    expect(findPaneInDirection(tree, "bl", "right")?.id).toBe("right");
  });

  it("skips browser panes", () => {
    const tree = split("horizontal", term("left"), {
      type: "browser",
      id: "web",
      url: "https://example.com",
    });

    expect(findPaneInDirection(tree, "left", "right")).toBeNull();
  });

  it("returns null for an unknown source pane", () => {
    const tree = split("horizontal", term("a"), term("b"));
    expect(findPaneInDirection(tree, "missing", "right")).toBeNull();
  });
});
