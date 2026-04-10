import { useCallback, useRef, useState } from "react";
import type { PaneNode } from "../../types";
import TerminalView from "../Terminal/TerminalView";
import BrowserView from "../Browser/BrowserView";

interface SplitContainerProps {
  node: PaneNode;
  onTerminalReady: (paneId: string, terminalId: string) => void;
  onTerminalFocus: (terminalId: string) => void;
  activeTerminalId: string | null;
  shell?: string;
}

export default function SplitContainer({
  node,
  onTerminalReady,
  onTerminalFocus,
  activeTerminalId,
  shell,
}: SplitContainerProps) {
  if (node.type === "terminal") {
    return (
      <div style={{ width: "100%", height: "100%", position: "relative" }}>
        <TerminalView
          onReady={(terminalId) => onTerminalReady(node.id, terminalId)}
          shell={shell}
          focused={node.terminalId === activeTerminalId}
          onFocus={() => {
            if (node.terminalId) onTerminalFocus(node.terminalId);
          }}
        />
      </div>
    );
  }

  if (node.type === "browser") {
    return (
      <div style={{ width: "100%", height: "100%", position: "relative" }}>
        <BrowserView initialUrl={node.url} />
      </div>
    );
  }

  return (
    <SplitView
      direction={node.direction}
      initialRatio={node.ratio}
      first={
        <SplitContainer
          node={node.first}
          onTerminalReady={onTerminalReady}
          onTerminalFocus={onTerminalFocus}
          activeTerminalId={activeTerminalId}
          shell={shell}
        />
      }
      second={
        <SplitContainer
          node={node.second}
          onTerminalReady={onTerminalReady}
          onTerminalFocus={onTerminalFocus}
          activeTerminalId={activeTerminalId}
          shell={shell}
        />
      }
    />
  );
}

// ── Split View with draggable divider ─────────────────────────────

interface SplitViewProps {
  direction: "horizontal" | "vertical";
  initialRatio: number;
  first: React.ReactNode;
  second: React.ReactNode;
}

function SplitView({ direction, initialRatio, first, second }: SplitViewProps) {
  const [ratio, setRatio] = useState(initialRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const isHorizontal = direction === "horizontal";

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      const onMouseMove = (e: MouseEvent) => {
        if (!dragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const pos = isHorizontal
          ? (e.clientX - rect.left) / rect.width
          : (e.clientY - rect.top) / rect.height;
        setRatio(Math.max(0.1, Math.min(0.9, pos)));
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [isHorizontal]
  );

  const firstSize = `${ratio * 100}%`;
  const secondSize = `${(1 - ratio) * 100}%`;

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        flexDirection: isHorizontal ? "row" : "column",
        width: "100%",
        height: "100%",
      }}
    >
      <div style={{ [isHorizontal ? "width" : "height"]: firstSize, overflow: "hidden" }}>
        {first}
      </div>
      <div
        onMouseDown={onMouseDown}
        style={{
          [isHorizontal ? "width" : "height"]: "4px",
          [isHorizontal ? "minWidth" : "minHeight"]: "4px",
          backgroundColor: "#21262d",
          cursor: isHorizontal ? "col-resize" : "row-resize",
          transition: "background-color 0.15s",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.backgroundColor = "#58a6ff";
        }}
        onMouseLeave={(e) => {
          if (!dragging.current) {
            (e.currentTarget as HTMLDivElement).style.backgroundColor = "#21262d";
          }
        }}
      />
      <div style={{ [isHorizontal ? "width" : "height"]: secondSize, overflow: "hidden" }}>
        {second}
      </div>
    </div>
  );
}
