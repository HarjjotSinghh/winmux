import { useEffect, useCallback, useState, useMemo, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import TitleBar from "./components/TitleBar/TitleBar";
import Sidebar from "./components/Sidebar/Sidebar";
import SplitContainer from "./components/SplitPane/SplitContainer";
import TerminalSearch from "./components/Terminal/TerminalSearch";
import NotificationPanel from "./components/Notification/NotificationPanel";
import CommandPalette from "./components/CommandPalette/CommandPalette";
import WorkspacePresets from "./components/Sidebar/WorkspacePresets";
import WorktreeDialog from "./components/Sidebar/WorktreeDialog";
import UpdateBanner from "./components/Updater/UpdateBanner";
import DaemonBanner from "./components/Daemon/DaemonBanner";
import type { LayoutPreset } from "./components/Sidebar/WorkspacePresets";
import { AGENT_PRESETS } from "./components/Sidebar/WorkspacePresets";
import { useWorkspaceStore, applyCwdToTree, getTerminalIds, getFirstTerminalId, getPaneTerminalId } from "./stores/workspaceStore";
import { computeLayout, findPaneInDirection } from "./lib/paneLayout";
import type { PaneDirection } from "./lib/paneLayout";
import { setBroadcastTargetsProvider } from "./lib/broadcast";
import { clampFontSize, DEFAULT_FONT_SIZE } from "./lib/font";
import { useSettingsStore } from "./stores/settingsStore";
import { useAgentStore } from "./stores/agentStore";
import { closeTerminal, saveSession, loadSession, initNotifications, showSystemNotification, writeTerminal, getCwd, getTerminalShell, getScrollback, openDevtools, diagLog, gitToplevel, gitWorktreeAdd, getGitBranch, toggleQuake } from "./lib/ipc";
import { branchFromPath } from "./lib/worktree";
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
    setWorkspaceColor,
    setWorkspaceIcon,
    setActiveWorkspace,
    setActiveTerminal,
    updatePaneTree,
    setPaneRatio,
    toggleSidebar,
    incrementUnread,
    openBrowserInSplit,
    sidebarVisible,
    sidebarWidth,
  } = useWorkspaceStore();

  const loadSettings = useSettingsStore((s) => s.load);
  const settings = useSettingsStore((s) => s.settings);
  const agentUnread = useAgentStore((s) => s.unread);
  const agentStatuses = useAgentStore((s) => s.statuses);

  const terminalMeta = useMemo(() => {
    const map: Record<string, { unread: number; status: string }> = {};
    for (const [id, count] of Object.entries(agentUnread)) {
      map[id] = { unread: count, status: agentStatuses[id] ?? "needs_input" };
    }
    for (const [id, status] of Object.entries(agentStatuses)) {
      if (!map[id]) map[id] = { unread: 0, status };
    }
    return map;
  }, [agentUnread, agentStatuses]);

  const [notifPanelVisible, setNotifPanelVisible] = useState(false);
  const [commandPaletteVisible, setCommandPaletteVisible] = useState(false);
  const [presetPickerVisible, setPresetPickerVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const sessionRestoredRef = useRef(false);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  // ── Main-thread stall heartbeat ─────────────────────────────────
  // setInterval(100 ms) — if the actual gap between fires exceeds 300 ms the
  // main thread was blocked for that long. Log the stall to the Tauri log
  // file (readable after the fact via AppData\Local\com.winmux.terminal\logs)
  // so post-freeze investigation doesn't need the user to catch the freeze
  // with DevTools open.
  useEffect(() => {
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const gap = now - last;
      last = now;
      if (gap > 300) {
        diagLog(
          "warn",
          `UI stall: ${Math.round(gap)}ms (expected ~100ms) @ ${new Date().toISOString()}`
        );
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  // Also log long tasks for extra granularity when available.
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration > 200) {
            diagLog(
              "warn",
              `longtask: ${Math.round(e.duration)}ms "${(e as PerformanceEntry).name}"`
            );
          }
        }
      });
      obs.observe({ entryTypes: ["longtask"] });
      return () => obs.disconnect();
    } catch {
      // longtask entryType unsupported — ignore.
    }
  }, []);

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
          const created = createWorkspaceWithTree(ws.name, restorePaneTree(ws.paneTree, savedAt));
          // createWorkspaceWithTree assigns defaults — restore saved styling.
          if (ws.color) setWorkspaceColor(created.id, ws.color);
          if (ws.icon) setWorkspaceIcon(created.id, ws.icon);
        });
      } else {
        createWorkspace();
      }
    }).catch(() => {
      createWorkspace();
    });
  }, [loadSettings, createWorkspace, createWorkspaceWithTree, setWorkspaceColor, setWorkspaceIcon]);

  // ── Auto-save session ──────────────────────────────────────────
  // Light saves (structure + cwd) every 5s; heavy save (with scrollback)
  // on visibility change (window hide) and beforeunload.
  useEffect(() => {
    if (workspaces.length === 0) return;

    // Guard: if a save is still in-flight when the next interval fires, skip.
    // Without this, a slow save (e.g. blocked on a hung daemon call) lets
    // subsequent saves pile up and starve the async runtime.
    let saveInFlight = false;
    const doSave = async (includeScrollback: boolean) => {
      if (saveInFlight) return;
      saveInFlight = true;
      try {
        const wsData = await Promise.all(
          workspaces.map(async (ws) => ({
            name: ws.name,
            color: ws.color,
            icon: ws.icon ?? null,
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
      } finally {
        saveInFlight = false;
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

  /**
   * Close a pane, kill (or account for) its PTY, and re-target focus to a
   * surviving terminal. Reads the store directly so it can never act on a
   * stale `workspaces` closure (the terminal-exit event fires from outside
   * React and used to race re-renders).
   */
  const removeTerminalPanes = useCallback(
    (workspaceId: string, paneId: string, opts: { ptyAlreadyExited?: boolean } = {}) => {
      const store = useWorkspaceStore.getState();
      const ws = store.workspaces.find((w) => w.id === workspaceId);
      if (!ws) return;

      const isOnlyPane =
        ws.paneTree.type === "terminal" && ws.paneTree.id === paneId;

      if (isOnlyPane) {
        const terminalIds = getTerminalIds(ws.paneTree);
        const agentStore = useAgentStore.getState();
        if (opts.ptyAlreadyExited) {
          // Shell exited on its own. Close the workspace if there are others;
          // otherwise respawn a fresh shell so the app isn't stuck on a dead pane.
          if (store.workspaces.length > 1) {
            store.removeWorkspace(workspaceId);
            terminalIds.forEach((id) => agentStore.clearForTerminal(id));
          } else {
            terminalIds.forEach((id) => agentStore.clearForTerminal(id));
            store.resetPane(workspaceId, paneId);
          }
        } else if (store.workspaces.length > 1) {
          getTerminalIds(ws.paneTree).forEach((id) => closeTerminal(id).catch(() => {}));
          store.removeWorkspace(workspaceId);
          terminalIds.forEach((id) => agentStore.clearForTerminal(id));
        }
        return;
      }

      const removedId = store.closePane(workspaceId, paneId);
      if (removedId) {
        useAgentStore.getState().clearForTerminal(removedId);
      }
      if (removedId && !opts.ptyAlreadyExited) {
        closeTerminal(removedId).catch(() => {});
      }

      const updated = useWorkspaceStore
        .getState()
        .workspaces.find((w) => w.id === workspaceId);
      if (!updated) return;
      if (updated.activeTerminalId === removedId || !updated.activeTerminalId) {
        const next = getFirstTerminalId(updated.paneTree);
        if (next) store.setActiveTerminal(workspaceId, next);
      }
    },
    []
  );

  // Listen for terminal exit events (shell exited, process crashed, …)
  useEffect(() => {
    const unlisten = listen<{ terminal_id: string }>("terminal-exit", (event) => {
      const store = useWorkspaceStore.getState();
      const ws = store.workspaces.find((w) =>
        getTerminalIds(w.paneTree).includes(event.payload.terminal_id)
      );
      if (!ws) return;
      const pane = findPaneByTerminalId(ws.paneTree, event.payload.terminal_id);
      if (pane) removeTerminalPanes(ws.id, pane.id, { ptyAlreadyExited: true });
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [removeTerminalPanes]);

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

  // Listen for OSC notifications — per-pane rings + agent status
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
        const agentStore = useAgentStore.getState();
        const isFocused =
          !!ws &&
          ws.id === activeWorkspaceId &&
          ws.activeTerminalId === event.payload.terminal_id;

        // Workspace-level badge (existing behaviour)
        if (ws && ws.id !== activeWorkspaceId) {
          incrementUnread(ws.id);
        }
        // Per-pane agent store — increment only if not currently focused
        if (!isFocused) {
          agentStore.incrementForTerminal(
            event.payload.terminal_id,
            event.payload.title,
            event.payload.body
          );
        } else {
          // Still track that the agent was working, but don't mark unread
          agentStore.setStatus(event.payload.terminal_id, "needs_input");
        }
      }
    );

    return () => { unlisten.then((fn) => fn()); };
  }, [workspaces, activeWorkspaceId, incrementUnread]);

  // Sync the active workspace's cwd + git branch from the focused terminal.
  // Runs on focus/workspace switches only (not on a timer) so a busy
  // machine never gets invoke storms; each step no-ops when unchanged.
  useEffect(() => {
    const ws = workspaces.find((w) => w.id === activeWorkspaceId);
    const tid = ws?.activeTerminalId;
    if (!ws || !tid) return;
    let cancelled = false;
    (async () => {
      const cwd = await getCwd(tid).catch(() => "");
      if (cancelled || !cwd) return;
      const store = useWorkspaceStore.getState();
      if (store.workspaces.find((w) => w.id === ws.id)?.cwd !== cwd) {
        store.setCwd(ws.id, cwd);
      }
      const branch = await getGitBranch(cwd);
      if (cancelled) return;
      if (store.workspaces.find((w) => w.id === ws.id)?.gitBranch !== (branch ?? null)) {
        store.setGitBranch(ws.id, branch);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, activeWorkspace?.activeTerminalId]);

  // Clear per-pane notification when the user focuses that terminal
  useEffect(() => {
    const tid = activeWorkspace?.activeTerminalId;
    if (!tid) return;
    const agentStore = useAgentStore.getState();
    if (agentStore.unread[tid]) {
      agentStore.clearForTerminal(tid);
    }
    // Mark as idle once viewed (will be set to working/needs_input again on next OSC)
    if (agentStore.statuses[tid] && agentStore.statuses[tid] !== "idle") {
      // keep working indication briefly, then idle — just clear unread, keep status for ring until next event?
      // For now, clear status to idle when focused
      agentStore.setStatus(tid, "idle");
    }
    // Also clear workspace unread when jumping to it
    if (activeWorkspace) {
      // Use store directly to avoid stale closure on clearUnread
      useWorkspaceStore.getState().clearUnread(activeWorkspace.id);
    }
  }, [activeWorkspace?.activeTerminalId, activeWorkspace?.id]);

  /** Best known working directory of a terminal (live when the shell reports
   *  OSC 7 / OSC 9;9, spawn dir otherwise). */
  const resolvePaneCwd = useCallback(async (terminalId: string | null) => {
    if (!terminalId) return undefined;
    try {
      const cwd = await getCwd(terminalId);
      return cwd || undefined;
    } catch {
      return undefined;
    }
  }, []);

  const handleSplit = useCallback(
    async (direction: "horizontal" | "vertical") => {
      const store = useWorkspaceStore.getState();
      const ws = store.workspaces.find((w) => w.id === store.activeWorkspaceId);
      if (!ws) return;
      const activePane = findActivePaneNode(ws.paneTree, ws.activeTerminalId);
      if (!activePane) return;
      const cwd = await resolvePaneCwd(
        activePane.type === "terminal" ? activePane.terminalId || null : null
      );
      // New splits start in the directory of the pane they came from.
      store.splitPane(ws.id, activePane.id, direction, "", cwd);
    },
    [resolvePaneCwd]
  );

  const handlePaneSplit = useCallback(
    async (paneId: string, direction: "horizontal" | "vertical") => {
      const store = useWorkspaceStore.getState();
      const ws = store.workspaces.find((w) => w.id === store.activeWorkspaceId);
      if (!ws) return;
      const cwd = await resolvePaneCwd(getPaneTerminalId(ws.paneTree, paneId));
      store.splitPane(ws.id, paneId, direction, "", cwd);
    },
    [resolvePaneCwd]
  );

  const handlePaneClose = useCallback(
    (paneId: string) => {
      const activeId = useWorkspaceStore.getState().activeWorkspaceId;
      if (!activeId) return;
      removeTerminalPanes(activeId, paneId);
    },
    [removeTerminalPanes]
  );

  /** Delete a workspace — kills every PTY it owns so no shells leak. */
  const handleCloseWorkspace = useCallback((workspaceId: string) => {
    const store = useWorkspaceStore.getState();
    const ws = store.workspaces.find((w) => w.id === workspaceId);
    if (!ws) return;
    const ids = getTerminalIds(ws.paneTree);
    ids.forEach((id) => closeTerminal(id).catch(() => {}));
    store.removeWorkspace(workspaceId);
    const agentStore = useAgentStore.getState();
    ids.forEach((id) => agentStore.clearForTerminal(id));
  }, []);

  /** Duplicate a workspace's layout with fresh shells (palette + tab menu). */
  const handleDuplicateWorkspace = useCallback(async (workspaceId?: string) => {
    const store = useWorkspaceStore.getState();
    const id = workspaceId ?? store.activeWorkspaceId;
    if (!id) return;
    const ws = store.workspaces.find((w) => w.id === id);
    if (!ws) return;
    // Resolve each live terminal's *current* directory so duplicates start
    // where the shells actually are, not where they spawned. Dead or
    // unreachable terminals simply contribute nothing (stored cwd fallback).
    const live = new Map<string, string>();
    await Promise.all(
      getTerminalIds(ws.paneTree).map(async (tid) => {
        try {
          const cwd = await getCwd(tid);
          if (cwd) live.set(tid, cwd);
        } catch {
          // Session gone mid-duplicate — fall back to stored cwd.
        }
      })
    );
    store.duplicateWorkspace(id, live);
  }, []);

  /** Cycle workspaces forward/backward with wraparound (Ctrl+Tab). */
  const handleCycleWorkspace = useCallback((direction: 1 | -1) => {
    useWorkspaceStore.getState().cycleWorkspace(direction);
  }, []);

  const handleCloseActivePane = useCallback(() => {
    if (!activeWorkspace) return;
    const activePane = findActivePaneNode(
      activeWorkspace.paneTree,
      activeWorkspace.activeTerminalId
    );
    if (activePane) handlePaneClose(activePane.id);
  }, [activeWorkspace, handlePaneClose]);

  /**
   * Toggle full-bleed zoom for the active pane (Ctrl+Shift+Z). The other
   * panes stay mounted underneath, so no PTY is ever disturbed.
   */
  const handleToggleZoom = useCallback(() => {
    const store = useWorkspaceStore.getState();
    const ws = store.workspaces.find((w) => w.id === store.activeWorkspaceId);
    if (!ws) return;
    const activePane = findActivePaneNode(ws.paneTree, ws.activeTerminalId);
    if (activePane) store.toggleZoom(ws.id, activePane.id);
  }, []);

  /**
   * Toggle broadcast input for the active workspace (Ctrl+Shift+G). When on,
   * keystrokes typed into any pane are mirrored to every other pane in the
   * workspace. Paste flows through xterm onData, so it broadcasts too.
   */
  const handleToggleBroadcast = useCallback(() => {
    const store = useWorkspaceStore.getState();
    const ws = store.workspaces.find((w) => w.id === store.activeWorkspaceId);
    if (ws) store.toggleBroadcast(ws.id);
  }, []);

  // Register the broadcast fan-out resolver once. TerminalView reads it
  // synchronously on every keystroke (its effect mounts once), so this must
  // not depend on render state — it pulls fresh store state per keystroke.
  useEffect(() => {
    setBroadcastTargetsProvider((selfId) => {
      const s = useWorkspaceStore.getState();
      const ws = s.workspaces.find((w) => getTerminalIds(w.paneTree).includes(selfId));
      if (!ws || !ws.broadcastInput) return [];
      return getTerminalIds(ws.paneTree);
    });
    return () => setBroadcastTargetsProvider(null);
  }, []);

  const handleJumpToTerminal = useCallback((terminalId: string): boolean => {
    const store = useWorkspaceStore.getState();
    const ws = store.workspaces.find((w) => getTerminalIds(w.paneTree).includes(terminalId));
    if (!ws) return false;
    store.setActiveWorkspace(ws.id);
    store.setActiveTerminal(ws.id, terminalId);
    useAgentStore.getState().clearForTerminal(terminalId);
    store.clearUnread(ws.id);
    setNotifPanelVisible(false);
    return true;
  }, []);

  const handleNextNotification = useCallback(() => {
    const agentStore = useAgentStore.getState();
    const current = activeWorkspace?.activeTerminalId ?? null;
    // Evict any terminals that died since their notification arrived so the
    // queue can never wedge on a stale head.
    for (let i = 0; i < agentStore.queue.length + 1; i++) {
      const nextId = agentStore.nextUnread(current);
      if (!nextId) return;
      if (handleJumpToTerminal(nextId)) return;
      agentStore.clearForTerminal(nextId);
    }
  }, [activeWorkspace?.activeTerminalId, handleJumpToTerminal]);

  const handlePrevNotification = useCallback(() => {
    const agentStore = useAgentStore.getState();
    const current = activeWorkspace?.activeTerminalId ?? null;
    for (let i = 0; i < agentStore.queue.length + 1; i++) {
      const prevId = agentStore.prevUnread(current);
      if (!prevId) return;
      if (handleJumpToTerminal(prevId)) return;
      agentStore.clearForTerminal(prevId);
    }
  }, [activeWorkspace?.activeTerminalId, handleJumpToTerminal]);

  /** Terminal font zoom (Ctrl+= / Ctrl+- / Ctrl+0), persisted to settings. */
  const zoomFont = useCallback((delta: number) => {
    const store = useSettingsStore.getState();
    const current = store.settings?.appearance.fontSize ?? DEFAULT_FONT_SIZE;
    store.setFontSize(clampFontSize(current + delta));
  }, []);

  const resetFont = useCallback(() => {
    useSettingsStore.getState().setFontSize(DEFAULT_FONT_SIZE);
  }, []);

  /**
   * Move keyboard focus to the nearest pane in a direction (Alt+Arrow).
   * Geometry-based, so it always matches the visible layout.
   */
  const handleFocusDirection = useCallback((direction: PaneDirection) => {
    const store = useWorkspaceStore.getState();
    const ws = store.workspaces.find((w) => w.id === store.activeWorkspaceId);
    if (!ws) return;

    const activePane = findActivePaneNode(ws.paneTree, ws.activeTerminalId);
    if (!activePane) return;

    const target = findPaneInDirection(ws.paneTree, activePane.id, direction);
    if (target && target.type === "terminal" && target.terminalId) {
      store.setActiveTerminal(ws.id, target.terminalId);
    }
  }, []);

  // Chords xterm would otherwise forward to the shell. Registered in the
  // capture phase so the terminal textarea never sees them: xterm's own
  // keydown listener translates Ctrl+Shift+<letter> into control characters
  // sent via onData before a bubble-phase window handler could prevent it.
  // (Placed after all handlers it references to avoid TDZ issues.)
  useEffect(() => {
    const directions: Record<string, PaneDirection> = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    };
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const direction = directions[e.key];
        if (!direction) return;
        e.preventDefault();
        e.stopPropagation();
        handleFocusDirection(direction);
        return;
      }
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === "Tab") {
        // Ctrl+Tab / Ctrl+Shift+Tab — cycle workspaces. Must be captured:
        // xterm's textarea listener would otherwise forward the Tab to the
        // PTY (triggering completion) before a bubble handler could stop it.
        e.preventDefault();
        e.stopPropagation();
        handleCycleWorkspace(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === "g") {
          e.preventDefault();
          e.stopPropagation();
          handleToggleBroadcast();
        } else if (key === "u") {
          e.preventDefault();
          e.stopPropagation();
          void handleOpenWorktreeDialog();
        }
      }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Startup commands queued per pane id; consumed once the terminal reports
  // ready (agent presets). Pane ids are stable, so a ref is enough.
  const pendingSpawnsRef = useRef(new Map<string, string>());

  const handleNewWorkspace = useCallback(
    async (preset: LayoutPreset, name: string) => {
      const tree = preset.build();
      if (preset.spawns && preset.spawns.length > 0) {
        // Map spawns to terminal panes in layout (DFS) order.
        const paneIds = computeLayout(tree)
          .leaves.filter((l) => l.node.type === "terminal")
          .map((l) => l.node.id);
        paneIds.forEach((paneId, i) => {
          const cmd = preset.spawns?.[i];
          if (cmd) pendingSpawnsRef.current.set(paneId, cmd);
        });
      }
      // New workspaces start in the active terminal's directory (when it has
      // one) so agent presets like `npm run dev` run in the project, not home.
      const store = useWorkspaceStore.getState();
      const ws = store.workspaces.find((w) => w.id === store.activeWorkspaceId);
      const cwd = await resolvePaneCwd(ws?.activeTerminalId ?? null);
      createWorkspaceWithTree(name, cwd ? applyCwdToTree(tree, cwd) : tree);
      setPresetPickerVisible(false);
    },
    [createWorkspaceWithTree, resolvePaneCwd]
  );

  const [worktreeDialogVisible, setWorktreeDialogVisible] = useState(false);
  const [worktreeDefaultRepo, setWorktreeDefaultRepo] = useState<string | null>(null);

  const handleOpenWorktreeDialog = useCallback(async () => {
    // Prefill the repo from the active terminal's cwd when it's inside git.
    let repo: string | null = null;
    try {
      const store = useWorkspaceStore.getState();
      const ws = store.workspaces.find((w) => w.id === store.activeWorkspaceId);
      const tid = ws?.activeTerminalId ?? null;
      if (tid) {
        const cwd = await getCwd(tid).catch(() => "");
        if (cwd) repo = await gitToplevel(cwd);
      }
    } catch {
      repo = null;
    }
    setWorktreeDefaultRepo(repo);
    setWorktreeDialogVisible(true);
  }, []);

  const handleCreateWorktree = useCallback(
    async (repo: string, path: string, branch: string) => {
      await gitWorktreeAdd(repo, path, branch);
      const paneId = `pane-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tree: PaneNode = { type: "terminal", id: paneId, terminalId: "", cwd: path };
      createWorkspaceWithTree(branchFromPath(path), tree);
      setWorktreeDialogVisible(false);
    },
    [createWorkspaceWithTree]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "i") && e.altKey) {
        // Ctrl+Shift+Alt+I — open devtools (diagnostic; avoid colliding
        // with the terminal's own Ctrl+Shift+I).
        e.preventDefault();
        openDevtools().catch(console.error);
        return;
      }
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
      } else if (e.ctrlKey && e.shiftKey && e.key === "Z") {
        e.preventDefault();
        handleToggleZoom();
      } else if (e.ctrlKey && (e.key === "=" || e.key === "+")) {
        // Ctrl+= or Ctrl+Shift+= (Ctrl++) — both zoom in.
        e.preventDefault();
        zoomFont(1);
      } else if (e.ctrlKey && !e.shiftKey && e.key === "-") {
        e.preventDefault();
        zoomFont(-1);
      } else if (e.ctrlKey && !e.shiftKey && e.key === "0") {
        e.preventDefault();
        resetFont();
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleNextNotification();
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        handlePrevNotification();
      } else if (e.ctrlKey && !e.shiftKey && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if (e.ctrlKey && e.shiftKey && e.key === "P") {
        e.preventDefault();
        setCommandPaletteVisible((v) => !v);
      } else if (e.ctrlKey && e.shiftKey && e.key === "I") {
        e.preventDefault();
        setNotifPanelVisible((v) => !v);
      } else if (e.ctrlKey && e.shiftKey && e.key === "F") {
        e.preventDefault();
        setSearchVisible((v) => !v);
      } else if (e.ctrlKey && e.shiftKey && e.key === "L") {
        e.preventDefault();
        handleOpenBrowser();
        // NOTE: Ctrl+Shift+G (broadcast), Ctrl+Shift+U (worktree), and
        // Ctrl+Tab / Ctrl+Shift+Tab (workspace cycling) are handled in the
        // capture-phase listener above — by the time a bubble handler runs,
        // xterm has already forwarded them to the shell.
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
  }, [workspaces, setActiveWorkspace, toggleSidebar, handleSplit, handleCloseActivePane, handleOpenBrowser, handleToggleZoom, zoomFont, resetFont, handleNextNotification, handlePrevNotification, handleCycleWorkspace]);

  const commands = useMemo(
    () => [
      { id: "newWorkspace", label: "New Workspace...", shortcut: "Ctrl+Shift+T", action: () => setPresetPickerVisible(true) },
      ...AGENT_PRESETS.map((p) => ({
        id: `agent-preset-${p.id}`,
        label: `New ${p.name} workspace`,
        action: () => { void handleNewWorkspace(p, p.name); },
      })),
      { id: "splitRight", label: "Split Right", shortcut: "Ctrl+Shift+D", action: () => handleSplit("horizontal") },
      { id: "splitDown", label: "Split Down", shortcut: "Ctrl+Shift+E", action: () => handleSplit("vertical") },
      { id: "focusLeft", label: "Focus Pane Left", shortcut: "Alt+Left", action: () => handleFocusDirection("left") },
      { id: "focusRight", label: "Focus Pane Right", shortcut: "Alt+Right", action: () => handleFocusDirection("right") },
      { id: "focusUp", label: "Focus Pane Up", shortcut: "Alt+Up", action: () => handleFocusDirection("up") },
      { id: "focusDown", label: "Focus Pane Down", shortcut: "Alt+Down", action: () => handleFocusDirection("down") },
      { id: "zoomPane", label: "Zoom Active Pane", shortcut: "Ctrl+Shift+Z", action: handleToggleZoom },
      { id: "fontIncrease", label: "Increase Terminal Font", shortcut: "Ctrl+=", action: () => zoomFont(1) },
      { id: "fontDecrease", label: "Decrease Terminal Font", shortcut: "Ctrl+-", action: () => zoomFont(-1) },
      { id: "fontReset", label: "Reset Terminal Font Size", shortcut: "Ctrl+0", action: resetFont },
      { id: "toggleSidebar", label: "Toggle Sidebar", shortcut: "Ctrl+B", action: toggleSidebar },
      { id: "commandPalette", label: "Toggle Command Palette", shortcut: "Ctrl+Shift+P", action: () => setCommandPaletteVisible((v) => !v) },
      { id: "notifications", label: "Toggle Notifications", shortcut: "Ctrl+Shift+I", action: () => setNotifPanelVisible((v) => !v) },
      { id: "findInTerminal", label: "Find in Terminal", shortcut: "Ctrl+Shift+F", action: () => setSearchVisible((v) => !v) },
      { id: "nextNotification", label: "Next Notification", shortcut: "Ctrl+Shift+N", action: handleNextNotification },
      { id: "prevNotification", label: "Previous Notification", shortcut: "Ctrl+Shift+B", action: handlePrevNotification },
      { id: "openBrowser", label: "Open Browser in Split", shortcut: "Ctrl+Shift+L", action: handleOpenBrowser },
      { id: "toggleBroadcast", label: "Toggle Broadcast Input", shortcut: "Ctrl+Shift+G", action: handleToggleBroadcast },
      { id: "worktreeWorkspace", label: "New Workspace from Git Worktree…", shortcut: "Ctrl+Shift+U", action: () => { void handleOpenWorktreeDialog(); } },
      { id: "nextWorkspace", label: "Next Workspace", shortcut: "Ctrl+Tab", action: () => handleCycleWorkspace(1) },
      { id: "prevWorkspace", label: "Previous Workspace", shortcut: "Ctrl+Shift+Tab", action: () => handleCycleWorkspace(-1) },
      { id: "duplicateWorkspace", label: "Duplicate Active Workspace", shortcut: undefined, action: () => handleDuplicateWorkspace() },
      { id: "quakeWindow", label: "Toggle Quake Window", shortcut: "Ctrl+Shift+Space", action: () => { toggleQuake().catch(console.error); } },
      { id: "testNotification", label: "Send Test Notification", action: () => showSystemNotification("WinMux", "Notifications are working!") },
      ...workspaces.map((w, i) => ({
        id: `workspace-${w.id}`,
        label: `Switch to ${w.name}`,
        shortcut: i < 9 ? `Ctrl+${i + 1}` : undefined,
        action: () => setActiveWorkspace(w.id),
      })),
    ],
    [workspaces, handleSplit, handleFocusDirection, handleToggleZoom, zoomFont, resetFont, toggleSidebar, setActiveWorkspace, handleNextNotification, handlePrevNotification, handleToggleBroadcast, handleNewWorkspace, handleCycleWorkspace, handleDuplicateWorkspace]
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
          <Sidebar
            onNewWorkspace={() => setPresetPickerVisible(true)}
            onCloseWorkspace={handleCloseWorkspace}
            onDuplicateWorkspace={(id) => handleDuplicateWorkspace(id)}
          />
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
                  // Agent preset: boot the queued command once the shell is up.
                  // Small delay so the prompt is ready; PTY input would queue
                  // anyway, this just avoids racing profile output.
                  const spawn = pendingSpawnsRef.current.get(paneId);
                  if (spawn) {
                    pendingSpawnsRef.current.delete(paneId);
                    setTimeout(() => {
                      writeTerminal(terminalId, `${spawn}\r`).catch(console.error);
                    }, 600);
                  }
                }}
                onTerminalFocus={(terminalId) =>
                  setActiveTerminal(ws.id, terminalId)
                }
                activeTerminalId={ws.id === activeWorkspaceId ? ws.activeTerminalId : null}
                shell={settings?.shell.defaultShell}
                onSplit={ws.id === activeWorkspaceId ? handlePaneSplit : undefined}
                onClosePane={ws.id === activeWorkspaceId ? handlePaneClose : undefined}
                onRatioChange={
                  ws.id === activeWorkspaceId
                    ? (splitId, ratio) => setPaneRatio(ws.id, splitId, ratio)
                    : undefined
                }
                zoomedPaneId={ws.zoomedPaneId ?? null}
                terminalMeta={terminalMeta}
              />
            </div>
          ))}

          {activeWorkspace?.broadcastInput && (
            <div
              onClick={handleToggleBroadcast}
              title="Broadcast input is ON — click to turn off (Ctrl+Shift+G)"
              style={{
                position: "absolute",
                bottom: 10,
                right: 12,
                zIndex: 300,
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                background: "rgba(239, 68, 68, 0.92)",
                borderRadius: 10,
                boxShadow: "0 1px 6px rgba(0,0,0,0.4)",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "#fff",
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
                BROADCAST · {getTerminalIds(activeWorkspace.paneTree).length} panes
              </span>
            </div>
          )}

          <TerminalSearch
            visible={searchVisible}
            terminalId={activeWorkspace?.activeTerminalId ?? null}
            onClose={() => setSearchVisible(false)}
          />
        </div>

        <NotificationPanel
          visible={notifPanelVisible}
          onClose={() => setNotifPanelVisible(false)}
          onJump={handleJumpToTerminal}
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
        onWorktree={() => {
          setPresetPickerVisible(false);
          void handleOpenWorktreeDialog();
        }}
      />

      <WorktreeDialog
        visible={worktreeDialogVisible}
        defaultRepo={worktreeDefaultRepo}
        onSubmit={handleCreateWorktree}
        onClose={() => setWorktreeDialogVisible(false)}
      />

      <UpdateBanner />
      <DaemonBanner />
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
    return { type: "browser", url: node.url };
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
  if (data.type === "browser") {
    return { type: "browser", id, url: data.url };
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
