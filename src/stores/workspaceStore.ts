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
    newTerminalId: string
  ) => void;
  closePane: (workspaceId: string, paneId: string) => string | null;
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

  splitPane: (workspaceId, paneId, direction, newTerminalId) => {
    set((state) => ({
      workspaces: state.workspaces.map((w) => {
        if (w.id !== workspaceId) return w;
        return {
          ...w,
          paneTree: splitNode(w.paneTree, paneId, direction, newTerminalId),
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
          w.id === workspaceId ? { ...w, paneTree: result.tree } : w
        ),
      }));
      return result.removedTerminalId;
    }
    return null;
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
  newTerminalId: string
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
      },
    };
  }

  if (node.type === "split") {
    return {
      ...node,
      first: splitNode(node.first, targetId, direction, newTerminalId),
      second: splitNode(node.second, targetId, direction, newTerminalId),
    };
  }

  return node;
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
  return [...getTerminalIds(node.first), ...getTerminalIds(node.second)];
}
