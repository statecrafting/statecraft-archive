import { describe, expect, it } from "vitest";
import {
  executeBashHandler,
  executeAgentHandler,
  executePromptHandler,
  executeHandler,
} from "./handlers.js";
import type { HandlerContext } from "./handlers.js";

const ctx: HandlerContext = {
  event: "PreToolUse",
  payload: { tool: "Bash", input: { command: "ls" } },
  sessionId: "sess-1",
  projectPath: "/tmp/proj",
};

describe("executeBashHandler", () => {
  it("captures stdout from a successful command", async () => {
    const result = await executeBashHandler("echo hello", ctx, 5000, "warn");
    expect(result.action.type).toBe("warn");
    if (result.action.type === "warn") {
      expect(result.action.message).toBe("hello");
    }
    expect(result.stdout?.trim()).toBe("hello");
  });

  it("returns block when declared action is block", async () => {
    const result = await executeBashHandler("echo blocked", ctx, 5000, "block");
    expect(result.action.type).toBe("block");
    if (result.action.type === "block") {
      expect(result.action.reason).toBe("blocked");
    }
  });

  it("returns allow when stdout is empty", async () => {
    const result = await executeBashHandler("true", ctx, 5000, "warn");
    expect(result.action.type).toBe("allow");
  });

  it("treats timeout as warn (FR-006)", async () => {
    const result = await executeBashHandler("sleep 10", ctx, 100, "block");
    expect(result.action.type).toBe("warn");
    if (result.action.type === "warn") {
      expect(result.action.message).toContain("timed out");
    }
  });

  it("handles non-zero exit as warn when action is warn", async () => {
    const result = await executeBashHandler("exit 1", ctx, 5000, "warn");
    expect(result.action.type).toBe("warn");
  });

  it("handles non-zero exit as block when action is block", async () => {
    const result = await executeBashHandler(
      "echo 'policy violation' && exit 1",
      ctx,
      5000,
      "block",
    );
    expect(result.action.type).toBe("block");
    if (result.action.type === "block") {
      expect(result.action.reason).toContain("policy violation");
    }
  });

  it("passes HOOK_* env vars to the command", async () => {
    const result = await executeBashHandler(
      "echo $HOOK_EVENT:$HOOK_TOOL",
      ctx,
      5000,
      "warn",
    );
    expect(result.stdout?.trim()).toBe("PreToolUse:Bash");
  });

  it("parses JSON stdout for modify action", async () => {
    const result = await executeBashHandler(
      'echo \'{"extra":"field"}\'',
      ctx,
      5000,
      "modify",
    );
    expect(result.action.type).toBe("modify");
    if (result.action.type === "modify") {
      expect(result.action.patch).toEqual({ extra: "field" });
    }
  });
});

describe("executeAgentHandler", () => {
  it("delegates to agent dispatch function (FR-007)", async () => {
    const dispatch = async (prompt: string, payload: Record<string, unknown>) => {
      expect(prompt).toBe("Check tool usage");
      expect(payload.tool).toBe("Bash");
      return { type: "warn" as const, message: "agent says ok" };
    };

    const result = await executeAgentHandler("Check tool usage", ctx, dispatch);
    expect(result.action.type).toBe("warn");
  });

  it("returns block from agent", async () => {
    const dispatch = async () => ({ type: "block" as const, reason: "nope" });
    const result = await executeAgentHandler("Check", ctx, dispatch);
    expect(result.action.type).toBe("block");
  });
});

describe("executePromptHandler", () => {
  it("displays message and returns allow", async () => {
    const display = async (msg: string) => {
      expect(msg).toBe("Proceed?");
      return "yes";
    };
    const result = await executePromptHandler("Proceed?", display);
    expect(result.action.type).toBe("allow");
    expect(result.stdout).toBe("yes");
  });
});

describe("executeHandler", () => {
  it("routes to bash handler", async () => {
    const result = await executeHandler(
      { type: "bash", command: "echo routed" },
      ctx,
      5000,
      "warn",
    );
    expect(result.stdout?.trim()).toBe("routed");
  });

  it("routes to agent handler", async () => {
    const result = await executeHandler(
      { type: "agent", promptTemplate: "test" },
      ctx,
      5000,
      "warn",
      { agentDispatch: async () => ({ type: "allow" }) },
    );
    expect(result.action.type).toBe("allow");
  });

  it("routes to prompt handler", async () => {
    const result = await executeHandler(
      { type: "prompt", message: "hello" },
      ctx,
      5000,
      "warn",
      { promptDisplay: async () => "ok" },
    );
    expect(result.action.type).toBe("allow");
  });
});
