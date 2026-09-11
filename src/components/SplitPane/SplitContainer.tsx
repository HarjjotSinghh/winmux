import { useMemo, useRef, useState } from "react";
import type { PaneNode } from "../../types";
import type { SplitLayout } from "../../lib/paneLayout";
import { computeLayout } from "../../lib/paneLayout";
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
  onRatioChange?: (splitId: string, ratio: number) => void;
  /** Pane shown full-bleed on top; the rest stay mounted underneath. */
  zoomedPaneId?: string | null;
  /** Per-terminal agent metadata for rings/badges (key = terminalId). */
  terminalMeta?: Record<string, { unread: number; status: string }>;
}

/**
 * Renders a pane tree as a flat, absolutely-positioned set of keyed leaves.
 *
 * Rendering the tree recursively makes React reconcile by *position*: when a
 * terminal leaf turns into a split, the element at that position changes from
 * a TerminalView to a layout container, so xterm is unmounted and remounted.
 * Re-attaching the PTY on remount is lossy (daemon-only, drops visual state,
 * blanks out when the session isn't attachable), which is why splitting used
 * to reset terminals. Flat, keyed rendering keeps every TerminalView mounted
 * for the lifetime of its pane.
 */
export default function SplitContainer({
  node,
  onTerminalReady,
  onTerminalFocus,
  activeTerminalId,
  shell,
  onSplit,
  onClosePane,
  onRatioChange,
  zoomedPaneId,
  terminalMeta,
}: SplitContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { leaves, splits } = useMemo(() => computeLayout(node), [node]);

  // Show the active-pane ring only when there is more than one pane — a lone
  // terminal shouldn't carry a permanent outline.
  const showFocusRing = leaves.length > 1;

  // Ignore a stale zoom id (pane closed) so the layout can't get stuck.
  const zoomedLeafId = leaves.some((l) => l.node.id === zoomedPaneId)
    ? zoomedPaneId
    : null;

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {leaves.map(({ node: leaf, rect: layoutRect }) => {
        const isZoomed = leaf.id === zoomedLeafId;
        const rect = isZoomed ? { x: 0, y: 0, w: 1, h: 1 } : layoutRect;
        const meta =
          leaf.type === "terminal" && leaf.terminalId
            ? terminalMeta?.[leaf.terminalId]
            : undefined;
        const hasNotification = (meta?.unread ?? 0) > 0;
        const agentStatus = meta?.status;
        return (
        <div
          key={leaf.id}
          style={{
            position: "absolute",
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`,
            height: `${rect.h * 100}%`,
            overflow: "hidden",
            zIndex: isZoomed ? 30 : undefined,
          }}
        >
          <PaneFrame
            paneId={leaf.id}
            onSplit={onSplit}
            onClose={onClosePane}
            focused={
              showFocusRing &&
              leaf.type === "terminal" &&
              leaf.terminalId !== "" &&
              leaf.terminalId === activeTerminalId
            }
            hasNotification={hasNotification}
            notificationCount={meta?.unread}
            agentStatus={agentStatus}
          >
            {leaf.type === "terminal" ? (
              <TerminalView
                onReady={(tid) => onTerminalReady(leaf.id, tid)}
                shell={leaf.restore?.shell || shell}
                cwd={leaf.cwd ?? leaf.restore?.cwd}
                restore={leaf.restore}
                focused={leaf.terminalId === activeTerminalId}
                onFocus={() => {
                  if (leaf.terminalId) onTerminalFocus(leaf.terminalId);
                }}
              />
            ) : (
              <BrowserView initialUrl={leaf.url} />
            )}
          </PaneFrame>
        </div>
        );
      })}

      {!zoomedLeafId &&
        splits.map((split) => (
          <PaneDivider
            key={split.id}
            split={split}
            containerRef={containerRef}
            onRatioChange={onRatioChange}
          />
        ))}
    </div>
  );
}

function PaneDivider({
  split,
  containerRef,
  onRatioChange,
}: {
  split: SplitLayout;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onRatioChange?: (splitId: string, ratio: number) => void;
}) {
  const horiz = split.direction === "horizontal";
  const [dragging, setDragging] = useState(false);

  const onDown = (e: React.MouseEvent) => {
    if (!onRatioChange) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);

    const move = (ev: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const posAbs = horiz
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height;
      const local = horiz
        ? (posAbs - split.rect.x) / split.rect.w
        : (posAbs - split.rect.y) / split.rect.h;
      onRatioChange(split.id, Math.max(0.15, Math.min(0.85, local)));
    };

    const up = () => {
      setDragging(false);
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

  const pos = horiz
    ? split.rect.x + split.rect.w * split.ratio
    : split.rect.y + split.rect.h * split.ratio;

  return (
    <div
      onMouseDown={onDown}
      style={{
        position: "absolute",
        left: horiz ? `${pos * 100}%` : 0,
        top: horiz ? 0 : `${pos * 100}%`,
        width: horiz ? 1 : "100%",
        height: horiz ? "100%" : 1,
        marginLeft: horiz ? -0.5 : 0,
        marginTop: horiz ? 0 : -0.5,
        background: dragging ? "#3B82F6" : "#2A2A2A",
        cursor: onRatioChange ? (horiz ? "col-resize" : "row-resize") : "default",
        zIndex: 20,
        flexShrink: 0,
      }}
    >
      {/* Invisible wider hit area */}
      <div
        style={{
          position: "absolute",
          [horiz ? "width" : "height"]: "9px",
          [horiz ? "left" : "top"]: "-4px",
          [horiz ? "top" : "left"]: 0,
          [horiz ? "bottom" : "right"]: 0,
          [horiz ? "height" : "width"]: "100%",
          cursor: onRatioChange ? (horiz ? "col-resize" : "row-resize") : "default",
        }}
      />
    </div>
  );
}

function PaneFrame({
  paneId,
  onSplit,
  onClose,
  focused,
  hasNotification,
  notificationCount,
  agentStatus,
  children,
}: {
  paneId: string;
  onSplit?: (paneId: string, direction: "horizontal" | "vertical") => void;
  onClose?: (paneId: string) => void;
  focused?: boolean;
  hasNotification?: boolean;
  notificationCount?: number;
  agentStatus?: string;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);

  const shadows: string[] = [];
  if (focused) shadows.push("inset 0 0 0 1px rgba(59, 130, 246, 0.6)");
  if (hasNotification) {
    const color =
      agentStatus === "needs_input"
        ? "rgba(251, 191, 36, 0.9)"
        : agentStatus === "working"
          ? "rgba(59, 130, 246, 0.9)"
          : "rgba(59, 130, 246, 0.9)";
    shadows.push(`inset 0 0 0 2px ${color}`);
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        boxShadow: shadows.length ? shadows.join(", ") : undefined,
        transition: "box-shadow 120ms ease",
      }}
    >
      {hasNotification && (
        <div
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: notificationCount && notificationCount > 1 ? "2px 6px" : "4px",
            background:
              agentStatus === "needs_input"
                ? "rgba(251, 191, 36, 0.95)"
                : "rgba(59, 130, 246, 0.95)",
            borderRadius: 10,
            zIndex: 9,
            boxShadow: "0 1px 6px rgba(0,0,0,0.4)",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#fff",
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          {notificationCount && notificationCount > 1 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
              {notificationCount}
            </span>
          )}
        </div>
      )}
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
