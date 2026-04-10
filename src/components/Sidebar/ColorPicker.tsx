import { WORKSPACE_COLORS } from "../../lib/theme";

const EXTRA = ["#E5E5E5", "#737373", "#404040", "#F97316", "#84CC16",
  "#E11D48", "#8B5CF6", "#0EA5E9", "#D946EF", "#F59E0B"];
const ALL = [...WORKSPACE_COLORS, ...EXTRA];

interface ColorPickerProps {
  currentColor: string;
  onSelect: (color: string) => void;
  onClose: () => void;
}

export default function ColorPicker({ currentColor, onSelect, onClose }: ColorPickerProps) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: "calc(100% + 12px)",
        top: "-4px",
        background: "#141414",
        border: "1px solid #1F1F1F",
        borderRadius: "8px",
        padding: "8px",
        zIndex: 50,
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: "4px",
        width: "140px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      }}
    >
      {ALL.map((c) => (
        <button
          key={c}
          onClick={() => { onSelect(c); onClose(); }}
          aria-label={c}
          style={{
            width: "20px",
            height: "20px",
            borderRadius: "4px",
            background: c,
            border: c === currentColor ? "2px solid #E5E5E5" : "2px solid transparent",
            cursor: "pointer",
            transition: "transform 100ms",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.15)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
        />
      ))}
    </div>
  );
}
