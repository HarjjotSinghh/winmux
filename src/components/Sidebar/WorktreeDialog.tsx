import { useEffect, useState } from "react";
import { defaultWorktreePath, isPlausibleBranch } from "../../lib/worktree";

interface Props {
  visible: boolean;
  /** Prefilled repo path (toplevel of the active terminal, when it's a git repo). */
  defaultRepo: string | null;
  onSubmit: (repo: string, path: string, branch: string) => Promise<void>;
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "#0A0A0A",
  border: "1px solid #1F1F1F",
  borderRadius: "6px",
  color: "#E5E5E5",
  fontSize: "12px",
  outline: "none",
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "11px",
  color: "#A3A3A3",
  margin: "10px 0 4px",
  fontWeight: 500,
};

export default function WorktreeDialog({ visible, defaultRepo, onSubmit, onClose }: Props) {
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [location, setLocation] = useState("");
  const [locationTouched, setLocationTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setRepo(defaultRepo ?? "");
      setBranch("");
      setLocation("");
      setLocationTouched(false);
      setBusy(false);
      setError(null);
    }
  }, [visible, defaultRepo]);

  // Keep the suggested location in sync until the user edits it by hand.
  useEffect(() => {
    if (!locationTouched && repo.trim() && branch.trim()) {
      setLocation(defaultWorktreePath(repo.trim(), branch));
    }
  }, [repo, branch, locationTouched]);

  if (!visible) return null;

  const branchOk = isPlausibleBranch(branch);
  const canSubmit =
    !busy && repo.trim().length > 0 && branchOk && location.trim().length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(repo.trim(), location.trim(), branch.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  // While git is running, closing would orphan the operation: the workspace
  // still gets created when the call resolves, after the user cancelled.
  const closeGuarded = () => {
    if (!busy) onClose();
  };

  return (
    <div
      onClick={closeGuarded}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        justifyContent: "center",
        paddingTop: "14%",
        zIndex: 200,
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "440px",
          height: "fit-content",
          background: "#141414",
          border: "1px solid #1F1F1F",
          borderRadius: "10px",
          overflow: "hidden",
          boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          animation: "fadeIn 100ms ease",
        }}
      >
        <div
          style={{
            padding: "16px 20px 12px",
            borderBottom: "1px solid #1F1F1F",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: "13px", fontWeight: 500, color: "#E5E5E5" }}>
            New Workspace from Git Worktree
          </span>
          <button
            onClick={closeGuarded}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              color: "#525252",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            x
          </button>
        </div>

        <div style={{ padding: "12px 20px 16px" }}>
          <label style={{ ...labelStyle, marginTop: 0 }}>Repository</label>
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="C:\path\to\repo"
            autoFocus
            style={inputStyle}
          />

          <label style={labelStyle}>New branch</label>
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="feature/my-branch"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") closeGuarded();
            }}
            style={{
              ...inputStyle,
              borderColor:
                branch.length > 0 && !branchOk ? "#EF4444" : "#1F1F1F",
            }}
          />

          <label style={labelStyle}>Worktree location</label>
          <div style={{ fontSize: 10, color: "#525252", margin: "-2px 0 4px" }}>
            Suggested next to the repo — never inside it, so it can't be
            accidentally committed.
          </div>
          <input
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              setLocationTouched(true);
            }}
            placeholder="auto-suggested from branch"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") closeGuarded();
            }}
            style={inputStyle}
          />

          {error && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 10px",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                borderRadius: 6,
                color: "#F87171",
                fontSize: 11,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 14,
            }}
          >
            <button
              onClick={closeGuarded}
              disabled={busy}
              style={{
                padding: "7px 14px",
                background: "transparent",
                border: "1px solid #2A2A2A",
                borderRadius: 5,
                color: busy ? "#525252" : "#A3A3A3",
                cursor: busy ? "default" : "pointer",
                fontSize: 12,
              }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit}
              style={{
                padding: "7px 14px",
                background: canSubmit ? "#3B82F6" : "#1F1F1F",
                border: "none",
                borderRadius: 5,
                color: canSubmit ? "#fff" : "#525252",
                cursor: canSubmit ? "pointer" : "default",
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              {busy ? "Creating…" : "Create workspace"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
