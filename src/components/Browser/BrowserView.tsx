import { useState, useRef, useCallback } from "react";

interface BrowserViewProps {
  initialUrl?: string;
  onFocus?: () => void;
}

export default function BrowserView({ initialUrl = "https://google.com", onFocus }: BrowserViewProps) {
  const [url, setUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const navigate = useCallback((raw: string) => {
    let u = raw.trim();
    if (!u.startsWith("http://") && !u.startsWith("https://")) {
      u = u.includes(".") && !u.includes(" ") ? "https://" + u : `https://www.google.com/search?q=${encodeURIComponent(u)}`;
    }
    setUrl(u);
    setInputUrl(u);
    setLoading(true);
  }, []);

  return (
    <div onClick={onFocus} style={{
      width: "100%", height: "100%",
      display: "flex", flexDirection: "column",
      background: "#0A0A0A",
    }}>
      {/* Nav bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: "4px",
        padding: "6px 8px", background: "#0E0E0E",
        borderBottom: "1px solid #1F1F1F", minHeight: "34px",
      }}>
        <NavBtn onClick={() => iframeRef.current?.contentWindow?.history.back()} label="Back">
          <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </NavBtn>
        <NavBtn onClick={() => iframeRef.current?.contentWindow?.history.forward()} label="Forward">
          <path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </NavBtn>
        <NavBtn onClick={() => { if (iframeRef.current) { iframeRef.current.src = url; setLoading(true); } }} label="Reload">
          <path d="M11 7a4 4 0 11-1.5-3.1M10 1v3h-3" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </NavBtn>

        <div style={{
          flex: 1, display: "flex", alignItems: "center",
          background: "#0A0A0A", border: "1px solid #1F1F1F",
          borderRadius: "6px", padding: "0 8px", height: "26px",
        }}>
          {loading && <div style={{
            width: "6px", height: "6px", borderRadius: "50%",
            background: "#3B82F6", marginRight: "6px", flexShrink: 0,
            animation: "pulse 1s infinite",
          }} />}
          <input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") navigate(inputUrl); }}
            placeholder="URL or search..."
            style={{
              flex: 1, background: "none", border: "none",
              color: "#737373", fontSize: "11px", outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1 }}>
        <iframe
          ref={iframeRef}
          src={url}
          onLoad={() => setLoading(false)}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
          title="Browser"
        />
      </div>
    </div>
  );
}

function NavBtn({ children, onClick, label }: {
  children: React.ReactNode; onClick: () => void; label: string;
}) {
  return (
    <button
      onClick={onClick} aria-label={label}
      style={{
        width: "26px", height: "26px", borderRadius: "4px",
        border: "none", background: "none", color: "#525252",
        cursor: "pointer", display: "flex", alignItems: "center",
        justifyContent: "center", flexShrink: 0,
        transition: "all 150ms",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "#1A1A1A"; e.currentTarget.style.color = "#E5E5E5"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#525252"; }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14">{children}</svg>
    </button>
  );
}
