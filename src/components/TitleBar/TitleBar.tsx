import { useState, useEffect, useCallback } from "react";
import { windowMinimize, windowMaximize, windowClose, windowIsMaximized, quitApp } from "../../lib/ipc";
import { getCurrentWindow } from "@tauri-apps/api/window";
import CloseConfirmModal from "./CloseConfirmModal";

type CloseAction = "ask" | "hide" | "quit";
const CLOSE_ACTION_KEY = "winmux.closeAction";

function readCloseAction(): CloseAction {
  const v = localStorage.getItem(CLOSE_ACTION_KEY);
  return v === "hide" || v === "quit" ? v : "ask";
}

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);

  useEffect(() => {
    windowIsMaximized().then(setMaximized).catch(() => {});
    const unlisten = getCurrentWindow().onResized(() => {
      windowIsMaximized().then(setMaximized).catch(() => {});
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleCloseClick = useCallback(() => {
    const action = readCloseAction();
    if (action === "hide") {
      windowClose();
    } else if (action === "quit") {
      quitApp();
    } else {
      setShowCloseModal(true);
    }
  }, []);

  const handleKeepRunning = useCallback((remember: boolean) => {
    if (remember) localStorage.setItem(CLOSE_ACTION_KEY, "hide");
    setShowCloseModal(false);
    windowClose();
  }, []);

  const handleQuit = useCallback((remember: boolean) => {
    if (remember) localStorage.setItem(CLOSE_ACTION_KEY, "quit");
    setShowCloseModal(false);
    quitApp();
  }, []);

  return (
    <div
      onMouseDown={() => getCurrentWindow().startDragging()}
      style={{
        height: "36px",
        minHeight: "36px",
        background: "#0A0A0A",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid #1F1F1F",
        userSelect: "none",
      }}
    >
      <div style={{
        paddingLeft: "14px",
        fontSize: "12px",
        fontWeight: 500,
        color: "#737373",
        letterSpacing: "0.02em",
      }}>
        WinMux
      </div>

      <div
        style={{ display: "flex", height: "100%" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <WinBtn onClick={windowMinimize} label="Minimize">
          <svg width="10" height="1" viewBox="0 0 10 1">
            <rect width="10" height="1" fill="currentColor" />
          </svg>
        </WinBtn>
        <WinBtn onClick={() => windowMaximize().then(() => setMaximized(!maximized))} label={maximized ? "Restore" : "Maximize"}>
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M2 0h8v8H8v2H0V2h2V0zm1 1v1h6v6h1V1H3zM1 3v6h6V3H1z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </WinBtn>
        <WinBtn onClick={handleCloseClick} label="Close" danger>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </WinBtn>
      </div>

      {showCloseModal && (
        <CloseConfirmModal
          onKeepRunning={handleKeepRunning}
          onQuit={handleQuit}
          onCancel={() => setShowCloseModal(false)}
        />
      )}
    </div>
  );
}

function WinBtn({ children, onClick, label, danger }: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        width: "46px",
        height: "100%",
        border: "none",
        background: "none",
        color: "#525252",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 150ms ease",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.background = danger ? "#EF4444" : "#1A1A1A";
        el.style.color = danger ? "#fff" : "#E5E5E5";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.background = "none";
        el.style.color = "#525252";
      }}
    >
      {children}
    </button>
  );
}
