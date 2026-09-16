// Spec: specs/171-opc-structural-diff-plan-ui/spec.md
//
// Types and helpers for the deterministic structural-diff plan UI
// (ASI09 anti-anthropomorphic-trust rendering). The cockpit reviews
// agent-proposed plans as action graphs and structural diffs, not
// conversational summaries.

// ── Action graph (FR-002) ────────────────────────────────────────────

/** Kinds of action an agent may propose in a plan. */
export type PlanActionKind =
  | 'edit_spec'
  | 'edit_code'
  | 'invoke_tool'
  | 'factory_run'
  | 'deploy';

/** A single action in the agent's proposed plan. */
export interface PlanAction {
  /** Stable id within the plan; used for traversal acknowledgement. */
  id: string;
  kind: PlanActionKind;
  /** Path or logical target — file path, tool name, deploy target. */
  target: string;
  /** Optional short, machine-shaped summary of the change. Free-form
   *  description belongs in the narrative panel, not here. */
  diff?: PlanDiff;
  /** Optional structured tool args / deploy params. */
  args?: Record<string, unknown>;
  /** Optional gate-impact prediction attached at construction time. */
  gateImpact?: GateImpact;
  /** Marks an action requiring future M-of-N dual acknowledgement
   *  (kernel/invariant/production-deploy classes). FR-007. */
  critical?: CriticalActionMarker;
}

/** A structural diff for one target. Free-form text is rejected here
 *  by design — the narrative panel is the secondary surface. */
export interface PlanDiff {
  /** Unified-diff hunks or structured patch. Strings only so the
   *  renderer can syntax-highlight without a parsing dependency. */
  hunks?: string[];
  /** Optional structured frontmatter changes for spec edits. */
  frontmatter?: SpecFrontmatterChange[];
}

/** A single frontmatter field change (status, relationship edges,
 *  unit grammar — per spec 154). */
export interface SpecFrontmatterChange {
  field: string;
  before?: unknown;
  after?: unknown;
}

// ── Spec spine diff (§2.1) ───────────────────────────────────────────

/** A diff over the spec spine state that a plan would produce. */
export interface StructuralDiff {
  added: SpecRef[];
  removed: SpecRef[];
  modified: SpecModification[];
}

export interface SpecRef {
  id: string;
  slug: string;
  /** Path to spec.md, relative to repo root. */
  path: string;
}

export interface SpecModification {
  spec: SpecRef;
  /** One row per changed field. */
  changes: SpecFrontmatterChange[];
}

// ── Gate impact preview (FR-003) ─────────────────────────────────────

/** Which configured gate is affected by an action. */
export type GateName =
  | 'spec-code-coupling'
  | 'spec-lint'
  | 'schema-parity'
  | 'supply-chain'
  | 'invariant-freeze'
  | 'codification';

/** Predicted effect on each gate. `warn` and `fail` surface a marker
 *  on the action before the human can approve. `pass` is informational. */
export type GateImpactLevel = 'pass' | 'warn' | 'fail';

export interface GateImpactEntry {
  gate: GateName;
  level: GateImpactLevel;
  /** Short reason string the UI renders next to the level pill. No
   *  prose narrative — the agent cannot explain its way past a gate. */
  reason: string;
}

export interface GateImpact {
  entries: GateImpactEntry[];
}

// ── Critical-action marker (FR-007) ─────────────────────────────────

/** Stub for future M-of-N dual-auth UX. The marker is rendered today;
 *  the multi-actor approval flow lands as a separate spec. */
export interface CriticalActionMarker {
  /** Category drives the badge label / colour. */
  category: 'kernel' | 'invariant' | 'production-deploy';
  /** Short reason: which spec authority makes this critical. */
  reason: string;
  /** Required acknowledgements; today always > 1, today only renders. */
  requiredAcks: number;
}

// ── Certificate prediction / actual diff (FR-006) ────────────────────

