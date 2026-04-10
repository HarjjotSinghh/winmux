import { useWorkspaceStore } from "../../stores/workspaceStore";
import WorkspaceTab from "./WorkspaceTab";

interface SidebarProps {
  onNewWorkspace: () => void;
}

export default function Sidebar({ onNewWorkspace }: SidebarProps) {
  const {
    workspaces,
    activeWorkspaceId,
    setActiveWorkspace,
    removeWorkspace,
    renameWorkspace,
    setWorkspaceColor,
    sidebarWidth,
    sidebarVisible,
  } = useWorkspaceStore();

  if (!sidebarVisible) return null;

  return (
    <div style={{
      width: sidebarWidth,
      minWidth: sidebarWidth,
      height: "100%",
      background: "#0E0E0E",
      borderRight: "1px solid #1F1F1F",
      display: "flex",
      flexDirection: "column",
    }}>
      <div style={{
        padding: "14px 14px 10px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <span style={{
          fontSize: "11px",
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "#525252",
        }}>
          Workspaces
        </span>
        <button
          onClick={onNewWorkspace}
          aria-label="New Workspace"
          style={{
            width: "20px",
            height: "20px",
            borderRadius: "4px",
            border: "1px solid #1F1F1F",
            background: "none",
            color: "#525252",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "14px",
            lineHeight: 1,
            transition: "all 150ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#3B82F6";
            e.currentTarget.style.color = "#3B82F6";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#1F1F1F";
            e.currentTarget.style.color = "#525252";
          }}
        >
          +
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 6px 6px" }}>
        {workspaces.map((ws, i) => (
          <WorkspaceTab
            key={ws.id}
            workspace={ws}
            index={i}
            isActive={ws.id === activeWorkspaceId}
            onClick={() => setActiveWorkspace(ws.id)}
            onClose={workspaces.length > 1 ? () => removeWorkspace(ws.id) : undefined}
            onRename={(name) => renameWorkspace(ws.id, name)}
            onColorChange={(color) => setWorkspaceColor(ws.id, color)}
          />
        ))}
      </div>
    </div>
  );
}
