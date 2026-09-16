import { parse as parseYaml } from "yaml";
import type {
  Action,
  ConditionLeaf,
  ConditionNode,
  Diagnostic,
  HookEventType,
  Matcher,
  ParseRuleResult,
  Rule,
} from "./types.js";

const SUPPORTED_EVENTS: ReadonlySet<HookEventType> = new Set([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "SessionStart",
  "SessionStop",
  "FileChanged",
]);

const SUPPORTED_ACTIONS = new Set(["block", "warn", "modify"]);

interface FrontmatterParseResult {
  frontmatter: Record<string, unknown> | null;
  rationale: string;
  diagnostics: Diagnostic[];
}

function makeDiagnostic(
  code: string,
  message: string,
  filePath: string,
  ruleId?: string,
): Diagnostic {
  return {
    code,
    severity: "error",
    message,
    filePath,
    ruleId,
  };
}

function parseFrontmatter(content: string, filePath: string): FrontmatterParseResult {
  const diagnostics: Diagnostic[] = [];
  if (!content.startsWith("---")) {
    diagnostics.push(
      makeDiagnostic(
        "HKY_MISSING_FRONTMATTER",
        "Missing YAML frontmatter header.",
        filePath,
      ),
    );
    return { frontmatter: null, rationale: "", diagnostics };
  }

  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) {
    diagnostics.push(
      makeDiagnostic(
        "HKY_INVALID_FRONTMATTER",
        "Malformed frontmatter boundaries.",
        filePath,
      ),
    );
    return { frontmatter: null, rationale: "", diagnostics };
  }

  try {
    const parsed = parseYaml(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      diagnostics.push(
        makeDiagnostic(
          "HKY_INVALID_FRONTMATTER_OBJECT",
          "Frontmatter must be a YAML object.",
          filePath,
        ),
      );
      return { frontmatter: null, rationale: match[2], diagnostics };
    }
    return {
      frontmatter: parsed as Record<string, unknown>,
      rationale: match[2],
      diagnostics,
    };
  } catch (error) {
    diagnostics.push(
      makeDiagnostic(
        "HKY_YAML_PARSE_ERROR",
        `Failed to parse YAML frontmatter: ${String(error)}`,
        filePath,
      ),
    );
    return { frontmatter: null, rationale: match[2], diagnostics };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeLeafCondition(
  value: unknown,
  filePath: string,
  diagnostics: Diagnostic[],
  ruleId?: string,
): ConditionLeaf | null {
  if (!isRecord(value) || typeof value.field !== "string") {
    diagnostics.push(
      makeDiagnostic(
        "HKY_INVALID_CONDITION",
        "Condition leaf must be an object with a string field property.",
        filePath,
        ruleId,
      ),
    );
    return null;
  }

  const supportedOperators = ["==", "!=", "contains", "matches", "glob"] as const;
  const operatorCount = supportedOperators.reduce(
    (count, key) => (key in value ? count + 1 : count),
    0,
  );
  if (operatorCount !== 1) {
    diagnostics.push(
      makeDiagnostic(
        "HKY_INVALID_CONDITION_OPERATOR",
        "Condition leaf must declare exactly one operator.",
        filePath,
        ruleId,
      ),
    );
    return null;
  }

  return value as unknown as ConditionLeaf;
}

function normalizeConditionNode(
  raw: unknown,
  filePath: string,
  diagnostics: Diagnostic[],
  ruleId?: string,
): ConditionNode | null {
  if (Array.isArray(raw)) {
    // Flat condition arrays are normalized as implicit AND.
    const normalized = raw
      .map((item) => normalizeConditionNode(item, filePath, diagnostics, ruleId))
      .filter((item): item is ConditionNode => item !== null);
    if (normalized.length === 0) {
      diagnostics.push(
        makeDiagnostic(
          "HKY_INVALID_CONDITION_ARRAY",
          "Flat condition arrays must include at least one valid condition.",
          filePath,
          ruleId,
        ),
      );
      return null;
    }
    return { all: normalized };
  }

  if (!isRecord(raw)) {
    diagnostics.push(
      makeDiagnostic(
        "HKY_INVALID_CONDITION_NODE",
        "Condition must be an object, array, or boolean combinator node.",
        filePath,
        ruleId,
      ),
    );
    return null;
  }

  if ("all" in raw) {
    if (!Array.isArray(raw.all)) {
      diagnostics.push(
        makeDiagnostic(
          "HKY_INVALID_ALL_NODE",
          "all must be an array of conditions.",
          filePath,
          ruleId,
        ),
      );
      return null;
    }
    const all = raw.all
      .map((item) => normalizeConditionNode(item, filePath, diagnostics, ruleId))
      .filter((item): item is ConditionNode => item !== null);
    return all.length > 0 ? { all } : null;
  }

  if ("any" in raw) {
    if (!Array.isArray(raw.any)) {
      diagnostics.push(
        makeDiagnostic(
          "HKY_INVALID_ANY_NODE",
          "any must be an array of conditions.",
          filePath,
          ruleId,
        ),
      );
      return null;
    }
    const any = raw.any
      .map((item) => normalizeConditionNode(item, filePath, diagnostics, ruleId))
      .filter((item): item is ConditionNode => item !== null);
    return any.length > 0 ? { any } : null;
  }

  if ("not" in raw) {
    const not = normalizeConditionNode(raw.not, filePath, diagnostics, ruleId);
    return not ? { not } : null;
  }

  return normalizeLeafCondition(raw, filePath, diagnostics, ruleId);
}

function validateAction(
  raw: unknown,
  filePath: string,
  diagnostics: Diagnostic[],
  ruleId?: string,
): Action | null {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    diagnostics.push(
      makeDiagnostic(
        "HKY_MISSING_ACTION",
        "action must be an object with a type field.",
        filePath,
        ruleId,
      ),
    );
    return null;
  }

  if (!SUPPORTED_ACTIONS.has(raw.type)) {
    diagnostics.push(
      makeDiagnostic(
        "HKY_INVALID_ACTION",
        `Unsupported action type: ${raw.type}`,
        filePath,
        ruleId,
      ),
    );
    return null;
  }

  return raw as unknown as Action;
}

