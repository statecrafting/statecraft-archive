import { stringify } from "yaml";
import type { CodingStandard, RuleVerb, StandardPriority } from "./types.js";

// --- Finding input types (FR-006) ---

/** Source tool that produced the finding. */
export type FindingSource = "lint" | "review" | "test" | "security" | "custom";

/** A single execution finding from a linter, test runner, or code review tool. */
export interface ExecutionFinding {
  /** Short rule or check identifier (e.g., "no-empty-catch", "sql-injection"). */
  ruleId: string;
  /** Human-readable description of the issue. */
  message: string;
  /** Category hint (e.g., "error-handling", "security"). Falls back to ruleId prefix if absent. */
  category?: string;
  /** Source tool kind. */
  source: FindingSource;
  /** File where the finding was reported. */
  filePath?: string;
  /** The offending code snippet, used to derive anti-patterns. */
  snippet?: string;
  /** Optional suggested fix, used to derive anti-pattern corrections. */
  fix?: string;
}

// --- Aggregator types ---

/** Aggregated group of findings sharing the same category + ruleId. */
export interface AggregatedFinding {
  /** Normalized rule identifier. */
  ruleId: string;
  /** Resolved category. */
  category: string;
  /** How many times this finding appeared. */
  count: number;
  /** Unique source types that reported this finding. */
  sources: Set<FindingSource>;
  /** Representative messages (deduplicated, max 5). */
  messages: string[];
  /** Collected snippets for anti-pattern derivation (max 3). */
  snippets: Array<{ pattern: string; correction?: string }>;
}

/** Result of the aggregation step. */
export interface AggregateResult {
  /** Findings grouped by "category::ruleId", sorted by frequency descending. */
  groups: AggregatedFinding[];
  /** Total findings processed. */
  totalFindings: number;
}

// --- Candidate generator types ---

/** Options for candidate generation. */
export interface GenerateCandidateOptions {
  /** Minimum finding count to produce a candidate. Default: 2. */
  minFrequency?: number;
  /** Maximum number of candidates to generate. Default: 10. */
  maxCandidates?: number;
}

/** A generated candidate standard ready for human review. */
export interface GeneratedCandidate {
  /** The candidate standard object (status: candidate). */
  standard: CodingStandard;
  /** YAML text serialization of the candidate. */
  yaml: string;
  /** Suggested file name for `standards/candidates/`. */
  fileName: string;
  /** Number of findings that contributed to this candidate. */
  findingCount: number;
}

/** Result of the candidate generation step. */
export interface GenerateCandidatesResult {
  candidates: GeneratedCandidate[];
  /** Findings that did not meet the frequency threshold. */
  skippedCount: number;
}

// --- Implementation ---

const MAX_MESSAGES = 5;
const MAX_SNIPPETS = 3;

/**
 * Normalize a rule ID to kebab-case for use as a standard ID component.
 */
function toKebab(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/**
 * Derive a category from a finding. Uses explicit category if provided,
 * otherwise extracts a prefix from the ruleId (e.g., "no-empty-catch" → "error-handling" is not derivable,
 * so falls back to "general").
 */
function resolveCategory(finding: ExecutionFinding): string {
  if (finding.category) return toKebab(finding.category);
  // Use source as a rough category fallback
  switch (finding.source) {
    case "security":
      return "security";
    case "test":
      return "testing";
    case "lint":
      return "code-quality";
    case "review":
      return "code-quality";
    default:
      return "general";
  }
}

/**
 * Group key for aggregation: "category::ruleId".
 */
function groupKey(category: string, ruleId: string): string {
  return `${category}::${ruleId}`;
}

/**
 * Aggregate execution findings by category and ruleId, counting frequency (FR-006).
 *
 * Groups findings that share the same resolved category and ruleId,
 * counts occurrences, and sorts by frequency descending. High-frequency
 * findings are prioritized per R-002 mitigation.
 */
export function aggregateFindings(findings: ExecutionFinding[]): AggregateResult {
  const groups = new Map<string, AggregatedFinding>();

  for (const finding of findings) {
    const category = resolveCategory(finding);
    const ruleId = toKebab(finding.ruleId);
    const key = groupKey(category, ruleId);

    let group = groups.get(key);
    if (!group) {
      group = {
        ruleId,
        category,
        count: 0,
        sources: new Set(),
        messages: [],
        snippets: [],
      };
      groups.set(key, group);
    }

    group.count++;
    group.sources.add(finding.source);

    // Deduplicate messages, cap at MAX_MESSAGES
    if (
      group.messages.length < MAX_MESSAGES &&
      !group.messages.includes(finding.message)
    ) {
      group.messages.push(finding.message);
    }

    // Collect snippets for anti-pattern derivation
    if (finding.snippet && group.snippets.length < MAX_SNIPPETS) {
      group.snippets.push({
        pattern: finding.snippet,
        correction: finding.fix,
      });
    }
  }

  // Sort by frequency descending (R-002: prioritize high-frequency findings)
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count);

  return { groups: sorted, totalFindings: findings.length };
}

