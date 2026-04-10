import { useEffect, useCallback, useState, useMemo, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import TitleBar from "./components/TitleBar/TitleBar";
import Sidebar from "./components/Sidebar/Sidebar";
import SplitContainer from "./components/SplitPane/SplitContainer";
import NotificationPanel from "./components/Notification/NotificationPanel";
import CommandPalette from "./components/CommandPalette/CommandPalette";
import WorkspacePresets from "./components/Sidebar/WorkspacePresets";
import type { LayoutPreset } from "./components/Sidebar/WorkspacePresets";
import { useWorkspaceStore, getTerminalIds } from "./stores/workspaceStore";
import { useSettingsStore } from "./stores/settingsStore";
import { closeTerminal, saveSession, loadSession } from "./lib/ipc";
import type { SessionData, PaneNode } from "./types";

const AUTO_SAVE_INTERVAL = 5000; // 5 seconds

export default function App() {
  const {
    workspaces,
    activeWorkspaceId,
    createWorkspace,
    createWorkspaceWithTree,
    removeWorkspace,
    setActiveWorkspace,
    setActiveTerminal,
    updatePaneTree,
    splitPane,
    closePane,
    toggleSidebar,
    incrementUnread,
    sidebarVisible,
    sidebarWidth,
  } = useWorkspaceStore();

  const loadSettings = useSettingsStore((s) => s.load);
  const settings = useSettingsStore((s) => s.settings);

  const [notifPanelVisible, setNotifPanelVisible] = useState(false);
  const [commandPaletteVisible, setCommandPaletteVisible] = useState(false);
  const [presetPickerVisible, setPresetPickerVisible] = useState(false);
  const sessionRestoredRef = useRef(false);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  // ── Session Restore on mount ────────────────────────────────────
  useEffect(() => {
    if (sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;

    loadSettings();

    loadSession().then((data) => {
      if (data && data.workspaces.length > 0) {
        // Restore workspaces from saved session
        data.workspaces.forEach((ws) => {
          createWorkspaceWithTree(ws.name, restorePaneTree(ws.paneTree));
        });
      } else {
        createWorkspace();
      }
    }).catch(() => {
      createWorkspace();
    });
  }, [loadSettings, createWorkspace, createWorkspaceWithTree]);

  // ── Auto-save session every 5 seconds ──────────────────────────
  useEffect(() => {
    if (workspaces.length === 0) return;

    const timer = setInterval(() => {
      const sessionData: SessionData = {
        workspaces: workspaces.map((ws) => ({
          name: ws.name,
          color: ws.color,
          paneTree: serializePaneTree(ws.paneTree),
        })),
        activeWorkspace: workspaces.findIndex((w) => w.id === activeWorkspaceId),
        sidebarWidth,
        sidebarVisible,
        windowState: { x: 0, y: 0, width: 1280, height: 800, maximized: false },
      };
      saveSession(sessionData).catch(() => {});
    }, AUTO_SAVE_INTERVAL);

    return () => clearInterval(timer);
  }, [workspaces, activeWorkspaceId, sidebarWidth, sidebarVisible]);

  // ── Also save on beforeunload ──────────────────────────────────
  useEffect(() => {
    const handler = () => {
      if (workspaces.length === 0) return;
      const sessionData: SessionData = {
        workspaces: workspaces.map((ws) => ({
          name: ws.name,
          color: ws.color,
          paneTree: serializePaneTree(ws.paneTree),
        })),
        activeWorkspace: workspaces.findIndex((w) => w.id === activeWorkspaceId),
        sidebarWidth,
        sidebarVisible,
        windowState: { x: 0, y: 0, width: 1280, height: 800, maximized: false },
      };
      saveSession(sessionData).catch(() => {});
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [workspaces, activeWorkspaceId, sidebarWidth, sidebarVisible]);

  // Listen for terminal exit events
  useEffect(() => {
    const unlisten = listen<{ terminal_id: string }>("terminal-exit", (event) => {
      const ws = workspaces.find((w) => {
        const ids = getTerminalIds(w.paneTree);
        return ids.includes(event.payload.terminal_id);
      });
      if (ws) {
        const pane = findPaneByTerminalId(ws.paneTree, event.payload.terminal_id);
        if (pane) {
          const removedId = closePane(ws.id, pane.id);
          if (removedId && ws.paneTree.type === "terminal") {
            if (workspaces.length > 1) {
              removeWorkspace(ws.id);
            }
          }
        }
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [workspaces, closePane, removeWorkspace]);

  // Listen for OSC notifications
  useEffect(() => {
    const unlisten = listen<{ terminal_id: string; title: string; body: string }>(
      "osc-notification",
      (event) => {
        const ws = workspaces.find((w) => {
          const ids = getTerminalIds(w.paneTree);
          return ids.includes(event.payload.terminal_id);
        });
        if (ws && ws.id !== activeWorkspaceId) {
          incrementUnread(ws.id);
        }
      }
    );

    return () => { unlisten.then((fn) => fn()); };
  }, [workspaces, activeWorkspaceId, incrementUnread]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "T") {
        e.preventDefault();
        setPresetPickerVisible(true);
      } else if (e.ctrlKey && e.shiftKey && e.key === "W") {
        e.preventDefault();
        if (activeWorkspaceId && workspaces.length > 1) {
          const ws = workspaces.find((w) => w.id === activeWorkspaceId);
          if (ws) {
            const terminalIds = getTerminalIds(ws.paneTree);
            terminalIds.forEach((id) => closeTerminal(id).catch(() => {}));
            removeWorkspace(activeWorkspaceId);
          }
        }
      } else if (e.ctrlKey && e.shiftKey && e.key === "D") {
        e.preventDefault();
        handleSplit("horizontal");
      } else if (e.ctrlKey && e.shiftKey && e.key === "E") {
        e.preventDefault();
        handleSplit("vertical");
      } else if (e.ctrlKey && !e.shiftKey && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if (e.ctrlKey && e.shiftKey && e.key === "P") {
        e.preventDefault();
        setCommandPaletteVisible((v) => !v);
      } else if (e.ctrlKey && e.shiftKey && e.key === "I") {
        e.preventDefault();
        setNotifPanelVisible((v) => !v);
      } else if (e.ctrlKey && !e.shiftKey && e.key >= "1" && e.key <= "9") {
        const index = parseInt(e.key) - 1;
        if (index < workspaces.length) {
          e.preventDefault();
          setActiveWorkspace(workspaces[index].id);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [workspaces, activeWorkspaceId, createWorkspace, removeWorkspace, setActiveWorkspace, toggleSidebar]);

  const handleSplit = useCallback(
    (direction: "horizontal" | "vertical") => {
      if (!activeWorkspace) return;
      const activePane = findActivePaneNode(
        activeWorkspace.paneTree,
        activeWorkspace.activeTerminalId
      );
      if (activePane) {
        splitPane(activeWorkspace.id, activePane.id, direction, "");
      }
    },
    [activeWorkspace, splitPane]
  );

  const handleNewWorkspace = useCallback(
    (preset: LayoutPreset, name: string) => {
      const tree = preset.build();
      createWorkspaceWithTree(name || undefined as unknown as string, tree);
      setPresetPickerVisible(false);
    },
    [createWorkspaceWithTree]
  );

  const handleTerminalReady = useCallback(
    (paneId: string, terminalId: string) => {
      if (!activeWorkspace) return;
      const updated = setPaneTerminalId(activeWorkspace.paneTree, paneId, terminalId);
      updatePaneTree(activeWorkspace.id, updated);
      setActiveTerminal(activeWorkspace.id, terminalId);
    },
    [activeWorkspace, updatePaneTree, setActiveTerminal]
  );

  const commands = useMemo(
    () => [
      { id: "newWorkspace", label: "New Workspace...", shortcut: "Ctrl+Shift+T", action: () => setPresetPickerVisible(true) },
      { id: "splitRight", label: "Split Right", shortcut: "Ctrl+Shift+D", action: () => handleSplit("horizontal") },
      { id: "splitDown", label: "Split Down", shortcut: "Ctrl+Shift+E", action: () => handleSplit("vertical") },
      { id: "toggleSidebar", label: "Toggle Sidebar", shortcut: "Ctrl+B", action: toggleSidebar },
      { id: "notifications", label: "Toggle Notifications", shortcut: "Ctrl+Shift+I", action: () => setNotifPanelVisible((v) => !v) },
      ...workspaces.map((w, i) => ({
        id: `workspace-${w.id}`,
        label: `Switch to ${w.name}`,
        shortcut: i < 9 ? `Ctrl+${i + 1}` : undefined,
        action: () => setActiveWorkspace(w.id),
      })),
    ],
    [workspaces, handleSplit, toggleSidebar, setActiveWorkspace]
  );

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#0d1117",
        color: "#c9d1d9",
        overflow: "hidden",
      }}
    >
      <TitleBar />

      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
        {sidebarVisible && (
          <Sidebar onNewWorkspace={() => setPresetPickerVisible(true)} />
        )}

        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {activeWorkspace && (
            <SplitContainer
              key={activeWorkspace.id}
              node={activeWorkspace.paneTree}
              onTerminalReady={handleTerminalReady}
              onTerminalFocus={(terminalId) =>
                setActiveTerminal(activeWorkspace.id, terminalId)
              }
              activeTerminalId={activeWorkspace.activeTerminalId}
              shell={settings?.shell.defaultShell}
            />
          )}
        </div>

        <NotificationPanel
          visible={notifPanelVisible}
          onClose={() => setNotifPanelVisible(false)}
        />
      </div>

      <CommandPalette
        visible={commandPaletteVisible}
        onClose={() => setCommandPaletteVisible(false)}
        commands={commands}
      />

      <WorkspacePresets
        visible={presetPickerVisible}
        onSelect={handleNewWorkspace}
        onClose={() => setPresetPickerVisible(false)}
      />
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function findActivePaneNode(
  node: PaneNode,
  activeTerminalId: string | null
): PaneNode | null {
  if (node.type === "terminal") {
    if (!activeTerminalId || node.terminalId === activeTerminalId) return node;
    return null;
  }
  return findActivePaneNode(node.first, activeTerminalId) || findActivePaneNode(node.second, activeTerminalId);
}

function findPaneByTerminalId(node: PaneNode, terminalId: string): PaneNode | null {
  if (node.type === "terminal" && node.terminalId === terminalId) return node;
  if (node.type === "split") {
    return findPaneByTerminalId(node.first, terminalId) || findPaneByTerminalId(node.second, terminalId);
  }
  return null;
}

function setPaneTerminalId(node: PaneNode, paneId: string, terminalId: string): PaneNode {
  if (node.id === paneId && node.type === "terminal") return { ...node, terminalId };
  if (node.type === "split") {
    return {
      ...node,
      first: setPaneTerminalId(node.first, paneId, terminalId),
      second: setPaneTerminalId(node.second, paneId, terminalId),
    };
  }
  return node;
}

// ── Session Serialization ────────────────────────────────────────

function serializePaneTree(node: PaneNode): import("./types").PaneNodeData {
  if (node.type === "terminal") {
    return { type: "terminal", cwd: "", shell: "" };
  }
  return {
    type: "split",
    direction: node.direction,
    ratio: node.ratio,
    first: serializePaneTree(node.first),
    second: serializePaneTree(node.second),
  };
}

function restorePaneTree(data: import("./types").PaneNodeData): PaneNode {
  const id = `pane-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (data.type === "terminal") {
    return { type: "terminal", id, terminalId: "" };
  }
  return {
    type: "split",
    id,
    direction: data.direction as "horizontal" | "vertical",
    ratio: data.ratio,
    first: restorePaneTree(data.first),
    second: restorePaneTree(data.second),
  };
}
