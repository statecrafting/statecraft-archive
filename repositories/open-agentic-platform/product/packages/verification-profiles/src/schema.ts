import type {
  Determinism,
  NetworkPolicy,
  SafetyTier,
  VerificationDiagnostic,
} from "./types.js";

const VALID_DETERMINISM: ReadonlySet<Determinism> = new Set([
  "deterministic",
  "mostly_deterministic",
  "non_deterministic",
]);

const VALID_SAFETY_TIER: ReadonlySet<SafetyTier> = new Set([
  "safe",
  "cautious",
  "dangerous",
]);

const VALID_NETWORK_POLICY: ReadonlySet<NetworkPolicy> = new Set([
  "allow",
  "deny",
  "restricted",
]);

export function diag(
  code: string,
  message: string,
  filePath: string,
  line?: number,
  column?: number,
): VerificationDiagnostic {
  return { code, severity: "error", message, filePath, line, column };
}

/**
 * Validate a parsed YAML object as a verification profile (FR-001).
 * Returns diagnostics for any schema violations.
 */
export function validateProfileObject(
  obj: Record<string, unknown>,
  filePath: string,
): VerificationDiagnostic[] {
  const diagnostics: VerificationDiagnostic[] = [];

  if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
    diagnostics.push(
      diag("VP_PROFILE_MISSING_NAME", "Profile must have a non-empty 'name' string.", filePath),
    );
  }

  if (obj.description !== undefined && typeof obj.description !== "string") {
    diagnostics.push(
      diag("VP_PROFILE_BAD_DESCRIPTION", "Profile 'description' must be a string when provided.", filePath),
    );
  }

  if (typeof obj.gate !== "boolean") {
    diagnostics.push(
      diag("VP_PROFILE_MISSING_GATE", "Profile must have a boolean 'gate' field.", filePath),
    );
  }

  if (!Array.isArray(obj.skills)) {
    diagnostics.push(
      diag("VP_PROFILE_MISSING_SKILLS", "Profile must have a 'skills' array.", filePath),
    );
  } else {
    if (obj.skills.length === 0) {
      diagnostics.push(
        diag("VP_PROFILE_EMPTY_SKILLS", "Profile 'skills' array must not be empty.", filePath),
      );
    }
    for (let i = 0; i < obj.skills.length; i++) {
      if (typeof obj.skills[i] !== "string" || (obj.skills[i] as string).trim().length === 0) {
        diagnostics.push(
          diag(
            "VP_PROFILE_BAD_SKILL_REF",
            `Profile 'skills[${i}]' must be a non-empty string.`,
            filePath,
          ),
        );
      }
    }
  }

  return diagnostics;
}

/**
 * Validate a parsed YAML object as a verification skill (FR-002, FR-003).
 * Returns diagnostics for any schema violations.
 */
export function validateSkillObject(
  obj: Record<string, unknown>,
  filePath: string,
): VerificationDiagnostic[] {
  const diagnostics: VerificationDiagnostic[] = [];

  if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
    diagnostics.push(
      diag("VP_SKILL_MISSING_NAME", "Skill must have a non-empty 'name' string.", filePath),
    );
  }

  if (typeof obj.description !== "string" || obj.description.trim().length === 0) {
    diagnostics.push(
      diag("VP_SKILL_MISSING_DESCRIPTION", "Skill must have a non-empty 'description' string.", filePath),
    );
  }

  if (typeof obj.determinism !== "string" || !VALID_DETERMINISM.has(obj.determinism as Determinism)) {
    diagnostics.push(
      diag(
        "VP_SKILL_BAD_DETERMINISM",
        `Skill 'determinism' must be one of: ${[...VALID_DETERMINISM].join(", ")}. Got: ${JSON.stringify(obj.determinism)}.`,
        filePath,
      ),
    );
  }

  if (typeof obj.safety_tier !== "string" || !VALID_SAFETY_TIER.has(obj.safety_tier as SafetyTier)) {
    diagnostics.push(
      diag(
        "VP_SKILL_BAD_SAFETY_TIER",
        `Skill 'safety_tier' must be one of: ${[...VALID_SAFETY_TIER].join(", ")}. Got: ${JSON.stringify(obj.safety_tier)}.`,
        filePath,
      ),
    );
  }

  if (!Array.isArray(obj.steps)) {
    diagnostics.push(
      diag("VP_SKILL_MISSING_STEPS", "Skill must have a 'steps' array.", filePath),
    );
  } else {
    if (obj.steps.length === 0) {
      diagnostics.push(
        diag("VP_SKILL_EMPTY_STEPS", "Skill 'steps' array must not be empty.", filePath),
      );
    }
    for (let i = 0; i < obj.steps.length; i++) {
      const step = obj.steps[i];
      if (typeof step !== "object" || step === null || Array.isArray(step)) {
        diagnostics.push(
          diag("VP_SKILL_BAD_STEP", `Skill 'steps[${i}]' must be an object.`, filePath),
        );
        continue;
      }
      validateStepObject(step as Record<string, unknown>, i, filePath, diagnostics);
    }
  }

  return diagnostics;
}

function validateStepObject(
  step: Record<string, unknown>,
  index: number,
  filePath: string,
  diagnostics: VerificationDiagnostic[],
): void {
  if (typeof step.command !== "string" || step.command.trim().length === 0) {
    diagnostics.push(
      diag(
        "VP_STEP_MISSING_COMMAND",
        `Step ${index} must have a non-empty 'command' string.`,
        filePath,
      ),
    );
  }

  if (typeof step.timeout !== "number" || step.timeout <= 0) {
    diagnostics.push(
      diag(
        "VP_STEP_BAD_TIMEOUT",
        `Step ${index} must have a positive 'timeout' number (seconds).`,
        filePath,
      ),
    );
  }

  if (typeof step.read_only !== "boolean") {
    diagnostics.push(
      diag(
        "VP_STEP_MISSING_READ_ONLY",
        `Step ${index} must have a boolean 'read_only' field.`,
        filePath,
      ),
    );
  }

  if (typeof step.network !== "string" || !VALID_NETWORK_POLICY.has(step.network as NetworkPolicy)) {
    diagnostics.push(
      diag(
        "VP_STEP_BAD_NETWORK",
        `Step ${index} 'network' must be one of: ${[...VALID_NETWORK_POLICY].join(", ")}. Got: ${JSON.stringify(step.network)}.`,
        filePath,
      ),
    );
  }
}
