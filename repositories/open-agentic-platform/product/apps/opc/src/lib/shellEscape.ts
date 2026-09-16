/**
 * Cross-platform shell argument escaping utilities.
 *
 * Ported from crystal's shellEscape.ts and adapted for OAP.
 * Provides safe command construction to prevent shell injection.
 */

/**
 * Escape a single shell argument for safe interpolation into a command string.
 *
 * - Unix: wraps in single quotes; embedded single quotes become `'\''`
 * - Windows: wraps in double quotes; escapes backslashes and double quotes
 *
 * @param arg - The raw argument value.
 * @returns A safely-quoted string suitable for shell interpolation.
 */
export function escapeArg(arg: string): string {
  if (!arg) return "''";

  if (process.platform === 'win32') {
    const escaped = arg
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
    return `"${escaped}"`;
  }

  // Unix: end current quote, insert escaped literal quote, resume quoting
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * Build a shell command string from a base command and an array of arguments.
 * Every element of `args` is escaped before joining.
 *
 * @param cmd  - The base command (e.g. `"git"`, `"ls"`). Not escaped; the
 *               caller is responsible for providing a trusted command name.
 * @param args - Arguments to escape and append.
 * @returns The assembled command string.
 */
export function buildCommand(cmd: string, args: string[]): string {
  if (args.length === 0) return cmd;
  return `${cmd} ${args.map(escapeArg).join(' ')}`;
}

/**
 * Build a safe `git commit -m <message>` command that handles multi-line
 * commit messages correctly on every platform.
 *
 * - Unix: uses single-quote escaping so newlines are preserved literally.
 * - Windows: replaces newlines with the `\\n` escape sequence inside a
 *   double-quoted string, which git interprets correctly.
 *
 * @param message - The full (possibly multi-line) commit message.
 * @returns A ready-to-execute command string.
 */
export function buildGitCommit(message: string): string {
  if (process.platform === 'win32') {
    const escaped = message
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');
    return `git commit -m "${escaped}"`;
  }

  return `git commit -m ${escapeArg(message)}`;
}
