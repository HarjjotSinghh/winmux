import { useState, useEffect, useRef, useCallback } from "react";

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
  commands: Command[];
}

export default function CommandPalette({
  visible,
  onClose,
  commands,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (visible) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filtered[selectedIndex]) {
            filtered[selectedIndex].action();
            onClose();
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filtered, selectedIndex, onClose]
  );

  if (!visible) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        justifyContent: "center",
        paddingTop: "15%",
        zIndex: 200,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "500px",
          maxHeight: "400px",
          backgroundColor: "#161b22",
          border: "1px solid #30363d",
          borderRadius: "8px",
          overflow: "hidden",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Search input */}
        <div style={{ padding: "12px", borderBottom: "1px solid #21262d" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            style={{
              width: "100%",
              padding: "8px 12px",
              backgroundColor: "#0d1117",
              border: "1px solid #30363d",
              borderRadius: "6px",
              color: "#e6edf3",
              fontSize: "14px",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>

        {/* Command list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px" }}>
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              onClick={() => {
                cmd.action();
                onClose();
              }}
              style={{
                padding: "8px 12px",
                borderRadius: "4px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                backgroundColor: i === selectedIndex ? "#21262d" : "transparent",
                color: i === selectedIndex ? "#e6edf3" : "#8b949e",
                fontSize: "13px",
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span>{cmd.label}</span>
              {cmd.shortcut && (
                <span
                  style={{
                    fontSize: "11px",
                    color: "#484f58",
                    backgroundColor: "#0d1117",
                    padding: "2px 6px",
                    borderRadius: "3px",
                    border: "1px solid #21262d",
                  }}
                >
                  {cmd.shortcut}
                </span>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div
              style={{
                padding: "20px",
                textAlign: "center",
                color: "#484f58",
                fontSize: "13px",
              }}
            >
              No matching commands
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
