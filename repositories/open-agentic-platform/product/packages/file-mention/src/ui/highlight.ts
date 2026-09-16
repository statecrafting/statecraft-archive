/**
 * Match highlight utilities (058 Phase 4).
 *
 * Splits display text into highlighted and non-highlighted segments
 * based on matched ranges from the fuzzy scorer.
 */

export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

/**
 * Split text into segments based on matched ranges.
 *
 * The ranges are [start, end) pairs from fuzzyScore.matchedRanges,
 * relative to the display text.
 */
export function highlightText(
  text: string,
  matchedRanges: Array<[start: number, end: number]>,
): HighlightSegment[] {
  if (matchedRanges.length === 0) {
    return [{ text, highlighted: false }];
  }

  const segments: HighlightSegment[] = [];
  let pos = 0;

  for (const [start, end] of matchedRanges) {
    // Clamp to text bounds
    const s = Math.max(0, Math.min(start, text.length));
    const e = Math.max(s, Math.min(end, text.length));

    if (s > pos) {
      segments.push({ text: text.slice(pos, s), highlighted: false });
    }
    if (e > s) {
      segments.push({ text: text.slice(s, e), highlighted: true });
    }
    pos = e;
  }

  if (pos < text.length) {
    segments.push({ text: text.slice(pos), highlighted: false });
  }

  return segments;
}

/**
 * Get the display text for a candidate.
 * Files show the relative path; agents show the display name.
 */
export function candidateDisplayText(candidate: {
  type: "file" | "agent";
  relativePath?: string;
  displayName?: string;
}): string {
  if (candidate.type === "file") {
    return candidate.relativePath ?? "";
  }
  return candidate.displayName ?? "";
}
