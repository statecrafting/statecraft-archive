// --- Enums as union types ---

/** How reproducible the skill's output is across identical inputs (FR-002). */
export type Determinism =
  | "deterministic"
  | "mostly_deterministic"
  | "non_deterministic";

/** Safety classification for the skill (FR-002, aligns with 036-safety-tier-governance). */
export type SafetyTier = "safe" | "cautious" | "dangerous";

/** Network access policy for a verification step (FR-003). */
export type NetworkPolicy = "allow" | "deny" | "restricted";

// --- Core schema types ---

/** A single executable step within a verification skill (FR-003). */
export interface VerificationStep {
  /** Shell command to execute. */
  command: string;
  /** Maximum execution time in seconds. */
  timeout: number;
  /** Whether the step modifies state. */
  read_only: boolean;
  /** Network access policy during execution. */
  network: NetworkPolicy;
}

/** A reusable verification skill composing ordered steps (FR-002). */
export interface VerificationSkill {
  /** Unique skill name, used as reference key in profiles. */
  name: string;
  /** Human-readable description. */
  description: string;
  /** How reproducible this skill's results are. */
  determinism: Determinism;
  /** Safety classification. */
  safety_tier: SafetyTier;
  /** Ordered list of steps to execute. */
  steps: VerificationStep[];
}

/** A named verification profile composing skill references (FR-001). */
export interface VerificationProfile {
  /** Profile name (e.g., "pr", "release", "hotfix"). */
  name: string;
  /** Human-readable description. */
  description?: string;
  /** When true, delivery is blocked until all skills pass (FR-004). */
  gate: boolean;
  /** Ordered list of skill names to execute. */
  skills: string[];
}

// --- Result types ---

/** Result of executing a single verification step. */
export interface StepResult {
  /** The command that was run. */
  command: string;
  /** Process exit code (null if killed by signal). */
  exitCode: number | null;
  /** Whether the step passed (exit code 0). */
  passed: boolean;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Whether the step was killed due to timeout. */
  timedOut: boolean;
  /** Captured stdout. */
  stdout: string;
  /** Captured stderr. */
  stderr: string;
}

/** Result of executing all steps in a skill. */
export interface SkillResult {
  /** Skill name. */
  name: string;
  /** Whether all steps passed. */
  passed: boolean;
  /** Per-step results in execution order. */
  steps: StepResult[];
  /** Total duration in milliseconds. */
  durationMs: number;
}

/** Result of executing an entire profile. */
export interface ProfileResult {
  /** Profile name. */
  profile: string;
  /** Whether the gate passed (all skills passed, or gate not active). */
  passed: boolean;
  /** Per-skill results in execution order. */
  skills: SkillResult[];
  /** Names of skills that failed. */
  failedSkills: string[];
  /** Total duration in milliseconds. */
  durationMs: number;
}

/** Result of evaluating a post-session gate (FR-004). */
export interface GateResult {
  /** Whether delivery is allowed. True if: profile is ungated, or all skills passed. */
  passed: boolean;
  /** Whether this profile is gated (blocks delivery on failure). */
  gated: boolean;
  /** Profile name. */
  profile: string;
  /** Per-skill results in execution order. */
  results: SkillResult[];
  /** Names of skills that failed. */
  failedSkills: string[];
  /** Total duration in milliseconds. */
  durationMs: number;
}

// --- Diagnostic types ---

export type DiagnosticSeverity = "error" | "warning" | "info";

/** Diagnostic emitted during parsing or validation (NF-001). */
export interface VerificationDiagnostic {
  /** Diagnostic code prefixed with VP_ (e.g., VP_INVALID_YAML). */
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  /** Path of the file that caused the diagnostic. */
  filePath: string;
  /** 1-based line number when available. */
  line?: number;
  /** 1-based column when available. */
  column?: number;
}

/** Result of parsing a profile YAML file. */
export interface ParseProfileResult {
  profile: VerificationProfile | null;
  diagnostics: VerificationDiagnostic[];
}

/** Result of parsing a skill YAML file. */
export interface ParseSkillResult {
  skill: VerificationSkill | null;
  diagnostics: VerificationDiagnostic[];
}
