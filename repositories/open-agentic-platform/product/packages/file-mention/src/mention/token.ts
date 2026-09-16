/**
 * Mention token creation and resolution (058 Phase 5).
 *
 * Tokens are the inline markers that appear in the composer after a user
 * selects a mention candidate. On send, file tokens are resolved to
 * file content attachments (FR-008).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  MentionToken,
  MentionCandidate,
  FileAttachment,
  MentionMessage,
} from "../types.js";

/** Maximum file size to attach in full (R-003). 100 KB. */
const MAX_ATTACH_BYTES = 100 * 1024;

/**
 * Create a MentionToken from a selected candidate (FR-006, FR-007).
 */
export function createToken(candidate: MentionCandidate): MentionToken {
  if (candidate.type === "file") {
    return {
      type: "file",
      displayText: candidate.basename,
      resolvedValue: candidate.relativePath,
    };
  }

  return {
    type: "agent",
    displayText: candidate.displayName,
    resolvedValue: candidate.agentId,
  };
}

/**
 * Serialize a token to its inline text representation in the composer.
 * Format: [@displayText] — lightweight, parseable.
 */
export function tokenToText(token: MentionToken): string {
  return `[@${token.displayText}]`;
}

/**
 * Parse tokens from composed text.
 * Looks for [@...] patterns and matches them against known tokens.
 */
export function parseTokensFromText(
  text: string,
  knownTokens: MentionToken[],
): MentionToken[] {
  const found: MentionToken[] = [];
  const pattern = /\[@([^\]]+)\]/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const displayText = match[1]!;
    const token = knownTokens.find((t) => t.displayText === displayText);
    if (token) {
      found.push(token);
    }
  }

  return found;
}

/**
 * Read a file and create an attachment (FR-008, R-003).
 * Large files are truncated with a note.
 */
export async function readFileAttachment(
  relativePath: string,
  projectRoot: string,
): Promise<FileAttachment> {
  const absolutePath = join(projectRoot, relativePath);

  try {
    const buffer = await readFile(absolutePath);
    const truncated = buffer.length > MAX_ATTACH_BYTES;
    const content = truncated
      ? buffer.slice(0, MAX_ATTACH_BYTES).toString("utf-8") +
        `\n\n--- truncated (${buffer.length} bytes total, showing first ${MAX_ATTACH_BYTES}) ---`
      : buffer.toString("utf-8");

    return { relativePath, absolutePath, content, truncated };
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Unknown read error";
    return {
      relativePath,
      absolutePath,
      content: `[Error reading file: ${msg}]`,
      truncated: false,
    };
  }
}

/**
 * Resolve all tokens in a message into a MentionMessage (FR-008, SC-004).
 *
 * - File tokens trigger file reads and produce attachments.
 * - Agent tokens set the targetAgentId (last agent wins if multiple).
 */
export async function resolveMessage(
  text: string,
  tokens: MentionToken[],
  projectRoot: string,
): Promise<MentionMessage> {
  const fileTokens = tokens.filter((t) => t.type === "file");
  const agentTokens = tokens.filter((t) => t.type === "agent");

  const fileAttachments = await Promise.all(
    fileTokens.map((t) => readFileAttachment(t.resolvedValue, projectRoot)),
  );

  const targetAgentId =
    agentTokens.length > 0
      ? agentTokens[agentTokens.length - 1]!.resolvedValue
      : undefined;

  return {
    text,
    tokens,
    fileAttachments,
    targetAgentId,
  };
}
