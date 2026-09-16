// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature: 071-skill-command-factory

export type {
  SkillType,
  SkillHookDeclaration,
  SkillFrontmatter,
  ParsedSkill,
  SkillLoadStatus,
  SkillLoadResult,
  SkillToolResult,
  SkillExecutionContext,
  SkillDispatchFn,
  HeadlessSpawnFn,
  ToolFilter,
  SkillFactoryOptions,
} from "./types.js";

export { parseSkillFile, skillNameFromPath } from "./parser.js";

export {
  SkillFactory,
  type SkillFactoryLoadResult,
  type SkillRegisteredHook,
} from "./factory.js";

export { SkillToolDef, type SkillToolDefOptions } from "./tool-def.js";

export {
  DefaultToolFilter,
  computeEffectiveTools,
} from "./filter.js";

export {
  loadPluginSkills,
  mergeSkills,
  type PluginLoadResult,
} from "./plugin-loader.js";
