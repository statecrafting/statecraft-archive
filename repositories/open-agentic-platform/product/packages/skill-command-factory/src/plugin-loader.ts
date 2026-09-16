// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature: 071-skill-command-factory

/**
 * Plugin skill loading — scans .claude/plugins/<name>/commands/ directories.
 *
 * FR-010: Plugin skills are loaded alongside bundled skills with plugin-name
 * prefixing to avoid name collisions.
 *
 * Contract note: If a bundled skill and plugin skill share a name, the bundled
 * skill wins with a warning.
 */

import { type Dirent, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SkillFactory, SkillFactoryLoadResult, SkillRegisteredHook } from "./factory.js";
import type { SkillLoadResult } from "./types.js";
import type { SkillToolDef } from "./tool-def.js";

export interface PluginLoadResult {
  readonly pluginName: string;
  readonly factoryResult: SkillFactoryLoadResult;
}

/**
 * Scan a plugins directory for plugin skill directories.
 *
 * Expected layout:
 *   pluginsDir/
 *     plugin-a/
 *       commands/
 *         some-skill.md
 *     plugin-b/
 *       commands/
 *         other-skill.md
 */
export function loadPluginSkills(
  factory: SkillFactory,
  pluginsDir: string,
  allTools: readonly string[] = [],
): PluginLoadResult[] {
  const results: PluginLoadResult[] = [];

  let entries: Dirent<string>[];
  try {
    entries = readdirSync(pluginsDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginName = entry.name;
    const commandsDir = join(pluginsDir, pluginName, "commands");

    const factoryResult = factory.loadFromDir(commandsDir, allTools, pluginName);
    if (factoryResult.results.length > 0) {
      results.push({ pluginName, factoryResult });
    }
  }

  return results;
}

/**
 * Merge bundled skills and plugin skills, resolving name collisions.
 *
 * Contract note: bundled skills win on collision; a warning is emitted.
 */
export function mergeSkills(
  bundled: SkillFactoryLoadResult,
  plugins: readonly PluginLoadResult[],
): {
  skills: readonly SkillToolDef[];
  hooks: readonly SkillRegisteredHook[];
  results: readonly SkillLoadResult[];
  warnings: readonly string[];
} {
  const nameSet = new Set(bundled.skills.map((s) => s.name));
  const skills = [...bundled.skills];
  const hooks = [...bundled.hooks];
  const results = [...bundled.results];
  const warnings: string[] = [];

  for (const plugin of plugins) {
    for (const skill of plugin.factoryResult.skills) {
      if (nameSet.has(skill.name)) {
        warnings.push(
          `Plugin "${plugin.pluginName}" skill "${skill.skill.name}" collides with bundled skill; bundled skill wins`,
        );
        continue;
      }
      nameSet.add(skill.name);
      skills.push(skill);
    }
    hooks.push(...plugin.factoryResult.hooks);
    results.push(...plugin.factoryResult.results);
  }

  return { skills, hooks, results, warnings };
}
