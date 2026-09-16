/**
 * Unified diff parser.
 * Converts raw unified diff text into structured FileDiff/DiffHunk/DiffLine models.
 */

import type { FileDiff, DiffHunk, DiffLine, HunkRange } from "../types.js";

const DIFF_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/;
const BINARY_RE = /^Binary files /;

/**
 * Parse a complete unified diff output (may contain multiple files).
 */
export function parseDiff(raw: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = raw.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const headerMatch = line.match(DIFF_HEADER_RE);

    if (headerMatch) {
      const oldPath = headerMatch[1]!;
      const newPath = headerMatch[2]!;
      i++;

      // Skip extended header lines (index, ---/+++ etc) until hunk or next diff
      let isBinary = false;
      while (i < lines.length) {
        const current = lines[i]!;
        if (current.match(HUNK_HEADER_RE) || current.match(DIFF_HEADER_RE)) {
          break;
        }
        if (current.match(BINARY_RE)) {
          isBinary = true;
        }
        i++;
      }

      if (isBinary) {
        files.push({ oldPath, newPath, hunks: [], isBinary: true });
        continue;
      }

      const hunks: DiffHunk[] = [];

      // Parse hunks belonging to this file
      while (i < lines.length && !lines[i]!.match(DIFF_HEADER_RE)) {
        const hunkMatch = lines[i]!.match(HUNK_HEADER_RE);
        if (hunkMatch) {
          const range: HunkRange = {
            oldStart: parseInt(hunkMatch[1]!, 10),
            oldCount: parseInt(hunkMatch[2] ?? "1", 10),
            newStart: parseInt(hunkMatch[3]!, 10),
            newCount: parseInt(hunkMatch[4] ?? "1", 10),
          };
          const header = lines[i]!;
          i++;

          const hunkLines: DiffLine[] = [];
          let oldLine = range.oldStart;
          let newLine = range.newStart;

          while (i < lines.length) {
            const dl = lines[i]!;
            if (
              dl.match(HUNK_HEADER_RE) ||
              dl.match(DIFF_HEADER_RE)
            ) {
              break;
            }

            if (dl.startsWith("+")) {
              hunkLines.push({
                type: "addition",
                content: dl.slice(1),
                newLineNumber: newLine++,
              });
            } else if (dl.startsWith("-")) {
              hunkLines.push({
                type: "deletion",
                content: dl.slice(1),
                oldLineNumber: oldLine++,
              });
            } else if (dl.startsWith(" ") || dl === "") {
              hunkLines.push({
                type: "context",
                content: dl.startsWith(" ") ? dl.slice(1) : dl,
                oldLineNumber: oldLine++,
                newLineNumber: newLine++,
              });
            } else if (dl.startsWith("\\")) {
              // "\ No newline at end of file" — skip
              i++;
              continue;
            } else {
              break;
            }
            i++;
          }

          hunks.push({ range, header, lines: hunkLines });
        } else {
          i++;
        }
      }

      files.push({ oldPath, newPath, hunks, isBinary: false });
    } else {
      i++;
    }
  }

  return files;
}

/**
 * Reconstruct a patch string for specific hunks (for hunk-level staging).
 * Builds a minimal valid patch that git apply can consume.
 */
export function buildHunkPatch(
  fileDiff: FileDiff,
  hunkIndices: number[],
): string {
  const lines: string[] = [];
  lines.push(`diff --git a/${fileDiff.oldPath} b/${fileDiff.newPath}`);
  lines.push(`--- a/${fileDiff.oldPath}`);
  lines.push(`+++ b/${fileDiff.newPath}`);

  for (const idx of hunkIndices) {
    const hunk = fileDiff.hunks[idx];
    if (!hunk) continue;

    lines.push(hunk.header);
    for (const dl of hunk.lines) {
      switch (dl.type) {
        case "addition":
          lines.push(`+${dl.content}`);
          break;
        case "deletion":
          lines.push(`-${dl.content}`);
          break;
        case "context":
          lines.push(` ${dl.content}`);
          break;
      }
    }
  }

  return lines.join("\n") + "\n";
}
