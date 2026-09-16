/**
 * Stage/unstage operations for files and individual hunks.
 * FR-003: file-level staging, FR-004: hunk-level staging.
 */

import {
  stageFile,
  unstageFile,
  fileDiff,
  applyPatch,
} from "../backend/plumbing.js";
import { parseDiff, buildHunkPatch } from "../backend/diff-parser.js";
import type { HunkRange } from "../types.js";

export interface StagingOperations {
  /** Stage a file entirely, or specific hunks if provided. */
  stage(path: string, hunks?: HunkRange[]): Promise<void>;
  /** Unstage a file entirely, or specific hunks if provided. */
  unstage(path: string, hunks?: HunkRange[]): Promise<void>;
  /** Stage all unstaged/untracked files. */
  stageAll(): Promise<void>;
  /** Unstage all staged files. */
  unstageAll(): Promise<void>;
}

/**
 * Create staging operations bound to a repository path.
 */
export function createStagingOps(cwd: string): StagingOperations {
  return {
    async stage(path: string, hunks?: HunkRange[]): Promise<void> {
      if (!hunks || hunks.length === 0) {
        await stageFile(cwd, path);
        return;
      }
      // Hunk-level staging: get the full unstaged diff, build a patch for selected hunks
      const rawDiff = await fileDiff(cwd, path, false);
      const fileDiffs = parseDiff(rawDiff);
      if (fileDiffs.length === 0) return;

      const fd = fileDiffs[0]!;
      const hunkIndices = matchHunkIndices(fd.hunks, hunks);
      if (hunkIndices.length === 0) return;

      const patch = buildHunkPatch(fd, hunkIndices);
      await applyPatch(cwd, patch, true);
    },

    async unstage(path: string, hunks?: HunkRange[]): Promise<void> {
      if (!hunks || hunks.length === 0) {
        await unstageFile(cwd, path);
        return;
      }
      // Hunk-level unstaging: get the staged diff, build a reverse patch
      const rawDiff = await fileDiff(cwd, path, true);
      const fileDiffs = parseDiff(rawDiff);
      if (fileDiffs.length === 0) return;

      const fd = fileDiffs[0]!;
      const hunkIndices = matchHunkIndices(fd.hunks, hunks);
      if (hunkIndices.length === 0) return;

      const patch = buildHunkPatch(fd, hunkIndices);
      // Reverse-apply to unstage
      await applyReversePatch(cwd, patch);
    },

    async stageAll(): Promise<void> {
      const { execGit } = await import("../backend/plumbing.js");
      await execGit(["add", "-A"], { cwd });
    },

    async unstageAll(): Promise<void> {
      const { execGit } = await import("../backend/plumbing.js");
      await execGit(["reset", "HEAD"], { cwd });
    },
  };
}

/** Match HunkRange values to actual diff hunk indices. */
function matchHunkIndices(
  diffHunks: { range: HunkRange }[],
  targetRanges: HunkRange[],
): number[] {
  const indices: number[] = [];
  for (let i = 0; i < diffHunks.length; i++) {
    const range = diffHunks[i]!.range;
    for (const target of targetRanges) {
      if (
        range.oldStart === target.oldStart &&
        range.oldCount === target.oldCount &&
        range.newStart === target.newStart &&
        range.newCount === target.newCount
      ) {
        indices.push(i);
        break;
      }
    }
  }
  return indices;
}

/** Reverse-apply a patch (swap +/- lines) to unstage hunks. */
async function applyReversePatch(
  cwd: string,
  patch: string,
): Promise<void> {
  const reversed = patch
    .split("\n")
    .map((line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        return `-${line.slice(1)}`;
      }
      if (line.startsWith("-") && !line.startsWith("---")) {
        return `+${line.slice(1)}`;
      }
      // Swap --- and +++ headers
      if (line.startsWith("+++")) return `---${line.slice(3)}`;
      if (line.startsWith("---")) return `+++${line.slice(3)}`;
      // Swap @@ range numbers
      if (line.startsWith("@@")) {
        return line.replace(
          /@@ -(\d+(?:,\d+)?) \+(\d+(?:,\d+)?) @@/,
          "@@ -$2 +$1 @@",
        );
      }
      return line;
    })
    .join("\n");

  await applyPatch(cwd, reversed, true);
}
