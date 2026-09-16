import type {
  RuleVerb,
  StandardDiagnostic,
  StandardPriority,
  StandardStatus,
} from "./types.js";

const VALID_VERBS: ReadonlySet<RuleVerb> = new Set([
  "ALWAYS",
  "NEVER",
  "USE",
  "PREFER",
  "AVOID",
]);

const VALID_PRIORITIES: ReadonlySet<StandardPriority> = new Set([
  "critical",
  "high",
  "medium",
  "low",
]);

const VALID_STATUSES: ReadonlySet<StandardStatus> = new Set([
  "active",
  "candidate",
  "rejected",
]);

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function diag(
  code: string,
  message: string,
  filePath: string,
  line?: number,
  column?: number,
): StandardDiagnostic {
  return { code, severity: "error", message, filePath, line, column };
}

/**
 * Validate a parsed YAML object as a coding standard (FR-001, FR-002, FR-003).
 * Returns diagnostics for any schema violations.
 */
export function validateStandardObject(
  obj: Record<string, unknown>,
  filePath: string,
): StandardDiagnostic[] {
  const diagnostics: StandardDiagnostic[] = [];

  // id — required, kebab-case string
  if (typeof obj.id !== "string" || obj.id.trim().length === 0) {
    diagnostics.push(
      diag("CS_MISSING_ID", "Standard must have a non-empty 'id' string.", filePath),
    );
  } else if (!KEBAB_CASE.test(obj.id)) {
    diagnostics.push(
      diag("CS_BAD_ID", `Standard 'id' must be kebab-case. Got: "${obj.id}".`, filePath),
    );
  }

  // category — required string
  if (typeof obj.category !== "string" || obj.category.trim().length === 0) {
    diagnostics.push(
      diag("CS_MISSING_CATEGORY", "Standard must have a non-empty 'category' string.", filePath),
    );
  }

  // priority — required enum
  if (
    typeof obj.priority !== "string" ||
    !VALID_PRIORITIES.has(obj.priority as StandardPriority)
  ) {
    diagnostics.push(
      diag(
        "CS_BAD_PRIORITY",
        `Standard 'priority' must be one of: ${[...VALID_PRIORITIES].join(", ")}. Got: ${JSON.stringify(obj.priority)}.`,
        filePath,
      ),
    );
  }

  // status — optional, defaults to "active", must be valid if present
  if (obj.status !== undefined) {
    if (
      typeof obj.status !== "string" ||
      !VALID_STATUSES.has(obj.status as StandardStatus)
    ) {
      diagnostics.push(
        diag(
          "CS_BAD_STATUS",
          `Standard 'status' must be one of: ${[...VALID_STATUSES].join(", ")}. Got: ${JSON.stringify(obj.status)}.`,
          filePath,
        ),
      );
    }
  }

  // context — optional string
  if (obj.context !== undefined && typeof obj.context !== "string") {
    diagnostics.push(
      diag("CS_BAD_CONTEXT", "Standard 'context' must be a string when provided.", filePath),
    );
  }

  // tags — optional string array
  if (obj.tags !== undefined) {
    if (!Array.isArray(obj.tags)) {
      diagnostics.push(
        diag("CS_BAD_TAGS", "Standard 'tags' must be an array of strings when provided.", filePath),
      );
    } else {
      for (let i = 0; i < obj.tags.length; i++) {
        if (typeof obj.tags[i] !== "string") {
          diagnostics.push(
            diag("CS_BAD_TAG_ENTRY", `Standard 'tags[${i}]' must be a string.`, filePath),
          );
        }
      }
    }
  }

  // rules — required, non-empty array
  if (!Array.isArray(obj.rules)) {
    diagnostics.push(
      diag("CS_MISSING_RULES", "Standard must have a 'rules' array.", filePath),
    );
  } else {
    if (obj.rules.length === 0) {
      diagnostics.push(
        diag("CS_EMPTY_RULES", "Standard 'rules' array must not be empty.", filePath),
      );
    }
    for (let i = 0; i < obj.rules.length; i++) {
      const rule = obj.rules[i];
      if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
        diagnostics.push(
          diag("CS_BAD_RULE", `Standard 'rules[${i}]' must be an object.`, filePath),
        );
        continue;
      }
      validateRuleObject(rule as Record<string, unknown>, i, filePath, diagnostics);
    }
  }

  // anti_patterns — optional array
  if (obj.anti_patterns !== undefined) {
    if (!Array.isArray(obj.anti_patterns)) {
      diagnostics.push(
        diag("CS_BAD_ANTI_PATTERNS", "Standard 'anti_patterns' must be an array when provided.", filePath),
      );
    } else {
      for (let i = 0; i < obj.anti_patterns.length; i++) {
        const ap = obj.anti_patterns[i];
        if (typeof ap !== "object" || ap === null || Array.isArray(ap)) {
          diagnostics.push(
            diag("CS_BAD_ANTI_PATTERN", `Standard 'anti_patterns[${i}]' must be an object.`, filePath),
          );
          continue;
        }
        validateAntiPatternObject(ap as Record<string, unknown>, i, filePath, diagnostics);
      }
    }
  }

  // examples — optional array
  if (obj.examples !== undefined) {
    if (!Array.isArray(obj.examples)) {
      diagnostics.push(
        diag("CS_BAD_EXAMPLES", "Standard 'examples' must be an array when provided.", filePath),
      );
    } else {
      for (let i = 0; i < obj.examples.length; i++) {
        const ex = obj.examples[i];
        if (typeof ex !== "object" || ex === null || Array.isArray(ex)) {
          diagnostics.push(
            diag("CS_BAD_EXAMPLE", `Standard 'examples[${i}]' must be an object.`, filePath),
          );
          continue;
        }
        validateExampleObject(ex as Record<string, unknown>, i, filePath, diagnostics);
      }
    }
  }

  return diagnostics;
}

