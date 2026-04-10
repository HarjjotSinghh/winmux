import { useEffect, useState } from "react";
import type { Notification } from "../../types";
import { listNotifications, clearNotifications, dismissNotification } from "../../lib/ipc";

interface Props { visible: boolean; onClose: () => void; }

export default function NotificationPanel({ visible, onClose }: Props) {
  const [notifs, setNotifs] = useState<Notification[]>([]);

  useEffect(() => {
    if (visible) listNotifications().then(setNotifs).catch(console.error);
  }, [visible]);

  if (!visible) return null;

  const unread = notifs.filter((n) => !n.read);

  return (
    <div style={{
      position: "absolute", top: 0, right: 0,
      width: "320px", height: "100%",
      background: "#0E0E0E",
      borderLeft: "1px solid #1F1F1F",
      display: "flex", flexDirection: "column",
      zIndex: 100, boxShadow: "-8px 0 24px rgba(0,0,0,0.3)",
    }}>
      <div style={{
        padding: "14px 16px",
        borderBottom: "1px solid #1F1F1F",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "13px", fontWeight: 500, color: "#E5E5E5" }}>
            Notifications
          </span>
          {unread.length > 0 && (
            <span style={{
              fontSize: "10px", background: "#3B82F6", color: "#fff",
              borderRadius: "8px", padding: "1px 6px", fontWeight: 600,
            }}>{unread.length}</span>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {notifs.length > 0 && (
            <button
              onClick={() => clearNotifications().then(() => setNotifs([]))}
              style={{
                background: "none", border: "1px solid #1F1F1F",
                color: "#525252", cursor: "pointer", fontSize: "10px",
                padding: "2px 8px", borderRadius: "4px",
              }}
            >Clear</button>
          )}
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "#525252",
            cursor: "pointer", fontSize: "14px",
          }}>x</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {notifs.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "#404040", fontSize: "12px" }}>
            No notifications yet
          </div>
        ) : (
          notifs.slice().reverse().map((n) => (
            <div
              key={n.id}
              onClick={() => {
                dismissNotification(n.id);
                setNotifs((p) => p.map((x) => x.id === n.id ? { ...x, read: true } : x));
              }}
              style={{
                padding: "10px 12px", marginBottom: "2px", borderRadius: "6px",
                background: n.read ? "transparent" : "#141414",
                border: n.read ? "none" : "1px solid #1F1F1F",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", fontWeight: 500, color: n.read ? "#525252" : "#E5E5E5" }}>
                  {n.title}
                </span>
                <span style={{ fontSize: "10px", color: "#404040" }}>{fmtTime(n.timestamp)}</span>
              </div>
              {n.body && <div style={{ fontSize: "11px", color: "#737373", marginTop: "3px" }}>{n.body}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function fmtTime(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(ts).toLocaleDateString();
}
