import { useState } from "react";

export interface LayoutPreset {
  id: string;
  name: string;
  icon: string;
  description: string;
  build: () => import("../../types").PaneNode;
}

function paneId(): string {
  return `pane-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function termNode(): import("../../types").PaneNode {
  return { type: "terminal", id: paneId(), terminalId: "" };
}

function splitNode(
  dir: "horizontal" | "vertical",
  ratio: number,
  first: import("../../types").PaneNode,
  second: import("../../types").PaneNode
): import("../../types").PaneNode {
  return { type: "split", id: paneId(), direction: dir, ratio, first, second };
}

export const PRESETS: LayoutPreset[] = [
  {
    id: "single",
    name: "Single",
    icon: "[ ]",
    description: "One terminal",
    build: () => termNode(),
  },
  {
    id: "1x2",
    name: "Side by Side",
    icon: "[ | ]",
    description: "Two terminals side by side",
    build: () => splitNode("horizontal", 0.5, termNode(), termNode()),
  },
  {
    id: "2x1",
    name: "Stacked",
    icon: "[-]",
    description: "Two terminals stacked",
    build: () => splitNode("vertical", 0.5, termNode(), termNode()),
  },
  {
    id: "2x2",
    name: "Grid",
    icon: "[+]",
    description: "Four terminals in a grid",
    build: () =>
      splitNode(
        "vertical",
        0.5,
        splitNode("horizontal", 0.5, termNode(), termNode()),
        splitNode("horizontal", 0.5, termNode(), termNode())
      ),
  },
  {
    id: "1x3",
    name: "Three Columns",
    icon: "[|||]",
    description: "Three terminals side by side",
    build: () =>
      splitNode(
        "horizontal",
        0.33,
        termNode(),
        splitNode("horizontal", 0.5, termNode(), termNode())
      ),
  },
  {
    id: "main-side",
    name: "Main + Side",
    icon: "[| ]",
    description: "Large left pane with stacked right panes",
    build: () =>
      splitNode(
        "horizontal",
        0.6,
        termNode(),
        splitNode("vertical", 0.5, termNode(), termNode())
      ),
  },
];

interface WorkspacePresetsProps {
  visible: boolean;
  onSelect: (preset: LayoutPreset, name: string) => void;
  onClose: () => void;
}

export default function WorkspacePresets({
  visible,
  onSelect,
  onClose,
}: WorkspacePresetsProps) {
  const [name, setName] = useState("");

  if (!visible) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        justifyContent: "center",
        paddingTop: "12%",
        zIndex: 200,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "480px",
          backgroundColor: "#161b22",
          border: "1px solid #30363d",
          borderRadius: "8px",
          overflow: "hidden",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
        }}
      >
        <div
          style={{
            padding: "16px 20px 12px",
            borderBottom: "1px solid #21262d",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: "14px", fontWeight: 600, color: "#e6edf3" }}>
            New Workspace
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#8b949e",
              cursor: "pointer",
              fontSize: "16px",
            }}
          >
            x
          </button>
        </div>

        {/* Name input */}
        <div style={{ padding: "12px 20px" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workspace name (optional)"
            autoFocus
            style={{
              width: "100%",
              padding: "8px 12px",
              backgroundColor: "#0d1117",
              border: "1px solid #30363d",
              borderRadius: "6px",
              color: "#e6edf3",
              fontSize: "13px",
              outline: "none",
              fontFamily: "inherit",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onSelect(PRESETS[0], name);
              }
            }}
          />
        </div>

        {/* Preset grid */}
        <div
          style={{
            padding: "4px 16px 16px",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "8px",
          }}
        >
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => onSelect(preset, name)}
              style={{
                padding: "12px 8px",
                backgroundColor: "#0d1117",
                border: "1px solid #21262d",
                borderRadius: "8px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "6px",
                transition: "all 0.15s",
                color: "#c9d1d9",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#58a6ff";
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#161b22";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#21262d";
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#0d1117";
              }}
            >
              <PresetIcon preset={preset} />
              <span style={{ fontSize: "11px", fontWeight: 500 }}>
                {preset.name}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PresetIcon({ preset }: { preset: LayoutPreset }) {
  const w = 48;
  const h = 32;
  const gap = 2;
  const stroke = "#58a6ff";
  const fill = "#0d1117";

  const layouts: Record<string, React.ReactNode> = {
    single: <rect x={1} y={1} width={w - 2} height={h - 2} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />,
    "1x2": (
      <>
        <rect x={1} y={1} width={w / 2 - gap} height={h - 2} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
        <rect x={w / 2 + gap - 1} y={1} width={w / 2 - gap} height={h - 2} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
      </>
    ),
    "2x1": (
      <>
        <rect x={1} y={1} width={w - 2} height={h / 2 - gap} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
        <rect x={1} y={h / 2 + gap - 1} width={w - 2} height={h / 2 - gap} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
      </>
    ),
    "2x2": (
      <>
        <rect x={1} y={1} width={w / 2 - gap} height={h / 2 - gap} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
        <rect x={w / 2 + gap - 1} y={1} width={w / 2 - gap} height={h / 2 - gap} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
        <rect x={1} y={h / 2 + gap - 1} width={w / 2 - gap} height={h / 2 - gap} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
        <rect x={w / 2 + gap - 1} y={h / 2 + gap - 1} width={w / 2 - gap} height={h / 2 - gap} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
      </>
    ),
    "1x3": (
      <>
        <rect x={1} y={1} width={w / 3 - gap} height={h - 2} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
        <rect x={w / 3 + gap - 1} y={1} width={w / 3 - gap} height={h - 2} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
        <rect x={(2 * w) / 3 + gap - 1} y={1} width={w / 3 - gap} height={h - 2} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
      </>
    ),
    "main-side": (
      <>
        <rect x={1} y={1} width={w * 0.58} height={h - 2} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
        <rect x={w * 0.58 + gap + 1} y={1} width={w * 0.38} height={h / 2 - gap} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
        <rect x={w * 0.58 + gap + 1} y={h / 2 + gap - 1} width={w * 0.38} height={h / 2 - gap} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
      </>
    ),
  };

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {layouts[preset.id]}
    </svg>
  );
}