/** Predicted governance certificate stage list (spec 102 composition). */
export interface CertificatePrediction {
  /** Ordered list of stages the plan expects to emit. */
  stages: CertificateStagePrediction[];
  /** Optional adapter / build-spec context (shown but not approved). */
  adapter?: string;
}

export interface CertificateStagePrediction {
  id: string;
  name: string;
  /** Artifact basenames expected in this stage (no hashes — those
   *  are computed at runtime per spec 102). */
  artifacts: string[];
}

/** Actual certificate stage list after execution, used for the diff. */
export interface CertificateActual {
  stages: Array<{
    id: string;
    name: string;
    artifacts: string[];
    /** SHA-256 prefix of the per-stage artifact hash, if surfaced. */
    artifactHashPrefix?: string;
  }>;
}

/** A single discrepancy between predicted and actual stage lists. */
export interface CertificateDiscrepancy {
  kind:
    | 'missing-stage'
    | 'extra-stage'
    | 'missing-artifact'
    | 'extra-artifact';
  stageId: string;
  detail: string;
}

// ── Top-level plan (FR-001) ──────────────────────────────────────────

/** An agent-proposed plan. The structural diff + action graph is the
 *  primary surface; the narrative is secondary (FR-004). */
export interface AgentPlan {
  /** Stable id provided by the producer; rendered for traceability. */
  id: string;
  /** ISO timestamp the plan was proposed. */
  proposedAt: string;
  /** Identifier of the proposing agent (for traceability, not trust). */
  proposedBy: string;
  /** Ordered list of actions. */
  actions: PlanAction[];
  /** Structural diff over the spec spine the plan would produce. */
  structuralDiff: StructuralDiff;
  /** Optional certificate prediction for plans that include a
   *  factory_run action. */
  certificatePrediction?: CertificatePrediction;
  /** The agent's narrative, demoted to a secondary panel. Optional. */
  narrative?: string;
}

// ── Approval traversal state (FR-005) ────────────────────────────────

/** Per-action acknowledgement state. The plan cannot be approved
 *  until every action id appears here with `acknowledged: true`. */
export interface PlanApprovalState {
  planId: string;
  acknowledgements: Record<string, boolean>;
}

export function createInitialApprovalState(plan: AgentPlan): PlanApprovalState {
  const acknowledgements: Record<string, boolean> = {};
  for (const action of plan.actions) {
    acknowledgements[action.id] = false;
  }
  return { planId: plan.id, acknowledgements };
}

export function isPlanFullyAcknowledged(
  plan: AgentPlan,
  approval: PlanApprovalState,
): boolean {
  if (approval.planId !== plan.id) return false;
  if (plan.actions.length === 0) return false;
  return plan.actions.every(
    (action) => approval.acknowledgements[action.id] === true,
  );
}

// ── Deterministic hash (FR-008, SC-005) ─────────────────────────────

/** Canonicalise a JSON value: sort object keys recursively. Arrays
 *  preserve order — action order is semantically meaningful in a plan. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const sorted: Record<string, unknown> = {};
    for (const key of keys) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Canonical JSON of a plan. Stable across object-key insertion
 *  order; arrays preserve their order. */
export function canonicalPlanJson(plan: AgentPlan): string {
  // The narrative is excluded from the canonical hash by design:
  // FR-008 demands hash equality for the same *structural* plan input,
  // and the narrative is the secondary surface the cockpit refuses
  // to treat as load-bearing. Two plans differing only in prose
  // share a hash; two plans differing in any action / diff / cert
  // prediction field do not.
  const { narrative: _narrative, ...rest } = plan;
  return JSON.stringify(canonicalize(rest));
}

/** FNV-1a 64-bit hash → hex string. Synchronous, browser-safe,
 *  sufficient for "same plan → same id" determinism. Not a
 *  cryptographic primitive; the auditable cryptographic hash is
 *  spec 102's certificate. */
export function hashPlan(plan: AgentPlan): string {
  const json = canonicalPlanJson(plan);
  // FNV-1a 64-bit, using BigInt for portability.
  const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < json.length; i++) {
    hash ^= BigInt(json.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, '0');
}
