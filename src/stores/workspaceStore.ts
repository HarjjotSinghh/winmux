import { create } from "zustand";
import type { Workspace, PaneNode } from "../types";
import { getWorkspaceColor } from "../lib/theme";

let nextId = 1;
function genId(): string {
  return `ws-${nextId++}`;
}

function genPaneId(): string {
  return `pane-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface WorkspaceStore {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  sidebarWidth: number;
  sidebarVisible: boolean;

  // Actions
  createWorkspace: (name?: string) => Workspace;
  createWorkspaceWithTree: (name: string, tree: PaneNode) => Workspace;
  removeWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  setWorkspaceColor: (id: string, color: string) => void;
  setActiveTerminal: (workspaceId: string, terminalId: string) => void;
  updatePaneTree: (workspaceId: string, tree: PaneNode) => void;
  splitPane: (
    workspaceId: string,
    paneId: string,
    direction: "horizontal" | "vertical",
    newTerminalId: string,
    cwd?: string
  ) => void;
  openBrowserInSplit: (workspaceId: string, paneId: string, url: string) => void;
  closePane: (workspaceId: string, paneId: string) => string | null;
  setPaneRatio: (workspaceId: string, splitId: string, ratio: number) => void;
  /** Replace a pane with a brand new terminal pane (used when a shell exits). */
  resetPane: (workspaceId: string, paneId: string) => void;
  /** Toggle full-bleed zoom for a pane (Ctrl+Shift+Z). */
  toggleZoom: (workspaceId: string, paneId: string) => void;
  /** Toggle broadcast: keystrokes in any pane mirror to all panes (Ctrl+Shift+G). */
  toggleBroadcast: (workspaceId: string) => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
  setGitBranch: (workspaceId: string, branch: string | null) => void;
  setCwd: (workspaceId: string, cwd: string) => void;
  incrementUnread: (workspaceId: string) => void;
  clearUnread: (workspaceId: string) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  sidebarWidth: 220,
  sidebarVisible: true,

  createWorkspace: (name?: string) => {
    const id = genId();
    const index = get().workspaces.length;
    const terminalPaneId = genPaneId();
    const workspace: Workspace = {
      id,
      name: name || `Workspace ${index + 1}`,
      color: getWorkspaceColor(index),
      paneTree: {
        type: "terminal",
        id: terminalPaneId,
        terminalId: "",
      },
      activeTerminalId: null,
      zoomedPaneId: null,
      broadcastInput: false,
      gitBranch: null,
      cwd: null,
      unreadCount: 0,
    };

    set((state) => ({
      workspaces: [...state.workspaces, workspace],
      activeWorkspaceId: state.activeWorkspaceId ?? id,
    }));

    return workspace;
  },

  createWorkspaceWithTree: (name: string, tree: PaneNode) => {
    const id = genId();
    const index = get().workspaces.length;
    const workspace: Workspace = {
      id,
      name: name || `Workspace ${index + 1}`,
      color: getWorkspaceColor(index),
      paneTree: tree,
      activeTerminalId: null,
      zoomedPaneId: null,
      broadcastInput: false,
      gitBranch: null,
      cwd: null,
      unreadCount: 0,
    };

    set((state) => ({
      workspaces: [...state.workspaces, workspace],
      activeWorkspaceId: id,
    }));

    return workspace;
  },

  removeWorkspace: (id) => {
    set((state) => {
      const filtered = state.workspaces.filter((w) => w.id !== id);
      let activeId = state.activeWorkspaceId;
      if (activeId === id) {
        activeId = filtered.length > 0 ? filtered[filtered.length - 1].id : null;
      }
      return { workspaces: filtered, activeWorkspaceId: activeId };
    });
  },

  setActiveWorkspace: (id) => {
    set({ activeWorkspaceId: id });
  },

  renameWorkspace: (id, name) => {
    set((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.id === id ? { ...w, name } : w
      ),
    }));
  },

  setWorkspaceColor: (id, color) => {
    set((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.id === id ? { ...w, color } : w
      ),
    }));
  },

  setActiveTerminal: (workspaceId, terminalId) => {
    set((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, activeTerminalId: terminalId } : w
      ),
    }));
  },

  updatePaneTree: (workspaceId, tree) => {
    set((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, paneTree: tree } : w
      ),
    }));
  },

  splitPane: (workspaceId, paneId, direction, newTerminalId, cwd) => {
    set((state) => ({
      workspaces: state.workspaces.map((w) => {
        if (w.id !== workspaceId) return w;
        return {
          ...w,
          // Splitting a zoomed pane would hide the new pane behind the zoom
          // overlay, so leave zoom when a split happens.
          zoomedPaneId: null,
          paneTree: splitNode(w.paneTree, paneId, direction, newTerminalId, cwd),
        };
      }),
    }));
  },

  openBrowserInSplit: (workspaceId, paneId, url) => {
    set((state) => ({
      workspaces: state.workspaces.map((w) => {
        if (w.id !== workspaceId) return w;
        return {
          ...w,
          zoomedPaneId: null,
          paneTree: splitNodeWithBrowser(w.paneTree, paneId, url),
        };
      }),
    }));
  },

  closePane: (workspaceId, paneId) => {
    const state = get();
    const workspace = state.workspaces.find((w) => w.id === workspaceId);
    if (!workspace) return null;

    // If only one pane, return its terminalId for cleanup
    if (workspace.paneTree.type === "terminal" && workspace.paneTree.id === paneId) {
      return workspace.paneTree.terminalId;
    }

    const result = removeNode(workspace.paneTree, paneId);
    if (result) {
      set((state) => ({
        workspaces: state.workspaces.map((w) =>
          w.id === workspaceId
            ? {
                ...w,
                paneTree: result.tree,
                zoomedPaneId: w.zoomedPaneId === paneId ? null : w.zoomedPaneId,
              }
            : w
        ),
      }));
      return result.removedTerminalId;
    }
    return null;
  },

  setPaneRatio: (workspaceId, splitId, ratio) => {
    set((state) => ({
      workspaces: state.workspaces.map((w) => {
        if (w.id !== workspaceId) return w;
        return { ...w, paneTree: setNodeRatio(w.paneTree, splitId, ratio) };
      }),
    }));
  },

  resetPane: (workspaceId, paneId) => {
    set((state) => ({
      workspaces: state.workspaces.map((w) => {
        if (w.id !== workspaceId) return w;
        const tree = resetNode(w.paneTree, paneId);
        return tree
          ? {
              ...w,
              paneTree: tree,
              activeTerminalId: null,
              zoomedPaneId: w.zoomedPaneId === paneId ? null : w.zoomedPaneId,
            }
          : w;
      }),
    }));
  },

  toggleZoom: (workspaceId, paneId) => {
    set((state) => ({
      workspaces: state.workspaces.map((w) => {
        if (w.id !== workspaceId) return w;
        return {
          ...w,
          zoomedPaneId: w.zoomedPaneId === paneId ? null : paneId,
        };
      }),
    }));
  },

  toggleBroadcast: (workspaceId) => {
    set((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, broadcastInput: !w.broadcastInput } : w
      ),
    }));
  },

  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

  setGitBranch: (workspaceId, branch) => {
    set((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, gitBranch: branch } : w
      ),
    }));
  },

  setCwd: (workspaceId, cwd) => {
    set((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, cwd } : w
      ),
    }));
  },

  incrementUnread: (workspaceId) => {
    set((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, unreadCount: w.unreadCount + 1 } : w
      ),
    }));
  },

  clearUnread: (workspaceId) => {
    set((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, unreadCount: 0 } : w
      ),
    }));
  },
}));

// ── Tree Helpers ──────────────────────────────────────────────────

function splitNode(
  node: PaneNode,
  targetId: string,
  direction: "horizontal" | "vertical",
  newTerminalId: string,
  cwd?: string
): PaneNode {
  if (node.id === targetId && node.type === "terminal") {
    return {
      type: "split",
      id: genPaneId(),
      direction,
      ratio: 0.5,
      first: node,
      second: {
        type: "terminal",
        id: genPaneId(),
        terminalId: newTerminalId,
        ...(cwd ? { cwd } : {}),
      },
    };
  }

  if (node.type === "split") {
    return {
      ...node,
      first: splitNode(node.first, targetId, direction, newTerminalId, cwd),
      second: splitNode(node.second, targetId, direction, newTerminalId, cwd),
    };
  }

  return node;
}

/** Terminal id owned by a pane, if that pane currently has one. */
export function getPaneTerminalId(node: PaneNode, paneId: string): string | null {
  if (node.type === "terminal") {
    return node.id === paneId && node.terminalId ? node.terminalId : null;
  }
  if (node.type === "split") {
    return (
      getPaneTerminalId(node.first, paneId) ?? getPaneTerminalId(node.second, paneId)
    );
  }
  return null;
}

function removeNode(
  node: PaneNode,
  targetId: string
): { tree: PaneNode; removedTerminalId: string | null } | null {
  if (node.type === "split") {
    if (node.first.id === targetId) {
      const removedId = node.first.type === "terminal" ? node.first.terminalId : null;
      return { tree: node.second, removedTerminalId: removedId };
    }
    if (node.second.id === targetId) {
      const removedId = node.second.type === "terminal" ? node.second.terminalId : null;
      return { tree: node.first, removedTerminalId: removedId };
    }

    const firstResult = removeNode(node.first, targetId);
    if (firstResult) {
      return {
        tree: { ...node, first: firstResult.tree },
        removedTerminalId: firstResult.removedTerminalId,
      };
    }

    const secondResult = removeNode(node.second, targetId);
    if (secondResult) {
      return {
        tree: { ...node, second: secondResult.tree },
        removedTerminalId: secondResult.removedTerminalId,
      };
    }
  }

  return null;
}

// Find all terminal IDs in a pane tree
export function getTerminalIds(node: PaneNode): string[] {
  if (node.type === "terminal") {
    return node.terminalId ? [node.terminalId] : [];
  }
  if (node.type === "browser") {
    return [];
  }
  return [...getTerminalIds(node.first), ...getTerminalIds(node.second)];
}

// First live terminal ID in a pane tree (used to re-target focus after a pane closes)
export function getFirstTerminalId(node: PaneNode): string | null {
  if (node.type === "terminal") {
    return node.terminalId || null;
  }
  if (node.type === "browser") {
    return null;
  }
  return getFirstTerminalId(node.first) ?? getFirstTerminalId(node.second);
}

function setNodeRatio(node: PaneNode, splitId: string, ratio: number): PaneNode {
  if (node.type === "split") {
    if (node.id === splitId) {
      return { ...node, ratio };
    }
    const first = setNodeRatio(node.first, splitId, ratio);
    if (first !== node.first) return { ...node, first };
    const second = setNodeRatio(node.second, splitId, ratio);
    if (second !== node.second) return { ...node, second };
  }
  return node;
}

function resetNode(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === "terminal" && node.id === paneId) {
    // New pane id so React mounts a fresh TerminalView (and spawns a fresh
    // shell), rather than reusing the exited terminal's xterm instance.
    return { type: "terminal", id: genPaneId(), terminalId: "" };
  }
  if (node.type === "split") {
    const first = resetNode(node.first, paneId);
    if (first) return { ...node, first };
    const second = resetNode(node.second, paneId);
    if (second) return { ...node, second };
  }
  return null;
}

function splitNodeWithBrowser(
  node: PaneNode,
  targetId: string,
  url: string
): PaneNode {
  if (node.id === targetId && node.type === "terminal") {
    return {
      type: "split",
      id: genPaneId(),
      direction: "horizontal",
      ratio: 0.5,
      first: node,
      second: {
        type: "browser",
        id: genPaneId(),
        url,
      },
    };
  }

  if (node.type === "split") {
    return {
      ...node,
      first: splitNodeWithBrowser(node.first, targetId, url),
      second: splitNodeWithBrowser(node.second, targetId, url),
    };
  }

  return node;
}
