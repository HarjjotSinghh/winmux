import type { Workspace } from "../../types";

interface WorkspaceTabProps {
  workspace: Workspace;
  index: number;
  isActive: boolean;
  onClick: () => void;
  onClose?: () => void;
}

export default function WorkspaceTab({
  workspace,
  index,
  isActive,
  onClick,
  onClose,
}: WorkspaceTabProps) {
  return (
    <div
      onClick={onClick}
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
        if (!isActive) {
          (e.currentTarget as HTMLDivElement).style.backgroundColor = "#0d1117";
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent";
        }
      }}
    >
      {/* Color indicator */}
      <div
        style={{
          width: "3px",
          height: "24px",
          borderRadius: "2px",
          backgroundColor: isActive ? workspace.color : "#30363d",
          flexShrink: 0,
          transition: "background-color 0.15s",
        }}
      />

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
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
            {workspace.cwd && (
              <span>{workspace.cwd.split("\\").pop()}</span>
            )}
          </div>
        )}
      </div>

      {/* Keyboard shortcut hint */}
      {index < 9 && (
        <span
          style={{
            fontSize: "10px",
            color: "#484f58",
            flexShrink: 0,
          }}
        >
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
      {onClose && (
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
