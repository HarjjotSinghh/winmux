import { useState } from "react";

interface CloseConfirmModalProps {
  onKeepRunning: (remember: boolean) => void;
  onQuit: (remember: boolean) => void;
  onCancel: () => void;
}

export default function CloseConfirmModal({
  onKeepRunning,
  onQuit,
  onCancel,
}: CloseConfirmModalProps) {
  const [remember, setRemember] = useState(true);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.6)",
        zIndex: 5000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 400,
          background: "#141414",
          border: "1px solid #2A2A2A",
          borderRadius: 10,
          padding: "22px 22px 18px",
          boxShadow: "0 12px 40px rgba(0, 0, 0, 0.7)",
          color: "#F5F5F5",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
          Close WinMux?
        </div>
        <div style={{ fontSize: 12.5, color: "#B4B4B4", lineHeight: 1.55, marginBottom: 16 }}>
          Your terminals are still running. Keeping WinMux in the tray preserves
          your shells and any running processes (Claude, servers, dev loops). Quitting
          ends them.
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "#B4B4B4",
            cursor: "pointer",
            marginBottom: 16,
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            style={{ accentColor: "#3B82F6" }}
          />
          Remember my choice
        </label>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <ModalBtn onClick={() => onQuit(remember)}>Quit completely</ModalBtn>
          <ModalBtn primary onClick={() => onKeepRunning(remember)}>
            Keep running
          </ModalBtn>
        </div>
      </div>
    </div>
  );
}

function ModalBtn({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontSize: 12.5,
        fontWeight: 500,
        padding: "7px 14px",
        borderRadius: 5,
        border: primary ? "none" : "1px solid #2A2A2A",
        background: primary
          ? hover ? "#2563EB" : "#3B82F6"
          : hover ? "#2A2A2A" : "transparent",
        color: primary ? "#fff" : "#D4D4D4",
        cursor: "pointer",
        transition: "all 120ms ease",
      }}
    >
      {children}
    </button>
  );
}
