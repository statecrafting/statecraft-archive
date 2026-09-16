/**
 * Minimal typing for the optional peer `@anthropic-ai/claude-code`.
 * Runtime provides the real module when installed; consumers typecheck without it.
 */
declare module "@anthropic-ai/claude-code" {
  export function query(
    options: Record<string, unknown>,
  ): AsyncIterable<unknown>;
}
