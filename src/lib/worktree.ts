/**
 * Pure helpers for the "new workspace from git worktree" flow.
 * Kept free of IPC so they stay unit-testable.
 */

/** Turn freeform branch text into a safe single path segment. */
export function slugifyBranchName(branch: string): string {
  const slug = branch
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "worktree";
}

/** Default `git worktree add` location: `<repo>/.worktrees/<slug>`. */
export function defaultWorktreePath(repo: string, branch: string): string {
  const sep = repo.includes("/") && !repo.includes("\\") ? "/" : "\\";
  const clean = repo.replace(/[\\/]+$/, "");
  return `${clean}${sep}.worktrees${sep}${slugifyBranchName(branch)}`;
}

/** Workspace name suggestion from a worktree path (last segment). */
export function branchFromPath(path: string): string {
  const base = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  return base || "worktree";
}

/** Minimal sanity check before shelling out to git. */
export function isPlausibleBranch(branch: string): boolean {
  const b = branch.trim();
  return (
    b.length > 0 &&
    b.length <= 255 &&
    !/\s/.test(b) &&
    !b.startsWith("-") &&
    !b.includes("..") &&
    !/[~^:?*[\]\\]/.test(b)
  );
}
