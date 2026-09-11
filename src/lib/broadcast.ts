/**
 * Broadcast fan-out plumbing.
 *
 * Keystrokes arrive in `TerminalView.onData`, whose effect mounts once and
 * never re-runs — so the terminal cannot subscribe to React state for this.
 * Instead the App registers a targets provider once; the terminal calls
 * `getBroadcastTargets(ownId)` synchronously on every keystroke and writes
 * to the returned ids itself. No re-renders, no remounts, no extra invokes
 * when broadcast is off (provider returns []).
 */

/** Returns the ids that should also receive keystrokes typed into `selfTerminalId`. */
export type BroadcastTargetsProvider = (selfTerminalId: string) => string[];

let provider: BroadcastTargetsProvider | null = null;

export function setBroadcastTargetsProvider(fn: BroadcastTargetsProvider | null): void {
  provider = fn;
}

/** Ids to mirror the current keystroke to, excluding the source terminal. */
export function getBroadcastTargets(selfTerminalId: string): string[] {
  if (!selfTerminalId || !provider) return [];
  try {
    return provider(selfTerminalId).filter((id) => id && id !== selfTerminalId);
  } catch {
    return [];
  }
}
