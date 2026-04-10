import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import { createTerminal, writeTerminal, resizeTerminal } from "../../lib/ipc";
import { getXtermTheme } from "../../lib/theme";
import { useSettingsStore } from "../../stores/settingsStore";

interface TerminalViewProps {
  onReady: (terminalId: string) => void;
  onExit?: () => void;
  shell?: string;
  cwd?: string;
  focused?: boolean;
  onFocus?: () => void;
}

export default function TerminalView({
  onReady,
  onExit: _onExit,
  shell,
  cwd,
  focused,
  onFocus,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  const settings = useSettingsStore((s) => s.settings);

  const initTerminal = useCallback(async () => {
    if (initializedRef.current || !containerRef.current) return;
    initializedRef.current = true;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: settings?.appearance.fontFamily ?? "Cascadia Code, Consolas, monospace",
      fontSize: settings?.appearance.fontSize ?? 14,
      lineHeight: 1.2,
      theme: getXtermTheme(),
      allowProposedApi: true,
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new Unicode11Addon());

    term.open(containerRef.current);

    // Try WebGL, fall back to canvas
    try {
      term.loadAddon(new WebglAddon());
    } catch (e) {
      console.warn("WebGL addon failed, using canvas renderer:", e);
    }

    fitAddon.fit();
    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Spawn PTY and connect
    try {
      const id = await createTerminal(
        (data) => term.write(data),
        {
          shell,
          cwd,
          cols: term.cols,
          rows: term.rows,
        }
      );

      terminalIdRef.current = id;
      onReady(id);

      // Send keyboard input to PTY
      term.onData((data) => {
        writeTerminal(id, data).catch(console.error);
      });

      // Handle resize
      term.onResize(({ cols, rows }) => {
        resizeTerminal(id, cols, rows).catch(console.error);
      });
    } catch (e) {
      console.error("Failed to create terminal:", e);
      term.write(`\r\nFailed to start terminal: ${e}\r\n`);
    }

    // Focus handling
    term.textarea?.addEventListener("focus", () => onFocus?.());
  }, [shell, cwd, onReady, onFocus, settings?.appearance.fontFamily, settings?.appearance.fontSize]);

  useEffect(() => {
    initTerminal();

    return () => {
      terminalRef.current?.dispose();
    };
  }, [initTerminal]);

  // Handle resize on container size changes
  useEffect(() => {
    if (!containerRef.current || !fitAddonRef.current) return;

    const observer = new ResizeObserver(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // Ignore fit errors during rapid resize
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

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
