// Spec 164 §2.2 / FR-003..FR-005 — lifecycle-state board projection.
//
// Pure derivation over the same `SpecListRow[]` inventory that the
// Requirements view (spec 163) consumes. No I/O, no fetches; just a
// deterministic projection of (status, implementation, relationship
// edges) into board columns + lanes.
//
// The board has five fixed columns left-to-right (per spec 147 grammar)
// and two off-flow lanes:
//
//   draft → approved → impl:pending → impl:in-progress → impl:complete
//   (lane) superseded
//   (lane) amended
//
// Specs with `status: superseded` placement: superseded lane only.
// Specs amended by a successor: their primary column placement is
// preserved AND they additionally appear in the amended lane (so the
// lane is a view, not an exclusion).

import type { SpecListRow } from "../../../api/specRegistry/types";
import {
  buildDerivedGroups,
  type DerivedGroup,
  type GroupingDimension,
} from "./spec-registry-grouping";

// ---------------------------------------------------------------------------
// Column + lane identity
// ---------------------------------------------------------------------------

export const LIFECYCLE_COLUMN_IDS = [
  "draft",
  "approved",
  "implementation-pending",
  "implementation-in-progress",
  "implementation-complete",
] as const;

export type LifecycleColumnId = (typeof LIFECYCLE_COLUMN_IDS)[number];

export interface LifecycleColumnMeta {
  id: LifecycleColumnId;
  label: string;
  /**
   * "Maturity" ordinal — used as the tiebreak when computing a
   * cluster's dominant column. Higher = more progressed.
   */
  maturity: number;
}

export const LIFECYCLE_COLUMNS: readonly LifecycleColumnMeta[] = [
  { id: "draft", label: "Draft", maturity: 0 },
  { id: "approved", label: "Approved", maturity: 1 },
  { id: "implementation-pending", label: "Pending", maturity: 2 },
  { id: "implementation-in-progress", label: "In progress", maturity: 3 },
  { id: "implementation-complete", label: "Complete", maturity: 4 },
];

export const LIFECYCLE_LANE_IDS = ["superseded", "amended"] as const;
export type LifecycleLaneId = (typeof LIFECYCLE_LANE_IDS)[number];

export interface LifecycleLaneMeta {
  id: LifecycleLaneId;
  label: string;
  description: string;
}

export const LIFECYCLE_LANES: readonly LifecycleLaneMeta[] = [
  {
    id: "superseded",
    label: "Superseded",
    description:
      "Replaced by a direction-change successor. The successor's spec carries the supersedes: edge.",
  },
  {
    id: "amended",
    label: "Amended",
    description:
      "Patched without supersession (spec 130 amends: edge). Cards still appear in their primary column.",
  },
];

// ---------------------------------------------------------------------------
// Spec → placement
// ---------------------------------------------------------------------------

export interface LifecyclePlacement {
  /** null only when the spec is fully off-flow (e.g. status === superseded). */
  column: LifecycleColumnId | null;
  /** Lanes the spec also appears in (independent of the column). */
  lanes: LifecycleLaneId[];
}

/**
 * Per-spec placement rule:
 *
 * - `status: superseded`           → superseded lane only (column = null).
 * - `status: draft`                → draft column.
 * - `status: approved` + impl flag → impl column (`implementation-{pending,in-progress,complete}`).
 * - `status: approved` + other     → approved column (impl values like
 *   `n/a` / `deferred` collapse here so the spec stays visible).
 * - anything else                  → approved column as a safe default.
 *
 * Amended-lane membership is computed outside this function (it needs
 * the whole corpus to find incoming amends edges).
 */
export function placeSpec(
  spec: SpecListRow,
  amendedIds: ReadonlySet<string>,
): LifecyclePlacement {
  const lanes: LifecycleLaneId[] = [];

  if (spec.status === "superseded") {
    if (amendedIds.has(spec.id)) lanes.push("amended");
    lanes.push("superseded");
    return { column: null, lanes };
  }

  if (amendedIds.has(spec.id)) lanes.push("amended");

  if (spec.status === "draft") {
    return { column: "draft", lanes };
  }

  if (spec.status === "approved") {
    switch (spec.implementation) {
      case "pending":
        return { column: "implementation-pending", lanes };
      case "in-progress":
        return { column: "implementation-in-progress", lanes };
      case "complete":
        return { column: "implementation-complete", lanes };
      default:
        // n/a, deferred, or anything else surface in the Approved column
        // so the spec remains visible on the board.
        return { column: "approved", lanes };
    }
  }

  // Defensive default — any unknown status lands in Approved so it is
  // still visible (rather than vanishing from the board).
  return { column: "approved", lanes };
}