function validateRuleObject(
  rule: Record<string, unknown>,
  index: number,
  filePath: string,
  diagnostics: StandardDiagnostic[],
): void {
  if (typeof rule.verb !== "string" || !VALID_VERBS.has(rule.verb as RuleVerb)) {
    diagnostics.push(
      diag(
        "CS_RULE_BAD_VERB",
        `Rule ${index} 'verb' must be one of: ${[...VALID_VERBS].join(", ")}. Got: ${JSON.stringify(rule.verb)}.`,
        filePath,
      ),
    );
  }

  if (typeof rule.subject !== "string" || rule.subject.trim().length === 0) {
    diagnostics.push(
      diag("CS_RULE_MISSING_SUBJECT", `Rule ${index} must have a non-empty 'subject' string.`, filePath),
    );
  }

  if (typeof rule.rationale !== "string" || rule.rationale.trim().length === 0) {
    diagnostics.push(
      diag("CS_RULE_MISSING_RATIONALE", `Rule ${index} must have a non-empty 'rationale' string.`, filePath),
    );
  }
}

function validateAntiPatternObject(
  ap: Record<string, unknown>,
  index: number,
  filePath: string,
  diagnostics: StandardDiagnostic[],
): void {
  if (typeof ap.pattern !== "string" || ap.pattern.trim().length === 0) {
    diagnostics.push(
      diag("CS_ANTI_PATTERN_MISSING_PATTERN", `Anti-pattern ${index} must have a non-empty 'pattern' string.`, filePath),
    );
  }

  if (typeof ap.correction !== "string" || ap.correction.trim().length === 0) {
    diagnostics.push(
      diag("CS_ANTI_PATTERN_MISSING_CORRECTION", `Anti-pattern ${index} must have a non-empty 'correction' string.`, filePath),
    );
  }
}

function validateExampleObject(
  ex: Record<string, unknown>,
  index: number,
  filePath: string,
  diagnostics: StandardDiagnostic[],
): void {
  if (typeof ex.good !== "string" || ex.good.trim().length === 0) {
    diagnostics.push(
      diag("CS_EXAMPLE_MISSING_GOOD", `Example ${index} must have a non-empty 'good' string.`, filePath),
    );
  }

  if (typeof ex.bad !== "string" || ex.bad.trim().length === 0) {
    diagnostics.push(
      diag("CS_EXAMPLE_MISSING_BAD", `Example ${index} must have a non-empty 'bad' string.`, filePath),
    );
  }

  if (typeof ex.explanation !== "string" || ex.explanation.trim().length === 0) {
    diagnostics.push(
      diag("CS_EXAMPLE_MISSING_EXPLANATION", `Example ${index} must have a non-empty 'explanation' string.`, filePath),
    );
  }
}
