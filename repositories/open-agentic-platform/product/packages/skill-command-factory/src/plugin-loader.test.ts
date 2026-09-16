// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature: 071-skill-command-factory

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillFactory } from "./factory.js";
import { loadPluginSkills, mergeSkills } from "./plugin-loader.js";
import type { SkillFactoryLoadResult } from "./factory.js";
import { SkillToolDef } from "./tool-def.js";
import type { ParsedSkill } from "./types.js";

describe("loadPluginSkills", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "plugin-loader-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads skills from plugin directories with name prefixing (FR-010)", () => {
    // Create plugin-a/commands/deploy.md
    const pluginADir = join(tempDir, "plugin-a", "commands");
    mkdirSync(pluginADir, { recursive: true });
    writeFileSync(
      join(pluginADir, "deploy.md"),
      `---
name: deploy
description: Deploy from plugin A
type: headless
---

Deploy body.`,
    );

    // Create plugin-b/commands/lint.md
    const pluginBDir = join(tempDir, "plugin-b", "commands");
    mkdirSync(pluginBDir, { recursive: true });
    writeFileSync(
      join(pluginBDir, "lint.md"),
      `---
name: lint
description: Lint from plugin B
type: prompt
---

Lint body.`,
    );

    const factory = new SkillFactory();
    const results = loadPluginSkills(factory, tempDir, ["Bash"]);

    expect(results).toHaveLength(2);

    const pluginA = results.find((r) => r.pluginName === "plugin-a");
    expect(pluginA).toBeDefined();
    expect(pluginA!.factoryResult.skills).toHaveLength(1);
    expect(pluginA!.factoryResult.skills[0].skill.name).toBe(
      "plugin-a:deploy",
    );

    const pluginB = results.find((r) => r.pluginName === "plugin-b");
    expect(pluginB).toBeDefined();
    expect(pluginB!.factoryResult.skills[0].skill.name).toBe("plugin-b:lint");
  });

  it("returns empty for nonexistent plugins directory", () => {
    const factory = new SkillFactory();
    const results = loadPluginSkills(factory, "/nonexistent/plugins");
    expect(results).toHaveLength(0);
  });

  it("skips plugins without commands/ directory", () => {
    mkdirSync(join(tempDir, "empty-plugin"), { recursive: true });

    const factory = new SkillFactory();
    const results = loadPluginSkills(factory, tempDir);
    expect(results).toHaveLength(0);
  });
});

describe("mergeSkills", () => {
  function makeBundledResult(
    names: string[],
  ): SkillFactoryLoadResult {
    const skills = names.map((name) => {
      const skill: ParsedSkill = {
        name,
        description: `Bundled ${name}`,
        skillType: "prompt",
        allowedTools: "*",
        hooks: {},
        trigger: null,
        body: "body",
        sourcePath: `/commands/${name}.md`,
      };
      return new SkillToolDef(skill, { allTools: [] });
    });
    return {
      skills,
      hooks: [],
      results: skills.map((s) => ({
        filePath: s.skill.sourcePath,
        status: "ok" as const,
        skill: s.skill,
      })),
    };
  }

  it("merges bundled and plugin skills", () => {
    const bundled = makeBundledResult(["commit", "review"]);
    const plugins = [
      {
        pluginName: "my-plugin",
        factoryResult: makeBundledResult(["skill:my-plugin:deploy"]),
      },
    ];

    const merged = mergeSkills(bundled, plugins);
    expect(merged.skills).toHaveLength(3);
    expect(merged.warnings).toHaveLength(0);
  });

  it("bundled skill wins on name collision with warning (Contract note)", () => {
    const bundled = makeBundledResult(["commit"]);

    // Create a plugin skill whose tool name collides with bundled
    const collidingSkill: ParsedSkill = {
      name: "commit",
      description: "Plugin commit",
      skillType: "prompt",
      allowedTools: "*",
      hooks: {},
      trigger: null,
      body: "body",
      sourcePath: "/plugins/bad/commands/commit.md",
    };
    const collidingToolDef = new SkillToolDef(collidingSkill, { allTools: [] });

    const plugins = [
      {
        pluginName: "bad",
        factoryResult: {
          skills: [collidingToolDef],
          hooks: [],
          results: [
            {
              filePath: collidingSkill.sourcePath,
              status: "ok" as const,
              skill: collidingSkill,
            },
          ],
        },
      },
    ];

    const merged = mergeSkills(bundled, plugins);
    expect(merged.skills).toHaveLength(1);
    expect(merged.skills[0].skill.description).toBe("Bundled commit");
    expect(merged.warnings).toHaveLength(1);
    expect(merged.warnings[0]).toContain("collides with bundled skill");
  });
});
