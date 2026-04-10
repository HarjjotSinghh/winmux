import { useState, useRef, useCallback } from "react";

interface BrowserViewProps {
  initialUrl?: string;
  onFocus?: () => void;
}

export default function BrowserView({
  initialUrl = "https://google.com",
  onFocus,
}: BrowserViewProps) {
  const [url, setUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const navigate = useCallback(
    (newUrl: string) => {
      let normalized = newUrl.trim();
      if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
        if (normalized.includes(".") && !normalized.includes(" ")) {
          normalized = "https://" + normalized;
        } else {
          normalized = `https://www.google.com/search?q=${encodeURIComponent(normalized)}`;
        }
      }
      setUrl(normalized);
      setInputUrl(normalized);
      setLoading(true);
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        navigate(inputUrl);
      }
    },
    [inputUrl, navigate]
  );

  return (
    <div
      onClick={onFocus}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#0d1117",
        overflow: "hidden",
      }}
    >
      {/* Navigation bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 8px",
          backgroundColor: "#010409",
          borderBottom: "1px solid #21262d",
          minHeight: "36px",
        }}
      >
        {/* Back */}
        <NavButton
          onClick={() => {
            if (iframeRef.current?.contentWindow) {
              iframeRef.current.contentWindow.history.back();
              setCanGoBack(true);
            }
          }}
          disabled={!canGoBack}
          title="Back"
        >
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </NavButton>

        {/* Forward */}
        <NavButton
          onClick={() => {
            if (iframeRef.current?.contentWindow) {
              iframeRef.current.contentWindow.history.forward();
            }
          }}
          title="Forward"
        >
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </NavButton>

        {/* Reload */}
        <NavButton
          onClick={() => {
            if (iframeRef.current) {
              iframeRef.current.src = url;
              setLoading(true);
            }
          }}
          title="Reload"
        >
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path
              d="M11 7a4 4 0 11-1.5-3.1M10 1v3h-3"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
            />
          </svg>
        </NavButton>

        {/* URL bar */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            backgroundColor: "#0d1117",
            border: "1px solid #21262d",
            borderRadius: "6px",
            padding: "0 10px",
            height: "28px",
          }}
        >
          {loading && (
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "#58a6ff",
                marginRight: "8px",
                animation: "pulse 1s infinite",
                flexShrink: 0,
              }}
            />
          )}
          <input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter URL or search..."
            style={{
              flex: 1,
              background: "none",
              border: "none",
              color: "#8b949e",
              fontSize: "12px",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>
      </div>

      {/* Browser content */}
      <div style={{ flex: 1, position: "relative" }}>
        <iframe
          ref={iframeRef}
          src={url}
          onLoad={() => {
            setLoading(false);
            setCanGoBack(true);
            try {
              const currentUrl = iframeRef.current?.contentWindow?.location.href;
              if (currentUrl) setInputUrl(currentUrl);
            } catch {
              // Cross-origin, can't read URL
            }
          }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            backgroundColor: "#ffffff",
          }}
          title="WinMux Browser"
        />
      </div>
    </div>
  );
}

function NavButton({
  children,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        width: "28px",
        height: "28px",
        border: "none",
        borderRadius: "4px",
        background: "none",
        color: disabled ? "#30363d" : "#8b949e",
        cursor: disabled ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        if (!disabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#21262d";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
      }}
    >
      {children}
    </button>
  );
}
