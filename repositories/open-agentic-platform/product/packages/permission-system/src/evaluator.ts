import { DEFAULT_BYPASS_PATTERNS, DEFAULT_DISALLOWED_PATTERNS } from "./defaults";
import { matchesPermissionPattern, normalizePermissionPattern } from "./pattern";
import type { PermissionPromptHandler } from "./prompt";
import type { PermissionStore } from "./store";
import type { PermissionEvaluationInput, PermissionEvaluationResult } from "./types";

export interface NonInteractivePolicy {
  mode: "deny_all" | "allow_list";
  allowListPatterns?: string[];
}

export interface PermissionEvaluatorOptions {
  store: PermissionStore;
  prompt: PermissionPromptHandler;
  bypassPatterns?: string[];
  disallowedPatterns?: string[];
  nonInteractivePolicy?: NonInteractivePolicy;
}

export interface PermissionEvaluator {
  evaluate(input: PermissionEvaluationInput): Promise<PermissionEvaluationResult>;
}

function asUniquePatterns(patterns: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const pattern of patterns) {
    const canonical = normalizePermissionPattern(pattern);
    if (!seen.has(canonical)) {
      seen.add(canonical);
      normalized.push(canonical);
    }
  }
  return normalized;
}

function findMatchingPattern(
  patterns: readonly string[],
  toolName: string,
  argument: string,
): string | undefined {
  return patterns.find((pattern) =>
    matchesPermissionPattern(pattern, { toolName, argument }),
  );
}

function evaluateNonInteractive(
  policy: NonInteractivePolicy,
  toolName: string,
  argument: string,
): PermissionEvaluationResult {
  if (policy.mode === "allow_list") {
    const allowList = asUniquePatterns(policy.allowListPatterns ?? []);
    const matched = findMatchingPattern(allowList, toolName, argument);
    if (matched) {
      return {
        decision: "allow",
        source: "non_interactive",
        matchedPattern: matched,
        rationale: "Non-interactive allow-list matched invocation",
      };
    }
  }

  return {
    decision: "deny",
    source: "non_interactive",
    rationale: "Non-interactive policy denied invocation",
  };
}

export function createPermissionEvaluator(
  options: PermissionEvaluatorOptions,
): PermissionEvaluator {
  const bypassPatterns = asUniquePatterns([
    ...DEFAULT_BYPASS_PATTERNS,
    ...(options.bypassPatterns ?? []),
  ]);
  const defaultDisallowedPatterns = asUniquePatterns([
    ...DEFAULT_DISALLOWED_PATTERNS,
    ...(options.disallowedPatterns ?? []),
  ]);
  const nonInteractivePolicy = options.nonInteractivePolicy ?? { mode: "deny_all" };

  return {
    async evaluate(input) {
      if (!input.isInteractive) {
        return evaluateNonInteractive(nonInteractivePolicy, input.toolName, input.argument);
      }

      const bypassMatch = findMatchingPattern(
        bypassPatterns,
        input.toolName,
        input.argument,
      );
      if (bypassMatch) {
        return {
          decision: "allow",
          source: "bypass",
          matchedPattern: bypassMatch,
          rationale: "Bypass pattern matched invocation",
        };
      }

      const entries = await options.store.list();
      const rememberedAllows = entries
        .filter((entry) => entry.decision === "allow")
        .map((entry) => normalizePermissionPattern(entry.pattern));
      const rememberedDenies = entries
        .filter((entry) => entry.decision === "deny")
        .map((entry) => normalizePermissionPattern(entry.pattern));

      const disallowedPatterns = asUniquePatterns([
        ...defaultDisallowedPatterns,
        ...rememberedDenies,
      ]);
      const disallowedMatch = findMatchingPattern(
        disallowedPatterns,
        input.toolName,
        input.argument,
      );
      if (disallowedMatch) {
        return {
          decision: "deny",
          source: "disallowed",
          matchedPattern: disallowedMatch,
          rationale: "Disallowed pattern takes precedence",
        };
      }

      const rememberedMatch = findMatchingPattern(
        rememberedAllows,
        input.toolName,
        input.argument,
      );
      if (rememberedMatch) {
        return {
          decision: "allow",
          source: "remembered",
          matchedPattern: rememberedMatch,
          rationale: "Stored allow permission matched invocation",
        };
      }

      const suggestedPattern = `${input.toolName}(${input.argument})`;
      const response = await options.prompt({
        toolName: input.toolName,
        argument: input.argument,
        suggestedPattern,
      });

      if (response.choice === "allow_once") {
        return {
          decision: "allow",
          source: "prompt",
          matchedPattern: suggestedPattern,
          rationale: "User allowed this invocation once",
        };
      }

      if (response.choice === "allow_remember") {
        const pattern = normalizePermissionPattern(response.pattern ?? suggestedPattern);
        await options.store.upsert({
          tool: input.toolName,
          pattern,
          decision: "allow",
          scope: response.scope ?? "project",
          createdAt: input.nowIso,
        });
        return {
          decision: "allow",
          source: "prompt",
          matchedPattern: pattern,
          rationale: "User allowed invocation and remembered permission",
        };
      }

      return {
        decision: "deny",
        source: "prompt",
        matchedPattern: normalizePermissionPattern(response.pattern ?? suggestedPattern),
        rationale: "User denied invocation at prompt",
      };
    },
  };
}
