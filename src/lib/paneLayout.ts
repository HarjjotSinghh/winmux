import type { PaneNode } from "../types";

/**
 * Rect in fractions of the containing workspace (0..1). Using fractions keeps
 * the layout resolution-independent — the leaf wrappers are positioned with
 * percentages, so a window resize needs no recomputation.
 */
export interface PaneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LeafNode = Extract<PaneNode, { type: "terminal" | "browser" }>;

export interface LeafLayout {
  node: LeafNode;
  rect: PaneRect;
}

export interface SplitLayout {
  id: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  rect: PaneRect;
}

const MIN_RATIO = 0.05;
const MAX_RATIO = 0.95;

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

/**
 * Flatten a pane tree into positioned leaves + dividers.
 *
 * The UI renders every leaf as an absolutely-positioned, keyed element, so a
 * `TerminalView` keeps its identity across splits/closes. React reconciliation
 * inside a recursive tree would otherwise remount a terminal whenever its node
 * changes shape (terminal → split), tearing down xterm and re-attaching the
 * PTY — the bug behind "splitting resets my terminals".
 */
export function computeLayout(tree: PaneNode): {
  leaves: LeafLayout[];
  splits: SplitLayout[];
} {
  const leaves: LeafLayout[] = [];
  const splits: SplitLayout[] = [];

  const walk = (node: PaneNode, rect: PaneRect) => {
    if (node.type === "terminal" || node.type === "browser") {
      leaves.push({ node, rect });
      return;
    }

    const ratio = clampRatio(node.ratio);
    splits.push({
      id: node.id,
      direction: node.direction,
      ratio,
      rect,
    });

    if (node.direction === "horizontal") {
      walk(node.first, {
        x: rect.x,
        y: rect.y,
        w: rect.w * ratio,
        h: rect.h,
      });
      walk(node.second, {
        x: rect.x + rect.w * ratio,
        y: rect.y,
        w: rect.w * (1 - ratio),
        h: rect.h,
      });
    } else {
      walk(node.first, {
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h * ratio,
      });
      walk(node.second, {
        x: rect.x,
        y: rect.y + rect.h * ratio,
        w: rect.w,
        h: rect.h * (1 - ratio),
      });
    }
  };

  walk(tree, { x: 0, y: 0, w: 1, h: 1 });
  return { leaves, splits };
}
