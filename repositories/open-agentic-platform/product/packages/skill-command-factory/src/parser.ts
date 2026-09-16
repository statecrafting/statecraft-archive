// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature: 071-skill-command-factory

/**
 * Frontmatter parser for skill markdown files.
 *
 * FR-001: Parse YAML frontmatter with skill-specific fields.
 * FR-009: Invalid frontmatter produces a warning, does not block other skills.
 * Contract note: Files without frontmatter are prompt-type with allowed_tools: "*".
 */

import { parse as parseYaml } from "yaml";
import type {
  ParsedSkill,
  SkillFrontmatter,
  SkillHookDeclaration,
  SkillLoadResult,
  SkillType,
} from "./types.js";
import { basename } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const VALID_SKILL_TYPES: readonly SkillType[] = ["prompt", "agent", "headless"];
const VALID_HOOK_HANDLER_TYPES = new Set(["bash", "agent", "prompt"]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a single skill markdown file into a ParsedSkill.
 *
 * Returns a SkillLoadResult with status "ok", "warning", or "error".
 */
export function parseSkillFile(
  content: string,
  filePath: string,
): SkillLoadResult {
  const match = content.match(FRONTMATTER_RE);

  if (!match) {
    // Backward compatibility: no frontmatter → prompt skill, all tools, name from filename
    return backwardCompatSkill(content, filePath);
  }

  const [, yamlBlock, body] = match;

  let raw: Record<string, unknown>;
  try {
    raw = parseYaml(yamlBlock) as Record<string, unknown>;
    if (raw === null || typeof raw !== "object") {
      return backwardCompatSkill(content, filePath);
    }
  } catch (err) {
    return {
      filePath,
      status: "warning",
      message: `Invalid YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Validate and extract frontmatter fields
  const validation = validateFrontmatter(raw, filePath);
  if (validation.error) {
    return {
      filePath,
      status: "warning",
      message: validation.error,
    };
  }

  const fm = validation.frontmatter!;

  const skill: ParsedSkill = {
    name: fm.name,
    description: fm.description,
    skillType: fm.type,
    allowedTools: fm.allowed_tools,
    model: fm.model,
    hooks: fm.hooks ?? {},
    trigger: fm.trigger ?? null,
    body: body.trim(),
    sourcePath: filePath,
  };

  return { filePath, status: "ok", skill };
}

/**
 * Derive a skill name from a file path.
 * E.g., "/path/to/commit.md" → "commit"
 */
export function skillNameFromPath(filePath: string): string {
  return basename(filePath, ".md");
}

// ---------------------------------------------------------------------------
// Backward compatibility (Contract note)
// ---------------------------------------------------------------------------

function backwardCompatSkill(
  content: string,
  filePath: string,
): SkillLoadResult {
  const name = skillNameFromPath(filePath);
  const skill: ParsedSkill = {
    name,
    description: `Skill loaded from ${basename(filePath)}`,
    skillType: "prompt",
    allowedTools: "*",
    hooks: {},
    trigger: null,
    body: content.trim(),
    sourcePath: filePath,
  };
  return { filePath, status: "ok", skill };
}

// ---------------------------------------------------------------------------
// Frontmatter validation
// ---------------------------------------------------------------------------

interface ValidationResult {
  frontmatter?: SkillFrontmatter;
  error?: string;
}

function validateFrontmatter(
  raw: Record<string, unknown>,
  filePath: string,
): ValidationResult {
  // Name: required (R-002 says minimal required field)
  const name =
    typeof raw.name === "string" && raw.name.trim() !== ""
      ? raw.name.trim()
      : skillNameFromPath(filePath);

  // Description: optional, defaults to generic
  const description =
    typeof raw.description === "string" && raw.description.trim() !== ""
      ? raw.description.trim()
      : `Skill loaded from ${basename(filePath)}`;

  // Type: optional, defaults to "prompt"
  let type: SkillType = "prompt";
  if (typeof raw.type === "string") {
    if (!VALID_SKILL_TYPES.includes(raw.type as SkillType)) {
      return {
        error: `Invalid skill type "${raw.type}"; expected one of: ${VALID_SKILL_TYPES.join(", ")}`,
      };
    }
    type = raw.type as SkillType;
  }

  // Allowed tools: optional, defaults to "*"
  let allowed_tools: readonly string[] | "*" = "*";
  if (raw.allowed_tools !== undefined) {
    if (raw.allowed_tools === "*") {
      allowed_tools = "*";
    } else if (Array.isArray(raw.allowed_tools)) {
      const tools = raw.allowed_tools.filter(
        (t): t is string => typeof t === "string" && t.trim() !== "",
      );
      if (tools.length === 0) {
        return { error: "allowed_tools array is empty" };
      }
      allowed_tools = tools;
    } else {
      return {
        error: `allowed_tools must be "*" or an array of tool names`,
      };
    }
  }

  // Model: optional string
  const model =
    typeof raw.model === "string" && raw.model.trim() !== ""
      ? raw.model.trim()
      : undefined;

  // Hooks: optional map of event → handler declarations (FR-008)
  let hooks: Record<string, SkillHookDeclaration[]> | undefined;
  if (raw.hooks !== undefined && raw.hooks !== null) {
    if (typeof raw.hooks !== "object" || Array.isArray(raw.hooks)) {
      return { error: "hooks must be an object mapping event types to handler arrays" };
    }
    hooks = {};
    for (const [event, handlers] of Object.entries(
      raw.hooks as Record<string, unknown>,
    )) {
      if (!Array.isArray(handlers)) {
        return { error: `hooks.${event} must be an array of handler declarations` };
      }
      hooks[event] = [];
      for (const h of handlers) {
        if (typeof h !== "object" || h === null) {
          return { error: `hooks.${event} contains an invalid handler` };
        }
        const hObj = h as Record<string, unknown>;
        if (typeof hObj.name !== "string" || hObj.name.trim() === "") {
          return { error: `hooks.${event} handler missing required "name" field` };
        }
        if (
          typeof hObj.type !== "string" ||
          !VALID_HOOK_HANDLER_TYPES.has(hObj.type)
        ) {
          return {
            error: `hooks.${event}.${hObj.name} has invalid type; expected: bash, agent, prompt`,
          };
        }
        if (typeof hObj.run !== "string" || hObj.run.trim() === "") {
          return {
            error: `hooks.${event}.${hObj.name} missing required "run" field`,
          };
        }
        hooks[event].push({
          name: hObj.name as string,
          type: hObj.type as "bash" | "agent" | "prompt",
          if: typeof hObj.if === "string" ? hObj.if : undefined,
          run: hObj.run as string,
        });
      }
    }
  }

  // Trigger: optional string or null
  const trigger =
    typeof raw.trigger === "string" && raw.trigger.trim() !== ""
      ? raw.trigger.trim()
      : null;

  return {
    frontmatter: {
      name,
      description,
      type,
      allowed_tools,
      model,
      hooks,
      trigger,
    },
  };
}
