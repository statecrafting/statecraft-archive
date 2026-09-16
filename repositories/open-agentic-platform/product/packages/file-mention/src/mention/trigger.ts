/**
 * Mention trigger — detects "@" in the composer and manages state (058 Phase 3).
 *
 * Monitors text input for the "@" character and extracts the query string
 * following it. Integrates with the MentionSearchIndex to produce candidates.
 */

import type { MentionState, MentionIndex } from "../types.js";

/**
 * Characters that signal the "@" should NOT trigger autocomplete
 * (e.g., email addresses).
 */
const NON_TRIGGER_BEFORE = /[a-zA-Z0-9._]/;

/**
 * Create a mention trigger that detects "@" and queries the index.
 *
 * FR-001: Triggers on "@" in the composer.
 * FR-002: Returns up to `limit` candidates.
 * FR-005: State management for keyboard navigation.
 */
export function createMentionTrigger(index: MentionIndex, limit: number = 20) {
  /**
   * Called on every keystroke / input event.
   * Returns the current mention state.
   */
  function onInput(text: string, cursorPosition: number): MentionState {
    // Find the "@" that should trigger autocomplete
    const anchorPos = findTriggerAt(text, cursorPosition);
    if (anchorPos === null) {
      return { active: false };
    }

    // Extract query: everything between "@" and cursor
    const query = text.slice(anchorPos + 1, cursorPosition);

    // Don't trigger if query contains spaces (user moved past the mention)
    if (query.includes(" ") || query.includes("\n")) {
      return { active: false };
    }

    const candidates = index.search(query, limit);

    return {
      active: true,
      query,
      anchorPosition: anchorPos,
      candidates,
    };
  }

  return { onInput };
}

/**
 * Scan backwards from cursor to find the triggering "@".
 *
 * Rules:
 * - "@" must be at start of text, or preceded by whitespace/punctuation
 *   (not preceded by alphanumeric — avoids email triggers)
 * - No spaces between "@" and cursor position
 */
function findTriggerAt(text: string, cursorPosition: number): number | null {
  // Scan backwards from just before cursor
  for (let i = cursorPosition - 1; i >= 0; i--) {
    const ch = text[i];

    // Hit whitespace or newline before finding "@" — no trigger
    if (ch === " " || ch === "\n" || ch === "\t") return null;

    if (ch === "@") {
      // Check character before "@" — must be start-of-text or non-alphanumeric
      if (i > 0 && NON_TRIGGER_BEFORE.test(text[i - 1]!)) {
        return null; // Likely an email address
      }
      return i;
    }
  }

  return null;
}

export { findTriggerAt };
