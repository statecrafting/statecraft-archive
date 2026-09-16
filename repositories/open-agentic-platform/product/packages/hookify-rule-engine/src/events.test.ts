import { describe, expect, it } from "vitest";
import { buildEnvVars } from "./events.js";

describe("buildEnvVars", () => {
  it("sets HOOK_EVENT for all event types", () => {
    const env = buildEnvVars("PreToolUse", {});
    expect(env.HOOK_EVENT).toBe("PreToolUse");
  });

  it("sets tool env vars for PreToolUse", () => {
    const env = buildEnvVars("PreToolUse", {
      tool: "Bash",
      input: { command: "git status" },
    });
    expect(env.HOOK_TOOL).toBe("Bash");
    expect(env.HOOK_TOOL_INPUT).toBe('{"command":"git status"}');
    expect(env.HOOK_TOOL_OUTPUT).toBeUndefined();
  });

  it("sets tool output env var for PostToolUse", () => {
    const env = buildEnvVars("PostToolUse", {
      tool: "Bash",
      input: { command: "ls" },
      output: { stdout: "file.txt" },
    });
    expect(env.HOOK_TOOL).toBe("Bash");
    expect(env.HOOK_TOOL_OUTPUT).toBe('{"stdout":"file.txt"}');
  });

  it("sets HOOK_PROMPT for UserPromptSubmit", () => {
    const env = buildEnvVars("UserPromptSubmit", { prompt: "hello" });
    expect(env.HOOK_PROMPT).toBe("hello");
  });

  it("sets HOOK_FILE_PATH for FileChanged", () => {
    const env = buildEnvVars("FileChanged", { filePath: "/tmp/test.ts" });
    expect(env.HOOK_FILE_PATH).toBe("/tmp/test.ts");
  });

  it("sets HOOK_PROJECT_PATH for SessionStart", () => {
    const env = buildEnvVars("SessionStart", { projectPath: "/home/user/proj" });
    expect(env.HOOK_PROJECT_PATH).toBe("/home/user/proj");
  });

  it("passes extra sessionId and projectPath", () => {
    const env = buildEnvVars("SessionStop", {}, {
      sessionId: "sess-1",
      projectPath: "/tmp/proj",
    });
    expect(env.HOOK_SESSION_ID).toBe("sess-1");
    expect(env.HOOK_PROJECT_PATH).toBe("/tmp/proj");
  });
});
