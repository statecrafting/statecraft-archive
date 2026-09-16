import type { ConditionLeaf, ConditionNode, Diagnostic } from "./types.js";

interface EvaluationContext {
  payload: Record<string, unknown>;
  filePath?: string;
  ruleId?: string;
}

interface ConditionEvaluationResult {
  matched: boolean;
  diagnostics: Diagnostic[];
}

function makeDiagnostic(
  code: string,
  severity: Diagnostic["severity"],
  message: string,
  filePath?: string,
  ruleId?: string,
): Diagnostic {
  return { code, severity, message, filePath, ruleId };
}

function getPathValue(
  payload: Record<string, unknown>,
  fieldPath: string,
): { found: boolean; value: unknown } {
  const segments = fieldPath.split(".").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return { found: false, value: undefined };
  }

  let cursor: unknown = payload;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return { found: false, value: undefined };
    }
    if (!(segment in (cursor as Record<string, unknown>))) {
      return { found: false, value: undefined };
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return { found: true, value: cursor };
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
  const escaped = escapeRegExp(pattern);
  const regexPattern = `^${escaped.replace(/\\\*/g, ".*").replace(/\\\?/g, ".")}$`;
  return new RegExp(regexPattern);
}

function evaluateLeaf(
  leaf: ConditionLeaf,
  context: EvaluationContext,
): ConditionEvaluationResult {
  const diagnostics: Diagnostic[] = [];
  const valueResult = getPathValue(context.payload, leaf.field);
  if (!valueResult.found) {
    diagnostics.push(
      makeDiagnostic(
        "HKY_FIELD_UNDEFINED",
        "info",
        `Condition field path "${leaf.field}" is undefined in event payload.`,
        context.filePath,
        context.ruleId,
      ),
    );
    return { matched: false, diagnostics };
  }

  const value = valueResult.value;
  if ("==" in leaf) {
    return { matched: value === leaf["=="], diagnostics };
  }
  if ("!=" in leaf) {
    return { matched: value !== leaf["!="], diagnostics };
  }
  if ("contains" in leaf) {
    if (typeof value === "string") {
      return { matched: value.includes(leaf.contains as string), diagnostics };
    }
    if (Array.isArray(value)) {
      return { matched: value.some((item) => item === leaf.contains), diagnostics };
    }
    diagnostics.push(
      makeDiagnostic(
        "HKY_INVALID_CONTAINS_TARGET",
        "warning",
        `contains operator requires a string or array at "${leaf.field}".`,
        context.filePath,
        context.ruleId,
      ),
    );
    return { matched: false, diagnostics };
  }
  if ("matches" in leaf) {
    if (typeof value !== "string") {
      diagnostics.push(
        makeDiagnostic(
          "HKY_INVALID_MATCHES_TARGET",
          "warning",
          `matches operator requires a string at "${leaf.field}".`,
          context.filePath,
          context.ruleId,
        ),
      );
      return { matched: false, diagnostics };
    }
    try {
      const regex = new RegExp(leaf.matches as string);
      return { matched: regex.test(value), diagnostics };
    } catch (error) {
      diagnostics.push(
        makeDiagnostic(
          "HKY_INVALID_REGEX",
          "error",
          `Invalid regex in matches operator: ${String(error)}`,
          context.filePath,
          context.ruleId,
        ),
      );
      return { matched: false, diagnostics };
    }
  }
  if ("glob" in leaf) {
    if (typeof value !== "string") {
      diagnostics.push(
        makeDiagnostic(
          "HKY_INVALID_GLOB_TARGET",
          "warning",
          `glob operator requires a string at "${leaf.field}".`,
          context.filePath,
          context.ruleId,
        ),
      );
      return { matched: false, diagnostics };
    }
    try {
      const regex = globToRegExp(leaf.glob as string);
      return { matched: regex.test(value), diagnostics };
    } catch (error) {
      diagnostics.push(
        makeDiagnostic(
          "HKY_INVALID_GLOB",
          "error",
          `Invalid glob pattern: ${String(error)}`,
          context.filePath,
          context.ruleId,
        ),
      );
      return { matched: false, diagnostics };
    }
  }

  diagnostics.push(
    makeDiagnostic(
      "HKY_UNKNOWN_OPERATOR",
      "error",
      "Condition leaf has no recognized operator.",
      context.filePath,
      context.ruleId,
    ),
  );
  return { matched: false, diagnostics };
}

export function evaluateConditionNode(
  node: ConditionNode,
  context: EvaluationContext,
): ConditionEvaluationResult {
  if ("all" in node) {
    const diagnostics: Diagnostic[] = [];
    for (const child of node.all) {
      const result = evaluateConditionNode(child, context);
      diagnostics.push(...result.diagnostics);
      if (!result.matched) {
        return { matched: false, diagnostics };
      }
    }
    return { matched: true, diagnostics };
  }

  if ("any" in node) {
    const diagnostics: Diagnostic[] = [];
    for (const child of node.any) {
      const result = evaluateConditionNode(child, context);
      diagnostics.push(...result.diagnostics);
      if (result.matched) {
        return { matched: true, diagnostics };
      }
    }
    return { matched: false, diagnostics };
  }

  if ("not" in node) {
    const result = evaluateConditionNode(node.not, context);
    return {
      matched: !result.matched,
      diagnostics: result.diagnostics,
    };
  }

  return evaluateLeaf(node, context);
}
