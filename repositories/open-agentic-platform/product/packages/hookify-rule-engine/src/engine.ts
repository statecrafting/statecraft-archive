import { executeRuleAction } from "./actions.js";
import { evaluateConditionNode } from "./conditions.js";
import { matchesRuleEventType, matchesRuleMatcher } from "./matcher.js";
import type { Diagnostic, EvaluationResult, HookEvent, Rule } from "./types.js";

function compareRulesForEvaluationOrder(a: Rule, b: Rule): number {
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }
  const idCmp = a.id.localeCompare(b.id);
  if (idCmp !== 0) {
    return idCmp;
  }
  return a.sourcePath.localeCompare(b.sourcePath);
}

export interface EvaluateInput {
  rules: Rule[];
  event: HookEvent;
}

/**
 * Priority-ordered rule evaluation: filter by event type, sort by priority (ascending),
 * tie-break by rule id then source path. For each rule, match on current payload state,
 * evaluate conditions, then execute action. Short-circuits when a rule blocks.
 */
export function evaluate(input: EvaluateInput): EvaluationResult {
  const { rules, event } = input;
  const applicable = rules.filter((rule) => matchesRuleEventType(rule.event, event));
  const ordered = [...applicable].sort(compareRulesForEvaluationOrder);

  let payload: Record<string, unknown> = structuredClone(event.payload);
  let warnings: string[] = [];
  let matchedRuleIds: string[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const rule of ordered) {
    const hookEvent: HookEvent = { type: event.type, payload };

    if (!matchesRuleMatcher(rule.matcher, hookEvent)) {
      continue;
    }

    const conditionResult = evaluateConditionNode(rule.conditions, {
      payload,
      filePath: rule.sourcePath,
      ruleId: rule.id,
    });
    diagnostics.push(...conditionResult.diagnostics);

    if (!conditionResult.matched) {
      continue;
    }

    const actionResult = executeRuleAction({
      rule,
      payload,
      warnings,
      matchedRuleIds,
    });

    payload = actionResult.payload;
    warnings = actionResult.warnings;
    matchedRuleIds = actionResult.matchedRuleIds;
    diagnostics.push(...actionResult.diagnostics);

    if (actionResult.terminalDecision === "blocked") {
      return {
        allowed: false,
        blockedByRuleId: actionResult.blockedByRuleId,
        blockRationale: rule.rationale.trim(),
        warnings,
        diagnostics,
        payload,
        terminalDecision: "blocked",
        matchedRuleIds,
      };
    }
  }

  return {
    allowed: true,
    warnings,
    diagnostics,
    payload,
    terminalDecision: "allowed",
    matchedRuleIds,
  };
}
