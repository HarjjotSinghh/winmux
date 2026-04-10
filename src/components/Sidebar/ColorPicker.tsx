import { WORKSPACE_COLORS } from "../../lib/theme";

const EXTENDED_COLORS = [
  ...WORKSPACE_COLORS,
  "#e06c75",
  "#61afef",
  "#c678dd",
  "#98c379",
  "#e5c07b",
  "#56b6c2",
  "#be5046",
  "#d19a66",
  "#ffffff",
  "#8b949e",
];

interface ColorPickerProps {
  currentColor: string;
  onSelect: (color: string) => void;
  onClose: () => void;
}

export default function ColorPicker({
  currentColor,
  onSelect,
  onClose,
}: ColorPickerProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: "100%",
        top: 0,
        marginLeft: "4px",
        backgroundColor: "#161b22",
        border: "1px solid #30363d",
        borderRadius: "8px",
        padding: "8px",
        zIndex: 50,
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.3)",
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: "4px",
        width: "160px",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {EXTENDED_COLORS.map((color) => (
        <button
          key={color}
          onClick={() => {
            onSelect(color);
            onClose();
          }}
          style={{
            width: "24px",
            height: "24px",
            borderRadius: "4px",
            backgroundColor: color,
            border:
              color === currentColor
                ? "2px solid #ffffff"
                : "2px solid transparent",
            cursor: "pointer",
            outline: "none",
            transition: "transform 0.1s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.2)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
          }}
          title={color}
        />
      ))}
    </div>
  );
}
