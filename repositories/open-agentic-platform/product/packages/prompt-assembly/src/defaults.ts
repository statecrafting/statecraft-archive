// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature: 070-prompt-assembly-cache

import { PromptAssembler } from "./assembler.js";
import type { AssemblyContext, PromptSection } from "./types.js";
import type { StandardsFilter, IntegrationResult } from "@opc/yaml-standards-schema";
import { resolveAndFormat } from "@opc/yaml-standards-schema";

/**
 * Default section definitions matching the spec architecture diagram.
 *
 * Static sections (cached across turns):
 *   Identity (1000), Behavioral rules (900), Tool registry schemas (800),
 *   CLAUDE.md instructions (700), Orchestrator rules (600), Base hook defs (500)
 *
 * Dynamic sections (rebuilt each turn):
 *   Active workflow state (400), Session memory (350), MCP server context (300),
 *   Conversation summary (200), Active hooks summary (150), Environment context (100)
 *
 * FR-003: Static sections include tool schemas, rules, CLAUDE.md, identity
 * FR-004: Dynamic sections include memory, workflow, MCP, hooks, environment
 */

// -- Static sections ----------------------------------------------------------

export const identitySection: PromptSection = {
  name: "identity",
  contentFn: () =>
    "You are an AI assistant operating within the Open Agentic Platform (OAP). " +
    "You follow governed execution protocols and respect spec-driven workflows.",
  cacheLifetime: "static",
  priority: 1000,
  maxBytes: 4_096,
};

export const behavioralRulesSection: PromptSection = {
  name: "behavioral-rules",
  contentFn: (ctx) => {
    const rules = ctx.vars["behavioralRules"];
    return typeof rules === "string" ? rules : "";
  },
  cacheLifetime: "static",
  priority: 900,
  maxBytes: 16_384,
};

/**
 * Coding standards section (spec 055, priority 850).
 *
 * Reads pre-resolved standards text from `ctx.vars["codingStandards"]`.
 * Because `resolveAndFormat()` is async and `contentFn` is sync, callers
 * must pre-resolve standards before assembly using `preloadCodingStandards()`.
 *
 * Priority 850 places this between behavioral rules (900) and tool schemas (800).
 */
export const codingStandardsSection: PromptSection = {
  name: "coding-standards",
  contentFn: (ctx: AssemblyContext) => {
    const standards = ctx.vars["codingStandards"];
    return typeof standards === "string" ? standards : "";
  },
  cacheLifetime: "static",
  priority: 850,
  maxBytes: 16_384,
};

/**
 * Pre-resolve coding standards for injection into the assembler context.
 *
 * Call this before assembly and pass the result as `ctx.vars["codingStandards"]`.
 * Returns the formatted prompt text, or an empty string if no standards match.
 *
 * @example
 * ```ts
 * const standardsText = await preloadCodingStandards("/path/to/project", {
 *   tags: ["typescript"],
 * });
 * const ctx = { sessionId: "s1", modelContextWindow: 200_000, vars: {
 *   codingStandards: standardsText,
 * }};
 * const prompt = assembler.assemble(ctx);
 * ```
 */
export async function preloadCodingStandards(
  projectRoot: string,
  filter?: StandardsFilter,
): Promise<string> {
  const result: IntegrationResult = await resolveAndFormat({
    projectRoot,
    filter,
    format: { includeExamples: false },
  });
  return result.promptText;
}

export const toolRegistrySchemasSection: PromptSection = {
  name: "tool-registry-schemas",
  contentFn: (ctx) => {
    const schemas = ctx.vars["toolRegistrySchemas"];
    return typeof schemas === "string" ? schemas : "";
  },
  cacheLifetime: "static",
  priority: 800,
  maxBytes: 32_768,
};

export const claudeMdSection: PromptSection = {
  name: "claude-md-instructions",
  contentFn: (ctx) => {
    const md = ctx.vars["claudeMd"];
    return typeof md === "string" ? md : "";
  },
  cacheLifetime: "static",
  priority: 700,
  maxBytes: 16_384,
};

export const orchestratorRulesSection: PromptSection = {
  name: "orchestrator-rules",
  contentFn: (ctx) => {
    const rules = ctx.vars["orchestratorRules"];
    return typeof rules === "string" ? rules : "";
  },
  cacheLifetime: "static",
  priority: 600,
  maxBytes: 8_192,
};

export const baseHookDefsSection: PromptSection = {
  name: "base-hook-definitions",
  contentFn: (ctx) => {
    const hooks = ctx.vars["baseHookDefinitions"];
    return typeof hooks === "string" ? hooks : "";
  },
  cacheLifetime: "static",
  priority: 500,
  maxBytes: 8_192,
};

// -- Dynamic sections ---------------------------------------------------------

export const workflowStateSection: PromptSection = {
  name: "workflow-state",
  contentFn: (ctx) => {
    const state = ctx.vars["workflowState"];
    return typeof state === "string" ? state : "";
  },
  cacheLifetime: "dynamic",
  priority: 400,
  maxBytes: 8_192,
};

export const sessionMemorySection: PromptSection = {
  name: "session-memory",
  contentFn: (ctx) => {
    const memory = ctx.vars["sessionMemory"];
    return typeof memory === "string" ? memory : "";
  },
  cacheLifetime: "dynamic",
  priority: 350,
  maxBytes: 8_192,
};

export const mcpServerContextSection: PromptSection = {
  name: "mcp-server-context",
  contentFn: (ctx) => {
    const mcp = ctx.vars["mcpServerContext"];
    return typeof mcp === "string" ? mcp : "";
  },
  cacheLifetime: "dynamic",
  priority: 300,
  maxBytes: 8_192,
};

export const conversationSummarySection: PromptSection = {
  name: "conversation-summary",
  contentFn: (ctx) => {
    const summary = ctx.vars["conversationSummary"];
    return typeof summary === "string" ? summary : "";
  },
  cacheLifetime: "dynamic",
  priority: 200,
  maxBytes: 16_384,
};

export const activeHooksSummarySection: PromptSection = {
  name: "active-hooks-summary",
  contentFn: (ctx) => {
    const hooks = ctx.vars["activeHooksSummary"];
    return typeof hooks === "string" ? hooks : "";
  },
  cacheLifetime: "dynamic",
  priority: 150,
  maxBytes: 4_096,
};

export const environmentContextSection: PromptSection = {
  name: "environment-context",
  contentFn: (ctx) => {
    const env = ctx.vars["environmentContext"];
    return typeof env === "string" ? env : "";
  },
  cacheLifetime: "dynamic",
  priority: 100,
  maxBytes: 4_096,
};

/** All default sections in priority order (descending). */
export const DEFAULT_SECTIONS: readonly PromptSection[] = [
  identitySection,
  behavioralRulesSection,
  codingStandardsSection,
  toolRegistrySchemasSection,
  claudeMdSection,
  orchestratorRulesSection,
  baseHookDefsSection,
  workflowStateSection,
  sessionMemorySection,
  mcpServerContextSection,
  conversationSummarySection,
  activeHooksSummarySection,
  environmentContextSection,
];

/**
 * Create a PromptAssembler pre-loaded with the default sections.
 * Callers can then register additional sections or override defaults.
 */
export function createDefaultAssembler(): PromptAssembler {
  const assembler = new PromptAssembler();
  for (const section of DEFAULT_SECTIONS) {
    assembler.registerSection(section);
  }
  return assembler;
}
