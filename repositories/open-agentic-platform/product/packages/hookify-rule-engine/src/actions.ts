import type {
  ActionExecutionResult,
  Diagnostic,
  ModifyTransform,
  Rule,
} from "./types.js";

interface ExecuteRuleActionInput {
  rule: Rule;
  payload: Record<string, unknown>;
  warnings?: string[];
  matchedRuleIds?: string[];
}

function makeDiagnostic(
  code: string,
  severity: Diagnostic["severity"],
  message: string,
  rule: Rule,
): Diagnostic {
  return {
    code,
    severity,
    message,
    filePath: rule.sourcePath,
    ruleId: rule.id,
  };
}

function clonePayload(payload: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(payload);
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

function setPathValue(
  payload: Record<string, unknown>,
  fieldPath: string,
  value: unknown,
): boolean {
  const segments = fieldPath.split(".").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return false;
  }

  let cursor: Record<string, unknown> = payload;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const current = cursor[segment];
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }

  cursor[segments[segments.length - 1]] = value;
  return true;
}

function applyAppendArg(
  payload: Record<string, unknown>,
  transform: ModifyTransform,
  rule: Rule,
): { applied: boolean; diagnostics: Diagnostic[] } {
  const field = transform.field;
  const value = transform.value;
  if (typeof field !== "string" || typeof value !== "string") {
    return {
      applied: false,
      diagnostics: [
        makeDiagnostic(
          "HKY_INVALID_TRANSFORM_APPEND_ARG",
          "error",
          "append_arg requires string field and string value.",
          rule,
        ),
      ],
    };
  }

  const target = getPathValue(payload, field);
  if (!target.found || typeof target.value !== "string") {
    return {
      applied: false,
      diagnostics: [
        makeDiagnostic(
          "HKY_INVALID_TRANSFORM_TARGET",
          "error",
          `append_arg target "${field}" must be an existing string field.`,
          rule,
        ),
      ],
    };
  }

  const separator = target.value.trim().length === 0 ? "" : " ";
  setPathValue(payload, field, `${target.value}${separator}${value}`);
  return { applied: true, diagnostics: [] };
}

function applyReplaceRegex(
  payload: Record<string, unknown>,
  transform: ModifyTransform,
  rule: Rule,
): { applied: boolean; diagnostics: Diagnostic[] } {
  const field = transform.field;
  const pattern = transform.pattern;
  const replacement = transform.replacement;
  const flags = transform.flags;

  if (
    typeof field !== "string" ||
    typeof pattern !== "string" ||
    typeof replacement !== "string" ||
    (flags !== undefined && typeof flags !== "string")
  ) {
    return {
      applied: false,
      diagnostics: [
        makeDiagnostic(
          "HKY_INVALID_TRANSFORM_REPLACE_REGEX",
          "error",
          "replace_regex requires string field, pattern, replacement, and optional string flags.",
          rule,
        ),
      ],
    };
  }

  const target = getPathValue(payload, field);
  if (!target.found || typeof target.value !== "string") {
    return {
      applied: false,
      diagnostics: [
        makeDiagnostic(
          "HKY_INVALID_TRANSFORM_TARGET",
          "error",
          `replace_regex target "${field}" must be an existing string field.`,
          rule,
        ),
      ],
    };
  }

  try {
    const regex = new RegExp(pattern, flags);
    setPathValue(payload, field, target.value.replace(regex, replacement));
    return { applied: true, diagnostics: [] };
  } catch (error) {
    return {
      applied: false,
      diagnostics: [
        makeDiagnostic(
          "HKY_INVALID_TRANSFORM_REGEX",
          "error",
          `Invalid replace_regex pattern: ${String(error)}`,
          rule,
        ),
      ],
    };
  }
}

function applySetField(
  payload: Record<string, unknown>,
  transform: ModifyTransform,
  rule: Rule,
): { applied: boolean; diagnostics: Diagnostic[] } {
  const field = transform.field;
  if (typeof field !== "string") {
    return {
      applied: false,
      diagnostics: [
        makeDiagnostic(
          "HKY_INVALID_TRANSFORM_SET_FIELD",
          "error",
          "set_field requires a string field path.",
          rule,
        ),
      ],
    };
  }

  if (!("value" in transform)) {
    return {
      applied: false,
      diagnostics: [
        makeDiagnostic(
          "HKY_INVALID_TRANSFORM_SET_FIELD",
          "error",
          "set_field requires a value property.",
          rule,
        ),
      ],
    };
  }

  const ok = setPathValue(payload, field, transform.value);
  return ok
    ? { applied: true, diagnostics: [] }
    : {
        applied: false,
        diagnostics: [
          makeDiagnostic(
            "HKY_INVALID_TRANSFORM_SET_FIELD",
            "error",
            "set_field target path cannot be empty.",
            rule,
          ),
        ],
      };
}

function applyModifyTransform(
  payload: Record<string, unknown>,
  transform: ModifyTransform | undefined,
  rule: Rule,
): { payload: Record<string, unknown>; applied: boolean; diagnostics: Diagnostic[] } {
  if (!transform || typeof transform.type !== "string") {
    return {
      payload,
      applied: false,
      diagnostics: [
        makeDiagnostic(
          "HKY_INVALID_TRANSFORM",
          "error",
          "modify action requires action.transform with a valid type.",
          rule,
        ),
      ],
    };
  }

  if (transform.type === "append_arg") {
    const result = applyAppendArg(payload, transform, rule);
    return { payload, applied: result.applied, diagnostics: result.diagnostics };
  }
  if (transform.type === "replace_regex") {
    const result = applyReplaceRegex(payload, transform, rule);
    return { payload, applied: result.applied, diagnostics: result.diagnostics };
  }
  if (transform.type === "set_field") {
    const result = applySetField(payload, transform, rule);
    return { payload, applied: result.applied, diagnostics: result.diagnostics };
  }

  return {
    payload,
    applied: false,
    diagnostics: [
      makeDiagnostic(
        "HKY_UNKNOWN_TRANSFORM",
        "error",
        `Unsupported modify transform type: ${transform.type}`,
        rule,
      ),
    ],
  };
}

export function executeRuleAction(input: ExecuteRuleActionInput): ActionExecutionResult {
  const warnings = [...(input.warnings ?? [])];
  const matchedRuleIds = [...(input.matchedRuleIds ?? [])];
  const payload = clonePayload(input.payload);
  const diagnostics: Diagnostic[] = [];
  const rationale = input.rule.rationale.trim();

  if (input.rule.action.type === "block") {
    matchedRuleIds.push(input.rule.id);
    return {
      payload,
      warnings,
      diagnostics,
      terminalDecision: "blocked",
      matchedRuleIds,
      blockedByRuleId: input.rule.id,
    };
  }

  if (input.rule.action.type === "warn") {
    matchedRuleIds.push(input.rule.id);
    warnings.push(rationale);
    return {
      payload,
      warnings,
      diagnostics,
      terminalDecision: "allowed",
      matchedRuleIds,
    };
  }

  const modified = applyModifyTransform(payload, input.rule.action.transform, input.rule);
  diagnostics.push(...modified.diagnostics);
  if (modified.applied) {
    matchedRuleIds.push(input.rule.id);
  }
  return {
    payload: modified.payload,
    warnings,
    diagnostics,
    terminalDecision: "allowed",
    matchedRuleIds,
  };
}
