// The milestone ladder (spec 002 §2 "Status"). Each milestone names the real
// specs that constitute it, in the sibling repos' registries. The current
// position is NOT hardcoded: `rollupMilestone` derives it from the baked
// payload's `implementation` fields at build time, so the ladder re-derives on
// every deploy and cannot drift from source. See spec 002 §0 and §6.

import type { RegistryPayload } from "./registry";
import { findSpec } from "./registry";

export type MilestoneState = "done" | "in-progress" | "planned";

/** A spec that constitutes part of a milestone, addressed the way the registry
 *  viewer addresses it (`/registry/:repo/:id`). */
export interface MilestoneSpecRef {
  repo: string;
  id: string;
}

export interface Milestone {
  /** Ladder rung label, e.g. "M1". */
  key: string;
  /** Which turn of the loop this rung is: Substrate | Stamp | Factory | Fleet | Verify. */
  phase: string;
  title: string;
  blurb: string;
  specs: MilestoneSpecRef[];
}

/** A milestone's constituent spec, resolved against the baked payload. */
export interface ResolvedSpec extends MilestoneSpecRef {
  title: string;
  /** "complete" | "in-progress" | "pending" | "" (absent). */
  implementation: string;
  found: boolean;
}

export interface MilestoneRollup {
  milestone: Milestone;
  state: MilestoneState;
  /** How many constituent specs report `implementation: complete`. */
  complete: number;
  total: number;
  specs: ResolvedSpec[];
}

// The ladder. Every id here exists in the baked registry (enrahitu, statecraft,
// statecraft-cli); the viewer renders a detail page for each, so every rung is
// navigable to its source. Order is the delivery order, not the loop order.
// Each rung lists the headline specs for its phase, not the repo's full corpus:
// the point is an honest position on the ladder, not an exhaustive index (the
// registry is that). rollupMilestone reads their live state, so the curation
// cannot flatter the result. The index loader fails the build loud if any id
// here stops resolving.
export const MILESTONES: Milestone[] = [
  {
    key: "M1",
    phase: "Substrate",
    title: "The chassis boots",
    blurb:
      "EnRaHiTu: an Encore.ts app with in-process hiqlite, a CoreLedger data layer over libSQL/Turso, auth on rauthy behind a same-origin proxy, and a webapp, packaged as one container with a vendored toolchain.",
    specs: [
      { repo: "enrahitu", id: "001-enrahitu-architecture" },
      { repo: "enrahitu", id: "002-in-process-hiqlite" },
      { repo: "enrahitu", id: "003-coreledger" },
      { repo: "enrahitu", id: "004-auth-core" },
      { repo: "enrahitu", id: "005-rauthy-same-origin" },
      { repo: "enrahitu", id: "006-webapp-spa" },
      { repo: "enrahitu", id: "007-single-container-packaging" },
      { repo: "enrahitu", id: "008-vendored-encore-toolchain" },
    ],
  },
  {
    key: "M2",
    phase: "Stamp",
    title: "The template contract",
    blurb:
      "A versioned template.toml that says what a stamped app is, plus a born-with certificate that binds an explicit agentic posture at stamp time.",
    specs: [
      { repo: "enrahitu", id: "009-template-contract" },
      { repo: "enrahitu", id: "012-born-with-provenance" },
    ],
  },
  {
    key: "M3",
    phase: "Factory",
    title: "The control plane stamps apps",
    blurb:
      "Statecraft itself: the thesis, the EnRaHiTu app shell, tenant onboarding via a per-org GitHub App, and the factory that stamps complete apps into the customer's own org.",
    specs: [
      { repo: "statecraft", id: "001-statecraft-thesis" },
      { repo: "statecraft", id: "002-app-shell" },
      { repo: "statecraft", id: "004-tenants-github-app" },
      { repo: "statecraft", id: "005-factory-service" },
    ],
  },
  {
    key: "M4",
    phase: "Fleet",
    title: "The fleet operates the result",
    blurb:
      "Placing and running stamped EnRaHiTu apps: one container and one volume each, with update and backup as governed verbs rather than runbooks.",
    specs: [{ repo: "statecraft", id: "006-fleet" }],
  },
  {
    key: "M5",
    phase: "Verify",
    title: "The governance spine and the CLI face",
    blurb:
      "A tamper-evident attestation ledger with an action gate and trust window, and the statecraft binary that drives the same governed verbs from the terminal and over MCP.",
    specs: [
      { repo: "statecraft", id: "008-governance-attestation" },
      { repo: "statecraft-cli", id: "101-cli-mcp-thesis" },
      { repo: "statecraft-cli", id: "104-governance-verbs" },
      { repo: "statecraft-cli", id: "105-mcp-server" },
    ],
  },
];

/** Resolve one milestone against the baked payload and roll its constituent
 *  specs up into a single state. All complete → done; any complete/in-progress
 *  → in-progress; otherwise planned. Missing specs never count as complete. */
export function rollupMilestone(
  payload: RegistryPayload,
  milestone: Milestone
): MilestoneRollup {
  const specs: ResolvedSpec[] = milestone.specs.map((ref) => {
    const hit = findSpec(payload, ref.repo, ref.id);
    return {
      ...ref,
      title: hit?.spec.title ?? ref.id,
      implementation:
        typeof hit?.spec.implementation === "string"
          ? hit.spec.implementation
          : "",
      found: Boolean(hit),
    };
  });

  const total = specs.length;
  const complete = specs.filter((s) => s.implementation === "complete").length;
  const anyProgress = specs.some(
    (s) =>
      s.implementation === "complete" || s.implementation === "in-progress"
  );
  const state: MilestoneState =
    total > 0 && complete === total
      ? "done"
      : anyProgress
        ? "in-progress"
        : "planned";

  return { milestone, state, complete, total, specs };
}

export function rollupAll(payload: RegistryPayload): MilestoneRollup[] {
  return MILESTONES.map((m) => rollupMilestone(payload, m));
}

/** Map one spec's raw `implementation` to a state, for single-spec surfaces
 *  (the loop cards, the for-agents block) that carry a live maturity chip so a
 *  capability claim is never louder than what the spec that governs it reports.
 *  An empty value (spec not found) reads as planned; callers that need to fail
 *  on a missing ref should check `found` explicitly. */
export function implToState(implementation: string): MilestoneState {
  return implementation === "complete"
    ? "done"
    : implementation === "in-progress"
      ? "in-progress"
      : "planned";
}

const LADDER_CHIP_BASE =
  "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[0.7rem] leading-none";

/** Chip classes for a rolled-up milestone state. Mirrors implementationChip's
 *  palette (emerald/amber/muted) so the ladder reads consistently with the
 *  registry viewer. */
export function milestoneStateChip(state: MilestoneState): string {
  switch (state) {
    case "done":
      return `${LADDER_CHIP_BASE} border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400`;
    case "in-progress":
      return `${LADDER_CHIP_BASE} border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400`;
    default:
      return `${LADDER_CHIP_BASE} border border-border bg-muted text-muted-foreground`;
  }
}

/** Human label for a milestone state. */
export function milestoneStateLabel(state: MilestoneState): string {
  switch (state) {
    case "done":
      return "shipped";
    case "in-progress":
      return "in progress";
    default:
      return "planned";
  }
}
