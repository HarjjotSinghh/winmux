import type { TerminalTheme } from "../types";
import type { ITheme } from "@xterm/xterm";

const darkTheme: TerminalTheme = {
  background: "#0A0A0A",
  foreground: "#E5E5E5",
  cursor: "#3B82F6",
  cursorAccent: "#0A0A0A",
  selectionBackground: "rgba(59, 130, 246, 0.25)",
  selectionForeground: "#FFFFFF",
  black: "#404040",
  red: "#EF4444",
  green: "#22C55E",
  yellow: "#EAB308",
  blue: "#3B82F6",
  magenta: "#A855F7",
  cyan: "#06B6D4",
  white: "#D4D4D4",
  brightBlack: "#525252",
  brightRed: "#F87171",
  brightGreen: "#4ADE80",
  brightYellow: "#FACC15",
  brightBlue: "#60A5FA",
  brightMagenta: "#C084FC",
  brightCyan: "#22D3EE",
  brightWhite: "#F5F5F5",
};

export function getXtermTheme(theme: TerminalTheme = darkTheme): ITheme {
  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor,
    cursorAccent: theme.cursorAccent,
    selectionBackground: theme.selectionBackground,
    selectionForeground: theme.selectionForeground,
    black: theme.black,
    red: theme.red,
    green: theme.green,
    yellow: theme.yellow,
    blue: theme.blue,
    magenta: theme.magenta,
    cyan: theme.cyan,
    white: theme.white,
    brightBlack: theme.brightBlack,
    brightRed: theme.brightRed,
    brightGreen: theme.brightGreen,
    brightYellow: theme.brightYellow,
    brightBlue: theme.brightBlue,
    brightMagenta: theme.brightMagenta,
    brightCyan: theme.brightCyan,
    brightWhite: theme.brightWhite,
  };
}

export const WORKSPACE_COLORS = [
  "#3B82F6",
  "#22C55E",
  "#A855F7",
  "#EAB308",
  "#EF4444",
  "#06B6D4",
  "#EC4899",
  "#F97316",
  "#6366F1",
  "#14B8A6",
];

export function getWorkspaceColor(index: number): string {
  return WORKSPACE_COLORS[index % WORKSPACE_COLORS.length];
}
