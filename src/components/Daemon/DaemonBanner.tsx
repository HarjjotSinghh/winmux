import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * Surfaces a banner when the winmux-daemon pipe closes mid-run.
 * PTYs owned by the daemon are gone; the UI can't recover them in-place, so
 * the cleanest path is to relaunch WinMux (which respawns the daemon or
 * falls back to in-process PTYs).
 */
export default function DaemonBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const p = listen("daemon-disconnected", () => {
      setVisible(true);
    });
    return () => { p.then((fn) => fn()); };
  }, []);

  if (!visible) return null;

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
        <div style={{ fontWeight: 600 }}>Terminal daemon disconnected</div>
      </div>
      <div style={{ fontSize: 12, color: "#D4B4B4", lineHeight: 1.5, marginBottom: 10 }}>
        The background process hosting your terminals has stopped. Any
        running shells (Claude, dev servers, etc.) ended with it. Relaunch
        WinMux to start fresh.
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <BannerBtn primary onClick={() => relaunch().catch(console.error)}>
          Restart WinMux
        </BannerBtn>
        <BannerBtn onClick={() => setVisible(false)}>Dismiss</BannerBtn>
      </div>
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
