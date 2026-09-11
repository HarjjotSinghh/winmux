import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore, getFirstTerminalId, getTerminalIds } from "./workspaceStore";
import type { PaneNode } from "../types";

function resetStore() {
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
}

/** Creates a workspace whose only pane is already wired to a live terminal. */
function workspaceWithTerminal(terminalId = "term-1") {
  const ws = useWorkspaceStore.getState().createWorkspace("test");
  if (ws.paneTree.type !== "terminal") throw new Error("expected terminal pane");
  const paneId = ws.paneTree.id;
  useWorkspaceStore
    .getState()
    .updatePaneTree(ws.id, { ...ws.paneTree, terminalId });
  return { workspaceId: ws.id, paneId };
}

describe("workspaceStore pane tree", () => {
  beforeEach(resetStore);

  it("splitting a pane preserves the original pane id and terminal", () => {
    const { workspaceId, paneId } = workspaceWithTerminal("term-1");

    useWorkspaceStore.getState().splitPane(workspaceId, paneId, "horizontal", "");

    const tree = useWorkspaceStore.getState().workspaces[0].paneTree;
    expect(tree.type).toBe("split");
    if (tree.type !== "split") return;
    expect(tree.first.type).toBe("terminal");
    if (tree.first.type !== "terminal") return;

    // This is the fix for "splitting resets my terminals": the original pane
    // keeps its id and its live terminal, so the keyed TerminalView never
    // unmounts and the PTY is never re-created.
    expect(tree.first.id).toBe(paneId);
    expect(tree.first.terminalId).toBe("term-1");
    expect(tree.second.type).toBe("terminal");
    if (tree.second.type !== "terminal") return;
    expect(tree.second.terminalId).toBe("");
  });

  it("does not split when the target pane does not exist", () => {
    const { workspaceId } = workspaceWithTerminal("term-1");
    useWorkspaceStore.getState().splitPane(workspaceId, "missing", "vertical", "");
    expect(useWorkspaceStore.getState().workspaces[0].paneTree.type).toBe("terminal");
  });

  it("closing a split pane keeps the sibling's identity", () => {
    const { workspaceId, paneId } = workspaceWithTerminal("term-1");
    useWorkspaceStore.getState().splitPane(workspaceId, paneId, "horizontal", "");
    const split = useWorkspaceStore.getState().workspaces[0].paneTree;
    if (split.type !== "split") throw new Error("expected split");
    const newPaneId = split.second.id;

    useWorkspaceStore.getState().closePane(workspaceId, newPaneId);

    const tree = useWorkspaceStore.getState().workspaces[0].paneTree;
    expect(tree.type).toBe("terminal");
    if (tree.type !== "terminal") return;
    expect(tree.id).toBe(paneId);
    expect(tree.terminalId).toBe("term-1");
  });

  it("setPaneRatio updates only the targeted split", () => {
    const { workspaceId, paneId } = workspaceWithTerminal("term-1");
    useWorkspaceStore.getState().splitPane(workspaceId, paneId, "horizontal", "");
    const split = useWorkspaceStore.getState().workspaces[0].paneTree;
    if (split.type !== "split") throw new Error("expected split");

    useWorkspaceStore.getState().setPaneRatio(workspaceId, split.id, 0.75);

    const tree = useWorkspaceStore.getState().workspaces[0].paneTree;
    expect(tree.type).toBe("split");
    if (tree.type !== "split") return;
    expect(tree.ratio).toBe(0.75);
    // The panes are untouched objects (same identity, no re-creation).
    expect(tree.first).toBe(split.first);
    expect(tree.second).toBe(split.second);
  });

  it("resetPane mounts a fresh pane for an exited shell", () => {
    const { workspaceId, paneId } = workspaceWithTerminal("term-1");
    useWorkspaceStore.getState().resetPane(workspaceId, paneId);

    const tree = useWorkspaceStore.getState().workspaces[0].paneTree;
    expect(tree.type).toBe("terminal");
    if (tree.type !== "terminal") return;
    expect(tree.terminalId).toBe("");
    expect(tree.id).not.toBe(paneId);
    expect(useWorkspaceStore.getState().workspaces[0].activeTerminalId).toBeNull();
  });

  it("getTerminalIds / getFirstTerminalId walk the tree", () => {
    const { workspaceId, paneId } = workspaceWithTerminal("term-1");
    useWorkspaceStore.getState().splitPane(workspaceId, paneId, "horizontal", "");
    const split = useWorkspaceStore.getState().workspaces[0].paneTree;
    if (split.type !== "split") throw new Error("expected split");
    useWorkspaceStore
      .getState()
      .updatePaneTree(workspaceId, {
        ...split,
        second: { ...(split.second as Extract<PaneNode, { type: "terminal" }>), terminalId: "term-2" },
      });

    const tree = useWorkspaceStore.getState().workspaces[0].paneTree;
    expect(getTerminalIds(tree)).toEqual(["term-1", "term-2"]);
    expect(getFirstTerminalId(tree)).toBe("term-1");
  });
});

describe("workspaceStore pane zoom", () => {
  beforeEach(resetStore);

  it("toggleZoom sets and clears the zoomed pane", () => {
    const { workspaceId, paneId } = workspaceWithTerminal("term-1");

    useWorkspaceStore.getState().toggleZoom(workspaceId, paneId);
    expect(useWorkspaceStore.getState().workspaces[0].zoomedPaneId).toBe(paneId);

    useWorkspaceStore.getState().toggleZoom(workspaceId, paneId);
    expect(useWorkspaceStore.getState().workspaces[0].zoomedPaneId).toBeNull();
  });

  it("splitting clears zoom so the new pane is visible", () => {
    const { workspaceId, paneId } = workspaceWithTerminal("term-1");
    useWorkspaceStore.getState().toggleZoom(workspaceId, paneId);

    useWorkspaceStore.getState().splitPane(workspaceId, paneId, "horizontal", "");

    expect(useWorkspaceStore.getState().workspaces[0].zoomedPaneId).toBeNull();
  });

  it("closing the zoomed pane clears zoom", () => {
    const { workspaceId, paneId } = workspaceWithTerminal("term-1");
    useWorkspaceStore.getState().splitPane(workspaceId, paneId, "horizontal", "");
    const split = useWorkspaceStore.getState().workspaces[0].paneTree;
    if (split.type !== "split") throw new Error("expected split");
    const newPaneId = split.second.id;
    useWorkspaceStore.getState().toggleZoom(workspaceId, newPaneId);

    useWorkspaceStore.getState().closePane(workspaceId, newPaneId);

    expect(useWorkspaceStore.getState().workspaces[0].zoomedPaneId).toBeNull();
  });
});
