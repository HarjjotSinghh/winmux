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
    <div
      style={{
        width: sidebarWidth,
        minWidth: sidebarWidth,
        height: "100%",
        backgroundColor: "#010409",
        borderRight: "1px solid #21262d",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Sidebar header */}
      <div
        style={{
          padding: "12px 16px 8px",
          fontSize: "11px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "#8b949e",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>Workspaces</span>
        <button
          onClick={onNewWorkspace}
          title="New Workspace (Ctrl+Shift+T)"
          style={{
            background: "none",
            border: "none",
            color: "#8b949e",
            cursor: "pointer",
            fontSize: "16px",
            padding: "0 4px",
            lineHeight: 1,
          }}
        >
          +
        </button>
      </div>

      {/* Workspace list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "4px 8px",
        }}
      >
        {workspaces.map((workspace, index) => (
          <WorkspaceTab
            key={workspace.id}
            workspace={workspace}
            index={index}
            isActive={workspace.id === activeWorkspaceId}
            onClick={() => setActiveWorkspace(workspace.id)}
            onClose={
              workspaces.length > 1
                ? () => removeWorkspace(workspace.id)
                : undefined
            }
            onRename={(name) => renameWorkspace(workspace.id, name)}
            onColorChange={(color) => setWorkspaceColor(workspace.id, color)}
          />
        ))}
      </div>

      {/* Sidebar footer */}
      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid #21262d",
          fontSize: "11px",
          color: "#484f58",
          textAlign: "center",
        }}
      >
        WinMux v0.1.0
      </div>
    </div>
  );
}
