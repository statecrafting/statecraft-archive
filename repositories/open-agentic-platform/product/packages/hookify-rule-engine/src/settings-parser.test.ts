import { describe, expect, it } from "vitest";
import { parseSettingsHooks } from "./settings-parser.js";

describe("parseSettingsHooks", () => {
  it("parses a valid bash hook from settings", () => {
    const hooks = parseSettingsHooks({
      hooks: {
        PreToolUse: [
          {
            name: "block-force-push",
            type: "bash",
            run: "echo blocked",
            action: "block",
            priority: 100,
          },
        ],
      },
    });

    expect(hooks).toHaveLength(1);
    expect(hooks[0].name).toBe("block-force-push");
    expect(hooks[0].event).toBe("PreToolUse");
    expect(hooks[0].handler).toEqual({ type: "bash", command: "echo blocked" });
    expect(hooks[0].action).toBe("block");
    expect(hooks[0].priority).toBe(100);
    expect(hooks[0].source).toBe("settings");
  });

  it("parses agent and prompt handler types", () => {
    const hooks = parseSettingsHooks({
      hooks: {
        SessionStart: [
          { name: "greet", type: "prompt", run: "Welcome!", priority: 10 },
          { name: "check", type: "agent", run: "Check context", action: "warn", priority: 20 },
        ],
      },
    });

    expect(hooks).toHaveLength(2);
    expect(hooks[0].handler).toEqual({ type: "prompt", message: "Welcome!" });
    expect(hooks[1].handler).toEqual({ type: "agent", promptTemplate: "Check context" });
  });

  it("defaults to bash handler type when omitted", () => {
    const hooks = parseSettingsHooks({
      hooks: {
        PostToolUse: [{ name: "log", run: "echo done" }],
      },
    });

    expect(hooks[0].handler.type).toBe("bash");
  });

  it("applies default priority, failMode, and timeout", () => {
    const hooks = parseSettingsHooks({
      hooks: {
        PreToolUse: [{ name: "test", run: "echo x" }],
      },
    });

    expect(hooks[0].priority).toBe(50);
    expect(hooks[0].failMode).toBe("warn");
    expect(hooks[0].timeoutMs).toBe(30_000);
  });

  it("skips invalid event types", () => {
    const hooks = parseSettingsHooks({
      hooks: {
        InvalidEvent: [{ name: "bad", run: "echo x" }],
      },
    });
    expect(hooks).toHaveLength(0);
  });

  it("skips entries without a run command", () => {
    const hooks = parseSettingsHooks({
      hooks: {
        PreToolUse: [{ name: "no-run", type: "bash" }],
      },
    });
    expect(hooks).toHaveLength(0);
  });

  it("returns empty array when no hooks key", () => {
    expect(parseSettingsHooks({})).toEqual([]);
    expect(parseSettingsHooks({ hooks: "not-object" })).toEqual([]);
  });

  it("generates names for unnamed hooks", () => {
    const hooks = parseSettingsHooks({
      hooks: {
        FileChanged: [{ run: "echo changed" }],
      },
    });
    expect(hooks[0].name).toBe("settings:FileChanged:0");
  });

  it("parses all 6 event types", () => {
    const settings = {
      hooks: {
        PreToolUse: [{ run: "echo 1" }],
        PostToolUse: [{ run: "echo 2" }],
        UserPromptSubmit: [{ run: "echo 3" }],
        SessionStart: [{ run: "echo 4" }],
        SessionStop: [{ run: "echo 5" }],
        FileChanged: [{ run: "echo 6" }],
      },
    };
    const hooks = parseSettingsHooks(settings);
    expect(hooks).toHaveLength(6);
    const events = hooks.map((h) => h.event);
    expect(events).toContain("PreToolUse");
    expect(events).toContain("SessionStart");
    expect(events).toContain("FileChanged");
  });
});
