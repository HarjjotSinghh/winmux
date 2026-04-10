import { invoke, Channel } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
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

// ── System Notifications ──────────────────────────────────────

export async function initNotifications(): Promise<void> {
  let granted = await isPermissionGranted();
  if (!granted) {
    const result = await requestPermission();
    granted = result === "granted";
  }
  if (!granted) {
    console.warn("Notification permission not granted");
  }
}

export async function showSystemNotification(
  title: string,
  body: string
): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const result = await requestPermission();
      granted = result === "granted";
    }
    if (granted) {
      sendNotification({ title, body });
    }
  } catch (e) {
    console.warn("Failed to send notification:", e);
  }
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
