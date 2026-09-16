// Spec: specs/171-opc-structural-diff-plan-ui/spec.md
// FR-003 gate-impact preview + FR-007 critical-action marker inference.
//
// Pure heuristics that derive gate-impact predictions and
// critical-action markers from an action's kind / target / args.
//
// These helpers are explicitly deterministic and side-effect-free so
// the rendering remains hash-stable (FR-008). They are heuristics —
// the authoritative gate evaluation is the spec-spine couple
// binary at PR time. The cockpit-time prediction exists to surface
// likely-fail actions BEFORE the human acknowledges them.

import type {
  AgentPlan,
  GateImpact,
  GateImpactEntry,
  GateImpactLevel,
  PlanAction,
  CriticalActionMarker,
} from './planTypes';

// ── Path classifiers ─────────────────────────────────────────────────

/** Spec 167 born-with kernel paths. Editing these is a kernel-class
 *  critical action requiring future M-of-N dual-auth. */
const KERNEL_PATH_PATTERNS: RegExp[] = [
  /^crates\/factory-engine\/src\/(engine|governance_certificate|inter_stage_manifest)\.rs$/,
  /^crates\/factory-engine\/src\/lib\.rs$/,
];

/** Spec 132 constitutional-invariant-freeze paths. Editing these is
 *  an invariant-class critical action. */
const INVARIANT_PATH_PATTERNS: RegExp[] = [
  /^standards\/spec\/constitution\.md$/,
  /^standards\/spec\/contract\.md$/,
  /^specs\/000-bootstrap-spec-system\/spec\.md$/,
  /^specs\/132-constitutional-invariant-freeze\/spec\.md$/,
];

/** Production-deploy targets (heuristic — exact matching at deploy
 *  time is the deployd-api scope gate's job, not the cockpit's). */
const PRODUCTION_DEPLOY_PATTERNS: RegExp[] = [
  /\bprod(uction)?\b/i,
  /^prod-/,
  /-prod$/,
];

export function isKernelPath(path: string): boolean {
  return KERNEL_PATH_PATTERNS.some((re) => re.test(path));
}

export function isInvariantPath(path: string): boolean {
  return INVARIANT_PATH_PATTERNS.some((re) => re.test(path));
}

export function isProductionDeployTarget(target: string): boolean {
  return PRODUCTION_DEPLOY_PATTERNS.some((re) => re.test(target));
}

// ── Critical-action inference (FR-007) ───────────────────────────────

/** Infer a critical-action marker for an action, or null if the
 *  action is routine. */
export function inferCriticalMarker(
  action: PlanAction,
): CriticalActionMarker | null {
  if (action.kind === 'edit_code' && isKernelPath(action.target)) {
    return {
      category: 'kernel',
      reason: `Touches spec 167 born-with kernel (${action.target}).`,
      requiredAcks: 2,
    };
  }
  if (
    (action.kind === 'edit_spec' || action.kind === 'edit_code') &&
    isInvariantPath(action.target)
  ) {
    return {
      category: 'invariant',
      reason: `Touches a spec 132 invariant-freeze path (${action.target}).`,
      requiredAcks: 2,
    };
  }
  if (action.kind === 'deploy' && isProductionDeployTarget(action.target)) {
    return {
      category: 'production-deploy',
      reason: `Production deploy target (${action.target}).`,
      requiredAcks: 2,
    };
  }
  return null;
}

// ── Gate-impact inference (FR-003) ───────────────────────────────────

/** Test whether the plan would touch any code for the same spec the
 *  given edit_spec action targets. Used for the spec-code-coupling
 *  heuristic (spec 127 + 152). */
function planTouchesCodeForSpec(
  plan: AgentPlan,
  specPath: string,
): boolean {
  // Pull the `<id>-<slug>` segment out of `specs/<id>-<slug>/spec.md`.
  const m = specPath.match(/^specs\/([^/]+)\/spec\.md$/);
  if (!m) return false;
  const segment = m[1];
  return plan.actions.some(
    (a) => a.kind === 'edit_code' && a.target.includes(segment),
  );
}

