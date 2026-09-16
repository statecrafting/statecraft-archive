import { describe, expect, it, vi } from "vitest";

import type { PermissionScope } from "./types";
import type { PermissionStore } from "./store";
import { runPermissionsCli } from "./cli";

function createInMemoryStore(initial: Parameters<PermissionStore["list"]>[0] = undefined): PermissionStore {
  let entries =
    initial && initial !== "session"
      ? []
      : [
          {
            id: "1",
            tool: "Bash",
            pattern: "Bash(git commit:*)",
            decision: "allow" as const,
            scope: "project" as const,
            createdAt: "2026-03-30T10:00:00Z",
            expiresAt: null,
          },
          {
            id: "2",
            tool: "Read",
            pattern: "Read(/Users/me/**)",
            decision: "deny" as const,
            scope: "global" as const,
            createdAt: "2026-03-30T11:00:00Z",
            expiresAt: "2026-03-31T00:00:00Z",
          },
        ];

  return {
    async list(scope?: PermissionScope) {
      if (!scope || scope === "session") {
        return entries;
      }
      return entries.filter((entry) => entry.scope === scope);
    },
    async upsert() {
      throw new Error("Not implemented in in-memory CLI store");
    },
    async revoke(pattern: string, scope?: PermissionScope) {
      const before = entries.length;
      entries = entries.filter((entry) => {
        const scopeMatches =
          !scope || scope === "session" ? true : entry.scope === scope;
        if (!scopeMatches) {
          return true;
        }
        return entry.pattern !== pattern;
      });
      return before - entries.length;
    },
    async clearExpired(nowIso?: string, scope?: PermissionScope) {
      const nowMs = Date.parse(nowIso ?? new Date().toISOString());
      const before = entries.length;
      entries = entries.filter((entry) => {
        const scopeMatches =
          !scope || scope === "session" ? true : entry.scope === scope;
        if (!scopeMatches) {
          return true;
        }
        if (!entry.expiresAt) {
          return true;
        }
        const expiresMs = Date.parse(entry.expiresAt);
        if (Number.isNaN(expiresMs)) {
          return true;
        }
        return expiresMs > nowMs;
      });
      return before - entries.length;
    },
  };
}

describe("runPermissionsCli", () => {
  it("prints a friendly usage message when no subcommand is provided", async () => {
    const writeLine = vi.fn();
    const exitCode = await runPermissionsCli([], {
      store: createInMemoryStore(),
      writeLine,
    });

    expect(exitCode).toBe(0);
    const output = writeLine.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("permissions list");
    expect(output).toContain("permissions revoke <pattern>");
    expect(output).toContain("permissions clear --expired");
  });

  it("lists stored permission entries with pattern, decision, scope, and timestamps", async () => {
    const writeLine = vi.fn();
    const exitCode = await runPermissionsCli(["list"], {
      store: createInMemoryStore(),
      writeLine,
    });

    expect(exitCode).toBe(0);
    const lines = writeLine.mock.calls.map((call) => call[0]);
    expect(lines[0]).toBe("PATTERN | TOOL | DECISION | SCOPE | CREATED_AT | EXPIRES_AT");

    const dataLines = lines.slice(1);
    expect(dataLines.length).toBe(2);
    expect(dataLines[0]).toContain("Bash(git commit:*)");
    expect(dataLines[0]).toContain("allow");
    expect(dataLines[0]).toContain("project");
    expect(dataLines[0]).toContain("2026-03-30T10:00:00Z");

    expect(dataLines[1]).toContain("Read(/Users/me/**)");
    expect(dataLines[1]).toContain("deny");
    expect(dataLines[1]).toContain("global");
    expect(dataLines[1]).toContain("2026-03-30T11:00:00Z");
    expect(dataLines[1]).toContain("2026-03-31T00:00:00Z");
  });

  it("revokes entries by pattern across scopes when no scope flag is provided", async () => {
    const store = createInMemoryStore();
    const writeLine = vi.fn();
    const exitCode = await runPermissionsCli(
      ["revoke", "Bash(git commit:*)"],
      {
        store,
        writeLine,
      },
    );

    expect(exitCode).toBe(0);
    const message = writeLine.mock.calls.map((call) => call[0]).join("\n");
    expect(message).toContain("Revoked 1 permission entry for pattern: Bash(git commit:*)");

    const remaining = await store.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].pattern).toBe("Read(/Users/me/**)");
  });

  it("returns a non-zero exit code when revoke is called without a pattern", async () => {
    const writeError = vi.fn();
    const exitCode = await runPermissionsCli(["revoke"], {
      store: createInMemoryStore(),
      writeError,
    });

    expect(exitCode).toBe(1);
    const message = writeError.mock.calls.map((call) => call[0]).join("\n");
    expect(message).toContain("permissions revoke requires a <pattern> argument.");
  });

  it("clears expired entries when clear --expired is used", async () => {
    const store = createInMemoryStore();
    const writeLine = vi.fn();
    const nowIso = "2026-03-31T01:00:00Z";

    const exitCode = await runPermissionsCli(
      ["clear", "--expired"],
      {
        store,
        nowIso,
        writeLine,
      },
    );

    expect(exitCode).toBe(0);
    const message = writeLine.mock.calls.map((call) => call[0]).join("\n");
    expect(message).toContain("Removed 1 expired permission entry.");

    const remaining = await store.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].pattern).toBe("Bash(git commit:*)");
  });

  it("rejects clear without the --expired flag", async () => {
    const writeError = vi.fn();
    const exitCode = await runPermissionsCli(["clear"], {
      store: createInMemoryStore(),
      writeError,
    });

    expect(exitCode).toBe(1);
    const message = writeError.mock.calls.map((call) => call[0]).join("\n");
    expect(message).toContain("permissions clear currently supports only the --expired flag.");
  });

  it("prints a helpful error for unknown subcommands", async () => {
    const writeError = vi.fn();
    const exitCode = await runPermissionsCli(["unknown"], {
      store: createInMemoryStore(),
      writeError,
    });

    expect(exitCode).toBe(1);
    const message = writeError.mock.calls.map((call) => call[0]).join("\n");
    expect(message).toContain("Unknown permissions subcommand: unknown");
  });
});

