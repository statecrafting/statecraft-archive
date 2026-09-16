// Spec 163 §2.2 / FR-003 — derived-group projections over a spec list.
//
// Grouping is *derived* — there is no `groups.yaml` and no new spec
// field. Every grouping decision is a pure function of fields already
// present on the registry row, walked at render time.
//
// All projections share a single shape (`DerivedGroup`) so the
// rendering layer stays projection-agnostic. Specs without a value
// for the projected dimension fall into the explicit "Ungrouped"
// bucket so they remain visible.

import type { SpecListRow } from "../../../api/specRegistry/types";

export type GroupingDimension =
  | "by-category"
  | "by-establishment-chain"
  | "by-supersession-chain";

export interface GroupingDimensionMeta {
  value: GroupingDimension;
  label: string;
}

export const GROUPING_DIMENSIONS: GroupingDimensionMeta[] = [
  { value: "by-category", label: "By category" },
  { value: "by-establishment-chain", label: "By establishment chain" },
  { value: "by-supersession-chain", label: "By supersession chain" },
];

/** A derived group. The id is stable across renders for a given dimension. */
export interface DerivedGroup {
  /** Stable composite id (e.g. "by-category:lifecycle"). */
  id: string;
  /** Display label — projection-specific. */
  label: string;
  specs: SpecListRow[];
}

const UNGROUPED_LABEL = "Ungrouped";

/**
 * Group specs by `category:` frontmatter (spec 147 grammar). Categories
 * are an array — a multi-categoried spec appears in every group it
 * declares. Specs with no category fall into the "Ungrouped" bucket
 * (and only there).
 */
function groupByCategory(specs: SpecListRow[]): DerivedGroup[] {
  const byCategory = new Map<string, SpecListRow[]>();
  const ungrouped: SpecListRow[] = [];
  for (const s of specs) {
    if (s.categories.length === 0) {
      ungrouped.push(s);
      continue;
    }
    for (const c of s.categories) {
      if (!byCategory.has(c)) byCategory.set(c, []);
      byCategory.get(c)!.push(s);
    }
  }
  const groups: DerivedGroup[] = [];
  for (const [key, rows] of byCategory.entries()) {
    groups.push({
      id: `by-category:${key}`,
      label: key,
      specs: sortById(rows),
    });
  }
  groups.sort((a, b) => a.label.localeCompare(b.label));
  if (ungrouped.length > 0) {
    groups.push({
      id: "by-category:_ungrouped",
      label: UNGROUPED_LABEL,
      specs: sortById(ungrouped),
    });
  }
  return groups;
}

/**
 * Group specs by union-find over an edge relation extracted from the
 * `extraFrontmatter` field. Used for both by-establishment-chain
 * (extends/establishes edges) and by-supersession-chain (supersedes
 * edges). Singletons (specs with no edges in this dimension) collapse
 * into a single "Ungrouped" bucket so the view does not explode into
 * one-row groups.
 */
function groupByUnionFind(
  specs: SpecListRow[],
  edgeExtractor: (s: SpecListRow) => string[],
  dimensionId: string
): DerivedGroup[] {
  const ids = specs.map((s) => s.id);
  const idSet = new Set(ids);
  const parent = new Map<string, string>();
  for (const id of ids) parent.set(id, id);

  function find(x: string): string {
    let cur = x;
    while (parent.get(cur) !== cur) {
      const p = parent.get(cur)!;
      parent.set(cur, parent.get(p) ?? p);
      cur = parent.get(cur)!;
    }
    return cur;
  }
  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const s of specs) {
    for (const other of edgeExtractor(s)) {
      if (idSet.has(other)) union(s.id, other);
    }
  }

  const byRoot = new Map<string, SpecListRow[]>();
  for (const s of specs) {
    const root = find(s.id);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root)!.push(s);
  }

  const groups: DerivedGroup[] = [];
  const ungrouped: SpecListRow[] = [];
  for (const [root, rows] of byRoot.entries()) {
    if (rows.length === 1) {
      // Singleton — collapse into ungrouped bucket below.
      ungrouped.push(rows[0]);
      continue;
    }
    const sorted = sortById(rows);
    groups.push({
      id: `${dimensionId}:${root}`,
      label: sorted[0].title,
      specs: sorted,
    });
  }
  groups.sort((a, b) => a.specs[0].id.localeCompare(b.specs[0].id));
  if (ungrouped.length > 0) {
    groups.push({
      id: `${dimensionId}:_ungrouped`,
      label: UNGROUPED_LABEL,
      specs: sortById(ungrouped),
    });
  }
  return groups;
}

function extractIdRef(value: unknown): string | null {
  // A relationship-graph edge can be either a bare string ("087") or
  // an object with { spec: "..." } / { specs: [...] } / { with_specs: [...] }.
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.spec === "string") return v.spec;
  }
  return null;
}

function arrayField(s: SpecListRow, name: string): unknown[] {
  const v = s.relationshipFields[name];
  return Array.isArray(v) ? v : [];
}

function extractEdges(s: SpecListRow, names: readonly string[]): string[] {
  const acc: string[] = [];
  for (const name of names) {
    for (const raw of arrayField(s, name)) {
      const ref = extractIdRef(raw);
      if (ref) acc.push(normaliseId(ref));
      // Some edge objects carry `specs:` or `with_specs:` arrays of strings.
      if (raw && typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        for (const k of ["specs", "with_specs"]) {
          const inner = obj[k];
          if (Array.isArray(inner)) {
            for (const it of inner) {
              if (typeof it === "string") acc.push(normaliseId(it));
            }
          }
        }
      }
    }
  }
  return acc;
}

/**
 * Edges in extraFrontmatter sometimes encode the bare "087" form, sometimes
 * the full slug. Match against the spec id by normalising to the bare
 * leading three-digit chunk.
 */
function normaliseId(idOrPrefix: string): string {
  const m = /^(\d{3})/.exec(idOrPrefix);
  return m ? m[1] : idOrPrefix;
}

/**
 * Union-find of specs whose ids share a numeric prefix appearing in
 * the edge extractor. We rewrite the parent map keyed by id-prefix
 * to avoid mismatches between e.g. "087" and "087-unified-workspace-architecture".
 */
function groupByUnionFindOnPrefix(
  specs: SpecListRow[],
  edgeFieldNames: readonly string[],
  dimensionId: string
): DerivedGroup[] {
  const idByPrefix = new Map<string, string>();
  for (const s of specs) {
    const p = normaliseId(s.id);
    if (!idByPrefix.has(p)) idByPrefix.set(p, s.id);
  }
  return groupByUnionFind(
    specs,
    (s) =>
      extractEdges(s, edgeFieldNames)
        .map((p) => idByPrefix.get(p))
        .filter((x): x is string => !!x),
    dimensionId
  );
}

function sortById(rows: SpecListRow[]): SpecListRow[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * FR-003 — derive the group set for a chosen projection dimension.
 */
export function buildDerivedGroups(
  specs: SpecListRow[],
  dimension: GroupingDimension
): DerivedGroup[] {
  switch (dimension) {
    case "by-category":
      return groupByCategory(specs);
    case "by-establishment-chain":
      // establishes + extends are the spec-130 "this code path's
      // authority chain" edges. Both contribute to the same cluster.
      return groupByUnionFindOnPrefix(
        specs,
        ["establishes", "extends"],
        "by-establishment-chain"
      );
    case "by-supersession-chain":
      return groupByUnionFindOnPrefix(
        specs,
        ["supersedes"],
        "by-supersession-chain"
      );
  }
}