/**
 * Walk the corpus and collect ids of specs that have been amended by a
 * successor. We honour both shapes the relationship graph emits:
 *   - bare strings:  `amends: ["131"]`
 *   - typed edges:   `amends: [{ spec: "131", kind: "clarification" }]`
 *
 * Targets are matched on the leading three-digit prefix so amenders
 * may reference either the bare id or the full slug.
 */
export function collectAmendedIds(specs: SpecListRow[]): Set<string> {
  // Build a prefix→full-id map so we can resolve bare ids to full ids.
  const idByPrefix = new Map<string, string>();
  for (const s of specs) {
    const m = /^(\d{3})/.exec(s.id);
    if (m) idByPrefix.set(m[1], s.id);
  }

  const amended = new Set<string>();
  for (const s of specs) {
    const amends = s.relationshipFields["amends"];
    if (!Array.isArray(amends)) continue;
    for (const edge of amends) {
      const targetPrefix = extractTargetPrefix(edge);
      if (!targetPrefix) continue;
      const fullId = idByPrefix.get(targetPrefix);
      if (fullId) amended.add(fullId);
    }
  }
  return amended;
}

function extractTargetPrefix(edge: unknown): string | null {
  if (typeof edge === "string") {
    const m = /^(\d{3})/.exec(edge);
    return m ? m[1] : null;
  }
  if (edge && typeof edge === "object") {
    const v = edge as Record<string, unknown>;
    if (typeof v.spec === "string") {
      const m = /^(\d{3})/.exec(v.spec);
      return m ? m[1] : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Card model — one per spec or one per cluster (FR-005)
// ---------------------------------------------------------------------------

export type LifecycleCardKind = "spec" | "cluster";

export interface LifecycleCard {
  /** Stable id: spec id for `spec` cards, derived group id for clusters. */
  id: string;
  kind: LifecycleCardKind;
  /** Primary label rendered on the card: spec title or cluster label. */
  label: string;
  /** Members included in the card. For `spec` cards, length === 1. */
  members: SpecListRow[];
  /** Column + lane placement derived from the (cluster or spec) state. */
  placement: LifecyclePlacement;
}

export interface LifecycleBoard {
  columns: Record<LifecycleColumnId, LifecycleCard[]>;
  lanes: Record<LifecycleLaneId, LifecycleCard[]>;
}

function emptyBoard(): LifecycleBoard {
  return {
    columns: {
      draft: [],
      approved: [],
      "implementation-pending": [],
      "implementation-in-progress": [],
      "implementation-complete": [],
    },
    lanes: {
      superseded: [],
      amended: [],
    },
  };
}

/** Single-spec board projection (FR-005 default mode). */
export function buildBoard(specs: SpecListRow[]): LifecycleBoard {
  const amendedIds = collectAmendedIds(specs);
  const board = emptyBoard();
  for (const spec of specs) {
    const placement = placeSpec(spec, amendedIds);
    const card: LifecycleCard = {
      id: spec.id,
      kind: "spec",
      label: spec.title,
      members: [spec],
      placement,
    };
    if (placement.column) {
      board.columns[placement.column].push(card);
    }
    for (const lane of placement.lanes) {
      board.lanes[lane].push(card);
    }
  }
  for (const col of LIFECYCLE_COLUMN_IDS) {
    board.columns[col].sort(byMemberId);
  }
  for (const lane of LIFECYCLE_LANE_IDS) {
    board.lanes[lane].sort(byMemberId);
  }
  return board;
}

/**
 * Cluster-card projection (FR-005 grouped mode). Each derived group
 * from spec 163's grouping module becomes a single cluster card, placed
 * by the cluster's *dominant* lifecycle column.
 *
 * Dominant column rule: majority placement across cluster members; ties
 * resolved by "most progressed" (rightmost column wins) so a cluster
 * with mixed states tips toward its forward edge.
 *
 * Lane membership for a cluster: union of member lane memberships. A
 * cluster with one superseded member and four active members still shows
 * up in the superseded lane (signalling "this cluster has retired
 * branches") AND in its dominant column.
 */
export function buildBoardWithGrouping(
  specs: SpecListRow[],
  dimension: GroupingDimension,
): LifecycleBoard {
  const amendedIds = collectAmendedIds(specs);
  const groups: DerivedGroup[] = buildDerivedGroups(specs, dimension);
  const board = emptyBoard();
  for (const group of groups) {
    const memberPlacements = group.specs.map((s) =>
      placeSpec(s, amendedIds),
    );
    const dominantColumn = pickDominantColumn(memberPlacements);
    const lanes = unionLanes(memberPlacements);
    const card: LifecycleCard = {
      id: group.id,
      kind: "cluster",
      label: group.label,
      members: group.specs,
      placement: { column: dominantColumn, lanes },
    };
    if (dominantColumn) {
      board.columns[dominantColumn].push(card);
    }
    for (const lane of lanes) {
      board.lanes[lane].push(card);
    }
  }
  for (const col of LIFECYCLE_COLUMN_IDS) {
    board.columns[col].sort(byMemberId);
  }
  for (const lane of LIFECYCLE_LANE_IDS) {
    board.lanes[lane].sort(byMemberId);
  }
  return board;
}

function byMemberId(a: LifecycleCard, b: LifecycleCard): number {
  const ai = a.members[0]?.id ?? a.id;
  const bi = b.members[0]?.id ?? b.id;
  return ai.localeCompare(bi);
}

function pickDominantColumn(
  placements: readonly LifecyclePlacement[],
): LifecycleColumnId | null {
  const counts = new Map<LifecycleColumnId, number>();
  for (const p of placements) {
    if (!p.column) continue;
    counts.set(p.column, (counts.get(p.column) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  let bestCount = -1;
  let bestMaturity = -1;
  let best: LifecycleColumnId | null = null;
  for (const col of LIFECYCLE_COLUMNS) {
    const c = counts.get(col.id) ?? 0;
    if (c === 0) continue;
    if (
      c > bestCount ||
      (c === bestCount && col.maturity > bestMaturity)
    ) {
      bestCount = c;
      bestMaturity = col.maturity;
      best = col.id;
    }
  }
  return best;
}

function unionLanes(
  placements: readonly LifecyclePlacement[],
): LifecycleLaneId[] {
  const set = new Set<LifecycleLaneId>();
  for (const p of placements) {
    for (const lane of p.lanes) set.add(lane);
  }
  // Preserve canonical lane order.
  return LIFECYCLE_LANE_IDS.filter((id) => set.has(id));
}

// ---------------------------------------------------------------------------
// Spec → execution-evidence linkage (FR-006)
// ---------------------------------------------------------------------------
//
// The honest per-card "execution evidence" surface today is the spec's
// own claimed code paths (relationship-graph `establishes:` / `extends:`
// / `refines:` / `co_authority:` edges). When a spec claims paths,
// every factory run / certificate / coupling-gate fire that touches
// those paths is provenance the operator can correlate. Wiring per-spec
// run / cert / gate-fire feeds requires a `code-path → recent-evidence`
// index that has not been built (no `factory_runs.touchedPaths` column,
// no `certificate_emissions` projected table). Until that index lands
// the most truthful per-card overlay is the claimed-paths count.
//
// The project-level execution-evidence strip rendered above the board
// surfaces the latest factory pipeline state (out-of-band of per-card
// data) and links into the run list.

const PATH_BEARING_EDGE_FIELDS = [
  "establishes",
  "extends",
  "refines",
  "coAuthority",
] as const;

/**
 * Distinct code paths claimed by this spec across all path-bearing
 * relationship edges. Operates over the opaque edge objects in
 * `relationshipFields` — each edge is one of:
 *   - `{ unit: { path: "..." } }`
 *   - `{ paths: ["..."] }` (refines edges that fan out)
 */
export function claimedCodePaths(spec: SpecListRow): string[] {
  const seen = new Set<string>();
  for (const field of PATH_BEARING_EDGE_FIELDS) {
    const edges = spec.relationshipFields[field];
    if (!Array.isArray(edges)) continue;
    for (const edge of edges) {
      collectEdgePaths(edge, seen);
    }
  }
  return [...seen];
}

function collectEdgePaths(edge: unknown, out: Set<string>): void {
  if (!edge || typeof edge !== "object") return;
  const obj = edge as Record<string, unknown>;

  const unit = obj.unit;
  if (unit && typeof unit === "object") {
    const path = (unit as Record<string, unknown>).path;
    if (typeof path === "string" && path.length > 0) out.add(path);
  }

  const paths = obj.paths;
  if (Array.isArray(paths)) {
    for (const p of paths) {
      if (typeof p === "string" && p.length > 0) out.add(p);
    }
  }
}

// ---------------------------------------------------------------------------
// Filters (FR-008)
// ---------------------------------------------------------------------------
//
// All filters are URL-driven so they survive page reload and are
// shareable. Empty/undefined fields are interpreted as "no filter on
// this dimension"; supplied fields match exactly (case-sensitive — the
// SpecListRow values come from frontmatter and are stable).
//
// `with-evidence: true` filters to specs that have at least one claimed
// code path (the honest per-card execution-evidence linkage today).

export interface BoardFilters {
  kind?: string;
  category?: string;
  risk?: string;
  owner?: string;
  /** When true, keep only specs with at least one claimed code path. */
  withEvidence?: boolean;
}

/** Read filter values from URL search params; no validation beyond shape. */
export function parseFiltersFromSearchParams(
  params: URLSearchParams,
): BoardFilters {
  const out: BoardFilters = {};
  const kind = params.get("kind");
  if (kind) out.kind = kind;
  const category = params.get("category");
  if (category) out.category = category;
  const risk = params.get("risk");
  if (risk) out.risk = risk;
  const owner = params.get("owner");
  if (owner) out.owner = owner;
  if (params.get("withEvidence") === "true") out.withEvidence = true;
  return out;
}

/** True when at least one filter is active. */
export function hasActiveFilters(filters: BoardFilters): boolean {
  return Boolean(
    filters.kind ??
      filters.category ??
      filters.risk ??
      filters.owner ??
      filters.withEvidence,
  );
}

export function applyFilters(
  specs: SpecListRow[],
  filters: BoardFilters,
): SpecListRow[] {
  if (!hasActiveFilters(filters)) return specs;
  return specs.filter((s) => specMatches(s, filters));
}

function specMatches(spec: SpecListRow, filters: BoardFilters): boolean {
  if (filters.kind && spec.kind !== filters.kind) return false;
  if (filters.category && !spec.categories.includes(filters.category)) {
    return false;
  }
  if (filters.risk && spec.risk !== filters.risk) return false;
  if (filters.owner && spec.owner !== filters.owner) return false;
  if (filters.withEvidence && claimedCodePaths(spec).length === 0) {
    return false;
  }
  return true;
}

export interface FilterFacet {
  value: string;
  count: number;
}

/**
 * Build sorted, unique facet lists for each filter dimension. Counts
 * reflect the *unfiltered* corpus so an operator can see the size of
 * each option before narrowing.
 */
export function buildFilterFacets(specs: SpecListRow[]): {
  kinds: FilterFacet[];
  categories: FilterFacet[];
  risks: FilterFacet[];
  owners: FilterFacet[];
} {
  const kinds = new Map<string, number>();
  const categories = new Map<string, number>();
  const risks = new Map<string, number>();
  const owners = new Map<string, number>();
  for (const s of specs) {
    if (s.kind) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
    for (const c of s.categories) {
      categories.set(c, (categories.get(c) ?? 0) + 1);
    }
    if (s.risk) risks.set(s.risk, (risks.get(s.risk) ?? 0) + 1);
    if (s.owner) owners.set(s.owner, (owners.get(s.owner) ?? 0) + 1);
  }
  return {
    kinds: facetMapToList(kinds),
    categories: facetMapToList(categories),
    risks: facetMapToList(risks),
    owners: facetMapToList(owners),
  };
}

function facetMapToList(m: Map<string, number>): FilterFacet[] {
  return [...m.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value));
}
