import type { Terminal } from "@xterm/xterm";
import type { SearchAddon } from "@xterm/addon-search";

/**
 * Live xterm instances keyed by terminal id.
 *
 * `TerminalView` owns its xterm; consumers that need to act on the focused
 * terminal from outside the component tree (the search overlay, future
 * features like copy mode) look it up here instead of prop-drilling refs.
 */
export interface TerminalHandle {
  term: Terminal;
  search: SearchAddon;
}

const handles = new Map<string, TerminalHandle>();

export function registerTerminal(id: string, handle: TerminalHandle): void {
  handles.set(id, handle);
}

export function unregisterTerminal(id: string): void {
  handles.delete(id);
}

export function getTerminal(id: string | null | undefined): TerminalHandle | null {
  if (!id) return null;
  return handles.get(id) ?? null;
}
