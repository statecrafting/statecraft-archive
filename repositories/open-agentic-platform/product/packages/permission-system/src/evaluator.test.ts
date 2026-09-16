import { describe, expect, test, vi } from "vitest";

import { createPermissionEvaluator } from "./evaluator";
import type { PermissionPromptHandler } from "./prompt";
import type { PermissionStore } from "./store";
import type { PermissionDecision, PermissionEntry, PermissionScope } from "./types";

class MemoryPermissionStore implements PermissionStore {
  public readonly entries: PermissionEntry[] = [];

  async list(scope?: PermissionScope): Promise<PermissionEntry[]> {
    if (!scope || scope === "session") {
      return [...this.entries];
    }
    return this.entries.filter((entry) => entry.scope === scope);
  }

  async upsert(
    input: Omit<PermissionEntry, "id" | "createdAt"> & {
      id?: string;
      createdAt?: string;
    },
  ): Promise<PermissionEntry> {
    const next: PermissionEntry = {
      id: input.id ?? `id-${this.entries.length + 1}`,
      tool: input.tool,
      pattern: input.pattern,
      decision: input.decision,
      scope: input.scope,
      createdAt: input.createdAt ?? "2026-03-31T00:00:00.000Z",
      expiresAt: input.expiresAt ?? null,
    };

    const index = this.entries.findIndex((entry) => entry.id === next.id);
    if (index >= 0) {
      this.entries[index] = next;
    } else {
      this.entries.push(next);
    }
    return next;
  }

  async revoke(pattern: string, scope?: PermissionScope): Promise<number> {
    const before = this.entries.length;
    const kept = this.entries.filter((entry) => {
      if (scope && scope !== "session" && entry.scope !== scope) {
        return true;
      }
      return entry.pattern !== pattern;
    });
    this.entries.splice(0, this.entries.length, ...kept);
    return before - kept.length;
  }

  async clearExpired(): Promise<number> {
    return 0;
  }

  insert(
    pattern: string,
    decision: PermissionDecision,
    scope: Exclude<PermissionScope, "session"> = "project",
  ): void {
    this.entries.push({
      id: `seed-${this.entries.length + 1}`,
      tool: "Bash",
      pattern,
      decision,
      scope,
      createdAt: "2026-03-31T00:00:00.000Z",
      expiresAt: null,
    });
  }
}

describe("createPermissionEvaluator", () => {
  test("SC-001 bypass patterns short-circuit without prompting", async () => {
    const store = new MemoryPermissionStore();
    const prompt: PermissionPromptHandler = vi.fn(async () => ({ choice: "deny" }));
    const evaluator = createPermissionEvaluator({
      store,
      prompt,
      bypassPatterns: ["Bash(git:status)"],
      disallowedPatterns: [],
    });

    const result = await evaluator.evaluate({
      toolName: "Bash",
      argument: "git:status",
      isInteractive: true,
    });

    expect(result).toMatchObject({
      decision: "allow",
      source: "bypass",
      matchedPattern: "Bash(git:status)",
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  test("SC-002 disallowed overrides broader remembered allow", async () => {
    const store = new MemoryPermissionStore();
    store.insert("Bash(git:**)", "allow");
    const prompt: PermissionPromptHandler = vi.fn(async () => ({ choice: "allow_once" }));
    const evaluator = createPermissionEvaluator({
      store,
      prompt,
      disallowedPatterns: ["Bash(git:push:**)"],
      bypassPatterns: [],
    });

    const result = await evaluator.evaluate({
      toolName: "Bash",
      argument: "git:push:origin:main",
      isInteractive: true,
    });

    expect(result).toMatchObject({
      decision: "deny",
      source: "disallowed",
      matchedPattern: "Bash(git:push:**)",
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  test("SC-003 allow and remember persists grant then suppresses prompts", async () => {
    const store = new MemoryPermissionStore();
    const prompt: PermissionPromptHandler = vi.fn(async () => ({
      choice: "allow_remember",
      scope: "project",
      pattern: "Bash(git:commit:*)",
    }));
    const evaluator = createPermissionEvaluator({
      store,
      prompt,
      bypassPatterns: [],
      disallowedPatterns: [],
    });

    const first = await evaluator.evaluate({
      toolName: "Bash",
      argument: "git:commit:-m",
      isInteractive: true,
    });
    const second = await evaluator.evaluate({
      toolName: "Bash",
      argument: "git:commit:--amend",
      isInteractive: true,
    });

    expect(first).toMatchObject({
      decision: "allow",
      source: "prompt",
      matchedPattern: "Bash(git:commit:*)",
    });
    expect(second).toMatchObject({
      decision: "allow",
      source: "remembered",
      matchedPattern: "Bash(git:commit:*)",
    });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  test("non-interactive deny-all denies before other layers", async () => {
    const store = new MemoryPermissionStore();
    store.insert("Bash(git:status)", "allow");
    const prompt: PermissionPromptHandler = vi.fn(async () => ({ choice: "allow_once" }));
    const evaluator = createPermissionEvaluator({
      store,
      prompt,
      bypassPatterns: ["Bash(git:status)"],
      nonInteractivePolicy: { mode: "deny_all" },
    });

    const result = await evaluator.evaluate({
      toolName: "Bash",
      argument: "git:status",
      isInteractive: false,
    });

    expect(result).toMatchObject({
      decision: "deny",
      source: "non_interactive",
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  test("non-interactive allow-list allows only matching invocations", async () => {
    const store = new MemoryPermissionStore();
    store.insert("Bash(git:status)", "allow");
    const prompt: PermissionPromptHandler = vi.fn(async () => ({ choice: "deny" }));
    const evaluator = createPermissionEvaluator({
      store,
      prompt,
      bypassPatterns: ["Bash(git:status)"],
      nonInteractivePolicy: {
        mode: "allow_list",
        allowListPatterns: ["Bash(git:status)"],
      },
    });

    const allowed = await evaluator.evaluate({
      toolName: "Bash",
      argument: "git:status",
      isInteractive: false,
    });
    const denied = await evaluator.evaluate({
      toolName: "Bash",
      argument: "git:commit:-m",
      isInteractive: false,
    });

    expect(allowed).toMatchObject({
      decision: "allow",
      source: "non_interactive",
      matchedPattern: "Bash(git:status)",
    });
    expect(denied).toMatchObject({
      decision: "deny",
      source: "non_interactive",
    });
    expect(prompt).not.toHaveBeenCalled();
  });
});
