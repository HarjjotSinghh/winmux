import { create } from "zustand";
import type { Settings } from "../types";
import { getSettings, updateSettings } from "../lib/ipc";

interface SettingsStore {
  settings: Settings | null;
  loaded: boolean;
  load: () => Promise<void>;
  update: (settings: Settings) => Promise<void>;
  setFontSize: (size: number) => void;
}

const defaultSettings: Settings = {
  shell: {
    defaultShell: "powershell.exe",
    defaultCwd: null,
    env: {},
  },
  appearance: {
    fontFamily: "Cascadia Code, Consolas, monospace",
    fontSize: 14,
    theme: "dark",
    sidebarWidth: 220,
    showSidebar: true,
    opacity: 1.0,
  },
  notifications: {
    enabled: true,
    sound: true,
    toastNotifications: true,
    oscDetection: true,
  },
  keybindings: [],
};

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: null,
  loaded: false,

  load: async () => {
    try {
      const settings = await getSettings();
      set({ settings, loaded: true });
    } catch {
      set({ settings: defaultSettings, loaded: true });
    }
  },

  update: async (settings: Settings) => {
    set({ settings });
    await updateSettings(settings);
  },

  setFontSize: (size: number) => {
    const current = get().settings;
    if (current) {
      const updated = {
        ...current,
        appearance: { ...current.appearance, fontSize: size },
      };
      set({ settings: updated });
      updateSettings(updated).catch(() => {});
    }
  },
}));
