import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";

type State = "hidden" | "reconnecting" | "reconnected" | "dead";

/**
 * Surfaces daemon lifecycle events from Rust as a small bottom-left toast.
 *
 * - `daemon-reconnecting` → amber toast with spinner.
 * - `daemon-reconnected`  → green confirmation, auto-dismiss after 3s.
 * - `daemon-dead`         → red banner with Restart button (supervisor gave up).
 *
 * Existing shells die with the daemon regardless; per-tab `terminal-exit`
 * events are emitted from the Rust side so each tab surfaces "[process exited]".
 */
export default function DaemonBanner() {
  const [state, setState] = useState<State>("hidden");
  const autoHideTimer = useRef<number | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (autoHideTimer.current != null) {
        window.clearTimeout(autoHideTimer.current);
        autoHideTimer.current = null;
      }
    };

    const unlisteners: Array<Promise<() => void>> = [
      listen("daemon-reconnecting", () => {
        clearTimer();
        setState("reconnecting");
      }),
      listen("daemon-reconnected", () => {
        clearTimer();
        setState("reconnected");
        autoHideTimer.current = window.setTimeout(() => {
          setState("hidden");
          autoHideTimer.current = null;
        }, 3000);
      }),
      listen("daemon-dead", () => {
        clearTimer();
        setState("dead");
      }),
    ];

    return () => {
      clearTimer();
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  if (state === "hidden") return null;

  if (state === "reconnecting") {
    return (
      <Toast
        accent="#F59E0B"
        bg="#1F160A"
        border="#7C4A03"
        textDim="#D4B48A"
        title="Terminal daemon restarting"
        body="Reconnecting to background process. Running shells ended; create a new tab to continue."
        icon={<Spinner color="#F59E0B" />}
      />
    );
  }

  if (state === "reconnected") {
    return (
      <Toast
        accent="#22C55E"
        bg="#0F1A12"
        border="#14532D"
        textDim="#B4D4B8"
        title="Terminal daemon restored"
        body="New tabs will work normally. Any previously-running shells ended."
        icon={<Dot color="#22C55E" />}
      />
    );
  }

  // dead
  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        maxWidth: 400,
        background: "#1A0F0F",
        border: "1px solid #7F1D1D",
        borderRadius: 8,
        padding: "12px 14px",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
        zIndex: 2100,
        fontSize: 13,
        color: "#F5F5F5",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <Dot color="#EF4444" />
        <div style={{ fontWeight: 600 }}>Terminal daemon keeps crashing</div>
      </div>
      <div style={{ fontSize: 12, color: "#D4B4B4", lineHeight: 1.5, marginBottom: 10 }}>
        WinMux tried to auto-restart the background process but it crashed
        repeatedly. Check %LOCALAPPDATA%\WinMux\daemon.log for details, then
        relaunch.
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <BannerBtn primary onClick={() => relaunch().catch(console.error)}>
          Restart WinMux
        </BannerBtn>
        <BannerBtn onClick={() => setState("hidden")}>Dismiss</BannerBtn>
      </div>
    </div>
  );
}

function Toast({
  accent,
  bg,
  border,
  textDim,
  title,
  body,
  icon,
}: {
  accent: string;
  bg: string;
  border: string;
  textDim: string;
  title: string;
  body: string;
  icon: React.ReactNode;
}) {
  // accent is already baked into icon/border; the arg remains for future use.
  void accent;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        maxWidth: 360,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 8,
        padding: "10px 12px",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
        zIndex: 2100,
        fontSize: 13,
        color: "#F5F5F5",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        {icon}
        <div style={{ fontWeight: 600 }}>{title}</div>
      </div>
      <div style={{ fontSize: 12, color: textDim, lineHeight: 1.45 }}>{body}</div>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        background: color,
        flexShrink: 0,
        boxShadow: `0 0 8px ${color}80`,
      }}
    />
  );
}

function Spinner({ color }: { color: string }) {
  return (
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        border: `2px solid ${color}40`,
        borderTopColor: color,
        flexShrink: 0,
        animation: "winmux-daemon-spin 0.8s linear infinite",
      }}
    >
      <style>{`@keyframes winmux-daemon-spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}

function BannerBtn({
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
        fontSize: 12,
        fontWeight: 500,
        padding: "6px 12px",
        borderRadius: 4,
        border: primary ? "none" : "1px solid #3A1F1F",
        background: primary
          ? hover ? "#DC2626" : "#EF4444"
          : hover ? "#3A1F1F" : "transparent",
        color: primary ? "#fff" : "#D4B4B4",
        cursor: "pointer",
        transition: "all 120ms ease",
      }}
    >
      {children}
    </button>
  );
}
