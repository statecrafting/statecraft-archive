/**
 * Fuzzy scoring algorithm with path-segment awareness (058 Phase 2).
 *
 * Scoring priorities (FR-004):
 * 1. Exact basename match (highest)
 * 2. Basename prefix match
 * 3. Basename fuzzy match (boosted)
 * 4. Path fuzzy match
 *
 * Non-contiguous character matching is supported (FR-004):
 * e.g., "cmp" matches "components/Button.tsx"
 */

/** Weight multiplier when match occurs in the basename portion. */
const BASENAME_BOOST = 2.0;

/** Bonus for consecutive character matches. */
const CONSECUTIVE_BONUS = 5;

/** Bonus for matching at the start of a path segment. */
const SEGMENT_START_BONUS = 10;

/** Bonus for matching at position 0 of the search text. */
const PREFIX_BONUS = 15;

/** Base score per matched character. */
const CHAR_MATCH_SCORE = 10;

/** Penalty per gap (non-matched character between matches). */
const GAP_PENALTY = -1;

export interface ScoringResult {
  score: number;
  matchedRanges: Array<[start: number, end: number]>;
}

/**
 * Compute a fuzzy match score for `query` against `text`.
 * Returns null if query doesn't match (not all characters found).
 */
export function fuzzyScore(query: string, text: string): ScoringResult | null {
  if (query.length === 0) return { score: 0, matchedRanges: [] };
  if (query.length > text.length) return null;

  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  // First pass: check if all characters exist (in order)
  let qi = 0;
  for (let ti = 0; ti < textLower.length && qi < queryLower.length; ti++) {
    if (textLower[ti] === queryLower[qi]) qi++;
  }
  if (qi < queryLower.length) return null;

  // Second pass: greedy best-match with scoring
  const positions = findBestPositions(queryLower, textLower);
  if (!positions) return null;

  let score = 0;
  const ranges: Array<[number, number]> = [];
  let rangeStart = -1;
  let lastPos = -2;

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i]!;

    // Base score
    score += CHAR_MATCH_SCORE;

    // Consecutive bonus
    if (pos === lastPos + 1) {
      score += CONSECUTIVE_BONUS;
    } else if (lastPos >= 0) {
      // Gap penalty
      score += GAP_PENALTY * (pos - lastPos - 1);
    }

    // Segment start bonus (after / or at position 0)
    if (pos === 0 || text[pos - 1] === "/") {
      score += SEGMENT_START_BONUS;
    }

    // Prefix bonus
    if (i === 0 && pos === 0) {
      score += PREFIX_BONUS;
    }

    // Build ranges
    if (pos === lastPos + 1 && rangeStart >= 0) {
      // Extend current range
    } else {
      if (rangeStart >= 0) {
        ranges.push([rangeStart, lastPos + 1]);
      }
      rangeStart = pos;
    }

    lastPos = pos;
  }

  if (rangeStart >= 0) {
    ranges.push([rangeStart, lastPos + 1]);
  }

  return { score, matchedRanges: ranges };
}

/**
 * Find optimal match positions using a forward scan that prefers:
 * 1. Segment boundaries
 * 2. Consecutive matches
 * 3. Earlier positions
 */
function findBestPositions(query: string, text: string): number[] | null {
  const n = query.length;
  const m = text.length;

  // Forward pass: find the first valid match positions
  const first: number[] = [];
  let ti = 0;
  for (let qi = 0; qi < n; qi++) {
    while (ti < m && text[ti] !== query[qi]) ti++;
    if (ti >= m) return null;
    first.push(ti);
    ti++;
  }

  // Backward pass: from the last match, work backwards to prefer later positions
  // that produce better consecutive runs
  const best: number[] = new Array(n);
  best[n - 1] = first[n - 1]!;

  let lastMatchEnd = first[n - 1]!;
  for (let qi = n - 2; qi >= 0; qi--) {
    const minPos = first[qi]!;
    // Try to find the match just before the next character's position
    const maxPos = best[qi + 1]! - 1;
    let bestPos = minPos;

    // Prefer position right before next match (consecutive)
    for (let p = maxPos; p >= minPos; p--) {
      if (text[p] === query[qi]) {
        bestPos = p;
        // Prefer segment starts
        if (p === 0 || text[p - 1] === "/") break;
        // Prefer consecutive
        if (p === best[qi + 1]! - 1) break;
        break;
      }
    }
    best[qi] = bestPos;
  }

  return best;
}

/**
 * Score a query against a file path with basename boosting (FR-004).
 */
export function scoreFilePath(query: string, relativePath: string): ScoringResult | null {
  const lastSlash = relativePath.lastIndexOf("/");
  const basename = lastSlash >= 0 ? relativePath.slice(lastSlash + 1) : relativePath;

  // Try basename match first (boosted)
  const basenameResult = fuzzyScore(query, basename);
  if (basenameResult) {
    const offset = lastSlash >= 0 ? lastSlash + 1 : 0;
    return {
      score: Math.round(basenameResult.score * BASENAME_BOOST),
      matchedRanges: basenameResult.matchedRanges.map(
        ([s, e]) => [s + offset, e + offset] as [number, number],
      ),
    };
  }

  // Fall back to full path match
  return fuzzyScore(query, relativePath);
}

/**
 * Score a query against an agent display name.
 */
export function scoreAgent(query: string, displayName: string): ScoringResult | null {
  return fuzzyScore(query, displayName);
}
