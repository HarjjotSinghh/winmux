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
  onSplit?: (paneId: string, direction: "horizontal" | "vertical") => void;
  onClosePane?: (paneId: string) => void;
}

export default function SplitContainer({
  node, onTerminalReady, onTerminalFocus, activeTerminalId, shell, onSplit, onClosePane,
}: SplitContainerProps) {
  if (node.type === "terminal") {
    return (
      <PaneFrame
        paneId={node.id}
        onSplit={onSplit}
        onClose={onClosePane}
      >
        <TerminalView
          onReady={(tid) => onTerminalReady(node.id, tid)}
          shell={shell}
          focused={node.terminalId === activeTerminalId}
          onFocus={() => { if (node.terminalId) onTerminalFocus(node.terminalId); }}
        />
      </PaneFrame>
    );
  }

  if (node.type === "browser") {
    return (
      <PaneFrame
        paneId={node.id}
        onSplit={onSplit}
        onClose={onClosePane}
      >
        <BrowserView initialUrl={node.url} />
      </PaneFrame>
    );
  }

  return (
    <SplitView
      direction={node.direction}
      initialRatio={node.ratio}
      first={<SplitContainer node={node.first} onTerminalReady={onTerminalReady} onTerminalFocus={onTerminalFocus} activeTerminalId={activeTerminalId} shell={shell} onSplit={onSplit} onClosePane={onClosePane} />}
      second={<SplitContainer node={node.second} onTerminalReady={onTerminalReady} onTerminalFocus={onTerminalFocus} activeTerminalId={activeTerminalId} shell={shell} onSplit={onSplit} onClosePane={onClosePane} />}
    />
  );
}

function PaneFrame({
  paneId,
  onSplit,
  onClose,
  children,
}: {
  paneId: string;
  onSplit?: (paneId: string, direction: "horizontal" | "vertical") => void;
  onClose?: (paneId: string) => void;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      {children}
      {hovered && (onSplit || onClose) && (
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            display: "flex",
            gap: 2,
            padding: 2,
            background: "rgba(20, 20, 20, 0.92)",
            border: "1px solid #2A2A2A",
            borderRadius: 5,
            zIndex: 10,
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          }}
        >
          {onSplit && (
            <>
              <PaneButton
                title="Split right (Ctrl+Shift+D)"
                onClick={() => onSplit(paneId, "horizontal")}
              >
                <SplitRightIcon />
              </PaneButton>
              <PaneButton
                title="Split down (Ctrl+Shift+E)"
                onClick={() => onSplit(paneId, "vertical")}
              >
                <SplitDownIcon />
              </PaneButton>
            </>
          )}
          {onClose && (
            <PaneButton
              title="Close pane (Ctrl+Shift+W)"
              onClick={() => onClose(paneId)}
              danger
            >
              <CloseIcon />
            </PaneButton>
          )}
        </div>
      )}
    </div>
  );
}

function PaneButton({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 22,
        height: 22,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: hover ? (danger ? "rgba(239, 68, 68, 0.15)" : "#2A2A2A") : "transparent",
        color: hover ? (danger ? "#EF4444" : "#F5F5F5") : "#A3A3A3",
        border: "none",
        borderRadius: 3,
        cursor: "pointer",
        padding: 0,
        transition: "all 120ms ease",
      }}
    >
      {children}
    </button>
  );
}

function SplitRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1" />
      <line x1="6" y1="1" x2="6" y2="11" stroke="currentColor" strokeWidth="1" />
      <line x1="8.5" y1="4" x2="8.5" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="7.2" y1="6" x2="9.8" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function SplitDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1" />
      <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1" />
      <line x1="6" y1="7.5" x2="6" y2="10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="4.5" y1="9" x2="7.5" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
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
          background: "#2A2A2A",
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
