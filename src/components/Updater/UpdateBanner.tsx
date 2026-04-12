import { useEffect, useState, useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type Phase =
  | { kind: "idle" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; update: Update; downloaded: number; total: number }
  | { kind: "ready"; update: Update }
  | { kind: "error"; message: string };

const CHECK_INTERVAL = 1000 * 60 * 60; // 1 hour

export default function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dismissed, setDismissed] = useState(false);

  const checkForUpdate = useCallback(async () => {
    try {
      const update = await check();
      if (update) {
        setPhase({ kind: "available", update });
        setDismissed(false);
      }
    } catch (e) {
      console.warn("Update check failed:", e);
    }
  }, []);

  useEffect(() => {
    // Check once on startup (delay 5s so the app UI settles)
    const initial = setTimeout(checkForUpdate, 5000);
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  const startDownload = useCallback(async () => {
    if (phase.kind !== "available") return;
    const update = phase.update;
    setPhase({ kind: "downloading", update, downloaded: 0, total: 0 });
    try {
      let total = 0;
      let downloaded = 0;
      await update.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          setPhase({ kind: "downloading", update, downloaded: 0, total });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setPhase({ kind: "downloading", update, downloaded, total });
        } else if (event.event === "Finished") {
          setPhase({ kind: "ready", update });
        }
      });
    } catch (e) {
      setPhase({ kind: "error", message: String(e) });
    }
  }, [phase]);

  const installAndRestart = useCallback(async () => {
    if (phase.kind !== "ready") return;
    try {
      await phase.update.install();
      await relaunch();
    } catch (e) {
      setPhase({ kind: "error", message: String(e) });
    }
  }, [phase]);

  if (phase.kind === "idle") return null;
  if (dismissed) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        minWidth: 320,
        maxWidth: 380,
        background: "#141414",
        border: "1px solid #2A2A2A",
        borderRadius: 8,
        padding: "12px 14px",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
        zIndex: 2000,
        fontSize: 13,
        color: "#F5F5F5",
      }}
    >
      <Content phase={phase} onDownload={startDownload} onRestart={installAndRestart} onDismiss={() => setDismissed(true)} />
    </div>
  );
}

function Content({
  phase,
  onDownload,
  onRestart,
  onDismiss,
}: {
  phase: Phase;
  onDownload: () => void;
  onRestart: () => void;
  onDismiss: () => void;
}) {
  if (phase.kind === "available") {
    return (
      <>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
          <Dot color="#3B82F6" />
          <div style={{ fontWeight: 600 }}>Update available</div>
          <div style={{ fontSize: 11, color: "#8A8A8A", marginLeft: "auto" }}>v{phase.update.version}</div>
        </div>
        {phase.update.body && (
          <div
            style={{
              fontSize: 11,
              color: "#B4B4B4",
              maxHeight: 60,
              overflow: "hidden",
              marginBottom: 10,
              whiteSpace: "pre-wrap",
            }}
          >
            {phase.update.body.slice(0, 180)}
          </div>
        )}
        <Actions>
          <Button primary onClick={onDownload}>Download</Button>
          <Button onClick={onDismiss}>Later</Button>
        </Actions>
      </>
    );
  }

  if (phase.kind === "downloading") {
    const pct = phase.total > 0 ? Math.round((phase.downloaded / phase.total) * 100) : 0;
    return (
      <>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
          <Dot color="#3B82F6" pulse />
          <div style={{ fontWeight: 600 }}>Downloading update</div>
          <div style={{ fontSize: 11, color: "#8A8A8A", marginLeft: "auto" }}>{pct}%</div>
        </div>
        <div style={{ height: 3, background: "#2A2A2A", borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: `${pct}%`,
            background: "#3B82F6",
            transition: "width 200ms linear",
          }} />
        </div>
      </>
    );
  }

  if (phase.kind === "ready") {
    return (
      <>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
          <Dot color="#22C55E" />
          <div style={{ fontWeight: 600 }}>Update ready</div>
          <div style={{ fontSize: 11, color: "#8A8A8A", marginLeft: "auto" }}>v{phase.update.version}</div>
        </div>
        <div style={{ fontSize: 11, color: "#B4B4B4", marginBottom: 10 }}>
          Restart WinMux to finish installing.
        </div>
        <Actions>
          <Button primary onClick={onRestart}>Restart to update</Button>
          <Button onClick={onDismiss}>Later</Button>
        </Actions>
      </>
    );
  }

  if (phase.kind === "error") {
    return (
      <>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
          <Dot color="#EF4444" />
          <div style={{ fontWeight: 600 }}>Update failed</div>
        </div>
        <div style={{ fontSize: 11, color: "#B4B4B4", marginBottom: 10 }}>{phase.message}</div>
        <Actions>
          <Button onClick={onDismiss}>Dismiss</Button>
        </Actions>
      </>
    );
  }

  return null;
}

function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        background: color,
        flexShrink: 0,
        animation: pulse ? "winmux-pulse 1.4s ease-in-out infinite" : undefined,
        boxShadow: `0 0 6px ${color}40`,
      }}
    />
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 6 }}>{children}</div>;
}

function Button({
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