export function parseRuleFile(content: string, filePath: string): ParseRuleResult {
  const diagnostics: Diagnostic[] = [];
  const { frontmatter, rationale, diagnostics: fmDiagnostics } = parseFrontmatter(
    content,
    filePath,
  );
  diagnostics.push(...fmDiagnostics);
  if (!frontmatter) {
    return { rule: null, diagnostics };
  }

  const id = frontmatter.id;
  const event = frontmatter.event;
  const matcher = frontmatter.matcher;
  const conditions = frontmatter.conditions;
  const action = frontmatter.action;
  const priority = frontmatter.priority;

  if (typeof id !== "string" || id.trim().length === 0) {
    diagnostics.push(
      makeDiagnostic(
        "HKY_MISSING_ID",
        "Rule requires a non-empty id in frontmatter.",
        filePath,
      ),
    );
  }

  if (typeof event !== "string" || !SUPPORTED_EVENTS.has(event as HookEventType)) {
    diagnostics.push(
      makeDiagnostic(
        "HKY_INVALID_EVENT",
        `Unsupported event: ${String(event)}`,
        filePath,
        typeof id === "string" ? id : undefined,
      ),
    );
  }

  if (!isRecord(matcher)) {
    diagnostics.push(
      makeDiagnostic(
        "HKY_MISSING_MATCHER",
        "Rule requires matcher object in frontmatter.",
        filePath,
        typeof id === "string" ? id : undefined,
      ),
    );
  }

  const normalizedConditions = normalizeConditionNode(
    conditions,
    filePath,
    diagnostics,
    typeof id === "string" ? id : undefined,
  );
  const validatedAction = validateAction(
    action,
    filePath,
    diagnostics,
    typeof id === "string" ? id : undefined,
  );

  if (typeof priority !== "number" || !Number.isFinite(priority)) {
    diagnostics.push(
      makeDiagnostic(
        "HKY_INVALID_PRIORITY",
        "priority must be a finite number.",
        filePath,
        typeof id === "string" ? id : undefined,
      ),
    );
  }

  if (diagnostics.length > 0) {
    return { rule: null, diagnostics };
  }

  const rule: Rule = {
    id: id as string,
    event: event as HookEventType,
    matcher: matcher as Matcher,
    conditions: normalizedConditions as ConditionNode,
    action: validatedAction as Action,
    priority: priority as number,
    rationale,
    sourcePath: filePath,
  };

  return { rule, diagnostics };
}

export function parseRuleSet(
  files: Array<{ path: string; content: string }>,
): { rules: Rule[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const rules: Rule[] = [];
  const seenIds = new Set<string>();

  for (const file of files) {
    const result = parseRuleFile(file.content, file.path);
    diagnostics.push(...result.diagnostics);
    if (!result.rule) {
      continue;
    }
    if (seenIds.has(result.rule.id)) {
      diagnostics.push(
        makeDiagnostic(
          "HKY_DUPLICATE_RULE_ID",
          `Duplicate rule id: ${result.rule.id}`,
          file.path,
          result.rule.id,
        ),
      );
      continue;
    }
    seenIds.add(result.rule.id);
    rules.push(result.rule);
  }

  return { rules, diagnostics };
}
