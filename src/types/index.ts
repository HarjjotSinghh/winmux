// ── Pane Tree ──────────────────────────────────────────────────────

export type PaneNode =
  | { type: "terminal"; id: string; terminalId: string }
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
  | { type: "terminal"; cwd: string; shell: string }
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
