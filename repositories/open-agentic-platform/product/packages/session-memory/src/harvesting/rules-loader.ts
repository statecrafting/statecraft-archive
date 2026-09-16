/**
 * Custom rules loader (FR-004).
 *
 * Loads project-specific harvesting rules from a YAML config file
 * at `.session-memory/harvest-rules.yaml` in the project root.
 *
 * Custom rules are merged with built-in rules. Custom rules with
 * the same id as a built-in rule override the built-in.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { MemoryKind, ImportanceLevel } from "../types.js";
import type { HarvestRule } from "./rules.js";
import { BUILTIN_RULES } from "./rules.js";

/** Shape of a rule in the YAML config file. */
export interface RuleConfig {
  id: string;
  pattern: string;
  flags?: string;
  kind: MemoryKind;
  importance: ImportanceLevel;
  /** Template for extracted content. Use $1, $2, etc. for capture groups. */
  template: string;
}

/** Shape of the harvest-rules.yaml config file. */
export interface HarvestRulesConfig {
  rules: RuleConfig[];
}

export interface LoadRulesResult {
  rules: HarvestRule[];
  customCount: number;
  overriddenCount: number;
  errors: string[];
}

const VALID_KINDS: MemoryKind[] = ["decision", "correction", "pattern", "note", "preference"];
const VALID_IMPORTANCE: ImportanceLevel[] = ["ephemeral", "short-term", "medium-term", "long-term", "permanent"];

/** Convert a RuleConfig from YAML into a HarvestRule. */
export function configToRule(config: RuleConfig): HarvestRule {
  const flags = config.flags ?? "gi";
  const pattern = new RegExp(config.pattern, flags);

  return {
    id: config.id,
    pattern,
    kind: config.kind,
    importance: config.importance,
    extractContent: (match: RegExpMatchArray) => {
      let result = config.template;
      for (let i = 0; i < match.length; i++) {
        result = result.replaceAll(`$${i}`, match[i] ?? "");
      }
      return result;
    },
  };
}

/** Validate a rule config. Returns error messages or empty array. */
export function validateRuleConfig(config: RuleConfig): string[] {
  const errors: string[] = [];

  if (!config.id || typeof config.id !== "string") {
    errors.push("Rule missing required 'id' field");
  }
  if (!config.pattern || typeof config.pattern !== "string") {
    errors.push(`Rule '${config.id}': missing required 'pattern' field`);
  } else {
    try {
      new RegExp(config.pattern);
    } catch {
      errors.push(`Rule '${config.id}': invalid regex pattern: ${config.pattern}`);
    }
  }
  if (!VALID_KINDS.includes(config.kind)) {
    errors.push(`Rule '${config.id}': invalid kind '${config.kind}'`);
  }
  if (!VALID_IMPORTANCE.includes(config.importance)) {
    errors.push(`Rule '${config.id}': invalid importance '${config.importance}'`);
  }
  if (!config.template || typeof config.template !== "string") {
    errors.push(`Rule '${config.id}': missing required 'template' field`);
  }

  return errors;
}

/**
 * Load custom harvesting rules from the project's config file.
 *
 * File location: `<projectRoot>/.session-memory/harvest-rules.yaml`
 *
 * Custom rules are merged with builtins. A custom rule with the same
 * id as a builtin overrides it.
 */
export function loadHarvestRules(projectRoot: string): LoadRulesResult {
  const configPath = join(projectRoot, ".session-memory", "harvest-rules.yaml");
  const errors: string[] = [];
  let customCount = 0;
  let overriddenCount = 0;

  if (!existsSync(configPath)) {
    return { rules: [...BUILTIN_RULES], customCount: 0, overriddenCount: 0, errors: [] };
  }

  let configText: string;
  try {
    configText = readFileSync(configPath, "utf-8");
  } catch (err) {
    return {
      rules: [...BUILTIN_RULES],
      customCount: 0,
      overriddenCount: 0,
      errors: [`Failed to read ${configPath}: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  // Parse YAML — use dynamic import to avoid hard dep on yaml package
  let config: HarvestRulesConfig;
  try {
    // Simple YAML parsing for the rules config format
    config = parseRulesYaml(configText);
  } catch (err) {
    return {
      rules: [...BUILTIN_RULES],
      customCount: 0,
      overriddenCount: 0,
      errors: [`Failed to parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  if (!Array.isArray(config.rules)) {
    return {
      rules: [...BUILTIN_RULES],
      customCount: 0,
      overriddenCount: 0,
      errors: [`${configPath}: 'rules' must be an array`],
    };
  }

  // Build custom rules
  const customRules: HarvestRule[] = [];
  const customIds = new Set<string>();

  for (const ruleConfig of config.rules) {
    const validationErrors = validateRuleConfig(ruleConfig);
    if (validationErrors.length > 0) {
      errors.push(...validationErrors);
      continue;
    }
    customRules.push(configToRule(ruleConfig));
    customIds.add(ruleConfig.id);
    customCount++;
  }

  // Merge: custom overrides builtin by id
  const builtinFiltered = BUILTIN_RULES.filter((r) => {
    if (customIds.has(r.id)) {
      overriddenCount++;
      return false;
    }
    return true;
  });

  return {
    rules: [...builtinFiltered, ...customRules],
    customCount,
    overriddenCount,
    errors,
  };
}

function parseRulesYaml(text: string): HarvestRulesConfig {
  return parseYaml(text) as HarvestRulesConfig;
}
