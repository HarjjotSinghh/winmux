import { useState, useEffect } from "react";
import { windowMinimize, windowMaximize, windowClose, windowIsMaximized } from "../../lib/ipc";
import { getCurrentWindow } from "@tauri-apps/api/window";

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    windowIsMaximized().then(setMaximized).catch(() => {});

    const unlisten = getCurrentWindow().onResized(() => {
      windowIsMaximized().then(setMaximized).catch(() => {});
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const startDrag = async () => {
    await getCurrentWindow().startDragging();
  };

  return (
    <div
      style={{
        height: "32px",
        minHeight: "32px",
        backgroundColor: "#010409",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid #21262d",
        WebkitAppRegion: "drag",
        userSelect: "none",
      } as React.CSSProperties}
      onMouseDown={startDrag}
    >
      {/* App name */}
      <div
        style={{
          paddingLeft: "16px",
          fontSize: "12px",
          fontWeight: 600,
          color: "#8b949e",
          letterSpacing: "0.03em",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <span style={{ color: "#58a6ff", fontSize: "14px" }}>W</span>
        <span>WinMux</span>
      </div>

      {/* Window controls */}
      <div
        style={{
          display: "flex",
          height: "100%",
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <WindowButton onClick={windowMinimize} title="Minimize">
          <svg width="10" height="1" viewBox="0 0 10 1">
            <rect width="10" height="1" fill="currentColor" />
          </svg>
        </WindowButton>
        <WindowButton onClick={() => windowMaximize().then(() => setMaximized(!maximized))} title={maximized ? "Restore" : "Maximize"}>
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M2 0h8v8H8v2H0V2h2V0zm1 1v1h6v6h1V1H3zM1 3v6h6V3H1z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="0" y="0" width="10" height="10" rx="0" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </WindowButton>
        <WindowButton
          onClick={windowClose}
          title="Close"
          hoverBg="#e81123"
          hoverColor="#ffffff"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </WindowButton>
      </div>
    </div>
  );
}

function WindowButton({
  children,
  onClick,
  title,
  hoverBg = "#21262d",
  hoverColor = "#e6edf3",
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  hoverBg?: string;
  hoverColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: "46px",
        height: "100%",
        border: "none",
        background: "none",
        color: "#8b949e",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 0.1s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor = hoverBg;
        (e.currentTarget as HTMLButtonElement).style.color = hoverColor;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
        (e.currentTarget as HTMLButtonElement).style.color = "#8b949e";
      }}
    >
      {children}
    </button>
  );
}
