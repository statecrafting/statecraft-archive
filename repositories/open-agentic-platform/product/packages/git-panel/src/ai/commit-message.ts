/**
 * AI commit message generation from staged diffs.
 * FR-006: one-click AI message generation.
 * R-003: includes recent commits as few-shot examples.
 */

import { stagedDiff, gitLog } from "../backend/plumbing.js";
import { parseLog } from "../backend/parser.js";
import type { CommitMessageProvider } from "../types.js";

/** Default number of recent commits to include as examples. */
export const DEFAULT_EXAMPLE_COUNT = 5;

/** Maximum diff size (in characters) to send to the LLM. */
export const MAX_DIFF_SIZE = 50_000;

/**
 * Build the prompt for AI commit message generation.
 * Exported for testability.
 */
export function buildPrompt(
  diff: string,
  recentMessages: string[],
): string {
  const parts: string[] = [];

  parts.push(
    "Generate a concise, conventional commit message for the following staged changes.",
  );
  parts.push(
    "Follow the format: <type>(<optional scope>): <description>",
  );
  parts.push(
    "Types: feat, fix, refactor, docs, test, chore, perf, style, build, ci.",
  );
  parts.push("Only output the commit message, nothing else.");

  if (recentMessages.length > 0) {
    parts.push("");
    parts.push("Recent commit messages in this repository (for style reference):");
    for (const msg of recentMessages) {
      parts.push(`  - ${msg}`);
    }
  }

  parts.push("");
  parts.push("Staged diff:");
  parts.push("```");
  parts.push(diff.length > MAX_DIFF_SIZE ? diff.slice(0, MAX_DIFF_SIZE) + "\n[diff truncated]" : diff);
  parts.push("```");

  return parts.join("\n");
}

/**
 * Generate an AI commit message for currently staged changes.
 */
export async function generateCommitMessage(
  cwd: string,
  provider: CommitMessageProvider,
  exampleCount: number = DEFAULT_EXAMPLE_COUNT,
): Promise<string> {
  const [diff, logOutput] = await Promise.all([
    stagedDiff(cwd),
    gitLog(cwd, exampleCount),
  ]);

  if (!diff.trim()) {
    throw new Error("No staged changes to generate a commit message for");
  }

  const recentCommits = parseLog(logOutput);
  const recentMessages = recentCommits.map((c) => c.message);

  return provider.generateCommitMessage(diff, recentMessages);
}
