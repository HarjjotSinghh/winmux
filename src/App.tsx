import { useEffect, useCallback, useState, useMemo, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import TitleBar from "./components/TitleBar/TitleBar";
import Sidebar from "./components/Sidebar/Sidebar";
import SplitContainer from "./components/SplitPane/SplitContainer";
import NotificationPanel from "./components/Notification/NotificationPanel";
import CommandPalette from "./components/CommandPalette/CommandPalette";
import WorkspacePresets from "./components/Sidebar/WorkspacePresets";
import UpdateBanner from "./components/Updater/UpdateBanner";
import type { LayoutPreset } from "./components/Sidebar/WorkspacePresets";
import { useWorkspaceStore, getTerminalIds } from "./stores/workspaceStore";
import { useSettingsStore } from "./stores/settingsStore";
import { closeTerminal, saveSession, loadSession, initNotifications, showSystemNotification, writeTerminal, getCwd, getTerminalShell, getScrollback } from "./lib/ipc";
import type { SessionData, PaneNode, PaneNodeData } from "./types";

function quotePath(p: string): string {
  return /[\s"']/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

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
    openBrowserInSplit,
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
    initNotifications().catch(console.warn);

    loadSession().then((data) => {
      if (data && data.workspaces.length > 0) {
        const savedAt = Date.now();
        data.workspaces.forEach((ws) => {
          createWorkspaceWithTree(ws.name, restorePaneTree(ws.paneTree, savedAt));
        });
      } else {
        createWorkspace();
      }
    }).catch(() => {
      createWorkspace();
    });
  }, [loadSettings, createWorkspace, createWorkspaceWithTree]);

  // ── Auto-save session ──────────────────────────────────────────
  // Light saves (structure + cwd) every 5s; heavy save (with scrollback)
  // on visibility change (window hide) and beforeunload.
  useEffect(() => {
    if (workspaces.length === 0) return;

    const doSave = async (includeScrollback: boolean) => {
      try {
        const wsData = await Promise.all(
          workspaces.map(async (ws) => ({
            name: ws.name,
            color: ws.color,
            paneTree: await serializePaneTree(ws.paneTree, includeScrollback),
          }))
        );
        const sessionData: SessionData = {
          workspaces: wsData,
          activeWorkspace: workspaces.findIndex((w) => w.id === activeWorkspaceId),
          sidebarWidth,
          sidebarVisible,
          windowState: { x: 0, y: 0, width: 1280, height: 800, maximized: false },
        };
        await saveSession(sessionData);
      } catch (e) {
        console.warn("session save failed:", e);
      }
    };

    const timer = setInterval(() => { doSave(false); }, AUTO_SAVE_INTERVAL);

    const heavySave = () => { doSave(true); };
    const visHandler = () => { if (document.hidden) heavySave(); };
    window.addEventListener("beforeunload", heavySave);
    document.addEventListener("visibilitychange", visHandler);

    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", heavySave);
      document.removeEventListener("visibilitychange", visHandler);
    };
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

  // Drag-drop files → write quoted paths into active terminal
  useEffect(() => {
    const webview = getCurrentWebview();
    const unlistenPromise = webview.onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const ws = workspaces.find((w) => w.id === activeWorkspaceId);
      if (!ws?.activeTerminalId) return;
      const paths = event.payload.paths || [];
      if (paths.length === 0) return;
      const text = paths.map(quotePath).join(" ") + " ";
      writeTerminal(ws.activeTerminalId, text).catch(console.error);
    });
    return () => { unlistenPromise.then((fn) => fn()); };
  }, [workspaces, activeWorkspaceId]);

  // Listen for OSC notifications
  useEffect(() => {
    const unlisten = listen<{ terminal_id: string; title: string; body: string }>(
      "osc-notification",
      (event) => {
        // Fire Windows toast notification
        showSystemNotification(
          event.payload.title || "WinMux",
          event.payload.body || "Terminal notification"
        );

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

  const handlePaneSplit = useCallback(
    (paneId: string, direction: "horizontal" | "vertical") => {
      if (!activeWorkspace) return;
      splitPane(activeWorkspace.id, paneId, direction, "");
    },
    [activeWorkspace, splitPane]
  );

  const handlePaneClose = useCallback(
    (paneId: string) => {
      if (!activeWorkspace) return;
      if (activeWorkspace.paneTree.type === "terminal" && activeWorkspace.paneTree.id === paneId) {
        if (workspaces.length > 1) {
          const ids = getTerminalIds(activeWorkspace.paneTree);
          ids.forEach((id) => closeTerminal(id).catch(() => {}));
          removeWorkspace(activeWorkspace.id);
        }
        return;
      }
      const removedId = closePane(activeWorkspace.id, paneId);
      if (removedId) closeTerminal(removedId).catch(() => {});
    },
    [activeWorkspace, workspaces, closePane, removeWorkspace]
  );

  const handleCloseActivePane = useCallback(() => {
    if (!activeWorkspace) return;
    const activePane = findActivePaneNode(
      activeWorkspace.paneTree,
      activeWorkspace.activeTerminalId
    );
    if (activePane) handlePaneClose(activePane.id);
  }, [activeWorkspace, handlePaneClose]);

  const handleOpenBrowser = useCallback(() => {
    if (!activeWorkspace) return;
    const activePane = findActivePaneNode(
      activeWorkspace.paneTree,
      activeWorkspace.activeTerminalId
    );
    if (activePane) {
      openBrowserInSplit(activeWorkspace.id, activePane.id, "https://google.com");
    }
  }, [activeWorkspace, openBrowserInSplit]);

  const handleNewWorkspace = useCallback(
    (preset: LayoutPreset, name: string) => {
      const tree = preset.build();
      createWorkspaceWithTree(name || undefined as unknown as string, tree);
      setPresetPickerVisible(false);
    },
    [createWorkspaceWithTree]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "T") {
        e.preventDefault();
        setPresetPickerVisible(true);
      } else if (e.ctrlKey && e.shiftKey && e.key === "W") {
        e.preventDefault();
        handleCloseActivePane();
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
      } else if (e.ctrlKey && e.shiftKey && e.key === "L") {
        e.preventDefault();
        handleOpenBrowser();
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
  }, [workspaces, setActiveWorkspace, toggleSidebar, handleSplit, handleCloseActivePane, handleOpenBrowser]);

  const commands = useMemo(
    () => [
      { id: "newWorkspace", label: "New Workspace...", shortcut: "Ctrl+Shift+T", action: () => setPresetPickerVisible(true) },
      { id: "splitRight", label: "Split Right", shortcut: "Ctrl+Shift+D", action: () => handleSplit("horizontal") },
      { id: "splitDown", label: "Split Down", shortcut: "Ctrl+Shift+E", action: () => handleSplit("vertical") },
      { id: "toggleSidebar", label: "Toggle Sidebar", shortcut: "Ctrl+B", action: toggleSidebar },
      { id: "notifications", label: "Toggle Notifications", shortcut: "Ctrl+Shift+I", action: () => setNotifPanelVisible((v) => !v) },
      { id: "openBrowser", label: "Open Browser in Split", shortcut: "Ctrl+Shift+L", action: handleOpenBrowser },
      { id: "testNotification", label: "Send Test Notification", action: () => showSystemNotification("WinMux", "Notifications are working!") },
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

        {/* Render ALL workspaces, hide inactive ones — keeps terminals alive */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              style={{
                position: "absolute",
                inset: 0,
                visibility: ws.id === activeWorkspaceId ? "visible" : "hidden",
                zIndex: ws.id === activeWorkspaceId ? 1 : 0,
              }}
            >
              <SplitContainer
                node={ws.paneTree}
                onTerminalReady={(paneId, terminalId) => {
                  const updated = setPaneTerminalId(ws.paneTree, paneId, terminalId);
                  updatePaneTree(ws.id, updated);
                  setActiveTerminal(ws.id, terminalId);
                }}
                onTerminalFocus={(terminalId) =>
                  setActiveTerminal(ws.id, terminalId)
                }
                activeTerminalId={ws.id === activeWorkspaceId ? ws.activeTerminalId : null}
                shell={settings?.shell.defaultShell}
                onSplit={ws.id === activeWorkspaceId ? handlePaneSplit : undefined}
                onClosePane={ws.id === activeWorkspaceId ? handlePaneClose : undefined}
              />
            </div>
          ))}
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

      <UpdateBanner />
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
  if (node.type === "browser") return null;
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

async function serializePaneTree(
  node: PaneNode,
  includeScrollback: boolean
): Promise<PaneNodeData> {
  if (node.type === "terminal") {
    const tid = node.terminalId;
    if (!tid) return { type: "terminal", cwd: "", shell: "" };

    const [cwd, shell, scrollback] = await Promise.all([
      getCwd(tid).catch(() => ""),
      getTerminalShell(tid).catch(() => ""),
      includeScrollback
        ? getScrollback(tid).then(uint8ToBase64).catch(() => "")
        : Promise.resolve(""),
    ]);
    // Persist the terminal ID as the daemon session ID. On restore the UI will
    // try to re-attach; if the daemon's still holding that session, the PTY
    // (and anything running in it) survives the UI restart.
    return { type: "terminal", cwd, shell, scrollback, sessionId: tid };
  }
  if (node.type === "browser") {
    return { type: "terminal", cwd: "", shell: "" };
  }
  const [first, second] = await Promise.all([
    serializePaneTree(node.first, includeScrollback),
    serializePaneTree(node.second, includeScrollback),
  ]);
  return {
    type: "split",
    direction: node.direction,
    ratio: node.ratio,
    first,
    second,
  };
}

function restorePaneTree(data: PaneNodeData, savedAt: number): PaneNode {
  const id = `pane-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (data.type === "terminal") {
    const hasState =
      (data.cwd && data.cwd.length > 0) ||
      (data.scrollback && data.scrollback.length > 0) ||
      !!data.sessionId;
    return {
      type: "terminal",
      id,
      terminalId: "",
      restore: hasState
        ? {
            cwd: data.cwd,
            shell: data.shell,
            scrollbackBase64: data.scrollback ?? "",
            savedAt,
            sessionId: data.sessionId,
          }
        : undefined,
    };
  }
  return {
    type: "split",
    id,
    direction: data.direction as "horizontal" | "vertical",
    ratio: data.ratio,
    first: restorePaneTree(data.first, savedAt),
    second: restorePaneTree(data.second, savedAt),
  };
}
