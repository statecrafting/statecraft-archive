// Spec 124 §4.1 — pure walker for AgentReference variants embedded in a
// process definition JSONB.
//
// Extracted from `runAgentRefs.ts` so unit tests can import it without
// pulling in the Encore.ts native runtime (the resolver imports `db` and
// `agentCatalog`, both of which trip the runtime's NAPI loader at module
// init under bare vitest).
//
// AgentReference is externally-tagged in serde (the Rust enum variant key
// is the outer JSON key). See `crates/factory-contracts/src/agent_reference.rs`.

/** Externally-tagged variants matching the Rust `AgentReference` serde
 *  shape. Each variant is a discriminated object with a single key. */
export type AgentRefVariant =
  | { by_id: { org_agent_id: string; version: number } }
  | { by_name: { name: string; version: number } }
  | { by_name_latest: { name: string } };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Probe a JSON node for the `AgentReference` shape. Returns the variant
 *  when matched, otherwise `null`. The test is structural: the node must
 *  contain *only* the discriminator key with the right inner shape. */
export function asAgentRef(node: unknown): AgentRefVariant | null {
  if (!isObject(node)) return null;
  const keys = Object.keys(node);
  if (keys.length !== 1) return null;
  const tag = keys[0];

  if (tag === "by_id") {
    const inner = node.by_id;
    if (!isObject(inner)) return null;
    const orgAgentId = inner.org_agent_id;
    const version = inner.version;
    if (typeof orgAgentId === "string" && typeof version === "number") {
      return { by_id: { org_agent_id: orgAgentId, version } };
    }
    return null;
  }

  if (tag === "by_name") {
    const inner = node.by_name;
    if (!isObject(inner)) return null;
    const name = inner.name;
    const version = inner.version;
    if (typeof name === "string" && typeof version === "number") {
      return { by_name: { name, version } };
    }
    return null;
  }

  if (tag === "by_name_latest") {
    const inner = node.by_name_latest;
    if (!isObject(inner)) return null;
    const name = inner.name;
    if (typeof name === "string") {
      return { by_name_latest: { name } };
    }
    return null;
  }

  return null;
}

/**
 * Recursively walk a JSON node, collecting every `AgentReference` variant
 * encountered. Stage-occurrence order is preserved by the depth-first walk
 * — process definitions list stages in pipeline order, so the output
 * `agents[]` aligns with stage execution order.
 */
export function walkForAgentRefs(
  node: unknown,
  out: AgentRefVariant[] = [],
): AgentRefVariant[] {
  const ref = asAgentRef(node);
  if (ref) {
    out.push(ref);
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) walkForAgentRefs(item, out);
    return out;
  }
  if (isObject(node)) {
    for (const value of Object.values(node)) walkForAgentRefs(value, out);
  }
  return out;
}
