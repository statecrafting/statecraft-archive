// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature: 071-skill-command-factory

/**
 * Tool allow-list filtering.
 *
 * FR-003: Only allowed tools are visible during skill execution.
 * NF-003: Allowed tools are intersected with permission rules.
 * R-001: Filtered context propagates to all sub-agents.
 */

import type { ToolFilter } from "./types.js";

/**
 * Default ToolFilter that computes the intersection of the skill's
 * allowed_tools list with the set of all available tools, minus any
 * explicitly denied tools from the permission runtime.
 */
export class DefaultToolFilter implements ToolFilter {
  private readonly deniedTools: ReadonlySet<string>;

  constructor(deniedTools: readonly string[] = []) {
    this.deniedTools = new Set(deniedTools);
  }

  filter(
    allowedTools: readonly string[] | "*",
    allTools: readonly string[],
  ): readonly string[] {
    const permitted = allTools.filter((t) => !this.deniedTools.has(t));

    if (allowedTools === "*") {
      return permitted;
    }

    const allowSet = new Set(allowedTools);
    return permitted.filter((t) => allowSet.has(t));
  }
}

/**
 * Compute the effective tool list for a skill execution.
 *
 * This is the convenience function used by SkillToolDef.execute().
 */
export function computeEffectiveTools(
  allowedTools: readonly string[] | "*",
  allTools: readonly string[],
  deniedTools: readonly string[] = [],
): readonly string[] {
  const filter = new DefaultToolFilter(deniedTools);
  return filter.filter(allowedTools, allTools);
}
