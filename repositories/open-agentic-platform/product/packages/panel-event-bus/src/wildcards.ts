/**
 * Glob-style pattern matching for event type names (FR-006).
 * Supports `*` as a wildcard that matches any sequence of characters.
 * E.g., "git:operation_*" matches "git:operation_commit", "git:operation_push".
 */

/** Check if a pattern contains wildcard characters. */
export function isWildcard(pattern: string): boolean {
  return pattern.includes('*');
}

/** Convert a glob pattern to a RegExp. */
export function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withWildcards = escaped.replace(/\*/g, '.*');
  return new RegExp(`^${withWildcards}$`);
}

/** Test if an event type name matches a pattern (exact or glob). */
export function matchesPattern(eventType: string, pattern: string): boolean {
  if (!isWildcard(pattern)) return eventType === pattern;
  return patternToRegExp(pattern).test(eventType);
}
