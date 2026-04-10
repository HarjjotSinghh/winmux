import { useEffect, useState } from "react";
import type { Notification } from "../../types";
import { listNotifications, clearNotifications, dismissNotification } from "../../lib/ipc";

interface NotificationPanelProps {
  visible: boolean;
  onClose: () => void;
}

export default function NotificationPanel({ visible, onClose }: NotificationPanelProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (visible) {
      listNotifications().then(setNotifications).catch(console.error);
    }
  }, [visible]);

  if (!visible) return null;

  const unread = notifications.filter((n) => !n.read);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: "360px",
        height: "100%",
        backgroundColor: "#0d1117",
        borderLeft: "1px solid #30363d",
        display: "flex",
        flexDirection: "column",
        zIndex: 100,
        boxShadow: "-4px 0 16px rgba(0, 0, 0, 0.3)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #21262d",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "#e6edf3" }}>
            Notifications
          </span>
          {unread.length > 0 && (
            <span
              style={{
                fontSize: "11px",
                backgroundColor: "#58a6ff",
                color: "#fff",
                borderRadius: "10px",
                padding: "1px 8px",
                fontWeight: 600,
              }}
            >
              {unread.length}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {notifications.length > 0 && (
            <button
              onClick={() => {
                clearNotifications().then(() => setNotifications([]));
              }}
              style={{
                background: "none",
                border: "1px solid #30363d",
                color: "#8b949e",
                cursor: "pointer",
                fontSize: "11px",
                padding: "3px 10px",
                borderRadius: "4px",
              }}
            >
              Clear all
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#8b949e",
              cursor: "pointer",
              fontSize: "16px",
              padding: "0 4px",
            }}
          >
            x
          </button>
        </div>
      </div>

      {/* Notification list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {notifications.length === 0 ? (
          <div
            style={{
              padding: "40px 20px",
              textAlign: "center",
              color: "#484f58",
              fontSize: "13px",
            }}
          >
            No notifications yet.
            <br />
            <span style={{ fontSize: "11px", marginTop: "4px", display: "block" }}>
              Notifications from AI agents and OSC sequences will appear here.
            </span>
          </div>
        ) : (
          notifications
            .slice()
            .reverse()
            .map((notif) => (
              <div
                key={notif.id}
                style={{
                  padding: "10px 12px",
                  marginBottom: "4px",
                  borderRadius: "6px",
                  backgroundColor: notif.read ? "transparent" : "#161b22",
                  border: `1px solid ${notif.read ? "transparent" : "#30363d"}`,
                  cursor: "pointer",
                }}
                onClick={() => {
                  dismissNotification(notif.id);
                  setNotifications((prev) =>
                    prev.map((n) =>
                      n.id === notif.id ? { ...n, read: true } : n
                    )
                  );
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: notif.read ? "#8b949e" : "#e6edf3",
                    }}
                  >
                    {notif.title}
                  </span>
                  <span style={{ fontSize: "10px", color: "#484f58", flexShrink: 0 }}>
                    {formatTime(notif.timestamp)}
                  </span>
                </div>
                {notif.body && (
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#8b949e",
                      marginTop: "4px",
                      lineHeight: 1.4,
                    }}
                  >
                    {notif.body}
                  </div>
                )}
                <div style={{ fontSize: "10px", color: "#484f58", marginTop: "4px" }}>
                  {notif.source}
                </div>
              </div>
            ))
        )}
      </div>
    </div>
  );
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return date.toLocaleDateString();
}
