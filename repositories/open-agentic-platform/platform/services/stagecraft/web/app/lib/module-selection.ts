// Spec 227: dependency-aware module selection for the Create-project picker.
//
// The module catalog is a small DAG: `requires` are forward edges and a
// module's dependents are the reverse edges. Toggling a checkbox must keep the
// selection internally consistent across *transitive* edges, not just the
// direct neighbours:
//
//   - Checking a module pulls in every module it transitively requires
//     (check A when A -> B -> C selects A, B, C).
//   - Unchecking a module drops every module that transitively depends on it
//     (uncheck C when A -> B -> C removes C, B, and A). The previous
//     direct-only pass (`m.requires.includes(id)`) left orphaned dependents
//     checked; ai-review flagged this on #533 as adapter-driven `requires`
//     makes multi-hop chains likely (spec 227 Stage 2 nit, pulled forward).
//
// Conflicts declared by a newly-present module are removed, but a module pulled
// in as a (transitive) requirement is never removed by a conflict: a
// self-contradictory manifest that both requires and conflicts the same module
// keeps the requirement rather than half-applying it.
//
// Pure and catalog-shaped (no React, no server imports) so the graph logic is
// unit-testable and safe to import into the client bundle.

export interface ModuleGraphNode {
  id: string;
  requires: string[];
  conflicts: string[];
}

function indexById(
  modules: ModuleGraphNode[]
): Map<string, ModuleGraphNode> {
  return new Map(modules.map((m) => [m.id, m]));
}

/** Ids `id` transitively requires (forward-edge closure, excludes `id`). */
function transitiveRequires(
  byId: Map<string, ModuleGraphNode>,
  id: string
): Set<string> {
  const out = new Set<string>();
  const queue = [...(byId.get(id)?.requires ?? [])];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    if (out.has(next)) continue;
    out.add(next);
    queue.push(...(byId.get(next)?.requires ?? []));
  }
  // A requires-cycle back to `id` can re-add it; the contract excludes `id`.
  out.delete(id);
  return out;
}

/** Ids that transitively depend on `id` (reverse-edge closure, excludes `id`). */
function transitiveDependents(
  modules: ModuleGraphNode[],
  id: string
): Set<string> {
  const out = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const target = queue.shift() as string;
    for (const m of modules) {
      if (m.id !== id && !out.has(m.id) && m.requires.includes(target)) {
        out.add(m.id);
        queue.push(m.id);
      }
    }
  }
  return out;
}

/**
 * Resolve the next selected-module set after toggling `id`. Returns a new Set;
 * the input `selected` is not mutated.
 */
export function applyModuleToggle(
  modules: ModuleGraphNode[],
  selected: ReadonlySet<string>,
  id: string,
  checked: boolean
): Set<string> {
  const byId = indexById(modules);
  const next = new Set(selected);

  if (checked) {
    const added = new Set<string>([id, ...transitiveRequires(byId, id)]);
    for (const a of added) next.add(a);
    // Drop modules that conflict with anything now present. Requirements win:
    // a module we just pulled in is never removed, so a manifest that both
    // requires and conflicts the same module keeps the requirement.
    for (const a of added) {
      for (const c of byId.get(a)?.conflicts ?? []) {
        if (!added.has(c)) next.delete(c);
      }
    }
  } else {
    next.delete(id);
    for (const d of transitiveDependents(modules, id)) next.delete(d);
  }

  return next;
}
