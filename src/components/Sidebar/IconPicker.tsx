// Small emoji grid popover for workspace icons. Mirrors ColorPicker's
// positioning so it can anchor to the same accent-dot area.
const EMOJIS = [
  "🚀", "🧠", "⚙️", "🐛", "📦", "🌐", "🎨", "📊",
  "🔥", "💡", "🧪", "📝", "🎯", "💻", "🖥️", "⌨️",
  "🌙", "☀️", "🎧", "🎮", "📚", "🔧", "🧹", "✨",
];

interface IconPickerProps {
  currentIcon: string | null;
  onSelect: (icon: string | null) => void;
  onClose: () => void;
}

export default function IconPicker({ currentIcon, onSelect, onClose }: IconPickerProps) {
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
        gridTemplateColumns: "repeat(6, 1fr)",
        gap: "2px",
        width: "172px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      }}
    >
      <button
        onClick={() => { onSelect(null); onClose(); }}
        title="No icon"
        style={{
          height: "24px",
          borderRadius: "4px",
          background: "transparent",
          border: currentIcon === null ? "2px solid #E5E5E5" : "2px solid transparent",
          color: "#525252",
          cursor: "pointer",
          fontSize: "12px",
        }}
      >
        ×
      </button>
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => { onSelect(emoji); onClose(); }}
          aria-label={emoji}
          style={{
            height: "24px",
            borderRadius: "4px",
            background: "transparent",
            border: currentIcon === emoji ? "2px solid #E5E5E5" : "2px solid transparent",
            cursor: "pointer",
            fontSize: "14px",
            lineHeight: 1,
            transition: "transform 100ms",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.2)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
