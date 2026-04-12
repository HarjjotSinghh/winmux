import { useState, useRef, useEffect } from "react";
import type { Workspace } from "../../types";
import ColorPicker from "./ColorPicker";

interface WorkspaceTabProps {
  workspace: Workspace;
  index: number;
  isActive: boolean;
  onClick: () => void;
  onClose?: () => void;
  onRename: (name: string) => void;
  onColorChange: (color: string) => void;
}

export default function WorkspaceTab({
  workspace, index, isActive, onClick, onClose, onRename, onColorChange,
}: WorkspaceTabProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(workspace.name);
  const [showColor, setShowColor] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [menu]);

  const commit = () => {
    const v = editValue.trim();
    if (v && v !== workspace.name) onRename(v);
    else setEditValue(workspace.name);
    setEditing(false);
  };

  const startRename = () => {
    setEditing(true);
    setEditValue(workspace.name);
    setMenu(null);
  };

  return (
    <div
      onClick={onClick}
      onDoubleClick={(e) => { e.stopPropagation(); startRename(); }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "7px 8px",
        marginBottom: "1px",
        borderRadius: "6px",
        cursor: "pointer",
        background: isActive ? "#1A1A1A" : hovered ? "#131313" : "transparent",
        transition: "background 150ms ease",
        position: "relative",
      }}
    >
      {/* Accent dot */}
      <div
        onClick={(e) => { e.stopPropagation(); setShowColor(!showColor); }}
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: isActive ? workspace.color : "#333",
          flexShrink: 0,
          cursor: "pointer",
          transition: "background 150ms ease",
          position: "relative",
        }}
      >
        {showColor && (
          <ColorPicker
            currentColor={workspace.color}
            onSelect={onColorChange}
            onClose={() => setShowColor(false)}
          />
        )}
      </div>

      {/* Name */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditValue(workspace.name); setEditing(false); } }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              padding: "0 2px",
              background: "#0A0A0A",
              border: "1px solid #3B82F6",
              borderRadius: "3px",
              color: "#E5E5E5",
              fontSize: "12px",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        ) : (
          <>
            <div style={{
              fontSize: "12px",
              fontWeight: isActive ? 500 : 400,
              color: isActive ? "#F5F5F5" : hovered ? "#D4D4D4" : "#B4B4B4",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}>
              {workspace.name}
            </div>
            {workspace.gitBranch && (
              <div style={{ fontSize: "10px", color: "#8A8A8A", marginTop: "1px" }}>
                {workspace.gitBranch}
              </div>
            )}
          </>
        )}
      </div>

      {/* Shortcut hint */}
      {index < 9 && !editing && (
        <span style={{ fontSize: "10px", color: "#666", flexShrink: 0, fontFamily: "monospace" }}>
          {index + 1}
        </span>
      )}

      {/* Badge */}
      {workspace.unreadCount > 0 && (
        <div style={{
          minWidth: "16px",
          height: "16px",
          borderRadius: "8px",
          background: "#3B82F6",
          color: "#fff",
          fontSize: "9px",
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 4px",
          flexShrink: 0,
        }}>
          {workspace.unreadCount > 9 ? "9+" : workspace.unreadCount}
        </div>
      )}

      {/* Close */}
      {onClose && !editing && hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          aria-label="Close workspace"
          style={{
            background: "none",
            border: "none",
            color: "#A3A3A3",
            cursor: "pointer",
            fontSize: "12px",
            padding: "0",
            lineHeight: 1,
            flexShrink: 0,
            transition: "color 150ms",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#EF4444"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#A3A3A3"; }}
        >
          x
        </button>
      )}

      {/* Context menu */}
      {menu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: menu.y,
            left: menu.x,
            minWidth: 160,
            background: "#1A1A1A",
            border: "1px solid #2A2A2A",
            borderRadius: 6,
            padding: 4,
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.5)",
            zIndex: 1000,
          }}
        >
          <MenuItem onClick={startRename}>Rename</MenuItem>
          <MenuItem onClick={() => { setShowColor(true); setMenu(null); }}>
            Change Color
          </MenuItem>
          {onClose && (
            <>
              <div style={{ height: 1, background: "#2A2A2A", margin: "4px 0" }} />
              <MenuItem
                danger
                onClick={() => { onClose(); setMenu(null); }}
              >
                Delete Workspace
              </MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "6px 10px",
        fontSize: 12,
        borderRadius: 4,
        cursor: "pointer",
        color: hover ? (danger ? "#EF4444" : "#F5F5F5") : danger ? "#D4D4D4" : "#D4D4D4",
        background: hover ? (danger ? "rgba(239, 68, 68, 0.1)" : "#2A2A2A") : "transparent",
        transition: "all 100ms ease",
      }}
    >
      {children}
    </div>
  );
}
