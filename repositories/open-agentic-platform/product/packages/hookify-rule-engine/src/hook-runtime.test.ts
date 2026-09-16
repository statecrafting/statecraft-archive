import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryAuditSink } from "./audit.js";
import { HookRuntime } from "./hook-runtime.js";
import type { RegisteredHook } from "./types.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hook-runtime-"));
}

function writeRule(dir: string, filename: string, content: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content, "utf8");
}

function makeHook(overrides: Partial<RegisteredHook> = {}): RegisteredHook {
  return {
    name: "test-hook",
    event: "PreToolUse",
    condition: null,
    matcher: {},
    handler: { type: "bash", command: "echo blocked" },
    action: "warn",
    priority: 50,
    failMode: "warn",
    timeoutMs: 5000,
    source: "programmatic",
    ...overrides,
  };
}

describe("HookRuntime — unified dispatch (SC-002)", () => {
  let rulesDir: string;
  let runtime: HookRuntime;

  beforeEach(() => {
    rulesDir = tmpDir();
  });

  afterEach(() => {
    runtime?.dispose();
    fs.rmSync(rulesDir, { recursive: true, force: true });
  });

  it("dispatches through hooks when no rules exist", async () => {
    const audit = new MemoryAuditSink();
    runtime = new HookRuntime({
      loader: { rulesDir },
      auditSink: audit,
    });

    runtime.register(
      makeHook({
        name: "echo-hook",
        handler: { type: "bash", command: "echo hello" },
        action: "warn",
      }),
    );

    const result = await runtime.dispatch("PreToolUse", {
      tool: "Bash",
      input: { command: "ls" },
    });

    expect(result.outcome).toBe("allowed");
    expect(audit.entries.length).toBe(1);
    expect(audit.entries[0].hookName).toBe("echo-hook");
  });

  it("rule block short-circuits before hooks execute", async () => {
    // Write a blocking rule in the spec-048 format
    writeRule(
      rulesDir,
      "block-all.md",
      `---
id: block-all
event: PreToolUse
matcher:
  tool: Bash
conditions:
  - field: input.command
    contains: "rm"
action:
  type: block
priority: 100
---
Block dangerous commands.
`,
    );

    const audit = new MemoryAuditSink();
    runtime = new HookRuntime({
      loader: { rulesDir },
      auditSink: audit,
    });

    // Also register a hook — it should NOT fire
    runtime.register(
      makeHook({
        name: "should-not-fire",
        handler: { type: "bash", command: "echo this should not run" },
        action: "warn",
      }),
    );

    const result = await runtime.dispatch("PreToolUse", {
      tool: "Bash",
      input: { command: "rm -rf /" },
    });

    expect(result.outcome).toBe("blocked");
    if (result.outcome === "blocked") {
      expect(result.hookName).toBe("block-all");
    }

    // No audit entries — hooks were short-circuited by rule
    expect(audit.entries.length).toBe(0);
  });

  it("rule modifications flow into hook dispatch", async () => {
    // Write a warn rule (doesn't block, just warns)
    writeRule(
      rulesDir,
      "warn-rule.md",
      `---
id: warn-bash
event: PreToolUse
matcher:
  tool: Bash
conditions:
  - field: input.command
    contains: "ls"
action:
  type: warn
priority: 50
---
Warn about tool usage.
`,
    );

    const audit = new MemoryAuditSink();
    runtime = new HookRuntime({
      loader: { rulesDir },
      auditSink: audit,
    });

    runtime.register(makeHook({ name: "after-rule", action: "warn" }));

    const result = await runtime.dispatch("PreToolUse", {
      tool: "Bash",
      input: { command: "ls" },
    });

    // Rule warned but didn't block, so hooks still fire
    expect(result.outcome).toBe("allowed");
    expect(audit.entries.length).toBe(1);
    expect(audit.entries[0].hookName).toBe("after-rule");
  });

  it("settings hooks are loaded on construction (FR-005a)", async () => {
    const audit = new MemoryAuditSink();
    runtime = new HookRuntime({
      loader: { rulesDir },
      auditSink: audit,
      settings: {
        hooks: {
          PreToolUse: [
            {
              name: "settings-block",
              type: "bash",
              run: "echo blocked by settings",
              action: "block",
              priority: 90,
            },
          ],
        },
      },
    });

    const result = await runtime.dispatch("PreToolUse", {
      tool: "Bash",
      input: { command: "ls" },
    });

    expect(result.outcome).toBe("blocked");
    if (result.outcome === "blocked") {
      expect(result.hookName).toBe("settings-block");
    }
  });

  it("loadSettings replaces settings hooks atomically", async () => {
    const audit = new MemoryAuditSink();
    runtime = new HookRuntime({
      loader: { rulesDir },
      auditSink: audit,
      settings: {
        hooks: {
          PreToolUse: [
            { name: "old-hook", type: "bash", run: "echo old", action: "warn" },
          ],
        },
      },
    });

    expect(runtime.hookCount).toBe(1);

    runtime.loadSettings({
      hooks: {
        PreToolUse: [
          { name: "new-hook-a", type: "bash", run: "echo a", action: "warn" },
          { name: "new-hook-b", type: "bash", run: "echo b", action: "warn" },
        ],
      },
    });

    expect(runtime.hookCount).toBe(2);
  });

  it("programmatic hooks fire correctly (FR-005d)", async () => {
    const audit = new MemoryAuditSink();
    runtime = new HookRuntime({
      loader: { rulesDir },
      auditSink: audit,
    });

    runtime.register(
      makeHook({
        name: "prog-hook",
        event: "SessionStart",
        handler: { type: "bash", command: "echo started" },
        action: "warn",
      }),
    );

    const result = await runtime.dispatch("SessionStart", {
      sessionId: "s1",
      projectPath: "/tmp",
    });

    expect(result.outcome).toBe("allowed");
    expect(audit.entries.length).toBe(1);
    expect(audit.entries[0].eventType).toBe("SessionStart");
  });

  it("non-matching events pass through with zero overhead", async () => {
    runtime = new HookRuntime({ loader: { rulesDir } });
    runtime.register(makeHook({ event: "PreToolUse" }));

    const start = performance.now();
    const result = await runtime.dispatch("SessionStop", {
      sessionId: "s1",
      durationMs: 1000,
      toolCallCount: 5,
    });
    const elapsed = performance.now() - start;

    expect(result.outcome).toBe("allowed");
    expect(elapsed).toBeLessThan(5); // NF-001
  });

  it("dispose stops hot-reload cleanly", () => {
    runtime = new HookRuntime({
      loader: { rulesDir },
      hotReload: true,
    });

    // Should not throw
    runtime.dispose();
    runtime.dispose(); // idempotent
  });

  it("reloadRules picks up new rule files", () => {
    runtime = new HookRuntime({ loader: { rulesDir } });

    expect(runtime.ruleVersion).toBeGreaterThan(0);
    const v1 = runtime.ruleVersion;

    writeRule(
      rulesDir,
      "new-rule.md",
      `---
id: new-rule
event: PreToolUse
matcher:
  tool: Bash
conditions:
  - field: input.command
    contains: "ls"
action:
  type: warn
priority: 10
---
New rule added.
`,
    );

    runtime.reloadRules();
    expect(runtime.ruleVersion).toBeGreaterThan(v1);
  });

  it("agent handler delegates receive payload context (FR-007)", async () => {
    let capturedPayload: Record<string, unknown> | undefined;

    runtime = new HookRuntime({
      loader: { rulesDir },
      agentDispatch: async (_prompt, payload) => {
        capturedPayload = payload;
        return { type: "allow" };
      },
    });

    runtime.register(
      makeHook({
        name: "agent-hook",
        handler: { type: "agent", promptTemplate: "Check this tool call" },
        action: "warn",
      }),
    );

    await runtime.dispatch("PreToolUse", {
      tool: "FileWrite",
      input: { path: "/tmp/test.txt" },
    });

    expect(capturedPayload).toBeDefined();
    expect(capturedPayload!.tool).toBe("FileWrite");
  });
});
