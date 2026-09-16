export const DEFAULT_BYPASS_PATTERNS: readonly string[] = Object.freeze([
  "Read(**)",
  "Glob(**)",
  "rg(**)",
]);

export const DEFAULT_DISALLOWED_PATTERNS: readonly string[] = Object.freeze([
  "Bash(rm:-rf:*)",
  "Bash(git:push:--force*)",
]);
