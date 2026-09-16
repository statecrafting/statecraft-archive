/**
 * Parsers for git plumbing command output.
 * Converts raw text output into typed models.
 */

import type {
  GitFileStatus,
  FileStatusCode,
  GitCommit,
  BranchInfo,
} from "../types.js";

// ── Name-status parsing (diff-files, diff-index) ────────────────────

const STATUS_MAP: Record<string, FileStatusCode> = {
  A: "added",
  M: "modified",
  D: "deleted",
  C: "copied",
};

function parseStatusCode(raw: string): {
  status: FileStatusCode;
  isRename: boolean;
} {
  if (raw.startsWith("R")) return { status: "renamed", isRename: true };
  if (raw.startsWith("C")) return { status: "copied", isRename: true };
  return {
    status: STATUS_MAP[raw] ?? "modified",
    isRename: false,
  };
}

/**
 * Parse `git diff-files --name-status` or `git diff-index --cached --name-status HEAD` output.
 * Each line: `<status>\t<path>` or `<status>\t<oldPath>\t<newPath>` for renames/copies.
 */
export function parseNameStatus(
  output: string,
  staged: boolean,
): GitFileStatus[] {
  const results: GitFileStatus[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;

    const rawStatus = parts[0]!;
    const { status, isRename } = parseStatusCode(rawStatus);

    if (isRename && parts.length >= 3) {
      results.push({
        path: parts[2]!,
        oldPath: parts[1]!,
        status,
        staged,
      });
    } else {
      results.push({
        path: parts[1]!,
        status,
        staged,
      });
    }
  }

  return results;
}

/**
 * Parse `git ls-files --others --exclude-standard` output.
 * Each line is a file path.
 */
export function parseUntrackedFiles(output: string): GitFileStatus[] {
  const results: GitFileStatus[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const path = line.trim();
    if (!path) continue;
    results.push({
      path,
      status: "untracked",
      staged: false,
    });
  }

  return results;
}

// ── Commit log parsing ───────────────────────────────────────────────

/**
 * Parse structured git log output.
 * Format: `%H%x00%h%x00%an%x00%ae%x00%at%x00%P%x00%s%x01`
 * Records separated by \x01 (SOH), fields by \x00 (NUL).
 */
export function parseLog(output: string): GitCommit[] {
  if (!output.trim()) return [];

  const commits: GitCommit[] = [];
  const records = output.split("\x01");

  for (const record of records) {
    const trimmed = record.trim();
    if (!trimmed) continue;

    const fields = trimmed.split("\0");
    if (fields.length < 7) continue;

    const hash = fields[0]!;
    const abbreviatedHash = fields[1]!;
    const author = fields[2]!;
    const authorEmail = fields[3]!;
    const date = parseInt(fields[4]!, 10);
    const parentHashesRaw = fields[5]!;
    const message = fields[6]!.trimEnd();

    commits.push({
      hash,
      abbreviatedHash,
      author,
      authorEmail,
      date,
      message,
      parentHashes: parentHashesRaw
        ? parentHashesRaw.split(" ").filter(Boolean)
        : [],
    });
  }

  return commits;
}

// ── Branch parsing ───────────────────────────────────────────────────

/**
 * Parse `git for-each-ref` output.
 * Format: `%(refname:short)%00%(objectname:short)%00%(committerdate:unix)%00%(upstream:short)`
 */
export function parseBranches(
  output: string,
  currentBranchName: string,
): BranchInfo[] {
  const results: BranchInfo[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = line.split("\0");
    if (fields.length < 3) continue;

    const name = fields[0]!;
    const lastCommitHash = fields[1]!;
    const lastCommitDate = parseInt(fields[2]!, 10);
    const upstream = fields[3] || undefined;

    results.push({
      name,
      isCurrent: name === currentBranchName,
      upstream,
      lastCommitHash,
      lastCommitDate,
    });
  }

  return results;
}
