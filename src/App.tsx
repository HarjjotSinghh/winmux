import { useEffect, useCallback, useState, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import TitleBar from "./components/TitleBar/TitleBar";
import Sidebar from "./components/Sidebar/Sidebar";
import SplitContainer from "./components/SplitPane/SplitContainer";
import NotificationPanel from "./components/Notification/NotificationPanel";
import CommandPalette from "./components/CommandPalette/CommandPalette";
import { useWorkspaceStore, getTerminalIds } from "./stores/workspaceStore";
import { useSettingsStore } from "./stores/settingsStore";
import { closeTerminal } from "./lib/ipc";

export default function App() {
  const {
    workspaces,
    activeWorkspaceId,
    createWorkspace,
    removeWorkspace,
    setActiveWorkspace,
    setActiveTerminal,
    updatePaneTree,
    splitPane,
    closePane,
    toggleSidebar,
    incrementUnread,
    sidebarVisible,
  } = useWorkspaceStore();

  const loadSettings = useSettingsStore((s) => s.load);
  const settings = useSettingsStore((s) => s.settings);

  const [notifPanelVisible, setNotifPanelVisible] = useState(false);
  const [commandPaletteVisible, setCommandPaletteVisible] = useState(false);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Create initial workspace
  useEffect(() => {
    if (workspaces.length === 0) {
      createWorkspace();
    }
  }, [workspaces.length, createWorkspace]);

  // Listen for terminal exit events
  useEffect(() => {
    const unlisten = listen<{ terminal_id: string }>("terminal-exit", (event) => {
      // Find which workspace contains this terminal and handle cleanup
      const ws = workspaces.find((w) => {
        const ids = getTerminalIds(w.paneTree);
        return ids.includes(event.payload.terminal_id);
      });
      if (ws) {
        // Find the pane with this terminal
        const pane = findPaneByTerminalId(ws.paneTree, event.payload.terminal_id);
        if (pane) {
          const removedId = closePane(ws.id, pane.id);
          if (removedId && ws.paneTree.type === "terminal") {
            // Last pane in workspace closed - remove workspace or create new terminal
            if (workspaces.length > 1) {
              removeWorkspace(ws.id);
            }
          }
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
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

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [workspaces, activeWorkspaceId, incrementUnread]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Shift+T: New workspace
      if (e.ctrlKey && e.shiftKey && e.key === "T") {
        e.preventDefault();
        createWorkspace();
      }
      // Ctrl+Shift+W: Close workspace
      else if (e.ctrlKey && e.shiftKey && e.key === "W") {
        e.preventDefault();
        if (activeWorkspaceId && workspaces.length > 1) {
          const ws = workspaces.find((w) => w.id === activeWorkspaceId);
          if (ws) {
            const terminalIds = getTerminalIds(ws.paneTree);
            terminalIds.forEach((id) => closeTerminal(id).catch(() => {}));
            removeWorkspace(activeWorkspaceId);
          }
        }
      }
      // Ctrl+Shift+D: Split right
      else if (e.ctrlKey && e.shiftKey && e.key === "D") {
        e.preventDefault();
        handleSplit("horizontal");
      }
      // Ctrl+Shift+E: Split down
      else if (e.ctrlKey && e.shiftKey && e.key === "E") {
        e.preventDefault();
        handleSplit("vertical");
      }
      // Ctrl+B: Toggle sidebar
      else if (e.ctrlKey && !e.shiftKey && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      }
      // Ctrl+Shift+P: Command palette
      else if (e.ctrlKey && e.shiftKey && e.key === "P") {
        e.preventDefault();
        setCommandPaletteVisible((v) => !v);
      }
      // Ctrl+Shift+I: Notifications
      else if (e.ctrlKey && e.shiftKey && e.key === "I") {
        e.preventDefault();
        setNotifPanelVisible((v) => !v);
      }
      // Ctrl+1-9: Switch workspace
      else if (e.ctrlKey && !e.shiftKey && e.key >= "1" && e.key <= "9") {
        const index = parseInt(e.key) - 1;
        if (index < workspaces.length) {
          e.preventDefault();
          setActiveWorkspace(workspaces[index].id);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    workspaces,
    activeWorkspaceId,
    createWorkspace,
    removeWorkspace,
    setActiveWorkspace,
    toggleSidebar,
  ]);

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

  const handleTerminalReady = useCallback(
    (paneId: string, terminalId: string) => {
      if (!activeWorkspace) return;
      // Update the pane tree with the terminal ID
      const updated = setPaneTerminalId(activeWorkspace.paneTree, paneId, terminalId);
      updatePaneTree(activeWorkspace.id, updated);
      setActiveTerminal(activeWorkspace.id, terminalId);
    },
    [activeWorkspace, updatePaneTree, setActiveTerminal]
  );

  const commands = useMemo(
    () => [
      { id: "newWorkspace", label: "New Workspace", shortcut: "Ctrl+Shift+T", action: () => createWorkspace() },
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
    [workspaces, createWorkspace, handleSplit, toggleSidebar, setActiveWorkspace]
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
        {sidebarVisible && <Sidebar onNewWorkspace={() => createWorkspace()} />}

        {/* Main content area */}
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
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function findActivePaneNode(
  node: import("./types").PaneNode,
  activeTerminalId: string | null
): import("./types").PaneNode | null {
  if (node.type === "terminal") {
    if (!activeTerminalId || node.terminalId === activeTerminalId) {
      return node;
    }
    return null;
  }
  return (
    findActivePaneNode(node.first, activeTerminalId) ||
    findActivePaneNode(node.second, activeTerminalId)
  );
}

function findPaneByTerminalId(
  node: import("./types").PaneNode,
  terminalId: string
): import("./types").PaneNode | null {
  if (node.type === "terminal" && node.terminalId === terminalId) {
    return node;
  }
  if (node.type === "split") {
    return (
      findPaneByTerminalId(node.first, terminalId) ||
      findPaneByTerminalId(node.second, terminalId)
    );
  }
  return null;
}

function setPaneTerminalId(
  node: import("./types").PaneNode,
  paneId: string,
  terminalId: string
): import("./types").PaneNode {
  if (node.id === paneId && node.type === "terminal") {
    return { ...node, terminalId };
  }
  if (node.type === "split") {
    return {
      ...node,
      first: setPaneTerminalId(node.first, paneId, terminalId),
      second: setPaneTerminalId(node.second, paneId, terminalId),
    };
  }
  return node;
}
