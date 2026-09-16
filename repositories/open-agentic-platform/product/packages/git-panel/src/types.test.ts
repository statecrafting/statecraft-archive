import { describe, it, expect } from "vitest";
import type {
  GitFileStatus,
  GitStatus,
  GitCommit,
  BranchInfo,
  HunkRange,
  DiffLine,
  DiffHunk,
  FileDiff,
  CommitOptions,
  CommitMessageProvider,
  GitBackend,
  GitPanelWatcher,
  FileStatusCode,
} from "./types.js";

describe("types", () => {
  it("GitFileStatus has required fields", () => {
    const f: GitFileStatus = {
      path: "src/index.ts",
      status: "modified",
      staged: false,
    };
    expect(f.path).toBe("src/index.ts");
    expect(f.oldPath).toBeUndefined();
  });

  it("GitFileStatus supports rename with oldPath", () => {
    const f: GitFileStatus = {
      path: "new.ts",
      oldPath: "old.ts",
      status: "renamed",
      staged: true,
    };
    expect(f.oldPath).toBe("old.ts");
  });

  it("FileStatusCode covers all status values", () => {
    const codes: FileStatusCode[] = [
      "added",
      "modified",
      "deleted",
      "renamed",
      "copied",
      "untracked",
    ];
    expect(codes).toHaveLength(6);
  });

  it("GitStatus has branch and file groups", () => {
    const s: GitStatus = {
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: [],
    };
    expect(s.branch).toBe("main");
    expect(s.upstream).toBeUndefined();
  });

  it("GitCommit has all fields", () => {
    const c: GitCommit = {
      hash: "abc123def456",
      abbreviatedHash: "abc123d",
      author: "Test",
      authorEmail: "test@test.com",
      date: 1234567890,
      message: "initial commit",
      parentHashes: [],
    };
    expect(c.hash).toHaveLength(12);
  });

  it("BranchInfo includes upstream", () => {
    const b: BranchInfo = {
      name: "feature",
      isCurrent: false,
      upstream: "origin/feature",
      lastCommitHash: "abc1234",
      lastCommitDate: 1234567890,
    };
    expect(b.upstream).toBe("origin/feature");
  });

  it("HunkRange has 4 fields", () => {
    const h: HunkRange = {
      oldStart: 1,
      oldCount: 10,
      newStart: 1,
      newCount: 12,
    };
    expect(h.oldStart).toBe(1);
  });

  it("DiffLine covers all types", () => {
    const lines: DiffLine[] = [
      { type: "context", content: " unchanged", oldLineNumber: 1, newLineNumber: 1 },
      { type: "addition", content: "new line", newLineNumber: 2 },
      { type: "deletion", content: "old line", oldLineNumber: 2 },
      { type: "header", content: "@@ header" },
    ];
    expect(lines).toHaveLength(4);
  });

  it("DiffHunk combines range, header, and lines", () => {
    const hunk: DiffHunk = {
      range: { oldStart: 1, oldCount: 3, newStart: 1, newCount: 4 },
      header: "@@ -1,3 +1,4 @@",
      lines: [],
    };
    expect(hunk.header).toContain("@@");
  });

  it("FileDiff supports binary flag", () => {
    const fd: FileDiff = {
      oldPath: "img.png",
      newPath: "img.png",
      hunks: [],
      isBinary: true,
    };
    expect(fd.isBinary).toBe(true);
  });

  it("CommitOptions are optional", () => {
    const opts: CommitOptions = {};
    expect(opts.amend).toBeUndefined();
    expect(opts.signoff).toBeUndefined();
  });

  it("CommitMessageProvider interface shape", () => {
    const provider: CommitMessageProvider = {
      generateCommitMessage: async () => "feat: test",
    };
    expect(provider.generateCommitMessage).toBeDefined();
  });

  it("GitBackend interface covers all operations", () => {
    const methods: (keyof GitBackend)[] = [
      "status",
      "diff",
      "stage",
      "unstage",
      "commit",
      "log",
      "commitDiff",
      "branches",
      "checkout",
      "createBranch",
    ];
    expect(methods).toHaveLength(10);
  });

  it("GitPanelWatcher interface shape", () => {
    const watcher: GitPanelWatcher = {
      onChange: () => () => {},
      dispose: () => {},
    };
    expect(watcher.onChange).toBeDefined();
    expect(watcher.dispose).toBeDefined();
  });
});
