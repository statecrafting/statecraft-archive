import { describe, it, expect } from "vitest";
import { AUTO_COLLAPSE_DEPTH } from "./subagent-container.js";
import type { SubagentInfo } from "../types.js";

describe("SubagentContainer", () => {
  it("AUTO_COLLAPSE_DEPTH is 2 (R-002 mitigation)", () => {
    expect(AUTO_COLLAPSE_DEPTH).toBe(2);
  });

  it("SubagentInfo type supports required fields (FR-007)", () => {
    const info: SubagentInfo = {
      id: "sub-1",
      name: "explorer",
      model: "sonnet",
      toolInvocations: [
        {
          id: "inv-1",
          toolId: "Bash",
          input: { command: "ls" },
          startedAt: 1000,
          completedAt: 2000,
          result: { content: "file.ts" },
        },
      ],
      startedAt: 1000,
      completedAt: 3000,
    };
    expect(info.name).toBe("explorer");
    expect(info.toolInvocations).toHaveLength(1);
    expect(info.model).toBe("sonnet");
  });

  it("SubagentInfo supports optional model (SC-004)", () => {
    const info: SubagentInfo = {
      id: "sub-2",
      name: "reviewer",
      toolInvocations: [],
      startedAt: 1000,
    };
    expect(info.model).toBeUndefined();
    expect(info.completedAt).toBeUndefined();
  });

  it("nested subagent tool invocations are structurally valid", () => {
    const info: SubagentInfo = {
      id: "sub-3",
      name: "implementer",
      toolInvocations: [
        { id: "t1", toolId: "Read", input: { file_path: "/a.ts" }, startedAt: 100, completedAt: 200, result: { content: "code" } },
        { id: "t2", toolId: "Edit", input: { file_path: "/a.ts" }, startedAt: 200, completedAt: 300, result: { content: "diff" } },
        { id: "t3", toolId: "Bash", input: { command: "pnpm test" }, startedAt: 300, completedAt: 400, result: { content: "pass" } },
      ],
      startedAt: 100,
      completedAt: 400,
    };
    expect(info.toolInvocations).toHaveLength(3);
    const elapsed = info.completedAt! - info.startedAt;
    expect(elapsed).toBe(300);
  });
});
