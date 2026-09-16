/**
 * Built-in harvesting signal detection rules (FR-003).
 *
 * Each rule matches a pattern in conversation text, classifies the kind
 * of memory to create, and extracts the relevant content.
 */

import type { MemoryKind, ImportanceLevel } from "../types.js";

export interface HarvestRule {
  id: string;
  pattern: RegExp;
  kind: MemoryKind;
  importance: ImportanceLevel;
  extractContent: (match: RegExpMatchArray, fullText: string) => string;
}

/**
 * Extract the sentence containing the match for context.
 * Falls back to a window around the match position.
 */
function extractSentence(fullText: string, matchIndex: number, matchLength: number): string {
  // Find sentence boundaries around the match
  const before = fullText.lastIndexOf(".", matchIndex - 1);
  const after = fullText.indexOf(".", matchIndex + matchLength);
  const start = before === -1 ? 0 : before + 1;
  const end = after === -1 ? fullText.length : after + 1;
  return fullText.slice(start, end).trim();
}

/** Built-in rules for the four required signal categories (FR-003). */
export const BUILTIN_RULES: HarvestRule[] = [
  // === Decisions ===
  {
    id: "decision-lets-go-with",
    pattern: /let'?s\s+go\s+with\s+(.+?)(?:\.|$)/gi,
    kind: "decision",
    importance: "long-term",
    extractContent: (match) => `Decision: ${match[1].trim()}`,
  },
  {
    id: "decision-we-decided",
    pattern: /we\s+decided\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
    kind: "decision",
    importance: "long-term",
    extractContent: (match) => `Decision: ${match[1].trim()}`,
  },
  {
    id: "decision-going-with",
    pattern: /(?:I'm|we'?re)\s+going\s+(?:to\s+go\s+)?with\s+(.+?)(?:\.|$)/gi,
    kind: "decision",
    importance: "long-term",
    extractContent: (match) => `Decision: ${match[1].trim()}`,
  },
  {
    id: "decision-will-use",
    pattern: /(?:we|I)\s+(?:will|should|shall)\s+use\s+(.+?)(?:\s+(?:for|because|since|instead).*)?(?:\.|$)/gi,
    kind: "decision",
    importance: "long-term",
    extractContent: (match) => `Decision: use ${match[1].trim()}`,
  },

  // === Corrections ===
  {
    id: "correction-actually",
    pattern: /actually,?\s+(?:use\s+|we\s+should\s+|let'?s\s+)?(.+?)(?:\.|$)/gi,
    kind: "correction",
    importance: "medium-term",
    extractContent: (match) => `Correction: ${match[1].trim()}`,
  },
  {
    id: "correction-no-use",
    pattern: /no,?\s+(?:use|let'?s\s+use)\s+(.+?)(?:\s+instead.*)?(?:\.|$)/gi,
    kind: "correction",
    importance: "medium-term",
    extractContent: (match) => `Correction: use ${match[1].trim()}`,
  },
  {
    id: "correction-instead",
    pattern: /instead\s+(?:of\s+\S+\s+)?(?:use|let'?s\s+use)\s+(.+?)(?:\.|$)/gi,
    kind: "correction",
    importance: "medium-term",
    extractContent: (match) => `Correction: use ${match[1].trim()}`,
  },

  // === Explicit Notes ===
  {
    id: "note-remember",
    pattern: /remember\s+that\s+(.+?)(?:\.|$)/gi,
    kind: "note",
    importance: "permanent",
    extractContent: (match) => match[1].trim(),
  },
  {
    id: "note-explicit",
    pattern: /note:\s*(.+?)(?:\.|$)/gi,
    kind: "note",
    importance: "long-term",
    extractContent: (match) => match[1].trim(),
  },
  {
    id: "note-keep-in-mind",
    pattern: /keep\s+in\s+mind\s+(?:that\s+)?(.+?)(?:\.|$)/gi,
    kind: "note",
    importance: "long-term",
    extractContent: (match) => match[1].trim(),
  },

  // === Patterns ===
  {
    id: "pattern-observation",
    pattern: /the\s+pattern\s+(?:here\s+)?is\s+(.+?)(?:\.|$)/gi,
    kind: "pattern",
    importance: "long-term",
    extractContent: (match) => `Pattern: ${match[1].trim()}`,
  },
  {
    id: "pattern-convention",
    pattern: /(?:the|our)\s+convention\s+(?:here\s+)?is\s+(?:to\s+)?(.+?)(?:\.|$)/gi,
    kind: "pattern",
    importance: "long-term",
    extractContent: (match) => `Convention: ${match[1].trim()}`,
  },

  // === Preferences ===
  {
    id: "preference-always",
    pattern: /always\s+use\s+(.+?)\s+(?:for|when|in)\s+(.+?)(?:\.|$)/gi,
    kind: "preference",
    importance: "permanent",
    extractContent: (match) => `Always use ${match[1].trim()} for ${match[2].trim()}`,
  },
  {
    id: "preference-never",
    pattern: /never\s+use\s+(.+?)\s+(?:for|when|in)\s+(.+?)(?:\.|$)/gi,
    kind: "preference",
    importance: "permanent",
    extractContent: (match) => `Never use ${match[1].trim()} for ${match[2].trim()}`,
  },
  {
    id: "preference-prefer",
    pattern: /(?:I|we)\s+prefer\s+(.+?)(?:\s+(?:over|instead\s+of)\s+(.+?))?(?:\.|$)/gi,
    kind: "preference",
    importance: "long-term",
    extractContent: (match) =>
      match[2] ? `Prefer ${match[1].trim()} over ${match[2].trim()}` : `Prefer ${match[1].trim()}`,
  },
];
