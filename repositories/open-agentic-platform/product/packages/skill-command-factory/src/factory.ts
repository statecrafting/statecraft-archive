// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature: 071-skill-command-factory

/**
 * SkillFactory — loads skill files from directories, validates frontmatter,
 * registers each valid skill as a SkillToolDef, and wires hooks.
 *
 * FR-002: Scan .claude/commands/, validate, register.
 * FR-008: Register skill-declared hooks in HookRegistry.
 * FR-009: Invalid frontmatter warns but does not block.
 * FR-010: Plugin skills loaded with name prefixing.
 * NF-001: <100ms for up to 50 skill files.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSkillFile } from "./parser.js";
import { SkillToolDef, type SkillToolDefOptions } from "./tool-def.js";
import type {
  ParsedSkill,
  SkillFactoryOptions,
  SkillHookDeclaration,
  SkillLoadResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Hook conversion helper
// ---------------------------------------------------------------------------

/**
 * Convert skill hook declarations to the RegisteredHook shape
 * from the hookify-rule-engine (Feature 069).
 *
 * Returns plain objects so we don't take a hard import dependency
 * on @opc/hookify-rule-engine — the caller wires them into the registry.
 */
export interface SkillRegisteredHook {
  readonly name: string;
  readonly event: string;
  readonly condition: null;
  readonly matcher: Record<string, unknown>;
  readonly handler: { readonly type: string; readonly command?: string; readonly promptTemplate?: string; readonly message?: string };
  readonly action: "block" | "warn" | "modify";
  readonly priority: number;
  readonly failMode: "warn";
  readonly timeoutMs: number;
  readonly source: "programmatic";
}

function toRegisteredHooks(
  skill: ParsedSkill,
): SkillRegisteredHook[] {
  const result: SkillRegisteredHook[] = [];

  for (const [event, handlers] of Object.entries(skill.hooks)) {
    for (const h of handlers) {
      result.push(hookDeclToRegistered(event, h, skill.name));
    }
  }
  return result;
}

function hookDeclToRegistered(
  event: string,
  decl: SkillHookDeclaration,
  skillName: string,
): SkillRegisteredHook {
  const handler =
    decl.type === "bash"
      ? { type: "bash" as const, command: decl.run }
      : decl.type === "agent"
        ? { type: "agent" as const, promptTemplate: decl.run }
        : { type: "prompt" as const, message: decl.run };

  return {
    name: `${skillName}:${decl.name}`,
    event,
    condition: null,
    matcher: decl.if ? { tool: decl.if } : {},
    handler,
    action: "warn",
    priority: 50,
    failMode: "warn",
    timeoutMs: 10_000,
    source: "programmatic",
  };
}

// ---------------------------------------------------------------------------
// SkillFactory
// ---------------------------------------------------------------------------

export interface SkillFactoryLoadResult {
  readonly skills: readonly SkillToolDef[];
  readonly hooks: readonly SkillRegisteredHook[];
  readonly results: readonly SkillLoadResult[];
}

export class SkillFactory {
  private readonly options: SkillFactoryOptions;

  constructor(options: SkillFactoryOptions = {}) {
    this.options = options;
  }

  /**
   * Load skills from a directory.
   *
   * Scans for *.md files, parses frontmatter, creates SkillToolDef instances,
   * and collects hook declarations.
   */
  loadFromDir(
    dir: string,
    allTools: readonly string[] = [],
    namePrefix?: string,
  ): SkillFactoryLoadResult {
    const files = listMarkdownFiles(dir);
    const skills: SkillToolDef[] = [];
    const hooks: SkillRegisteredHook[] = [];
    const results: SkillLoadResult[] = [];

    for (const filePath of files) {
      let content: string;
      try {
        content = readFileSync(filePath, "utf-8");
      } catch {
        results.push({
          filePath,
          status: "error",
          message: `Could not read file: ${filePath}`,
        });
        continue;
      }

      const result = parseSkillFile(content, filePath);

      if (result.status === "error" || !result.skill) {
        results.push(result);
        continue;
      }

      // Apply name prefix for plugin skills (FR-010)
      let skill = result.skill;
      if (namePrefix) {
        skill = { ...skill, name: `${namePrefix}:${skill.name}` };
      }

      const toolDefOptions: SkillToolDefOptions = {
        allTools,
        deniedTools: this.options.deniedTools,
        dispatch: this.options.dispatch,
        headlessSpawn: this.options.headlessSpawn,
      };

      skills.push(new SkillToolDef(skill, toolDefOptions));
      hooks.push(...toRegisteredHooks(skill));
      results.push({
        filePath: result.filePath,
        status: result.status,
        skill,
        message: result.message,
      });
    }

    return { skills, hooks, results };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listMarkdownFiles(dir: string): string[] {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => join(dir, e.name))
      .sort(); // deterministic order
  } catch {
    return [];
  }
}
