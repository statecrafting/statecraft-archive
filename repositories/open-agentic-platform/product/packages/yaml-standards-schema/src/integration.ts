import type { CodingStandard, StandardRule, AntiPattern } from "./types.js";
import type { StandardsFilter, ResolveResult } from "./resolver.js";
import type { LoadResult } from "./loader.js";
import { loadAllTiers } from "./loader.js";
import { resolveStandards } from "./resolver.js";

// --- Types ---

/** Options for formatting standards into prompt text. */
export interface FormatOptions {
  /** Include anti-patterns in output (default: true). */
  includeAntiPatterns?: boolean;
  /** Include examples in output (default: false — saves tokens). */
  includeExamples?: boolean;
  /** Maximum number of standards to include (default: unlimited). */
  maxStandards?: number;
  /** Priority order for sorting: higher-priority standards appear first (default: true). */
  sortByPriority?: boolean;
}

/** Options for the high-level integration function. */
export interface IntegrationOptions {
  /** Project root containing standards/ directories. */
  projectRoot: string;
  /** Optional override for community tier path. */
  communityPath?: string;
  /** Category/tag filter passed to the resolver. */
  filter?: StandardsFilter;
  /** Formatting options for prompt text. */
  format?: FormatOptions;
}

/** Result of the integration function. */
export interface IntegrationResult {
  /** Formatted prompt text ready for injection into system prompts. */
  promptText: string;
  /** Number of standards included. */
  standardCount: number;
  /** IDs of standards included (for traceability). */
  standardIds: string[];
}

// --- Priority ordering ---

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// --- Formatting ---

function formatRule(rule: StandardRule): string {
  return `- ${rule.verb}: ${rule.subject}\n  Rationale: ${rule.rationale}`;
}

function formatAntiPattern(ap: AntiPattern): string {
  return `- Avoid: \`${ap.pattern}\`\n  Use instead: \`${ap.correction}\``;
}

function formatStandard(
  standard: CodingStandard,
  options: FormatOptions,
): string {
  const lines: string[] = [];

  lines.push(`### ${standard.id} [${standard.priority}]`);
  lines.push(`Category: ${standard.category}`);
  if (standard.context) {
    lines.push(`Context: ${standard.context}`);
  }

  lines.push("");
  lines.push("**Rules:**");
  for (const rule of standard.rules) {
    lines.push(formatRule(rule));
  }

  if (
    options.includeAntiPatterns !== false &&
    standard.anti_patterns &&
    standard.anti_patterns.length > 0
  ) {
    lines.push("");
    lines.push("**Anti-patterns:**");
    for (const ap of standard.anti_patterns) {
      lines.push(formatAntiPattern(ap));
    }
  }

  if (
    options.includeExamples &&
    standard.examples &&
    standard.examples.length > 0
  ) {
    lines.push("");
    lines.push("**Examples:**");
    for (const ex of standard.examples) {
      lines.push(`- Bad: \`${ex.bad.trim()}\``);
      lines.push(`  Good: \`${ex.good.trim()}\``);
      lines.push(`  Why: ${ex.explanation}`);
    }
  }

  return lines.join("\n");
}

/**
 * Sort standards by priority (critical first) then by id for determinism.
 */
function sortStandards(
  standards: CodingStandard[],
  sortByPriority: boolean,
): CodingStandard[] {
  return [...standards].sort((a, b) => {
    if (sortByPriority) {
      const pa = PRIORITY_ORDER[a.priority] ?? 99;
      const pb = PRIORITY_ORDER[b.priority] ?? 99;
      if (pa !== pb) return pa - pb;
    }
    return a.id.localeCompare(b.id);
  });
}

/**
 * Format a resolved set of standards into a prompt-ready text block.
 *
 * The output is a Markdown section suitable for appending to an agent's
 * system prompt. Standards are grouped by priority (critical first) and
 * each standard's rules, anti-patterns, and optionally examples are
 * included. The text is designed to be concise to minimize context window
 * usage (R-003 mitigation).
 */
export function formatStandardsForPrompt(
  resolved: ResolveResult,
  options: FormatOptions = {},
): IntegrationResult {
  const {
    includeAntiPatterns = true,
    includeExamples = false,
    maxStandards,
    sortByPriority = true,
  } = options;

  let standards = Array.from(resolved.standards.values());
  standards = sortStandards(standards, sortByPriority);

  if (maxStandards !== undefined && maxStandards >= 0) {
    standards = standards.slice(0, maxStandards);
  }

  if (standards.length === 0) {
    return {
      promptText: "",
      standardCount: 0,
      standardIds: [],
    };
  }

  const formatOpts: FormatOptions = {
    includeAntiPatterns,
    includeExamples,
  };

  const sections = standards.map((s) => formatStandard(s, formatOpts));

  const promptText = [
    "## Applicable Coding Standards",
    "",
    `The following ${standards.length} coding standard${standards.length === 1 ? " applies" : "s apply"} to this task. Follow these rules when generating or reviewing code.`,
    "",
    ...sections.flatMap((s, i) => (i > 0 ? ["", "---", "", s] : [s])),
  ].join("\n");

  return {
    promptText,
    standardCount: standards.length,
    standardIds: standards.map((s) => s.id),
  };
}

/**
 * High-level integration: load standards, resolve with filters, and format
 * for prompt injection. This is the primary entry point for wiring standards
 * into agent system prompts (Phase 6).
 *
 * @example
 * ```ts
 * const result = await resolveAndFormat({
 *   projectRoot: "/path/to/project",
 *   filter: { tags: ["typescript"] },
 * });
 * const systemPrompt = `${agentBody}\n\n${result.promptText}`;
 * ```
 */
export async function resolveAndFormat(
  options: IntegrationOptions,
): Promise<IntegrationResult> {
  const loadResult: LoadResult = await loadAllTiers(
    options.projectRoot,
    options.communityPath,
  );

  const resolved = resolveStandards(loadResult.tiers, options.filter);

  return formatStandardsForPrompt(resolved, options.format);
}

/**
 * Compose a final system prompt by appending applicable standards to an
 * agent's base prompt. Returns the original prompt unchanged if no standards
 * match the filter.
 */
export async function composeSystemPrompt(
  basePrompt: string,
  options: IntegrationOptions,
): Promise<{ prompt: string; integration: IntegrationResult }> {
  const integration = await resolveAndFormat(options);

  if (integration.standardCount === 0) {
    return { prompt: basePrompt, integration };
  }

  const prompt = `${basePrompt}\n\n${integration.promptText}`;
  return { prompt, integration };
}
