/**
 * Core types for the git panel package.
 * Covers file status, repository status, commits, branches, diffs, and backend interface.
 */

// ── File status ──────────────────────────────────────────────────────

export type FileStatusCode =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked";

export interface GitFileStatus {
  path: string;
  oldPath?: string;
  status: FileStatusCode;
  staged: boolean;
}

// ── Repository status ────────────────────────────────────────────────

export interface GitStatus {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: GitFileStatus[];
}

// ── Commits ──────────────────────────────────────────────────────────

export interface GitCommit {
  hash: string;
  abbreviatedHash: string;
  author: string;
  authorEmail: string;
  date: number;
  message: string;
  parentHashes: string[];
}

// ── Branches ─────────────────────────────────────────────────────────

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  upstream?: string;
  lastCommitHash: string;
  lastCommitDate: number;
}

// ── Diff structures ──────────────────────────────────────────────────

export interface HunkRange {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

export interface DiffLine {
  type: "context" | "addition" | "deletion" | "header";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunk {
  range: HunkRange;
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  isBinary: boolean;
}

// ── Commit options ───────────────────────────────────────────────────

export interface CommitOptions {
  amend?: boolean;
  signoff?: boolean;
}

// ── AI commit message ────────────────────────────────────────────────

export interface CommitMessageProvider {
  generateCommitMessage(
    stagedDiff: string,
    recentMessages?: string[],
  ): Promise<string>;
}

// ── Backend interface ────────────────────────────────────────────────

export interface GitBackend {
  status(): Promise<GitStatus>;
  diff(path: string, staged: boolean): Promise<string>;
  stage(path: string, hunks?: HunkRange[]): Promise<void>;
  unstage(path: string, hunks?: HunkRange[]): Promise<void>;
  commit(
    message: string,
    options?: CommitOptions,
  ): Promise<GitCommit>;
  log(limit: number, offset?: number): Promise<GitCommit[]>;
  commitDiff(hash: string): Promise<string>;
  branches(): Promise<BranchInfo[]>;
  checkout(branch: string): Promise<void>;
  createBranch(name: string): Promise<void>;
}

// ── Watcher ──────────────────────────────────────────────────────────

export interface GitPanelWatcher {
  onChange(handler: () => void): () => void;
  dispose(): void;
}
