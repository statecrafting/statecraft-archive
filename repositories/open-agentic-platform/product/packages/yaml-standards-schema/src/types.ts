// --- Enums as union types ---

/** Rule verb classifying the directive type (FR-002). */
export type RuleVerb = "ALWAYS" | "NEVER" | "USE" | "PREFER" | "AVOID";

/** Priority level for a coding standard (FR-001). */
export type StandardPriority = "critical" | "high" | "medium" | "low";

/** Lifecycle status of a coding standard (FR-007). */
export type StandardStatus = "active" | "candidate" | "rejected";

// --- Core schema types ---

/** A single rule within a coding standard (FR-002). */
export interface StandardRule {
  /** Directive verb: ALWAYS, NEVER, USE, PREFER, AVOID. */
  verb: RuleVerb;
  /** What the rule applies to. */
  subject: string;
  /** Why this rule exists. */
  rationale: string;
}

/** A code anti-pattern that violates the standard (FR-003). */
export interface AntiPattern {
  /** Code pattern that should be avoided. */
  pattern: string;
  /** Corrected version of the pattern. */
  correction: string;
}

/** A good/bad code example illustrating the standard (FR-003). */
export interface StandardExample {
  /** Code that follows the standard. */
  good: string;
  /** Code that violates the standard. */
  bad: string;
  /** Explanation of why good is preferred. */
  explanation: string;
}

/** A machine-readable coding standard (FR-001). */
export interface CodingStandard {
  /** Unique identifier, kebab-case (e.g., "error-handling-001"). */
  id: string;
  /** Category grouping (e.g., "error-handling", "naming", "testing"). */
  category: string;
  /** Priority level. */
  priority: StandardPriority;
  /** Lifecycle status. */
  status: StandardStatus;
  /** When this standard applies. */
  context?: string;
  /** Tags for filtering. */
  tags?: string[];
  /** Ordered rules that comprise this standard. */
  rules: StandardRule[];
  /** Anti-patterns that violate this standard. */
  anti_patterns?: AntiPattern[];
  /** Good/bad code examples. */
  examples?: StandardExample[];
}

// --- Diagnostic types ---

export type DiagnosticSeverity = "error" | "warning" | "info";

/** Diagnostic emitted during parsing or validation (NF-002). */
export interface StandardDiagnostic {
  /** Diagnostic code prefixed with CS_ (e.g., CS_INVALID_YAML). */
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

/** Result of parsing a standard YAML file. */
export interface ParseStandardResult {
  standard: CodingStandard | null;
  diagnostics: StandardDiagnostic[];
}
