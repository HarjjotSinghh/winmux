// ── Pane Tree ──────────────────────────────────────────────────────

export interface TerminalRestoreData {
  cwd: string;
  shell: string;
  scrollbackBase64: string;
  savedAt: number;
  /** Daemon session ID to re-attach; when set, UI tries attach_terminal first. */
  sessionId?: string;
}

export type PaneNode =
  | {
      type: "terminal";
      id: string;
      terminalId: string;
      restore?: TerminalRestoreData;
    }
  | { type: "browser"; id: string; url: string }
  | {
      type: "split";
      id: string;
      direction: "horizontal" | "vertical";
      ratio: number;
      first: PaneNode;
      second: PaneNode;
    };

// ── Workspace ──────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  color: string;
  paneTree: PaneNode;
  activeTerminalId: string | null;
  gitBranch: string | null;
  cwd: string | null;
  unreadCount: number;
}

// ── Notification ──────────────────────────────────────────────────

export interface Notification {
  id: string;
  terminalId: string;
  title: string;
  body: string;
  source: string;
  timestamp: string;
  read: boolean;
}

// ── Settings ──────────────────────────────────────────────────────

export interface Settings {
  shell: {
    defaultShell: string;
    defaultCwd: string | null;
    env: Record<string, string>;
  };
  appearance: {
    fontFamily: string;
    fontSize: number;
    theme: string;
    sidebarWidth: number;
    showSidebar: boolean;
    opacity: number;
  };
  notifications: {
    enabled: boolean;
    sound: boolean;
    toastNotifications: boolean;
    oscDetection: boolean;
  };
  keybindings: Keybinding[];
}

export interface Keybinding {
  action: string;
  keys: string;
}

// ── Session ──────────────────────────────────────────────────────

export interface SessionData {
  workspaces: WorkspaceData[];
  activeWorkspace: number;
  sidebarWidth: number;
  sidebarVisible: boolean;
  windowState: {
    x: number;
    y: number;
    width: number;
    height: number;
    maximized: boolean;
  };
}

export interface WorkspaceData {
  name: string;
  color: string | null;
  paneTree: PaneNodeData;
}

export type PaneNodeData =
  | {
      type: "terminal";
      cwd: string;
      shell: string;
      scrollback?: string;
      /** Daemon session ID to re-attach on restore (present only when daemon owned the PTY). */
      sessionId?: string;
    }
  | {
      type: "split";
      direction: string;
      ratio: number;
      first: PaneNodeData;
      second: PaneNodeData;
    };

// ── Theme ──────────────────────────────────────────────────────

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}
