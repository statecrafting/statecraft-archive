// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature: 071-skill-command-factory

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillFactory } from "./factory.js";

describe("SkillFactory", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "skill-factory-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeSkill(name: string, content: string): void {
    writeFileSync(join(tempDir, name), content, "utf-8");
  }

  // -----------------------------------------------------------------------
  // Basic loading (FR-002)
  // -----------------------------------------------------------------------

  it("loads skills from directory", () => {
    writeSkill(
      "commit.md",
      `---
name: commit
description: Create a commit
type: prompt
allowed_tools:
  - Bash
  - Grep
---

Draft a commit message.`,
    );

    writeSkill(
      "review.md",
      `---
name: review
description: Review code
type: agent
---

Review the changes.`,
    );

    const factory = new SkillFactory();
    const result = factory.loadFromDir(tempDir, [
      "Bash",
      "Grep",
      "FileWrite",
    ]);

    expect(result.skills).toHaveLength(2);
    expect(result.results.filter((r) => r.status === "ok")).toHaveLength(2);

    const commitSkill = result.skills.find(
      (s) => s.skill.name === "commit",
    );
    expect(commitSkill).toBeDefined();
    expect(commitSkill!.effectiveTools()).toEqual(["Bash", "Grep"]);

    const reviewSkill = result.skills.find(
      (s) => s.skill.name === "review",
    );
    expect(reviewSkill).toBeDefined();
    expect(reviewSkill!.skill.skillType).toBe("agent");
  });

  // -----------------------------------------------------------------------
  // Backward compatibility (SC-001)
  // -----------------------------------------------------------------------

  it("loads files without frontmatter as prompt skills", () => {
    writeSkill("simple.md", "Run git status and show the result");

    const factory = new SkillFactory();
    const result = factory.loadFromDir(tempDir);

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].skill.name).toBe("simple");
    expect(result.skills[0].skill.skillType).toBe("prompt");
    expect(result.skills[0].skill.allowedTools).toBe("*");
  });

  // -----------------------------------------------------------------------
  // Invalid frontmatter (FR-009, SC-006)
  // -----------------------------------------------------------------------

  it("warns on invalid frontmatter but loads other skills", () => {
    writeSkill(
      "good.md",
      `---
name: good
description: Valid skill
---

Good body.`,
    );

    writeSkill(
      "bad.md",
      `---
name: [broken yaml
---

Bad body.`,
    );

    const factory = new SkillFactory();
    const result = factory.loadFromDir(tempDir);

    // Good skill loaded
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].skill.name).toBe("good");

    // Bad skill produces warning
    const badResult = result.results.find((r) => r.filePath.includes("bad.md"));
    expect(badResult).toBeDefined();
    expect(badResult!.status).toBe("warning");
  });

  // -----------------------------------------------------------------------
  // Hook extraction (FR-008, SC-005)
  // -----------------------------------------------------------------------

  it("extracts hooks from skill frontmatter", () => {
    writeSkill(
      "hooked.md",
      `---
name: hooked
description: Skill with hooks
type: prompt
hooks:
  PostToolUse:
    - name: check-output
      type: bash
      run: "echo 'checked'"
---

Body.`,
    );

    const factory = new SkillFactory();
    const result = factory.loadFromDir(tempDir);

    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0].name).toBe("hooked:check-output");
    expect(result.hooks[0].event).toBe("PostToolUse");
    expect(result.hooks[0].handler).toEqual({
      type: "bash",
      command: "echo 'checked'",
    });
    expect(result.hooks[0].source).toBe("programmatic");
  });

  // -----------------------------------------------------------------------
  // Name prefixing (FR-010)
  // -----------------------------------------------------------------------

  it("prefixes skill names when namePrefix is provided", () => {
    writeSkill(
      "deploy.md",
      `---
name: deploy
description: Deploy the app
type: headless
---

Deploy body.`,
    );

    const factory = new SkillFactory();
    const result = factory.loadFromDir(tempDir, [], "my-plugin");

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].skill.name).toBe("my-plugin:deploy");
    expect(result.skills[0].name).toBe("skill:my-plugin:deploy");
  });

  // -----------------------------------------------------------------------
  // Empty / missing directory
  // -----------------------------------------------------------------------

  it("returns empty results for nonexistent directory", () => {
    const factory = new SkillFactory();
    const result = factory.loadFromDir("/nonexistent/path");

    expect(result.skills).toHaveLength(0);
    expect(result.hooks).toHaveLength(0);
    expect(result.results).toHaveLength(0);
  });

  it("ignores non-.md files", () => {
    writeFileSync(join(tempDir, "not-a-skill.txt"), "ignored");
    writeFileSync(join(tempDir, "also-not.json"), "{}");

    const factory = new SkillFactory();
    const result = factory.loadFromDir(tempDir);

    expect(result.skills).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Denied tools integration (NF-003)
  // -----------------------------------------------------------------------

  it("excludes denied tools from skill effective tools", () => {
    writeSkill(
      "all-tools.md",
      `---
name: all-tools
description: Uses all tools
---

Body.`,
    );

    const factory = new SkillFactory({ deniedTools: ["FileWrite", "Bash"] });
    const result = factory.loadFromDir(tempDir, [
      "Bash",
      "FileRead",
      "FileWrite",
      "Grep",
    ]);

    expect(result.skills[0].effectiveTools()).toEqual(["FileRead", "Grep"]);
  });
});