const ASSESSMENT_BY_KIND: Record<string, (action: PlanAction, plan: AgentPlan) => GateImpactEntry[]> = {
  edit_spec: (action, plan) => {
    const entries: GateImpactEntry[] = [];
    // spec-code-coupling: spec edits without matching code change in
    // the same plan tend to fail unless explicitly waived.
    const hasCodeTouch = planTouchesCodeForSpec(plan, action.target);
    entries.push({
      gate: 'spec-code-coupling',
      level: hasCodeTouch ? 'pass' : 'warn',
      reason: hasCodeTouch
        ? 'Plan also edits code under this spec.'
        : 'Spec edit without matching code change in the plan.',
    });
    // spec-lint runs on every spec edit.
    entries.push({
      gate: 'spec-lint',
      level: 'pass',
      reason: 'spec-lint is informational unless the spec violates V-* rules.',
    });
    if (isInvariantPath(action.target)) {
      entries.push({
        gate: 'invariant-freeze',
        level: 'fail',
        reason:
          'Spec 132 invariant-frozen file — refuse unless an explicit additive amendment is in the plan.',
      });
    }
    return entries;
  },
  edit_code: (action, plan) => {
    const entries: GateImpactEntry[] = [];
    // Heuristic: code edit without a matching spec edit anywhere in
    // the plan warns on coupling. (PR-time the gate looks at the
    // owning spec via implements:; we approximate that here.)
    const hasSpecTouch = plan.actions.some((a) => a.kind === 'edit_spec');
    entries.push({
      gate: 'spec-code-coupling',
      level: hasSpecTouch ? 'pass' : 'warn',
      reason: hasSpecTouch
        ? 'Plan includes spec edit(s); coupling gate likely satisfied.'
        : 'Code edit without any spec edit in the plan.',
    });
    if (isKernelPath(action.target)) {
      entries.push({
        gate: 'invariant-freeze',
        level: 'warn',
        reason: 'Spec 167 kernel path — verify additive evolution (spec 153).',
      });
    }
    return entries;
  },
  invoke_tool: () => [
    {
      gate: 'spec-code-coupling',
      level: 'pass',
      reason: 'Tool invocations do not modify tracked files.',
    } as GateImpactEntry,
  ],
  factory_run: () => [
    {
      gate: 'supply-chain',
      level: 'pass',
      reason:
        'Factory runs emit governance certificates — supply-chain check runs at certificate verify time.',
    } as GateImpactEntry,
    {
      gate: 'codification',
      level: 'warn',
      reason:
        'Factory runs may emit CRITICAL/HIGH findings requiring codification (future spec 174).',
    } as GateImpactEntry,
  ],
  deploy: (action) => {
    const entries: GateImpactEntry[] = [
      {
        gate: 'supply-chain',
        level: 'pass',
        reason: 'Deploys require attested artifacts (spec 117).',
      },
    ];
    if (isProductionDeployTarget(action.target)) {
      entries.push({
        gate: 'invariant-freeze',
        level: 'warn',
        reason: 'Production deploy — verify against spec 132 invariants.',
      });
    }
    return entries;
  },
};

export function inferGateImpact(
  action: PlanAction,
  plan: AgentPlan,
): GateImpact {
  const assess = ASSESSMENT_BY_KIND[action.kind];
  if (!assess) return { entries: [] };
  return { entries: assess(action, plan) };
}

// ── Enrichment ───────────────────────────────────────────────────────

/** Walk a plan and fill in `gateImpact` / `critical` for actions that
 *  don't already carry an explicit value. Action ordering is
 *  preserved so canonical hashing remains stable. */
export function enrichPlan(plan: AgentPlan): AgentPlan {
  const actions: PlanAction[] = plan.actions.map((action) => {
    const gateImpact = action.gateImpact ?? inferGateImpact(action, plan);
    const critical = action.critical ?? inferCriticalMarker(action) ?? undefined;
    return { ...action, gateImpact, critical };
  });
  return { ...plan, actions };
}

// ── Rolled-up summary ────────────────────────────────────────────────

export interface GateImpactSummary {
  /** Total actions in the plan. */
  total: number;
  /** Actions whose worst gate impact is `fail`. */
  failCount: number;
  /** Actions whose worst gate impact is `warn`. */
  warnCount: number;
  /** Actions tagged with a critical-action marker (FR-007). */
  criticalCount: number;
  /** Worst level across the whole plan. */
  worst: GateImpactLevel;
}

function levelRank(level: GateImpactLevel): number {
  return level === 'fail' ? 2 : level === 'warn' ? 1 : 0;
}

function worstLevel(action: PlanAction): GateImpactLevel {
  if (!action.gateImpact || action.gateImpact.entries.length === 0) return 'pass';
  return action.gateImpact.entries.reduce<GateImpactLevel>(
    (acc, entry) => (levelRank(entry.level) > levelRank(acc) ? entry.level : acc),
    'pass',
  );
}

export function summarizeGateImpact(plan: AgentPlan): GateImpactSummary {
  let failCount = 0;
  let warnCount = 0;
  let criticalCount = 0;
  let worst: GateImpactLevel = 'pass';
  for (const action of plan.actions) {
    const w = worstLevel(action);
    if (w === 'fail') failCount += 1;
    else if (w === 'warn') warnCount += 1;
    if (action.critical) criticalCount += 1;
    if (levelRank(w) > levelRank(worst)) worst = w;
  }
  return {
    total: plan.actions.length,
    failCount,
    warnCount,
    criticalCount,
    worst,
  };
}
