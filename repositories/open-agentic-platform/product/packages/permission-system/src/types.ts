export type PermissionScope = "session" | "project" | "global";

export type PermissionDecision = "allow" | "deny";

export interface PermissionEntry {
  id: string;
  tool: string;
  pattern: string;
  decision: PermissionDecision;
  scope: PermissionScope;
  createdAt: string;
  expiresAt?: string | null;
}

export interface PermissionEvaluationInput {
  toolName: string;
  argument: string;
  isInteractive: boolean;
  nowIso?: string;
}

export interface PermissionEvaluationResult {
  decision: PermissionDecision;
  source: "non_interactive" | "bypass" | "disallowed" | "remembered" | "prompt";
  matchedPattern?: string;
  rationale: string;
}
