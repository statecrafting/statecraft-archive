// Spec 163 / spec 217: typed shapes for the spec-registry API surface.
//
// These types mirror the `spec-spine registry` JSON output. The spec-spine
// CLI is the only allowed reader of the committed .derived/spec-registry
// shards per spec 103; downstream code (Encore handlers, Remix loaders)
// consumes these typed shapes rather than re-parsing the registry JSON.

/**
 * One row from `spec-spine registry list --json`. Only fields the
 * Requirements view consumes are typed; unknown frontmatter falls
 * into `extraFrontmatter`.
 */
export interface SpecListRow {
  id: string;
  title: string;
  status: string;
  implementation: string;
  kind: string | null;
  /** Spec 147 grammar — categories are an array (a spec can be multi-tagged). */
  categories: string[];
  /** Spec 164 FR-008 — risk filter dimension. */
  risk: string | null;
  /** Spec 164 FR-008 — owner filter dimension. */
  owner: string | null;
  summary?: string | null;
  specPath: string;
  /** Frontmatter fields not promoted to typed columns. */
  extraFrontmatter?: Record<string, unknown>;
  /**
   * Spec 130 relationship-graph edges captured for grouping projections
   * (FR-003). Each edge value is opaque to the typed layer — the
   * grouping logic does the structural walk. We carry raw arrays here
   * rather than re-shaping them so future relationship fields surface
   * automatically.
   */
  relationshipFields: Record<string, unknown[]>;
  /** Presence-only signal for the provenance badge (FR-005). */
  hasDecompositionOrigin: boolean;
}

/**
 * One row from `spec-spine registry show <id> --json` plus an authored
 * markdown body (read directly from the on-disk spec.md file — the
 * body is not a compiled artifact, so the spec 103 governed-read
 * discipline does not apply to it).
 */
export interface SpecDetail extends SpecListRow {
  /** Authored markdown body of the spec.md file (frontmatter stripped). */
  body: string;
  /** All `references:` entries with their role + unit. */
  references: SpecReference[];
}

export interface SpecReference {
  role: string;
  unit: {
    kind: string;
    path?: string;
    file?: string;
    anchor?: string;
  };
}

/**
 * Outgoing + incoming relationship edges as projected by the relationship
 * graph (spec 130). The graph is the canonical representation; the
 * registry exposes both the typed edges and a derived `implements:`
 * projection for back-compat.
 */
export interface SpecRelationships {
  id: string;
  outgoing: SpecEdge[];
  incoming: SpecEdge[];
}

export interface SpecEdge {
  /** One of: extends, refines, supersedes, amends, establishes, co_authority, constrains. */
  kind: string;
  /** The other spec id at the far end of the edge. */
  otherSpec: string;
  /** Nature attribute when present (e.g. extends `additive` / `wrapping`). */
  nature?: string;
  /** Scope attribute when present (e.g. supersedes `full` / `partial`). */
  scope?: string;
}

/**
 * Aggregate response for the inventory loader (FR-001).
 *
 * `registryAvailable === false` means the project has no spec-spine yet —
 * the route renders the empty-state CTA (FR-007 / SC-005). When true,
 * `specs` is the flat inventory sorted by id.
 */
export interface SpecInventory {
  registryAvailable: boolean;
  specs: SpecListRow[];
}
