/**
 * Ambient shim so `tsc` can resolve `@anthropic-ai/claude-code` when TypeScript
 * follows workspace-linked `@opc/claude-code-bridge` sources (optional peer).
 * Real types come from the package when installed.
 */
declare module "@anthropic-ai/claude-code" {
  export function query(
    opts: Record<string, unknown>,
  ): AsyncGenerator<unknown>;
}
