import { invoke, Channel } from "@tauri-apps/api/core";
import type { Settings, Notification, SessionData } from "../types";

// ── Terminal ──────────────────────────────────────────────────────

export async function createTerminal(
  onOutput: (data: Uint8Array) => void,
  options?: { shell?: string; cwd?: string; cols?: number; rows?: number }
): Promise<string> {
  const channel = new Channel<number[]>();
  channel.onmessage = (data) => {
    onOutput(new Uint8Array(data));
  };

  return invoke<string>("create_terminal", {
    onOutput: channel,
    shell: options?.shell,
    cwd: options?.cwd,
    cols: options?.cols ?? 80,
    rows: options?.rows ?? 24,
  });
}

export interface AttachInfo {
  scrollbackBase64: string;
  shell: string;
  cwd: string;
}

/**
 * Re-attach to an existing daemon-owned PTY by ID. Registers the output channel
 * for subsequent push notifications and returns the current scrollback so the
 * caller can replay it into xterm before live output resumes. Rejects with
 * "daemon_unavailable" if the daemon isn't running, or a "not_found" variant if
 * the session has since died.
 */
export async function attachTerminal(
  sessionId: string,
  onOutput: (data: Uint8Array) => void
): Promise<AttachInfo> {
  const channel = new Channel<number[]>();
  channel.onmessage = (data) => {
    onOutput(new Uint8Array(data));
  };

  const raw = await invoke<{ scrollback_b64: string; shell: string; cwd: string }>(
    "attach_terminal",
    { sessionId, onOutput: channel }
  );
  return {
    scrollbackBase64: raw.scrollback_b64,
    shell: raw.shell,
    cwd: raw.cwd,
  };
}

export async function writeTerminal(id: string, data: string): Promise<void> {
  const encoder = new TextEncoder();
  return invoke("write_terminal", {
    id,
    data: Array.from(encoder.encode(data)),
  });
}

export async function resizeTerminal(
  id: string,
  cols: number,
  rows: number
): Promise<void> {
  return invoke("resize_terminal", { id, cols, rows });
}

export async function closeTerminal(id: string): Promise<void> {
  return invoke("close_terminal", { id });
}

export async function getShellPath(): Promise<string> {
  return invoke<string>("get_shell_path");
}

export async function getCwd(id: string): Promise<string> {
  return invoke<string>("get_cwd", { id });
}

export async function getScrollback(id: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>("get_scrollback", { id });
  return new Uint8Array(bytes);
}

export async function getTerminalShell(id: string): Promise<string> {
  return invoke<string>("get_terminal_shell", { id });
}

// ── System Notifications ──────────────────────────────────────

export async function initNotifications(): Promise<void> {
  // notify-rust handles permissions natively on Windows
}

export async function showSystemNotification(
  title: string,
  body: string
): Promise<void> {
  return invoke("send_toast", { title, body });
}

// ── Notifications ──────────────────────────────────────────────

export async function listNotifications(): Promise<Notification[]> {
  return invoke<Notification[]>("list_notifications");
}

export async function clearNotifications(): Promise<void> {
  return invoke("clear_notifications");
}

export async function dismissNotification(id: string): Promise<void> {
  return invoke("dismiss_notification", { id });
}

// ── Settings ──────────────────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export async function updateSettings(settings: Settings): Promise<void> {
  return invoke("update_settings", { settings });
}

// ── Session ──────────────────────────────────────────────────────

export async function saveSession(data: SessionData): Promise<void> {
  return invoke("save_session", { data });
}

export async function loadSession(): Promise<SessionData | null> {
  return invoke<SessionData | null>("load_session");
}

// ── Clipboard ────────────────────────────────────────────────────

export type ClipboardPaste =
  | { kind: "text"; value: string }
  | { kind: "paths"; paths: string[] }
  | { kind: "empty" };

export async function clipboardPaste(): Promise<ClipboardPaste> {
  return invoke<ClipboardPaste>("clipboard_paste");
}

export async function clipboardWriteText(text: string): Promise<void> {
  return invoke("clipboard_write_text", { text });
}

// ── Window ──────────────────────────────────────────────────────

export async function windowMinimize(): Promise<void> {
  return invoke("window_minimize");
}

export async function windowMaximize(): Promise<void> {
  return invoke("window_maximize");
}

export async function windowClose(): Promise<void> {
  return invoke("window_close");
}

export async function windowIsMaximized(): Promise<boolean> {
  return invoke<boolean>("window_is_maximized");
}

export async function quitApp(): Promise<void> {
  return invoke("quit_app");
}

export async function openDevtools(): Promise<void> {
  return invoke("open_devtools");
}
