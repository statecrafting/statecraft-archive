// Spec 120: the capability contract (doc 04 §4). The engine's copy of the
// closed token vocabulary the contract crate fixes (B-1), the derivation of
// what a session requires and prefers from its profile and request (B-4),
// and the decision the driver seam makes before a process exists (B-5): a
// required token the driver lacks refuses, a preferred one degrades.
//
// The vocabulary is neutral; a token's payload may not be (the tool lists
// under `tool-allowlist` stay Claude-named, doc 04 D44). A token is added
// by a spec that names its enforcement, never here on its own.

// --- the vocabulary (B-1) ----------------------------------------------------

// Wire order. Every list derived from this set keeps it, so `applied` and
// `degraded` read the same on both sides of the wire.
export const CAPABILITIES = [
  "tool-allowlist",
  "max-turns",
  "mcp-config",
  "cost",
  "workspace-write",
  "hook-enforcement",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && (CAPABILITIES as readonly string[]).includes(value);
}

// The four request tokens the tier summarizes (B-2, doc 04 D46).
export const REQUEST_CAPABILITIES: readonly Capability[] = ["tool-allowlist", "max-turns", "mcp-config", "cost"];

// The tokens of the vocabulary that `set` contains, in wire order, without
// duplicates.
export function orderedCapabilities(set: readonly Capability[]): Capability[] {
  return CAPABILITIES.filter((c) => set.includes(c));
}

// Parse a list of tokens, refusing anything outside the vocabulary. The
// message names the accepted tokens, as the profile's refusals do.
export function parseCapabilityList(value: unknown, field: string): Capability[] {
  if (!Array.isArray(value)) throw new Error(`${field}: expected a list of capability tokens`);
  const out: Capability[] = [];
  for (const item of value) {
    if (!isCapability(item)) {
      throw new Error(`${field}: unknown capability ${JSON.stringify(item)}; accepted: ${CAPABILITIES.join(", ")}`);
    }
    out.push(item);
  }
  return orderedCapabilities(out);
}

// --- the tier, derived (B-2, B-7) -------------------------------------------

export type DerivedTier = "reference" | "basic";

// `reference` when the four request tokens are all supported, `basic`
// otherwise. The two boundary tokens are claims about confinement and
// enforcement that no tier summarizes.
export function tierFor(capabilities: readonly Capability[]): DerivedTier {
  return REQUEST_CAPABILITIES.every((c) => capabilities.includes(c)) ? "reference" : "basic";
}

// --- what a request needs (B-3, B-4) ----------------------------------------

export interface Requirements {
  readonly required: readonly Capability[];
  readonly preferred: readonly Capability[];
}

export const NO_REQUIREMENTS: Requirements = { required: [], preferred: [] };

// The shape of a request this derivation reads: the profile's posture and
// its `require` list, and the request fields that use a token.
export interface RequirementSource {
  readonly mode: "bypass" | "guarded";
  readonly allowedTools?: readonly string[];
  readonly disallowedTools?: readonly string[];
  readonly require?: readonly Capability[];
}

export interface RequestShape {
  readonly maxTurns?: number;
  readonly mcpConfigPath?: string;
  // Tokens the caller names beyond what the request implies.
  readonly requirements?: Requirements;
}

// B-4: the required set is the profile's `require` list plus whatever the
// caller required; the preferred set is the tokens the request actually
// uses. An MCP server set is required, not preferred: a session that asked
// for one and did not get it is the session 043 B-6 refused, and a verify
// stage without its browser server proves nothing.
export function requirementsFor(profile: RequirementSource, request: RequestShape): Requirements {
  const required: Capability[] = [...(profile.require ?? []), ...(request.requirements?.required ?? [])];
  const preferred: Capability[] = [...(request.requirements?.preferred ?? [])];
  const hasList = (l: readonly string[] | undefined): boolean => l !== undefined && l.length > 0;
  if (profile.mode === "guarded" || hasList(profile.allowedTools) || hasList(profile.disallowedTools)) {
    preferred.push("tool-allowlist");
  }
  if (request.maxTurns !== undefined) preferred.push("max-turns");
  if (request.mcpConfigPath !== undefined) required.push("mcp-config");
  preferred.push("cost");
  const req = orderedCapabilities(required);
  return { required: req, preferred: orderedCapabilities(preferred).filter((c) => !req.includes(c)) };
}

// --- the decision (B-5) ------------------------------------------------------

export interface CapabilityDecision {
  // Required tokens the driver does not support: the session is refused.
  readonly refused: readonly Capability[];
  // Preferred tokens the driver does not support: journaled, the session runs.
  readonly degraded: readonly Capability[];
}

export function decide(supported: readonly Capability[], requirements: Requirements): CapabilityDecision {
  return {
    refused: orderedCapabilities(requirements.required.filter((c) => !supported.includes(c))),
    degraded: orderedCapabilities(requirements.preferred.filter((c) => !supported.includes(c))),
  };
}

// The tokens a request uses, whether or not it named them (B-6): the same
// set the Rust core's `SpawnSpec::requested` derives, so both drivers'
// `session.init` agree. Wire order.
export function requestedCapabilities(profile: RequirementSource, request: RequestShape): Capability[] {
  const r = requirementsFor(profile, request);
  return orderedCapabilities([...r.required, ...r.preferred]);
}

// The wire payload: explicit lists, possibly empty.
export function requirementsPayload(requirements: Requirements): { required: Capability[]; preferred: Capability[] } {
  return { required: [...requirements.required], preferred: [...requirements.preferred] };
}

export function parseRequirements(value: unknown): Requirements {
  if (value === undefined || value === null) return NO_REQUIREMENTS;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("requirements: expected an object");
  const obj = value as Record<string, unknown>;
  return {
    required: obj.required === undefined || obj.required === null ? [] : parseCapabilityList(obj.required, "requirements.required"),
    preferred: obj.preferred === undefined || obj.preferred === null ? [] : parseCapabilityList(obj.preferred, "requirements.preferred"),
  };
}
