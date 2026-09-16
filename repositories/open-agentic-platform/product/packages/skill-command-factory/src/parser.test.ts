// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature: 071-skill-command-factory

import { describe, expect, it } from "vitest";
import { parseSkillFile, skillNameFromPath } from "./parser.js";

describe("skillNameFromPath", () => {
  it("strips directory and .md extension", () => {
    expect(skillNameFromPath("/path/to/commit.md")).toBe("commit");
    expect(skillNameFromPath("review-branch.md")).toBe("review-branch");
  });
});

describe("parseSkillFile", () => {
  // -----------------------------------------------------------------------
  // Backward compatibility (SC-001, Contract note)
  // -----------------------------------------------------------------------

  it("loads file without frontmatter as prompt-type skill with all tools", () => {
    const content = "Run git status and show the result";
    const result = parseSkillFile(content, "/commands/status.md");

    expect(result.status).toBe("ok");
    expect(result.skill).toBeDefined();
    expect(result.skill!.name).toBe("status");
    expect(result.skill!.skillType).toBe("prompt");
    expect(result.skill!.allowedTools).toBe("*");
    expect(result.skill!.body).toBe(content);
  });

  // -----------------------------------------------------------------------
  // Full frontmatter parsing (FR-001)
  // -----------------------------------------------------------------------

  it("parses complete YAML frontmatter", () => {
    const content = `---
name: commit
description: Create a git commit with conventional commit message
type: prompt
allowed_tools:
  - Bash
  - FileRead
  - Grep
model: sonnet
trigger: null
---

Run git status and draft a commit message.
Use $ARGS as additional context.`;

    const result = parseSkillFile(content, "/commands/commit.md");

    expect(result.status).toBe("ok");
    const skill = result.skill!;
    expect(skill.name).toBe("commit");
    expect(skill.description).toBe(
      "Create a git commit with conventional commit message",
    );
    expect(skill.skillType).toBe("prompt");
    expect(skill.allowedTools).toEqual(["Bash", "FileRead", "Grep"]);
    expect(skill.model).toBe("sonnet");
    expect(skill.trigger).toBeNull();
    expect(skill.body).toContain("$ARGS");
  });

  it("parses agent-type skill", () => {
    const content = `---
name: research
description: Deep research with sub-agents
type: agent
allowed_tools: "*"
---

Research the topic: $ARGS`;

    const result = parseSkillFile(content, "/commands/research.md");
    expect(result.status).toBe("ok");
    expect(result.skill!.skillType).toBe("agent");
    expect(result.skill!.allowedTools).toBe("*");
  });

  it("parses headless-type skill", () => {
    const content = `---
name: lint-all
description: Run linting in the background
type: headless
allowed_tools:
  - Bash
---

Run eslint on the entire project.`;

    const result = parseSkillFile(content, "/commands/lint-all.md");
    expect(result.status).toBe("ok");
    expect(result.skill!.skillType).toBe("headless");
  });

  // -----------------------------------------------------------------------
  // Hooks (FR-008)
  // -----------------------------------------------------------------------

  it("parses hook declarations", () => {
    const content = `---
name: commit
description: Commit skill
type: prompt
hooks:
  PostToolUse:
    - name: verify-commit-format
      type: bash
      if: "tool == 'Bash'"
      run: "echo 'Commit created'"
---

Commit body.`;

    const result = parseSkillFile(content, "/commands/commit.md");
    expect(result.status).toBe("ok");
    const hooks = result.skill!.hooks;
    expect(hooks.PostToolUse).toHaveLength(1);
    expect(hooks.PostToolUse[0].name).toBe("verify-commit-format");
    expect(hooks.PostToolUse[0].type).toBe("bash");
    expect(hooks.PostToolUse[0].if).toBe("tool == 'Bash'");
    expect(hooks.PostToolUse[0].run).toBe("echo 'Commit created'");
  });

  // -----------------------------------------------------------------------
  // Defaults
  // -----------------------------------------------------------------------

  it("defaults type to prompt when not specified", () => {
    const content = `---
name: simple
description: A simple skill
---

Do the thing.`;

    const result = parseSkillFile(content, "/commands/simple.md");
    expect(result.status).toBe("ok");
    expect(result.skill!.skillType).toBe("prompt");
    expect(result.skill!.allowedTools).toBe("*");
  });

  it("derives name from filename when frontmatter name is missing", () => {
    const content = `---
description: Missing name field
type: prompt
---

Body content.`;

    const result = parseSkillFile(content, "/commands/review-branch.md");
    expect(result.status).toBe("ok");
    expect(result.skill!.name).toBe("review-branch");
  });

  // -----------------------------------------------------------------------
  // Validation errors (FR-009)
  // -----------------------------------------------------------------------

  it("warns on invalid YAML", () => {
    const content = `---
name: [invalid yaml
---

Body.`;

    const result = parseSkillFile(content, "/commands/bad.md");
    expect(result.status).toBe("warning");
    expect(result.message).toContain("Invalid YAML");
    expect(result.skill).toBeUndefined();
  });

  it("warns on invalid skill type", () => {
    const content = `---
name: bad-type
type: interactive
---

Body.`;

    const result = parseSkillFile(content, "/commands/bad-type.md");
    expect(result.status).toBe("warning");
    expect(result.message).toContain("Invalid skill type");
  });

  it("warns on empty allowed_tools array", () => {
    const content = `---
name: no-tools
allowed_tools: []
---

Body.`;

    const result = parseSkillFile(content, "/commands/no-tools.md");
    expect(result.status).toBe("warning");
    expect(result.message).toContain("allowed_tools array is empty");
  });

  it("warns on invalid allowed_tools type", () => {
    const content = `---
name: bad-tools
allowed_tools: 42
---

Body.`;

    const result = parseSkillFile(content, "/commands/bad-tools.md");
    expect(result.status).toBe("warning");
    expect(result.message).toContain("allowed_tools must be");
  });

  it("warns on hook handler missing name", () => {
    const content = `---
name: bad-hook
hooks:
  PostToolUse:
    - type: bash
      run: "echo hi"
---

Body.`;

    const result = parseSkillFile(content, "/commands/bad-hook.md");
    expect(result.status).toBe("warning");
    expect(result.message).toContain("missing required \"name\" field");
  });

  it("warns on hook handler with invalid type", () => {
    const content = `---
name: bad-hook-type
hooks:
  PostToolUse:
    - name: check
      type: javascript
      run: "console.log('hi')"
---

Body.`;

    const result = parseSkillFile(content, "/commands/bad-hook-type.md");
    expect(result.status).toBe("warning");
    expect(result.message).toContain("invalid type");
  });

  // -----------------------------------------------------------------------
  // Edge cases (R-002)
  // -----------------------------------------------------------------------

  it("ignores unknown frontmatter fields (forward-compatible)", () => {
    const content = `---
name: future-skill
future_field: some_value
another_unknown: 42
---

Body.`;

    const result = parseSkillFile(content, "/commands/future-skill.md");
    expect(result.status).toBe("ok");
    expect(result.skill!.name).toBe("future-skill");
  });

  it("handles empty frontmatter block", () => {
    const content = `---
---

Body content.`;

    // Empty YAML parses to null → backward compat path
    const result = parseSkillFile(content, "/commands/empty-fm.md");
    expect(result.status).toBe("ok");
    expect(result.skill!.name).toBe("empty-fm");
    expect(result.skill!.skillType).toBe("prompt");
  });
});
