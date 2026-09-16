import { describe, expect, test, vi } from "vitest";

import { createPermissionHandler } from "./handler";
import type { PermissionEvaluator } from "./evaluator";

describe("createPermissionHandler", () => {
  test("routes every tool invocation through evaluator", async () => {
    const evaluate = vi.fn<PermissionEvaluator["evaluate"]>(async () => ({
      decision: "allow",
      source: "bypass",
      rationale: "test",
    }));
    const canUseTool = createPermissionHandler({
      evaluator: { evaluate },
      resolveArgument: () => "arg",
    });

    await expect(canUseTool("Read", { path: "/tmp/a" })).resolves.toBe(true);
    await expect(canUseTool("Write", { file_path: "/tmp/b" })).resolves.toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(evaluate).toHaveBeenNthCalledWith(1, {
      toolName: "Read",
      argument: "arg",
      isInteractive: true,
      nowIso: undefined,
    });
    expect(evaluate).toHaveBeenNthCalledWith(2, {
      toolName: "Write",
      argument: "arg",
      isInteractive: true,
      nowIso: undefined,
    });
  });

  test("denied result blocks tool and surfaces payload", async () => {
    const blockedSpy = vi.fn();
    const canUseTool = createPermissionHandler({
      evaluator: {
        evaluate: async () => ({
          decision: "deny",
          source: "disallowed",
          matchedPattern: "Bash(rm:-rf:*)",
          rationale: "Disallowed pattern takes precedence",
        }),
      },
      resolveArgument: () => "rm:-rf:/tmp/demo",
      onBlocked: blockedSpy,
    });

    await expect(canUseTool("Bash", { command: "rm -rf /tmp/demo" })).resolves.toBe(
      false,
    );
    expect(blockedSpy).toHaveBeenCalledTimes(1);
    expect(blockedSpy).toHaveBeenCalledWith({
      toolName: "Bash",
      argument: "rm:-rf:/tmp/demo",
      evaluation: {
        decision: "deny",
        source: "disallowed",
        matchedPattern: "Bash(rm:-rf:*)",
        rationale: "Disallowed pattern takes precedence",
      },
    });
  });
});

