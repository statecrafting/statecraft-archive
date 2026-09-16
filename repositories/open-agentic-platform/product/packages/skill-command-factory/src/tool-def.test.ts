// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature: 071-skill-command-factory

import { describe, expect, it, vi } from "vitest";
import { SkillToolDef } from "./tool-def.js";
import type { ParsedSkill, SkillDispatchFn, HeadlessSpawnFn } from "./types.js";

function makeSkill(overrides: Partial<ParsedSkill> = {}): ParsedSkill {
  return {
    name: "test-skill",
    description: "Test skill",
    skillType: "prompt",
    allowedTools: "*",
    hooks: {},
    trigger: null,
    body: "Do the thing with $ARGS",
    sourcePath: "/commands/test-skill.md",
    ...overrides,
  };
}

describe("SkillToolDef", () => {
  describe("metadata", () => {
    it("prefixes name with skill:", () => {
      const def = new SkillToolDef(makeSkill({ name: "commit" }), {
        allTools: [],
      });
      expect(def.name).toBe("skill:commit");
    });

    it("exposes description from parsed skill (NF-002)", () => {
      const def = new SkillToolDef(
        makeSkill({ description: "Create a commit" }),
        { allTools: [] },
      );
      expect(def.description).toBe("Create a commit");
    });

    it("returns JSON schema with args property (FR-007)", () => {
      const def = new SkillToolDef(makeSkill(), { allTools: [] });
      const schema = def.inputSchema;
      expect(schema.type).toBe("object");
      expect(schema.properties).toHaveProperty("args");
    });
  });

  describe("renderPrompt (FR-004)", () => {
    it("replaces $ARGS with provided arguments", () => {
      const def = new SkillToolDef(makeSkill(), { allTools: [] });
      expect(def.renderPrompt("fix the bug")).toBe(
        "Do the thing with fix the bug",
      );
    });

    it("replaces multiple $ARGS occurrences", () => {
      const def = new SkillToolDef(
        makeSkill({ body: "$ARGS first, then $ARGS again" }),
        { allTools: [] },
      );
      expect(def.renderPrompt("X")).toBe("X first, then X again");
    });
  });

  describe("effectiveTools (FR-003)", () => {
    it("returns all tools when allowed_tools is *", () => {
      const def = new SkillToolDef(makeSkill({ allowedTools: "*" }), {
        allTools: ["Bash", "FileRead", "Grep"],
      });
      expect(def.effectiveTools()).toEqual(["Bash", "FileRead", "Grep"]);
    });

    it("filters to allowed tools only (SC-002)", () => {
      const def = new SkillToolDef(
        makeSkill({ allowedTools: ["Bash", "FileRead"] }),
        { allTools: ["Bash", "FileRead", "FileWrite", "Grep"] },
      );
      expect(def.effectiveTools()).toEqual(["Bash", "FileRead"]);
    });

    it("excludes denied tools (NF-003)", () => {
      const def = new SkillToolDef(makeSkill({ allowedTools: "*" }), {
        allTools: ["Bash", "FileRead", "FileWrite"],
        deniedTools: ["FileWrite"],
      });
      expect(def.effectiveTools()).toEqual(["Bash", "FileRead"]);
    });
  });

  describe("execute", () => {
    it("dispatches prompt-type skill (FR-004)", async () => {
      const dispatch: SkillDispatchFn = vi.fn().mockResolvedValue({
        content: "Done",
        isError: false,
      });

      const def = new SkillToolDef(makeSkill(), {
        allTools: ["Bash"],
        dispatch,
      });

      const result = await def.execute("my args");
      expect(result.content).toBe("Done");
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          args: "my args",
          availableTools: ["Bash"],
        }),
        "Do the thing with my args",
        "prompt",
      );
    });

    it("dispatches agent-type skill (FR-005)", async () => {
      const dispatch: SkillDispatchFn = vi.fn().mockResolvedValue({
        content: "Agent result",
        isError: false,
      });

      const def = new SkillToolDef(makeSkill({ skillType: "agent" }), {
        allTools: ["Bash"],
        dispatch,
      });

      const result = await def.execute("research topic");
      expect(dispatch).toHaveBeenCalledWith(
        expect.anything(),
        "Do the thing with research topic",
        "agent",
      );
      expect(result.content).toBe("Agent result");
    });

    it("returns task ID for headless-type skill (FR-006, SC-004)", async () => {
      const headlessSpawn: HeadlessSpawnFn = vi
        .fn()
        .mockResolvedValue("task-123");

      const def = new SkillToolDef(makeSkill({ skillType: "headless" }), {
        allTools: ["Bash"],
        headlessSpawn,
      });

      const result = await def.execute("lint everything");
      expect(result.content).toBe("task-123");
      expect(result.isError).toBe(false);
      expect(result.metadata).toEqual({
        taskId: "task-123",
        skillType: "headless",
      });
    });

    it("returns error when dispatch is not configured", async () => {
      const def = new SkillToolDef(makeSkill(), { allTools: ["Bash"] });
      const result = await def.execute("args");
      expect(result.isError).toBe(true);
      expect(result.content).toContain("No dispatch function");
    });

    it("returns error when headlessSpawn is not configured", async () => {
      const def = new SkillToolDef(makeSkill({ skillType: "headless" }), {
        allTools: ["Bash"],
      });
      const result = await def.execute("args");
      expect(result.isError).toBe(true);
      expect(result.content).toContain("No headless spawn function");
    });
  });
});
