import { useState, useEffect, useRef, useCallback } from "react";

interface Command { id: string; label: string; shortcut?: string; action: () => void; }
interface Props { visible: boolean; onClose: () => void; commands: Command[]; }

export default function CommandPalette({ visible, onClose, commands }: Props) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (visible) { setQuery(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [visible]);

  useEffect(() => { setSel(0); }, [query]);

  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[sel]) { filtered[sel].action(); onClose(); } }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }, [filtered, sel, onClose]);

  if (!visible) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute", inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex", justifyContent: "center", paddingTop: "14%",
        zIndex: 200, backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "440px", maxHeight: "360px",
          background: "#141414", border: "1px solid #1F1F1F",
          borderRadius: "10px", overflow: "hidden",
          boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ padding: "12px", borderBottom: "1px solid #1F1F1F" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type a command..."
            style={{
              width: "100%", padding: "8px 10px",
              background: "#0A0A0A", border: "1px solid #1F1F1F",
              borderRadius: "6px", color: "#E5E5E5", fontSize: "13px",
              outline: "none", fontFamily: "inherit",
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "4px" }}>
          {filtered.map((c, i) => (
            <div
              key={c.id}
              onClick={() => { c.action(); onClose(); }}
              onMouseEnter={() => setSel(i)}
              style={{
                padding: "8px 12px", borderRadius: "4px", cursor: "pointer",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                background: i === sel ? "#1A1A1A" : "transparent",
                color: i === sel ? "#E5E5E5" : "#737373",
                fontSize: "12px", transition: "background 100ms",
              }}
            >
              <span>{c.label}</span>
              {c.shortcut && (
                <span style={{
                  fontSize: "10px", color: "#404040",
                  background: "#0A0A0A", padding: "2px 6px",
                  borderRadius: "3px", border: "1px solid #1F1F1F",
                  fontFamily: "monospace",
                }}>{c.shortcut}</span>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: "20px", textAlign: "center", color: "#404040", fontSize: "12px" }}>
              No matching commands
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
