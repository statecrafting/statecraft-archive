import { parseDocument } from "yaml";
import type { YAMLError } from "yaml";
import type {
  AntiPattern,
  CodingStandard,
  ParseStandardResult,
  RuleVerb,
  StandardDiagnostic,
  StandardExample,
  StandardPriority,
  StandardRule,
  StandardStatus,
} from "./types.js";
import { diag, validateStandardObject } from "./schema.js";

const CODE_YAML_PARSE = "CS_YAML_PARSE_ERROR";
const CODE_NOT_OBJECT = "CS_YAML_NOT_OBJECT";

function lineColFromYamlError(
  err: YAMLError,
): { line?: number; column?: number } {
  const lp = err.linePos;
  if (!lp) return {};
  const start = lp[0];
  return { line: start.line, column: start.col };
}

/**
 * Parse raw YAML text into a plain object, returning diagnostics on failure.
 * Uses `yaml.parseDocument()` for source-position-aware error reporting (NF-002).
 */
function parseYamlToObject(
  content: string,
  filePath: string,
): { value: Record<string, unknown> | null; diagnostics: StandardDiagnostic[] } {
  const diagnostics: StandardDiagnostic[] = [];

  const doc = parseDocument(content);

  if (doc.errors.length > 0) {
    const e = doc.errors[0];
    const { line, column } = lineColFromYamlError(e);
    diagnostics.push(diag(CODE_YAML_PARSE, e.message, filePath, line, column));
    return { value: null, diagnostics };
  }

  const js = doc.toJS();

  if (js === null || js === undefined) {
    diagnostics.push(
      diag(CODE_NOT_OBJECT, "YAML must resolve to a mapping (object), not null.", filePath, 1),
    );
    return { value: null, diagnostics };
  }

  if (typeof js !== "object" || Array.isArray(js)) {
    diagnostics.push(
      diag(
        CODE_NOT_OBJECT,
        "YAML must resolve to a mapping (object), not an array or scalar.",
        filePath,
        1,
      ),
    );
    return { value: null, diagnostics };
  }

  return { value: js as Record<string, unknown>, diagnostics };
}

/**
 * Convert a validated plain object to a typed `CodingStandard`.
 * Unknown fields are preserved on the returned object for forward compatibility (NF-003).
 */
function objectToStandard(obj: Record<string, unknown>): CodingStandard {
  const rules: StandardRule[] = (obj.rules as Record<string, unknown>[]).map((r) => ({
    verb: r.verb as RuleVerb,
    subject: (r.subject as string).trim(),
    rationale: (r.rationale as string).trim(),
  }));

  const standard: CodingStandard = {
    id: (obj.id as string).trim(),
    category: (obj.category as string).trim(),
    priority: obj.priority as StandardPriority,
    status: (obj.status as StandardStatus | undefined) ?? "active",
    rules,
  };

  if (typeof obj.context === "string") {
    standard.context = obj.context;
  }

  if (Array.isArray(obj.tags)) {
    standard.tags = obj.tags as string[];
  }

  if (Array.isArray(obj.anti_patterns)) {
    standard.anti_patterns = (obj.anti_patterns as Record<string, unknown>[]).map((ap) => ({
      pattern: (ap.pattern as string).trim(),
      correction: (ap.correction as string).trim(),
    }));
  }

  if (Array.isArray(obj.examples)) {
    standard.examples = (obj.examples as Record<string, unknown>[]).map((ex) => ({
      good: ex.good as string,
      bad: ex.bad as string,
      explanation: (ex.explanation as string).trim(),
    }));
  }

  // Preserve unknown fields for forward compatibility (NF-003)
  const knownKeys = new Set([
    "id", "category", "priority", "status", "context", "tags",
    "rules", "anti_patterns", "examples",
  ]);
  for (const key of Object.keys(obj)) {
    if (!knownKeys.has(key)) {
      (standard as unknown as Record<string, unknown>)[key] = obj[key];
    }
  }

  return standard;
}

/**
 * Parse a standard YAML file into a typed `CodingStandard` (FR-001).
 * Returns diagnostics with file path and line numbers on failure (NF-002).
 */
export function parseStandardFile(content: string, filePath: string): ParseStandardResult {
  const { value, diagnostics } = parseYamlToObject(content, filePath);
  if (!value) {
    return { standard: null, diagnostics };
  }

  const validationDiags = validateStandardObject(value, filePath);
  if (validationDiags.length > 0) {
    return { standard: null, diagnostics: [...diagnostics, ...validationDiags] };
  }

  return { standard: objectToStandard(value), diagnostics };
}