/**
 * Map finding frequency to a priority level.
 */
function frequencyToPriority(count: number): StandardPriority {
  if (count >= 10) return "critical";
  if (count >= 5) return "high";
  if (count >= 3) return "medium";
  return "low";
}

/**
 * Infer a rule verb from the finding's ruleId and messages.
 */
function inferVerb(ruleId: string, messages: string[]): RuleVerb {
  const combined = `${ruleId} ${messages.join(" ")}`.toLowerCase();
  if (combined.includes("never") || combined.includes("forbid") || combined.includes("prohibit")) return "NEVER";
  if (combined.includes("always") || combined.includes("must") || combined.includes("require")) return "ALWAYS";
  if (combined.includes("prefer")) return "PREFER";
  if (combined.includes("avoid") || combined.includes("discourage")) return "AVOID";
  // Default: if the ruleId starts with "no-" it's a NEVER rule
  if (ruleId.startsWith("no-")) return "NEVER";
  return "AVOID";
}

/**
 * Build a candidate standard id: "category-NNN" using a sequence number.
 */
function candidateId(category: string, seq: number): string {
  return `${category}-${String(seq).padStart(3, "0")}`;
}

/**
 * Generate candidate standard YAML files from aggregated findings (FR-006, FR-007).
 *
 * Filters groups by minimum frequency, maps each to a candidate `CodingStandard`
 * with `status: candidate`, derives rules from messages and anti-patterns from
 * code snippets, and serializes to YAML. Produces at most `maxCandidates` results.
 *
 * @returns Generated candidates plus a count of skipped low-frequency groups.
 */
export function generateCandidates(
  aggregated: AggregateResult,
  options?: GenerateCandidateOptions,
): GenerateCandidatesResult {
  const minFrequency = options?.minFrequency ?? 2;
  const maxCandidates = options?.maxCandidates ?? 10;

  const candidates: GeneratedCandidate[] = [];
  let skippedCount = 0;

  // Track sequence numbers per category for candidate IDs
  const seqByCategory = new Map<string, number>();

  for (const group of aggregated.groups) {
    if (candidates.length >= maxCandidates) break;

    if (group.count < minFrequency) {
      skippedCount++;
      continue;
    }

    const seq = (seqByCategory.get(group.category) ?? 0) + 1;
    seqByCategory.set(group.category, seq);

    const id = candidateId(group.category, seq);
    const verb = inferVerb(group.ruleId, group.messages);

    // Build rules from the finding group
    const rules = [
      {
        verb,
        subject: group.ruleId.replace(/-/g, " "),
        rationale: group.messages[0] ?? `Detected ${group.count} times across codebase.`,
      },
    ];

    // Build anti-patterns from collected snippets
    const anti_patterns =
      group.snippets.length > 0
        ? group.snippets
            .filter((s) => s.correction)
            .map((s) => ({
              pattern: s.pattern,
              correction: s.correction!,
            }))
        : undefined;

    // Build tags from sources
    const tags = [...group.sources] as string[];

    const standard: CodingStandard = {
      id,
      category: group.category,
      priority: frequencyToPriority(group.count),
      status: "candidate",
      context: `Auto-generated from ${group.count} execution findings (rule: ${group.ruleId}).`,
      tags: tags.length > 0 ? tags : undefined,
      rules,
      anti_patterns: anti_patterns && anti_patterns.length > 0 ? anti_patterns : undefined,
    };

    const yaml = stringify(standard, { lineWidth: 100 });
    const fileName = `${id}.yaml`;

    candidates.push({ standard, yaml, fileName, findingCount: group.count });
  }

  return { candidates, skippedCount };
}

/**
 * End-to-end pipeline: aggregate findings, then generate candidate standards (FR-006, FR-007, SC-004).
 *
 * @param findings — raw execution findings from linters, test runners, etc.
 * @param options — generation options (minFrequency, maxCandidates)
 * @returns Generated candidate standards ready for human review
 */
export function runContributorPipeline(
  findings: ExecutionFinding[],
  options?: GenerateCandidateOptions,
): GenerateCandidatesResult {
  const aggregated = aggregateFindings(findings);
  return generateCandidates(aggregated, options);
}
