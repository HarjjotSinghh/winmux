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

export type PaneDirection = "left" | "right" | "up" | "down";

const MIN_RATIO = 0.05;
const MAX_RATIO = 0.95;
const EPS = 1e-6;

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

/**
 * The terminal pane nearest to `fromPaneId` in `direction` (tmux/Windows
 * Terminal-style Alt+Arrow navigation). Based on the rendered geometry, so it
 * never disagrees with what the user sees.
 *
 * Ranking: panes sharing an edge (overlap > 0) win; among those, the largest
 * perpendicular overlap; ties break on the shortest travel distance. If no
 * pane shares an edge, the nearest one in that direction still wins (covers
 * diagonal layouts). Browser panes are skipped — they have no terminal focus.
 */
export function findPaneInDirection(
  tree: PaneNode,
  fromPaneId: string,
  direction: PaneDirection
): LeafNode | null {
  const { leaves } = computeLayout(tree);
  const active = leaves.find((l) => l.node.id === fromPaneId);
  if (!active) return null;
  const a = active.rect;

  const isCandidate = (r: PaneRect): boolean => {
    switch (direction) {
      case "right":
        return r.x >= a.x + a.w - EPS;
      case "left":
        return r.x + r.w <= a.x + EPS;
      case "down":
        return r.y >= a.y + a.h - EPS;
      case "up":
        return r.y + r.h <= a.y + EPS;
    }
  };

  const overlap = (r: PaneRect): number => {
    if (direction === "left" || direction === "right") {
      return Math.max(0, Math.min(a.y + a.h, r.y + r.h) - Math.max(a.y, r.y));
    }
    return Math.max(0, Math.min(a.x + a.w, r.x + r.w) - Math.max(a.x, r.x));
  };

  const distance = (r: PaneRect): number => {
    switch (direction) {
      case "right":
        return r.x - (a.x + a.w);
      case "left":
        return a.x - (r.x + r.w);
      case "down":
        return r.y - (a.y + a.h);
      case "up":
        return a.y - (r.y + r.h);
    }
  };

  const candidates = leaves.filter(
    (l) =>
      l.node.id !== fromPaneId &&
      l.node.type === "terminal" &&
      isCandidate(l.rect)
  );
  if (candidates.length === 0) return null;

  candidates.sort((p, q) => {
    const ovP = overlap(p.rect);
    const ovQ = overlap(q.rect);
    const hasP = ovP > EPS ? 1 : 0;
    const hasQ = ovQ > EPS ? 1 : 0;
    if (hasP !== hasQ) return hasQ - hasP;
    if (Math.abs(ovP - ovQ) > EPS) return ovQ - ovP;
    return Math.max(0, distance(p.rect)) - Math.max(0, distance(q.rect));
  });

  return candidates[0].node;
}
