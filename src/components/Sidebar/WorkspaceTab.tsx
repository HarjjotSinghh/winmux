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
  workspace,
  index,
  isActive,
  onClick,
  onClose,
  onRename,
  onColorChange,
}: WorkspaceTabProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(workspace.name);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== workspace.name) {
      onRename(trimmed);
    } else {
      setEditValue(workspace.name);
    }
    setEditing(false);
  };

  return (
    <div
      onClick={onClick}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
        setEditValue(workspace.name);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 10px",
        marginBottom: "2px",
        borderRadius: "6px",
        cursor: "pointer",
        backgroundColor: isActive ? "#161b22" : "transparent",
        border: isActive ? "1px solid #30363d" : "1px solid transparent",
        transition: "all 0.15s ease",
        position: "relative",
        gap: "10px",
      }}
      onMouseEnter={(e) => {
        if (!isActive)
          (e.currentTarget as HTMLDivElement).style.backgroundColor = "#0d1117";
      }}
      onMouseLeave={(e) => {
        if (!isActive)
          (e.currentTarget as HTMLDivElement).style.backgroundColor =
            "transparent";
      }}
    >
      {/* Color indicator — click to change color */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          setShowColorPicker((v) => !v);
        }}
        style={{
          width: "3px",
          height: "24px",
          borderRadius: "2px",
          backgroundColor: isActive ? workspace.color : "#30363d",
          flexShrink: 0,
          transition: "background-color 0.15s",
          cursor: "pointer",
          position: "relative",
        }}
        title="Change color"
      >
        {showColorPicker && (
          <ColorPicker
            currentColor={workspace.color}
            onSelect={onColorChange}
            onClose={() => setShowColorPicker(false)}
          />
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setEditValue(workspace.name);
                setEditing(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              padding: "1px 4px",
              backgroundColor: "#0d1117",
              border: "1px solid #58a6ff",
              borderRadius: "3px",
              color: "#e6edf3",
              fontSize: "13px",
              fontWeight: 600,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        ) : (
          <div
            style={{
              fontSize: "13px",
              fontWeight: isActive ? 600 : 400,
              color: isActive ? "#e6edf3" : "#8b949e",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {workspace.name}
          </div>
        )}
        {(workspace.cwd || workspace.gitBranch) && (
          <div
            style={{
              fontSize: "11px",
              color: "#484f58",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              marginTop: "2px",
            }}
          >
            {workspace.gitBranch && (
              <span style={{ color: "#3fb950", marginRight: "6px" }}>
                {workspace.gitBranch}
              </span>
            )}
            {workspace.cwd && <span>{workspace.cwd.split("\\").pop()}</span>}
          </div>
        )}
      </div>

      {/* Keyboard shortcut hint */}
      {index < 9 && !editing && (
        <span style={{ fontSize: "10px", color: "#484f58", flexShrink: 0 }}>
          ^{index + 1}
        </span>
      )}

      {/* Notification badge */}
      {workspace.unreadCount > 0 && (
        <div
          style={{
            width: "18px",
            height: "18px",
            borderRadius: "9px",
            backgroundColor: "#58a6ff",
            color: "#ffffff",
            fontSize: "10px",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {workspace.unreadCount > 9 ? "9+" : workspace.unreadCount}
        </div>
      )}

      {/* Close button */}
      {onClose && !editing && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{
            background: "none",
            border: "none",
            color: "#484f58",
            cursor: "pointer",
            fontSize: "14px",
            padding: "0 2px",
            lineHeight: 1,
            opacity: 0.6,
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.opacity = "1";
            (e.currentTarget as HTMLButtonElement).style.color = "#ff7b72";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.opacity = "0.6";
            (e.currentTarget as HTMLButtonElement).style.color = "#484f58";
          }}
        >
          x
        </button>
      )}
    </div>
  );
}
