import type { PermissionScope } from "./types";
import type { PermissionStore } from "./store";
import { createPermissionStore } from "./store";

export interface PermissionCliOptions {
  store?: PermissionStore;
  nowIso?: string;
  writeLine?: (line: string) => void;
  writeError?: (line: string) => void;
}

interface ParsedFlags {
  scope?: PermissionScope;
  expired?: boolean;
}

function parseFlags(args: string[]): ParsedFlags {
  const result: ParsedFlags = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--scope" || arg === "-s") {
      const value = args[i + 1];
      if (value && !value.startsWith("-")) {
        result.scope = value as PermissionScope;
        i += 1;
      }
      continue;
    }

    if (arg.startsWith("--scope=")) {
      result.scope = arg.slice("--scope=".length) as PermissionScope;
      continue;
    }

    if (arg === "--expired") {
      result.expired = true;
      continue;
    }
  }

  return result;
}

function formatEntryLine(entry: {
  pattern: string;
  tool: string;
  decision: string;
  scope: string;
  createdAt: string;
  expiresAt?: string | null;
}): string {
  const expires = entry.expiresAt ?? "";
  return [
    entry.pattern,
    entry.tool,
    entry.decision,
    entry.scope,
    entry.createdAt,
    expires,
  ]
    .map((part) => part.trim())
    .join(" | ");
}

export async function runPermissionsCli(
  args: string[],
  options: PermissionCliOptions = {},
): Promise<number> {
  const writeLine = options.writeLine ?? ((line: string) => console.log(line));
  // eslint-disable-next-line no-console
  const writeError = options.writeError ?? ((line: string) => console.error(line));
  const store = options.store ?? createPermissionStore();

  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    writeLine("Usage:");
    writeLine("  permissions list");
    writeLine("  permissions revoke <pattern> [--scope <session|project|global>]");
    writeLine("  permissions clear --expired [--scope <session|project|global>]");
    return 0;
  }

  if (subcommand === "list") {
    const entries = await store.list();
    if (entries.length === 0) {
      writeLine("No stored permission entries.");
      return 0;
    }

    const sorted = [...entries].sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt.localeCompare(b.createdAt);
      }
      if (a.tool !== b.tool) {
        return a.tool.localeCompare(b.tool);
      }
      if (a.pattern !== b.pattern) {
        return a.pattern.localeCompare(b.pattern);
      }
      return a.scope.localeCompare(b.scope);
    });

    writeLine("PATTERN | TOOL | DECISION | SCOPE | CREATED_AT | EXPIRES_AT");
    for (const entry of sorted) {
      writeLine(
        formatEntryLine({
          pattern: entry.pattern,
          tool: entry.tool,
          decision: entry.decision,
          scope: entry.scope,
          createdAt: entry.createdAt,
          expiresAt: entry.expiresAt,
        }),
      );
    }
    return 0;
  }

  if (subcommand === "revoke") {
    const [pattern, ...flagArgs] = rest;
    if (!pattern) {
      writeError("permissions revoke requires a <pattern> argument.");
      return 1;
    }

    const flags = parseFlags(flagArgs);
    const removed = await store.revoke(pattern, flags.scope);
    if (removed === 0) {
      writeLine(`No permission entries found for pattern: ${pattern}`);
    } else if (removed === 1) {
      writeLine(`Revoked 1 permission entry for pattern: ${pattern}`);
    } else {
      writeLine(`Revoked ${removed} permission entries for pattern: ${pattern}`);
    }
    return 0;
  }

  if (subcommand === "clear") {
    const flags = parseFlags(rest);
    if (!flags.expired) {
      writeError("permissions clear currently supports only the --expired flag.");
      return 1;
    }

    const removed = await store.clearExpired(options.nowIso, flags.scope);
    if (removed === 0) {
      writeLine("No expired permission entries were removed.");
    } else if (removed === 1) {
      writeLine("Removed 1 expired permission entry.");
    } else {
      writeLine(`Removed ${removed} expired permission entries.`);
    }
    return 0;
  }

  writeError(`Unknown permissions subcommand: ${subcommand}`);
  return 1;
}

