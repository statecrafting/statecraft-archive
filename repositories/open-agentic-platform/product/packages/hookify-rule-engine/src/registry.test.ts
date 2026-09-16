import { describe, expect, it } from "vitest";
import { MemoryAuditSink } from "./audit.js";
import { HookRegistry } from "./registry.js";
import type { RegisteredHook } from "./types.js";

function makeHook(overrides: Partial<RegisteredHook>): RegisteredHook {
  return {
    name: "test-hook",
    event: "PreToolUse",
    condition: null,
    matcher: {},
    handler: { type: "bash", command: "echo ok" },
    action: "warn",
    priority: 50,
    failMode: "warn",
    timeoutMs: 5000,
    source: "programmatic",
    ...overrides,
  };
}

describe("HookRegistry", () => {
  it("registers and counts hooks", () => {
    const reg = new HookRegistry();
    reg.register(makeHook({ name: "a" }));
    reg.register(makeHook({ name: "b" }));
    expect(reg.size).toBe(2);
  });

  it("returns allowed when no hooks match", async () => {
    const reg = new HookRegistry();
    reg.register(makeHook({ event: "SessionStart" }));
    const result = await reg.dispatch("PreToolUse", { tool: "Bash" });
    expect(result.outcome).toBe("allowed");
  });

  it("dispatches hooks in priority order (highest first)", async () => {
    const order: string[] = [];
    const reg = new HookRegistry({
      agentDispatch: async (prompt) => {
        order.push(prompt);
        return { type: "allow" };
      },
    });

    reg.register(makeHook({
      name: "low",
      priority: 10,
      handler: { type: "agent", promptTemplate: "low" },
    }));
    reg.register(makeHook({
      name: "high",
      priority: 100,
      handler: { type: "agent", promptTemplate: "high" },
    }));

    await reg.dispatch("PreToolUse", {});
    expect(order).toEqual(["high", "low"]);
  });

  it("short-circuits on block action (SC-001)", async () => {
    const reg = new HookRegistry();
    reg.register(makeHook({
      name: "blocker",
      priority: 100,
      handler: { type: "bash", command: "echo 'Force push blocked'" },
      action: "block",
    }));
    reg.register(makeHook({
      name: "after-blocker",
      priority: 10,
      handler: { type: "bash", command: "echo should-not-run" },
    }));

    const result = await reg.dispatch("PreToolUse", {});
    expect(result.outcome).toBe("blocked");
    if (result.outcome === "blocked") {
      expect(result.hookName).toBe("blocker");
    }
  });

  it("removes hooks by source", () => {
    const reg = new HookRegistry();
    reg.register(makeHook({ name: "s1", source: "settings" }));
    reg.register(makeHook({ name: "s2", source: "settings" }));
    reg.register(makeHook({ name: "p1", source: "programmatic" }));
    expect(reg.size).toBe(3);

    reg.removeBySource("settings");
    expect(reg.size).toBe(1);
    expect(reg.getAll()[0].name).toBe("p1");
  });

  it("replaces hooks by source atomically (FR-008)", () => {
    const reg = new HookRegistry();
    reg.register(makeHook({ name: "old", source: "rule_file" }));
    reg.register(makeHook({ name: "keep", source: "programmatic" }));

    reg.replaceSource("rule_file", [
      makeHook({ name: "new1", source: "rule_file" }),
      makeHook({ name: "new2", source: "rule_file" }),
    ]);

    expect(reg.size).toBe(3);
    const names = reg.getAll().map((h) => h.name);
    expect(names).toContain("new1");
    expect(names).toContain("new2");
    expect(names).toContain("keep");
    expect(names).not.toContain("old");
  });

  it("logs audit entries for all hook executions (NF-002, SC-006)", async () => {
    const sink = new MemoryAuditSink();
    const reg = new HookRegistry({ auditSink: sink });
    reg.register(makeHook({
      name: "warn-hook",
      handler: { type: "bash", command: "echo warning" },
      action: "warn",
    }));

    await reg.dispatch("PreToolUse", {});
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0].hookName).toBe("warn-hook");
    expect(sink.entries[0].handlerType).toBe("bash");
    expect(sink.entries[0].eventType).toBe("PreToolUse");
    expect(typeof sink.entries[0].durationMs).toBe("number");
  });

  it("prevents re-entrant dispatch (R-003)", async () => {
    const reg = new HookRegistry({
      agentDispatch: async (_prompt, _payload) => {
        // Try to dispatch again from within a hook — should be a no-op
        const inner = await reg.dispatch("PreToolUse", {});
        expect(inner.outcome).toBe("allowed"); // guard returns allowed
        return { type: "warn", message: "outer" };
      },
    });
    reg.register(makeHook({
      name: "reentrant",
      handler: { type: "agent", promptTemplate: "test" },
    }));

    const result = await reg.dispatch("PreToolUse", {});
    expect(result.outcome).toBe("allowed");
  });

  it("handles handler failure with failMode warn (FR-009)", async () => {
    const sink = new MemoryAuditSink();
    const reg = new HookRegistry({
      auditSink: sink,
      agentDispatch: async () => {
        throw new Error("agent crashed");
      },
    });

    reg.register(makeHook({
      name: "crasher",
      handler: { type: "agent", promptTemplate: "boom" },
      failMode: "warn",
    }));

    const result = await reg.dispatch("PreToolUse", {});
    expect(result.outcome).toBe("allowed"); // non-blocking
    expect(sink.entries[0].result).toBe("error");
  });

  it("handles handler failure with failMode block (FR-009)", async () => {
    const reg = new HookRegistry({
      agentDispatch: async () => {
        throw new Error("agent crashed");
      },
    });

    reg.register(makeHook({
      name: "crasher",
      handler: { type: "agent", promptTemplate: "boom" },
      failMode: "block",
    }));

    const result = await reg.dispatch("PreToolUse", {});
    expect(result.outcome).toBe("blocked");
    if (result.outcome === "blocked") {
      expect(result.reason).toContain("agent crashed");
    }
  });

  it("filters hooks by matcher (tool name)", async () => {
    const sink = new MemoryAuditSink();
    const reg = new HookRegistry({ auditSink: sink });
    reg.register(makeHook({
      name: "bash-only",
      matcher: { tool: "Bash" },
      handler: { type: "bash", command: "echo matched" },
    }));

    // Should not match — tool is "Read"
    await reg.dispatch("PreToolUse", { tool: "Read" });
    expect(sink.entries).toHaveLength(0);

    // Should match — tool is "Bash"
    await reg.dispatch("PreToolUse", { tool: "Bash" });
    expect(sink.entries).toHaveLength(1);
  });

  it("dispatches across all 6 event types (FR-001)", async () => {
    const events = [
      "PreToolUse",
      "PostToolUse",
      "UserPromptSubmit",
      "SessionStart",
      "SessionStop",
      "FileChanged",
    ] as const;

    const sink = new MemoryAuditSink();
    const reg = new HookRegistry({ auditSink: sink });

    for (const event of events) {
      reg.register(makeHook({
        name: `hook-${event}`,
        event,
        handler: { type: "bash", command: "echo ok" },
      }));
    }

    for (const event of events) {
      await reg.dispatch(event, {});
    }

    expect(sink.entries).toHaveLength(6);
    const logged = sink.entries.map((e) => e.eventType);
    for (const event of events) {
      expect(logged).toContain(event);
    }
  });
});
