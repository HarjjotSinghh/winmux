import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { SearchAddon } from "@xterm/addon-search";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import "@xterm/xterm/css/xterm.css";
import { registerTerminal, unregisterTerminal } from "../../lib/terminalRegistry";
import { getBroadcastTargets } from "../../lib/broadcast";
import {
  createTerminal,
  writeTerminal,
  resizeTerminal,
  closeTerminal,
  clipboardPaste,
  clipboardWriteText,
  attachTerminal,
} from "../../lib/ipc";
import { getXtermTheme } from "../../lib/theme";
import { clampFontSize, DEFAULT_FONT_SIZE } from "../../lib/font";
import { useSettingsStore } from "../../stores/settingsStore";
import type { TerminalRestoreData } from "../../types";

function quotePath(p: string): string {
  return /[\s"']/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p;
}

function base64ToUint8(s: string): Uint8Array {
  const binary = atob(s);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const day = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day} · ${h}:${m}`;
}

/**
 * Coalesce xterm writes into one-per-frame flushes. When a PTY bursts output
 * (Claude streaming tokens, `cargo build` scrollback, etc.) we can receive
 * dozens of `on_output` callbacks per frame. Calling `term.write` synchronously
 * for each one stalls the main thread and triggers Windows' "(Not Responding)"
 * detection within seconds. This batches them into a single merged write
 * scheduled via `requestAnimationFrame`, so xterm gets at most one write per
 * 16 ms no matter how fast the PTY is producing.
 */
function makeCoalescedWriter(term: Terminal, isAlive: () => boolean = () => true) {
  let pending: Uint8Array[] = [];
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    if (!isAlive()) {
      pending = [];
      return;
    }
    if (pending.length === 0) return;
    if (pending.length === 1) {
      term.write(pending[0]);
      pending = [];
      return;
    }
    let total = 0;
    for (const p of pending) total += p.length;
    const merged = new Uint8Array(total);
    let off = 0;
    for (const p of pending) {
      merged.set(p, off);
      off += p.length;
    }
    pending = [];
    term.write(merged);
  };
  return (data: Uint8Array) => {
    if (!isAlive()) return;
    pending.push(data);
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  };
}

async function smartPasteInto(term: Terminal) {
  try {
    const result = await clipboardPaste();
    if (result.kind === "text") {
      term.paste(result.value);
    } else if (result.kind === "paths") {
      term.paste(result.paths.map(quotePath).join(" "));
    }
  } catch (e) {
    console.error("paste failed:", e);
  }
}

interface TerminalViewProps {
  onReady: (terminalId: string) => void;
  shell?: string;
  cwd?: string;
  focused?: boolean;
  onFocus?: () => void;
  restore?: TerminalRestoreData;
}

export default function TerminalView({
  onReady,
  shell,
  cwd,
  focused,
  onFocus,
  restore,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);

  const fontSize = useSettingsStore((s) => s.settings?.appearance.fontSize);
  const initialFontSizeRef = useRef(fontSize ?? DEFAULT_FONT_SIZE);

  // Store callbacks in refs so the init effect never re-runs
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  // Initialize terminal ONCE on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // React StrictMode mounts → unmounts → mounts effects in development.
    // Without this flag the first mount's async `createTerminal` would spawn a
    // shell after its cleanup already ran, leaking an orphan PTY for the whole
    // session. If the promise resolves after unmount, we close it immediately.
    let disposed = false;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "Cascadia Code, Consolas, Courier New, monospace",
      fontSize: initialFontSizeRef.current,
      lineHeight: 1.2,
      theme: getXtermTheme(),
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        openExternal(uri).catch((e) => console.error("open url failed:", e));
      })
    );
    term.loadAddon(new Unicode11Addon());
    // Loading the addon isn't enough — xterm keeps its default Unicode 6
    // width table until this is set, which breaks emoji/CJK alignment.
    term.unicode.activeVersion = "11";

    // Ctrl+Shift+C to copy selection, Ctrl+Shift+V to paste.
    // Return false to tell xterm we've handled the event.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (e.ctrlKey && e.shiftKey && (e.key === "C" || e.key === "c")) {
        const sel = term.getSelection();
        if (sel) {
          clipboardWriteText(sel).catch(console.error);
          term.clearSelection();
          return false;
        }
      }
      if (e.ctrlKey && e.shiftKey && (e.key === "V" || e.key === "v")) {
        smartPasteInto(term);
        return false;
      }
      return true;
    });

    term.open(container);

    // Right-click to paste
    container.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      // If user has a selection, copy it; otherwise paste.
      const sel = term.getSelection();
      if (sel) {
        clipboardWriteText(sel).catch(console.error);
        term.clearSelection();
      } else {
        smartPasteInto(term);
      }
    });

    // Try WebGL, fall back silently to canvas. A lost GPU context must
    // dispose the addon, otherwise xterm keeps rendering into a dead canvas
    // (blank/frozen pane) until the component remounts.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        console.warn("webgl context lost — falling back to canvas renderer");
        webgl.dispose();
      });
      term.loadAddon(webgl);
    } catch {
      // Canvas renderer is fine
    }

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Coalesce live PTY output so bursts don't stall the main thread.
    const writeCoalesced = makeCoalescedWriter(term, () => !disposed);

    // Delayed fit — container needs a frame to have real dimensions
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // Container might not be ready yet
      }

      const wireSession = (id: string) => {
        if (disposed) return;
        terminalIdRef.current = id;
        registerTerminal(id, { term, search: searchAddon });
        onReadyRef.current(id);
        term.onData((data) => {
          writeTerminal(id, data).catch(console.error);
          // Broadcast mode: mirror the keystroke to every other pane in the
          // workspace. Paste also flows through here (term.paste -> onData).
          for (const tid of getBroadcastTargets(id)) {
            writeTerminal(tid, data).catch(console.error);
          }
        });
        term.onResize(({ cols, rows }) => {
          resizeTerminal(id, cols, rows).catch(console.error);
        });
        term.focus();
      };

      const tryAttachThenFallback = async () => {
        const restore = restoreRef.current;
        if (disposed) return;

        // Path A: try to re-attach to a live daemon / in-process session
        if (restore?.sessionId) {
          try {
            const info = await attachTerminal(restore.sessionId, writeCoalesced);
            if (disposed) return;
            if (info.scrollbackBase64) {
              try {
                term.write(base64ToUint8(info.scrollbackBase64));
              } catch (e) {
                console.warn("attach scrollback decode failed:", e);
              }
            }
            term.write("\r\n\x1b[2;90m── Reattached ──\x1b[0m\r\n");
            wireSession(restore.sessionId);
            return;
          } catch (e) {
            console.info("attach failed, falling back to fresh shell:", e);
          }
        }

        // Path B: fresh shell, with optional Tier 2b visual replay.
        const hasVisualRestore = !!restore && (restore.scrollbackBase64.length > 0 || restore.cwd.length > 0);
        const pendingOutput: Uint8Array[] = [];
        let replayed = !hasVisualRestore;

        try {
          const id = await createTerminal(
            (data) => {
              if (disposed) return;
              if (replayed) writeCoalesced(data);
              else pendingOutput.push(data);
            },
            {
              shell: shellRef.current,
              cwd: cwdRef.current,
              cols: term.cols,
              rows: term.rows,
            }
          );

          // StrictMode (or a fast unmount) disposed this view while the PTY was
          // spawning. Close it so we don't leak an invisible shell.
          if (disposed) {
            closeTerminal(id).catch(() => {});
            return;
          }

          if (hasVisualRestore && restore) {
            const header = `\r\n\x1b[2;90m── Previous session · ${formatTime(restore.savedAt)} ──\x1b[0m\r\n`;
            const footer = `\r\n\x1b[2;90m── Resumed ──\x1b[0m\r\n\r\n`;
            term.write(header);
            if (restore.scrollbackBase64) {
              try {
                term.write(base64ToUint8(restore.scrollbackBase64));
              } catch (e) {
                console.warn("scrollback decode failed:", e);
              }
            }
            term.write(footer);
            replayed = true;
            for (const p of pendingOutput) writeCoalesced(p);
            pendingOutput.length = 0;
          }

          wireSession(id);
        } catch (e) {
          term.writeln(`\x1b[31mFailed to start terminal: ${e}\x1b[0m`);
          term.writeln("Check that powershell.exe or cmd.exe is available.");
        }
      };

      tryAttachThenFallback();
    });

    // Focus handler
    term.textarea?.addEventListener("focus", () => onFocusRef.current?.());

    // Resize observer
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit errors during rapid resize
      }
    });
    observer.observe(container);

    return () => {
      disposed = true;
      if (terminalIdRef.current) unregisterTerminal(terminalIdRef.current);
      observer.disconnect();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps — mount once, never re-run

  // Live font-size changes (Ctrl+= / Ctrl+- / Ctrl+0) refit the terminal
  // without touching its session.
  useEffect(() => {
    const term = terminalRef.current;
    if (!term || !fontSize) return;
    term.options.fontSize = clampFontSize(fontSize);
    requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // Ignore fit errors during transient layout.
      }
    });
  }, [fontSize]);

  // Focus management
  useEffect(() => {
    if (focused && terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [focused]);

  return (
    <div
      ref={containerRef}
      onClick={onFocus}
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "#0A0A0A",
        overflow: "hidden",
      }}
    />
  );
}
