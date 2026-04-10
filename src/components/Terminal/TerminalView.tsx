import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import { createTerminal, writeTerminal, resizeTerminal } from "../../lib/ipc";
import { getXtermTheme } from "../../lib/theme";

interface TerminalViewProps {
  onReady: (terminalId: string) => void;
  shell?: string;
  cwd?: string;
  focused?: boolean;
  onFocus?: () => void;
}

export default function TerminalView({
  onReady,
  shell,
  cwd,
  focused,
  onFocus,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);

  // Store callbacks in refs so the init effect never re-runs
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  // Initialize terminal ONCE on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "Cascadia Code, Consolas, Courier New, monospace",
      fontSize: 14,
      lineHeight: 1.2,
      theme: getXtermTheme(),
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new Unicode11Addon());

    term.open(container);

    // Try WebGL, fall back silently to canvas
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // Canvas renderer is fine
    }

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Delayed fit — container needs a frame to have real dimensions
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // Container might not be ready yet
      }

      // Spawn PTY after fit so we send correct cols/rows
      createTerminal(
        (data) => term.write(data),
        {
          shell: shellRef.current,
          cwd: cwdRef.current,
          cols: term.cols,
          rows: term.rows,
        }
      )
        .then((id) => {
          terminalIdRef.current = id;
          onReadyRef.current(id);

          term.onData((data) => {
            writeTerminal(id, data).catch(console.error);
          });

          term.onResize(({ cols, rows }) => {
            resizeTerminal(id, cols, rows).catch(console.error);
          });

          term.focus();
        })
        .catch((e) => {
          term.writeln(`\x1b[31mFailed to start terminal: ${e}\x1b[0m`);
          term.writeln("Check that powershell.exe or cmd.exe is available.");
        });
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
      observer.disconnect();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps — mount once, never re-run

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
        backgroundColor: "#0d1117",
        overflow: "hidden",
      }}
    />
  );
}
