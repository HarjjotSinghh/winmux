import { useEffect, useRef, useState } from "react";
import { getTerminal } from "../../lib/terminalRegistry";

interface TerminalSearchProps {
  visible: boolean;
  terminalId: string | null;
  onClose: () => void;
}

/**
 * Find-in-scrollback bar for the active terminal (Ctrl+Shift+F).
 *
 * Typing searches incrementally, Enter/Shift+Enter step through matches, and
 * closing clears the match decorations from xterm.
 */
export default function TerminalSearch({
  visible,
  terminalId,
  onClose,
}: TerminalSearchProps) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTerminalRef = useRef<string | null>(null);

  useEffect(() => {
    // Switching panes/workspaces while the bar is open must not leave stale
    // match highlights behind on the previous terminal.
    const previous = lastTerminalRef.current;
    if (previous && previous !== terminalId) {
      getTerminal(previous)?.search.clearDecorations();
    }
    lastTerminalRef.current = terminalId;

    if (visible) {
      setQuery("");
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    getTerminal(terminalId)?.search.clearDecorations();
  }, [visible, terminalId]);

  const runFind = (
    value: string,
    direction: "next" | "prev",
    incremental: boolean,
    matchCase = caseSensitive
  ) => {
    const handle = getTerminal(terminalId);
    if (!handle) return;
    if (!value) {
      handle.search.clearDecorations();
      return;
    }
    const options = { caseSensitive: matchCase, incremental };
    if (direction === "next") handle.search.findNext(value, options);
    else handle.search.findPrevious(value, options);
  };

  const close = () => {
    const handle = getTerminal(terminalId);
    handle?.search.clearDecorations();
    handle?.term.focus();
    onClose();
  };

  if (!visible) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        right: 10,
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "6px 8px",
        background: "#141414",
        border: "1px solid #2A2A2A",
        borderRadius: 8,
        boxShadow: "0 8px 28px rgba(0, 0, 0, 0.55)",
      }}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          const value = e.target.value;
          setQuery(value);
          runFind(value, "next", true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            runFind(query, e.shiftKey ? "prev" : "next", false);
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
        placeholder="Find in terminal..."
        style={{
          width: 200,
          padding: "5px 8px",
          background: "#0A0A0A",
          border: "1px solid #1F1F1F",
          borderRadius: 5,
          color: "#E5E5E5",
          fontSize: 12,
          outline: "none",
          fontFamily: "inherit",
        }}
      />
      <SearchButton title="Previous match (Shift+Enter)" onClick={() => runFind(query, "prev", false)}>
        <ArrowIcon up />
      </SearchButton>
      <SearchButton title="Next match (Enter)" onClick={() => runFind(query, "next", false)}>
        <ArrowIcon />
      </SearchButton>
      <SearchButton
        title="Match case"
        active={caseSensitive}
        onClick={() => {
          const next = !caseSensitive;
          setCaseSensitive(next);
          runFind(query, "next", false, next);
        }}
      >
        Aa
      </SearchButton>
      <SearchButton title="Close (Esc)" onClick={close}>
        <CloseIcon />
      </SearchButton>
    </div>
  );
}

function SearchButton({
  children,
  title,
  onClick,
  active,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        minWidth: 24,
        height: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 4px",
        background: active ? "rgba(59, 130, 246, 0.2)" : hover ? "#2A2A2A" : "transparent",
        color: active ? "#60A5FA" : hover ? "#F5F5F5" : "#A3A3A3",
        border: "none",
        borderRadius: 4,
        cursor: "pointer",
        fontSize: 11,
        fontFamily: "inherit",
        transition: "all 100ms ease",
      }}
    >
      {children}
    </button>
  );
}

function ArrowIcon({ up }: { up?: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      {up ? (
        <path d="M5 8V2M2.5 4.5L5 2l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M5 2v6M2.5 5.5L5 8l2.5-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
      <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
