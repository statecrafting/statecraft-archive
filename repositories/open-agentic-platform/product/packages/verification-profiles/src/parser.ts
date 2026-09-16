import { parseDocument } from "yaml";
import type { YAMLError } from "yaml";
import type {
  ParseProfileResult,
  ParseSkillResult,
  VerificationDiagnostic,
  VerificationProfile,
  VerificationSkill,
  VerificationStep,
  Determinism,
  SafetyTier,
  NetworkPolicy,
} from "./types.js";
import { diag, validateProfileObject, validateSkillObject } from "./schema.js";

const CODE_YAML_PARSE = "VP_YAML_PARSE_ERROR";
const CODE_NOT_OBJECT = "VP_YAML_NOT_OBJECT";

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
 * Uses `yaml.parseDocument()` for source-position-aware error reporting (R-003 / NF-001).
 */
function parseYamlToObject(
  content: string,
  filePath: string,
): { value: Record<string, unknown> | null; diagnostics: VerificationDiagnostic[] } {
  const diagnostics: VerificationDiagnostic[] = [];

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
 * Convert a validated plain object to a typed `VerificationProfile`.
 * Assumes validation has already passed.
 */
function objectToProfile(obj: Record<string, unknown>): VerificationProfile {
  return {
    name: (obj.name as string).trim(),
    description: typeof obj.description === "string" ? obj.description : undefined,
    gate: obj.gate as boolean,
    skills: (obj.skills as string[]).map((s) => s.trim()),
  };
}

/**
 * Convert a validated plain object to a typed `VerificationSkill`.
 * Assumes validation has already passed.
 */
function objectToSkill(obj: Record<string, unknown>): VerificationSkill {
  const rawSteps = obj.steps as Record<string, unknown>[];
  const steps: VerificationStep[] = rawSteps.map((s) => ({
    command: (s.command as string).trim(),
    timeout: s.timeout as number,
    read_only: s.read_only as boolean,
    network: s.network as NetworkPolicy,
  }));

  return {
    name: (obj.name as string).trim(),
    description: (obj.description as string).trim(),
    determinism: obj.determinism as Determinism,
    safety_tier: obj.safety_tier as SafetyTier,
    steps,
  };
}

/**
 * Parse a profile YAML file into a typed `VerificationProfile` (FR-001).
 * Returns diagnostics with file path and line numbers on failure (NF-001).
 */
export function parseProfileFile(content: string, filePath: string): ParseProfileResult {
  const { value, diagnostics } = parseYamlToObject(content, filePath);
  if (!value) {
    return { profile: null, diagnostics };
  }

  const validationDiags = validateProfileObject(value, filePath);
  if (validationDiags.length > 0) {
    return { profile: null, diagnostics: [...diagnostics, ...validationDiags] };
  }

  return { profile: objectToProfile(value), diagnostics };
}

/**
 * Parse a skill YAML file into a typed `VerificationSkill` (FR-002).
 * Returns diagnostics with file path and line numbers on failure (NF-001).
 */
export function parseSkillFile(content: string, filePath: string): ParseSkillResult {
  const { value, diagnostics } = parseYamlToObject(content, filePath);
  if (!value) {
    return { skill: null, diagnostics };
  }

  const validationDiags = validateSkillObject(value, filePath);
  if (validationDiags.length > 0) {
    return { skill: null, diagnostics: [...diagnostics, ...validationDiags] };
  }

  return { skill: objectToSkill(value), diagnostics };
}
