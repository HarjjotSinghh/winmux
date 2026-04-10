import { useRef, useState } from "react";
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
  node, onTerminalReady, onTerminalFocus, activeTerminalId, shell,
}: SplitContainerProps) {
  if (node.type === "terminal") {
    return (
      <div style={{ width: "100%", height: "100%" }}>
        <TerminalView
          onReady={(tid) => onTerminalReady(node.id, tid)}
          shell={shell}
          focused={node.terminalId === activeTerminalId}
          onFocus={() => { if (node.terminalId) onTerminalFocus(node.terminalId); }}
        />
      </div>
    );
  }

  if (node.type === "browser") {
    return (
      <div style={{ width: "100%", height: "100%" }}>
        <BrowserView initialUrl={node.url} />
      </div>
    );
  }

  return (
    <SplitView
      direction={node.direction}
      initialRatio={node.ratio}
      first={<SplitContainer node={node.first} onTerminalReady={onTerminalReady} onTerminalFocus={onTerminalFocus} activeTerminalId={activeTerminalId} shell={shell} />}
      second={<SplitContainer node={node.second} onTerminalReady={onTerminalReady} onTerminalFocus={onTerminalFocus} activeTerminalId={activeTerminalId} shell={shell} />}
    />
  );
}

function SplitView({ direction, initialRatio, first, second }: {
  direction: "horizontal" | "vertical";
  initialRatio: number;
  first: React.ReactNode;
  second: React.ReactNode;
}) {
  const [ratio, setRatio] = useState(initialRatio);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const horiz = direction === "horizontal";

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const move = (e: MouseEvent) => {
      if (!dragging.current || !ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const pos = horiz ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height;
      setRatio(Math.max(0.15, Math.min(0.85, pos)));
    };
    const up = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    document.body.style.cursor = horiz ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div ref={ref} style={{ display: "flex", flexDirection: horiz ? "row" : "column", width: "100%", height: "100%" }}>
      <div style={{ [horiz ? "width" : "height"]: `${ratio * 100}%`, overflow: "hidden" }}>{first}</div>
      <div
        onMouseDown={onDown}
        style={{
          [horiz ? "width" : "height"]: "1px",
          [horiz ? "minWidth" : "minHeight"]: "1px",
          background: "#1F1F1F",
          cursor: horiz ? "col-resize" : "row-resize",
          flexShrink: 0,
          position: "relative",
        }}
      >
        {/* Invisible wider hit area */}
        <div style={{
          position: "absolute",
          [horiz ? "width" : "height"]: "9px",
          [horiz ? "left" : "top"]: "-4px",
          [horiz ? "top" : "left"]: 0,
          [horiz ? "bottom" : "right"]: 0,
          [horiz ? "height" : "width"]: "100%",
          cursor: horiz ? "col-resize" : "row-resize",
        }} />
      </div>
      <div style={{ [horiz ? "width" : "height"]: `${(1 - ratio) * 100}%`, overflow: "hidden" }}>{second}</div>
    </div>
  );
}
