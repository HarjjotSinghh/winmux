import { useState } from "react";

export interface LayoutPreset {
  id: string;
  name: string;
  description: string;
  build: () => import("../../types").PaneNode;
}

function pid(): string {
  return `pane-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function t(): import("../../types").PaneNode { return { type: "terminal", id: pid(), terminalId: "" }; }
function s(d: "horizontal"|"vertical", r: number, a: import("../../types").PaneNode, b: import("../../types").PaneNode): import("../../types").PaneNode {
  return { type: "split", id: pid(), direction: d, ratio: r, first: a, second: b };
}

export const PRESETS: LayoutPreset[] = [
  { id: "single", name: "Single", description: "One terminal", build: () => t() },
  { id: "1x2", name: "Side by Side", description: "Two columns", build: () => s("horizontal", 0.5, t(), t()) },
  { id: "2x1", name: "Stacked", description: "Two rows", build: () => s("vertical", 0.5, t(), t()) },
  { id: "2x2", name: "Grid", description: "2x2 grid", build: () => s("vertical", 0.5, s("horizontal", 0.5, t(), t()), s("horizontal", 0.5, t(), t())) },
  { id: "1x3", name: "Three Columns", description: "Three side by side", build: () => s("horizontal", 0.33, t(), s("horizontal", 0.5, t(), t())) },
  { id: "main-side", name: "Main + Side", description: "Large left, stacked right", build: () => s("horizontal", 0.6, t(), s("vertical", 0.5, t(), t())) },
];

interface Props {
  visible: boolean;
  onSelect: (preset: LayoutPreset, name: string) => void;
  onClose: () => void;
}

export default function WorkspacePresets({ visible, onSelect, onClose }: Props) {
  const [name, setName] = useState("");
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
          width: "420px",
          background: "#141414",
          border: "1px solid #1F1F1F",
          borderRadius: "10px",
          overflow: "hidden",
          boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          animation: "fadeIn 100ms ease",
        }}
      >
        <div style={{
          padding: "16px 20px 12px",
          borderBottom: "1px solid #1F1F1F",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: "13px", fontWeight: 500, color: "#E5E5E5" }}>
            New Workspace
          </span>
          <button onClick={onClose} aria-label="Close" style={{
            background: "none", border: "none", color: "#525252",
            cursor: "pointer", fontSize: "14px",
          }}>x</button>
        </div>

        <div style={{ padding: "12px 20px 8px" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") onSelect(PRESETS[0], name); }}
            style={{
              width: "100%", padding: "8px 10px",
              background: "#0A0A0A", border: "1px solid #1F1F1F",
              borderRadius: "6px", color: "#E5E5E5", fontSize: "12px",
              outline: "none", fontFamily: "inherit",
            }}
          />
        </div>

        <div style={{
          padding: "8px 16px 16px",
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px",
        }}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p, name)}
              style={{
                padding: "14px 8px 10px",
                background: "#0A0A0A",
                border: "1px solid #1F1F1F",
                borderRadius: "8px",
                cursor: "pointer",
                display: "flex", flexDirection: "column",
                alignItems: "center", gap: "8px",
                color: "#737373",
                transition: "all 150ms ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#3B82F6";
                e.currentTarget.style.color = "#E5E5E5";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#1F1F1F";
                e.currentTarget.style.color = "#737373";
              }}
            >
              <LayoutIcon id={p.id} />
              <span style={{ fontSize: "11px", fontWeight: 500 }}>{p.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function LayoutIcon({ id }: { id: string }) {
  const w = 44, h = 28, g = 2;
  const f = "#1A1A1A", st = "#333";
  const r = (x: number, y: number, ww: number, hh: number) =>
    <rect x={x} y={y} width={ww} height={hh} rx={2} fill={f} stroke={st} strokeWidth={0.5} />;

  const layouts: Record<string, React.ReactNode> = {
    single: r(1,1,w-2,h-2),
    "1x2": <>{r(1,1,w/2-g,h-2)}{r(w/2+g-1,1,w/2-g,h-2)}</>,
    "2x1": <>{r(1,1,w-2,h/2-g)}{r(1,h/2+g-1,w-2,h/2-g)}</>,
    "2x2": <>{r(1,1,w/2-g,h/2-g)}{r(w/2+g-1,1,w/2-g,h/2-g)}{r(1,h/2+g-1,w/2-g,h/2-g)}{r(w/2+g-1,h/2+g-1,w/2-g,h/2-g)}</>,
    "1x3": <>{r(1,1,w/3-g,h-2)}{r(w/3+g-1,1,w/3-g,h-2)}{r(2*w/3+g-1,1,w/3-g,h-2)}</>,
    "main-side": <>{r(1,1,w*0.58,h-2)}{r(w*0.58+g+1,1,w*0.38,h/2-g)}{r(w*0.58+g+1,h/2+g-1,w*0.38,h/2-g)}</>,
  };

  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>{layouts[id]}</svg>;
}
