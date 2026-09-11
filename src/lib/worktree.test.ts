import { describe, expect, it } from "vitest";
import {
  branchFromPath,
  defaultWorktreePath,
  isPlausibleBranch,
  slugifyBranchName,
} from "./worktree";

describe("slugifyBranchName", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyBranchName("Feature/My Cool Branch!")).toBe("feature-my-cool-branch");
  });
  it("strips edge hyphens and falls back when empty", () => {
    expect(slugifyBranchName("  --hi--  ")).toBe("hi");
    expect(slugifyBranchName("!!!")).toBe("worktree");
    expect(slugifyBranchName("")).toBe("worktree");
  });
  it("caps length", () => {
    expect(slugifyBranchName("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe("defaultWorktreePath", () => {
  it("defaults to a sibling folder, never inside the repo", () => {
    expect(defaultWorktreePath("C:\\repo\\app", "feat-x")).toBe(
      "C:\\repo\\app-feat-x"
    );
  });
  it("uses forward slashes for posix paths", () => {
    expect(defaultWorktreePath("/home/u/repo", "Feat X")).toBe(
      "/home/u/repo-feat-x"
    );
  });
  it("trims trailing separators", () => {
    expect(defaultWorktreePath("C:\\repo\\app\\", "b")).toBe("C:\\repo\\app-b");
  });
  it("falls back gracefully at a drive root", () => {
    expect(defaultWorktreePath("C:\\", "b")).toBe("C:\\b");
  });
});

describe("branchFromPath", () => {
  it("takes the last segment", () => {
    expect(branchFromPath("C:\\w\\my-branch")).toBe("my-branch");
    expect(branchFromPath("/home/u/w/other/")).toBe("other");
  });
});

describe("isPlausibleBranch", () => {
  it("accepts normal refs", () => {
    expect(isPlausibleBranch("feature/x")).toBe(true);
    expect(isPlausibleBranch("agent-1")).toBe(true);
  });
  it("rejects git-hostile input", () => {
    for (const bad of ["", "has space", "-dash", "a..b", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b"]) {
      expect(isPlausibleBranch(bad)).toBe(false);
    }
  });
});
