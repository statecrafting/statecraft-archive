/**
 * Spec 198 — governance-envelope admission gate.
 *
 * A factory is admissible iff it files a governance envelope that
 * (a) conforms to the envelope schema and (b) reconciles against its own
 * atomic declarations (FR-001/FR-003, two-sided + fail-closed). This module
 * evaluates admissibility over substrate rows, resolves each adapter's
 * scaffold source against the org's `factory_upstreams` (spec 199 FR-009 /
 * D-5 — resolution-at-admission), persists the admission record, and exposes
 * the serve/bind check helpers (FR-010 revocations included).
 *
 * The Rust twin of the reconcile rules lives in
 * `crates/factory-contracts/src/governance_envelope.rs`; the two MUST agree.
 * Canonical schema: `standards/schemas/factory/governance-envelope.schema.yaml`.
 */

import log from "encore.dev/log";
import { APIError } from "encore.dev/api";
import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { parse as parseYaml } from "yaml";
import { db } from "../db/drizzle";
import {
  factoryAdmissions,
  factoryArtifactSubstrate,
  factoryRevocations,
  factoryUpstreams,
} from "../db/schema";
import { signFactoryJws, signingConfigured } from "./signing";
import { sweepContentHashRevocations } from "./overrideScanCore";
import { isHaltedInScope } from "./orgHalt";

// ---------------------------------------------------------------------------
// Contract shapes (mirrors of the canonical YAML schema / Rust twin)
// ---------------------------------------------------------------------------

export const GOVERNANCE_ENVELOPE_SCHEMA_VERSION = "1.0.0";
export const ADAPTER_MANIFEST_ADMISSIBLE_VERSION = "1.1.0";

type TierValue = "tier1" | "tier2" | "tier3";
type MutationValue = "read-only" | "scoped-write" | "read-write" | "full";

const TIER_ORDER: Record<TierValue, number> = {
  tier1: 1,
  tier2: 2,
  tier3: 3,
};

// Spec 198 FR-003 mutation lattice: read-only < scoped-write < read-write < full.
const MUTATION_ORDER: Record<MutationValue, number> = {
  "read-only": 0,
  "scoped-write": 1,
  "read-write": 2,
  full: 3,
};

export type GovernanceEnvelope = {
  schema_version: string;
  process: {
    id: string;
    objective_class: string;
    goal_identifier_scheme: string;
  };
  ceilings: { max_tier: TierValue; max_mutation: MutationValue };
  gates: Array<{ predicate: string; description?: string }>;
  emits: Array<{ kind: string }>;
  constituents: { agents: string };
  overrides: { require_verified: boolean };
};

export type AdapterGovernance = {
  max_tier: TierValue;
  file_write_scope: string[];
  file_write_denied?: string[];
  allowed_commands_from: string;
  scaffold_execution: {
    entry_points_from?: string[];
    setup_commands_from: string;
    isolation: string;
  };
  agents_from: string;
};

/** The substrate-row slice the evaluator needs (sync drafts and read-time
 * rows both satisfy it). */
export type AdmissionRow = {
  origin: string;
  path: string;
  kind: string;
  body: string;
  contentHash: string;
  frontmatter: Record<string, unknown> | null;
};

export type ScaffoldResolution = {
  source_id: string;
  repo_url: string;
  ref: string;
};

export type AdmissionEvaluation = {
  status: "admitted" | "refused";
  violations: string[];
  envelopeHash: string | null;
  /** FR-004: composition preserved — process + per-adapter, never flattened. */
  composed: {
    process: GovernanceEnvelope | null;
    adapters: Record<
      string,
      { governance: AdapterGovernance; manifestHash: string }
    >;
    agentDigests: Record<string, string>;
    /** path → declared agent id (frontmatter). FR-010 agent-key revocations
     * are checked against these at grant issuance/renewal. Absent on
     * admission rows persisted before phase 4 (a re-sync backfills). */
    agentIds?: Record<string, string>;
  } | null;
  scaffoldResolutions: Record<string, ScaffoldResolution>;
};

// ---------------------------------------------------------------------------
// Evaluation (pure — no I/O; callers feed rows + upstreams)
// ---------------------------------------------------------------------------

export type UpstreamRef = {
  sourceId: string;
  repoUrl: string;
  ref: string;
};

export function evaluateFactoryAdmission(input: {
  factoryOrigin: string;
  rows: AdmissionRow[];
  upstreams: UpstreamRef[];
}): AdmissionEvaluation {
  const { factoryOrigin, rows, upstreams } = input;
  const violations: string[] = [];
  const factoryRows = rows.filter((r) => r.origin === factoryOrigin);

  // ── 1. The process envelope must exist and conform (⊨ schema) ─────
  const envelopeRow = factoryRows.find(
    (r) => r.kind === "governance-envelope",
  );
  if (!envelopeRow) {
    return refusal(
      [
        `factory '${factoryOrigin}' files no governance envelope ` +
          `(expected process/governance-envelope.yaml — spec 198 FR-001; ` +
          `an inadmissible factory is not served or bound)`,
      ],
      null,
      null,
      {},
    );
  }

  const envelope = parseEnvelope(envelopeRow.body, violations);
  if (!envelope) {
    return refusal(violations, envelopeRow.contentHash, null, {});
  }

  // ── 2. Process-layer reconcile (⊨ constituents) ────────────────────
  const processAgentRows = factoryRows.filter((r) =>
    matchesGlob(envelope.constituents.agents, r.path),
  );
  if (processAgentRows.length === 0) {
    violations.push(
      `constituents.agents glob '${envelope.constituents.agents}' matches no rows — ` +
        `the envelope must point at the agent frontmatter it composes`,
    );
  }
  const agentDigests: Record<string, string> = {};
  const agentIds: Record<string, string> = {};
  for (const row of processAgentRows) {
    const facts = agentFacts(row);
    agentDigests[row.path] = row.contentHash;
    agentIds[row.path] = facts.id;
    reconcileAgainstCeilings(
      facts,
      envelope.ceilings.max_tier,
      envelope.ceilings.max_mutation,
      violations,
    );
  }

  // ── 3. Adapter sub-envelopes (FR-004 composition; FR-012 home) ─────
  const adapters: Record<
    string,
    { governance: AdapterGovernance; manifestHash: string }
  > = {};
  const scaffoldResolutions: Record<string, ScaffoldResolution> = {};
  const manifestRows = factoryRows.filter((r) => r.kind === "adapter-manifest");
  if (manifestRows.length === 0) {
    violations.push(
      `factory '${factoryOrigin}' carries no adapter manifest — nothing to hand off to`,
    );
  }

  for (const manifestRow of manifestRows) {
    const adapterDir = manifestRow.path.replace(/\/manifest\.yaml$/, "");
    let manifest: Record<string, unknown>;
    try {
      manifest = parseYaml(manifestRow.body) as Record<string, unknown>;
    } catch (e) {
      violations.push(
        `${manifestRow.path}: manifest YAML does not parse (${String(e)})`,
      );
      continue;
    }
    const adapterName =
      str(get(manifest, "adapter", "name")) ?? `(unnamed:${manifestRow.path})`;
    const schemaVersion = str(manifest.schema_version);

    if (schemaVersion !== ADAPTER_MANIFEST_ADMISSIBLE_VERSION) {
      violations.push(
        `adapter '${adapterName}' manifest is schema_version '${schemaVersion ?? "(absent)"}' — ` +
          `admission requires ${ADAPTER_MANIFEST_ADMISSIBLE_VERSION} with a governance: section ` +
          `(1.0.0 manifests are servable but not admissible — spec 198 FR-012)`,
      );
      continue;
    }
    const governance = manifest.governance as AdapterGovernance | undefined;
    if (!governance || typeof governance !== "object") {
      violations.push(
        `adapter '${adapterName}' manifest (1.1.0) has no governance: section — spec 198 FR-012`,
      );
      continue;
    }
    validateSubEnvelopeShape(adapterName, governance, violations);

    // Reconcile adapter agents against the sub-envelope.
    const agentMap = (manifest.agents ?? {}) as Record<string, unknown>;
    const agentPaths = Object.values(agentMap)
      .filter((v): v is string => typeof v === "string")
      .map((rel) => `${adapterDir}/${rel}`);
    if (agentPaths.length === 0) {
      violations.push(
        `adapter '${adapterName}' declares no agents — the behavioral manifest is empty (ASI10 m5)`,
      );
    }
    for (const agentPath of agentPaths) {
      const row = factoryRows.find((r) => r.path === agentPath);
      if (!row) {
        violations.push(
          `adapter '${adapterName}' agents map points at '${agentPath}' but no substrate row exists (fail-closed)`,
        );
        continue;
      }
      const facts = agentFacts(row);
      agentDigests[row.path] = row.contentHash;
      agentIds[row.path] = facts.id;
      reconcileAdapterAgent(facts, governance, violations);
    }

    // Spec 199 FR-009 / D-5 — scaffold source resolved at admission.
    const source = get(manifest, "scaffold", "source") as
      | Record<string, unknown>
      | string
      | undefined;
    if (typeof source === "object" && source !== null) {
      const remote = str(source.remote);
      const defaultRef = str(source.default_ref) ?? "main";
      if (!remote) {
        violations.push(
          `adapter '${adapterName}' scaffold.source has no remote — nothing to resolve`,
        );
      } else {
        const match = upstreams.find(
          (u) =>
            normalizeRepoIdentity(u.repoUrl) === normalizeRepoIdentity(remote),
        );
        if (!match) {
          violations.push(
            `adapter '${adapterName}' scaffold.source.remote '${remote}' resolves to no ` +
              `factory_upstreams row for this org — register the upstream at ` +
              `/app/factory/upstreams before admission (spec 199 FR-009)`,
          );
        } else {
          scaffoldResolutions[adapterName] = {
            source_id: match.sourceId,
            repo_url: match.repoUrl,
            ref: match.ref || defaultRef,
          };
        }
      }
    }
    // A Local (vendored) scaffold source needs no resolution.

    adapters[adapterName] = {
      governance,
      manifestHash: manifestRow.contentHash,
    };
  }

  if (violations.length > 0) {
    return refusal(
      violations,
      envelopeRow.contentHash,
      { process: envelope, adapters, agentDigests, agentIds },
      scaffoldResolutions,
    );
  }
  return {
    status: "admitted",
    violations: [],
    envelopeHash: envelopeRow.contentHash,
    composed: { process: envelope, adapters, agentDigests, agentIds },
    scaffoldResolutions,
  };
}

function refusal(
  violations: string[],
  envelopeHash: string | null,
  composed: AdmissionEvaluation["composed"],
  scaffoldResolutions: Record<string, ScaffoldResolution>,
): AdmissionEvaluation {
  return { status: "refused", violations, envelopeHash, composed, scaffoldResolutions };
}

// ---------------------------------------------------------------------------
// Envelope parse + shape conformance (⊨ schema; mirrors the Rust semantics)
// ---------------------------------------------------------------------------

function parseEnvelope(
  body: string,
  violations: string[],
): GovernanceEnvelope | null {
  let raw: Record<string, unknown>;
  try {
    raw = parseYaml(body) as Record<string, unknown>;
  } catch (e) {
    violations.push(`governance envelope YAML does not parse (${String(e)})`);
    return null;
  }
  if (!raw || typeof raw !== "object") {
    violations.push("governance envelope is not a YAML mapping");
    return null;
  }
  const v = (msg: string) => violations.push(`governance envelope: ${msg}`);

  if (str(raw.schema_version) !== GOVERNANCE_ENVELOPE_SCHEMA_VERSION) {
    v(
      `unsupported schema_version '${str(raw.schema_version) ?? "(absent)"}' ` +
        `(expected ${GOVERNANCE_ENVELOPE_SCHEMA_VERSION})`,
    );
  }
  const processId = str(get(raw, "process", "id"));
  const objective = str(get(raw, "process", "objective_class"));
  const goalScheme = str(get(raw, "process", "goal_identifier_scheme"));
  if (!processId) v("process.id is empty");
  if (!objective) {
    v("process.objective_class is empty (intent-capsule template — ASI01 m5)");
  }
  const maxTier = str(get(raw, "ceilings", "max_tier")) as TierValue | undefined;
  const maxMutation = str(get(raw, "ceilings", "max_mutation")) as
    | MutationValue
    | undefined;
  if (!maxTier || !(maxTier in TIER_ORDER)) {
    v(`ceilings.max_tier '${maxTier ?? "(absent)"}' is not a tier value`);
  }
  if (!maxMutation || !(maxMutation in MUTATION_ORDER)) {
    v(
      `ceilings.max_mutation '${maxMutation ?? "(absent)"}' is not in the FR-003 grammar`,
    );
  }
  const emits = Array.isArray(raw.emits) ? raw.emits : [];
  if (emits.length === 0) {
    v("emits is empty (a run that emits nothing is not governable)");
  }
  const constituentsAgents = str(get(raw, "constituents", "agents"));
  if (!constituentsAgents) v("constituents.agents is empty");
  const requireVerified = get(raw, "overrides", "require_verified");
  if (typeof requireVerified !== "boolean") {
    v("overrides.require_verified must be a boolean (ASI06 m9 predicate)");
  }

  if (violations.length > 0) return null;
  return {
    schema_version: str(raw.schema_version)!,
    process: {
      id: processId!,
      objective_class: objective!,
      goal_identifier_scheme: goalScheme ?? "",
    },
    ceilings: { max_tier: maxTier!, max_mutation: maxMutation! },
    gates: (Array.isArray(raw.gates) ? raw.gates : []).map((g) => ({
      predicate: str((g as Record<string, unknown>)?.predicate) ?? "",
      description: str((g as Record<string, unknown>)?.description),
    })),
    emits: emits.map((e) => ({
      kind: str((e as Record<string, unknown>)?.kind) ?? "",
    })),
    constituents: { agents: constituentsAgents! },
    overrides: { require_verified: requireVerified as boolean },
  };
}

function validateSubEnvelopeShape(
  adapterName: string,
  gov: AdapterGovernance,
  violations: string[],
): void {
  const v = (msg: string) => violations.push(`adapter '${adapterName}': ${msg}`);
  if (!gov.max_tier || !(gov.max_tier in TIER_ORDER)) {
    v(`governance.max_tier '${gov.max_tier}' is not a tier value`);
  }
  if (!Array.isArray(gov.file_write_scope) || gov.file_write_scope.length === 0) {
    v(
      "governance.file_write_scope is empty (an adapter that writes nowhere scaffolds nothing)",
    );
  }
  if (gov.allowed_commands_from !== "commands") {
    v(
      `governance.allowed_commands_from '${gov.allowed_commands_from}' — only defined value is 'commands'`,
    );
  }
  if (gov.agents_from !== "agents") {
    v(`governance.agents_from '${gov.agents_from}' — only defined value is 'agents'`);
  }
  if (gov.scaffold_execution?.isolation !== "sandbox-required") {
    v(
      `governance.scaffold_execution.isolation '${gov.scaffold_execution?.isolation}' — ` +
        `only defined value is 'sandbox-required' (fail-closed on unknown isolation)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Agent frontmatter facts + reconcile (mirror of governance_envelope.rs)
// ---------------------------------------------------------------------------

type AgentFacts = {
  id: string;
  tier: TierValue | null;
  mutation: MutationValue | null;
  mutationScope: string[];
};

function agentFacts(row: AdmissionRow): AgentFacts {
  const fm = row.frontmatter ?? {};
  const id = str(fm.id) ?? str(fm.name) ?? row.path;
  // spec 054 alias: `tier: 1|2|3` accepted alongside `safety_tier: tierN`.
  let tier = str(fm.safety_tier) as TierValue | null;
  if (!tier && typeof fm.tier === "number") {
    tier = `tier${fm.tier}` as TierValue;
  }
  if (tier && !(tier in TIER_ORDER)) tier = null;
  let mutation = str(fm.mutation) as MutationValue | null;
  if (mutation && !(mutation in MUTATION_ORDER)) {
    // Free-form mutation values are non-conformant (FR-003) — surface as
    // missing so the violation is attributable and fail-closed.
    mutation = null;
  }
  const mutationScope = Array.isArray(fm.mutation_scope)
    ? fm.mutation_scope.filter((s): s is string => typeof s === "string")
    : [];
  return { id, tier, mutation, mutationScope };
}

function reconcileAgainstCeilings(
  agent: AgentFacts,
  maxTier: TierValue,
  maxMutation: MutationValue,
  violations: string[],
): void {
  if (!agent.tier) {
    violations.push(`agent '${agent.id}' declares no safety_tier (fail-closed)`);
  } else if (TIER_ORDER[agent.tier] > TIER_ORDER[maxTier]) {
    violations.push(
      `agent '${agent.id}' declares safety_tier ${agent.tier} above the envelope ceiling ${maxTier}`,
    );
  }
  if (!agent.mutation) {
    violations.push(
      `agent '${agent.id}' declares no (or a non-grammar) mutation (fail-closed; FR-003 grammar: read-only | scoped-write | read-write | full)`,
    );
  } else if (MUTATION_ORDER[agent.mutation] > MUTATION_ORDER[maxMutation]) {
    violations.push(
      `agent '${agent.id}' declares mutation ${agent.mutation} above the envelope ceiling ${maxMutation}`,
    );
  } else if (agent.mutation === "scoped-write" && agent.mutationScope.length === 0) {
    violations.push(
      `agent '${agent.id}' declares scoped-write without a mutation_scope`,
    );
  }
}

function reconcileAdapterAgent(
  agent: AgentFacts,
  gov: AdapterGovernance,
  violations: string[],
): void {
  if (!agent.tier) {
    violations.push(`agent '${agent.id}' declares no safety_tier (fail-closed)`);
  } else if (TIER_ORDER[agent.tier] > TIER_ORDER[gov.max_tier]) {
    violations.push(
      `agent '${agent.id}' declares safety_tier ${agent.tier} above the adapter ceiling ${gov.max_tier}`,
    );
  }
  if (!agent.mutation) {
    violations.push(
      `agent '${agent.id}' declares no (or a non-grammar) mutation (fail-closed)`,
    );
    return;
  }
  if (agent.mutation === "full") {
    violations.push(
      `agent '${agent.id}' declares mutation 'full' — unscoped write exceeds the scaffold boundary`,
    );
    return;
  }
  if (agent.mutation === "scoped-write") {
    if (agent.mutationScope.length === 0) {
      violations.push(
        `agent '${agent.id}' declares scoped-write without a mutation_scope`,
      );
    }
    for (const scope of agent.mutationScope) {
      if (!coveredBy(scope, gov.file_write_scope)) {
        violations.push(
          `agent '${agent.id}' mutation_scope '${scope}' is not covered by the adapter's file_write_scope`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Conservative glob coverage + minimal constituent glob (fail-closed)
// ---------------------------------------------------------------------------

/** Mirror of `governance_envelope::covered_by` — exact match or a
 * `<prefix>/**` write glob covering anything at/under `<prefix>`. Unknown
 * pattern shapes are NOT covered. */
export function coveredBy(scope: string, writeGlobs: string[]): boolean {
  return writeGlobs.some((w) => {
    if (w === scope) return true;
    if (w.endsWith("/**")) {
      const prefix = w.slice(0, -3);
      return scope === prefix || scope.startsWith(`${prefix}/`);
    }
    return false;
  });
}

/** Minimal glob for `constituents.agents` (e.g. `process/agents/*.md`):
 * `*` matches within a segment, `**` across segments. Anything else is a
 * literal. */
export function matchesGlob(glob: string, path: string): boolean {
  const re = new RegExp(
    "^" +
      glob
        .split(/(\*\*|\*)/)
        .map((part) => {
          if (part === "**") return ".*";
          if (part === "*") return "[^/]*";
          return part.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        })
        .join("") +
      "$",
  );
  return re.test(path);
}

function normalizeRepoIdentity(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\/[^/]+\//, "");
  s = s.replace(/^ssh:\/\/[^/]+\//, "");
  s = s.replace(/^git@[^:]+:/, "");
  s = s.replace(/\.git$/, "");
  s = s.replace(/^\/+|\/+$/g, "");
  const segments = s.split("/");
  return segments.slice(0, 2).join("/");
}

function get(
  obj: Record<string, unknown>,
  ...keys: string[]
): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

// ---------------------------------------------------------------------------
// Persistence + standing-state checks (serve / bind / grant consult these)
// ---------------------------------------------------------------------------

/**
 * FR-014 admission seal claims. The composition is already content-addressed
 * (substrate hashes), so the seal binds those hashes directly — a verifier
 * recomputes the hash of any served body and checks membership; no
 * cross-language canonical-JSON is involved (the JWS payload bytes are the
 * truth).
 */
export function buildSealClaims(
  orgId: string,
  origin: string,
  factorySha: string | null,
  evaluation: AdmissionEvaluation,
): Record<string, unknown> {
  const adapterManifestHashes: Record<string, string> = {};
  for (const [name, a] of Object.entries(evaluation.composed?.adapters ?? {})) {
    adapterManifestHashes[name] = a.manifestHash;
  }
  return {
    org_id: orgId,
    origin,
    envelope_hash: evaluation.envelopeHash,
    adapter_manifest_hashes: adapterManifestHashes,
    agent_digests: evaluation.composed?.agentDigests ?? {},
    scaffold_resolutions: evaluation.scaffoldResolutions,
    factory_sha: factorySha,
    iat: Math.floor(Date.now() / 1000),
  };
}

export async function persistAdmission(
  orgId: string,
  origin: string,
  factorySha: string | null,
  evaluation: AdmissionEvaluation,
): Promise<void> {
  let sealJws: string | null = null;
  let sealedAt: Date | null = null;
  if (evaluation.status === "admitted") {
    if (signingConfigured()) {
      const claims = buildSealClaims(orgId, origin, factorySha, evaluation);
      sealJws = signFactoryJws("oap-admission-seal+jws", claims).jws;
      sealedAt = new Date();
    } else {
      log.warn(
        "factory admission admitted but UNSEALED — signing authority not " +
          "configured (FR-014); the OPC engine refuses unsealed admissions " +
          "fail-closed",
        { orgId, origin },
      );
    }
  }
  await db.insert(factoryAdmissions).values({
    orgId,
    origin,
    status: evaluation.status,
    envelopeHash: evaluation.envelopeHash,
    composed: evaluation.composed,
    violations: evaluation.violations,
    scaffoldResolutions: evaluation.scaffoldResolutions,
    factorySha,
    sealJws,
    sealedAt,
  });
  log.info("factory admission evaluated", {
    orgId,
    origin,
    status: evaluation.status,
    sealed: sealJws !== null,
    violations: evaluation.violations.length,
  });
}

export type AdmissionState = {
  status: "admitted" | "refused" | "unevaluated";
  violations: string[];
  scaffoldResolutions: Record<string, ScaffoldResolution>;
  envelopeHash: string | null;
  /** FR-014 admission seal (compact JWS); null = unsealed. */
  sealJws: string | null;
  /** The composed admitted envelope (FR-004); the grant path sweeps its
   * nodes against FR-010 revocations. */
  composed: AdmissionEvaluation["composed"];
};

export async function loadLatestAdmission(
  orgId: string,
  origin: string,
): Promise<AdmissionState> {
  const rows = await db
    .select()
    .from(factoryAdmissions)
    .where(
      and(
        eq(factoryAdmissions.orgId, orgId),
        eq(factoryAdmissions.origin, origin),
      ),
    )
    .orderBy(desc(factoryAdmissions.createdAt))
    .limit(1);
  if (rows.length === 0) {
    return {
      status: "unevaluated",
      violations: [],
      scaffoldResolutions: {},
      envelopeHash: null,
      sealJws: null,
      composed: null,
    };
  }
  const row = rows[0];
  return {
    status: row.status,
    violations: (row.violations as string[]) ?? [],
    scaffoldResolutions:
      (row.scaffoldResolutions as Record<string, ScaffoldResolution>) ?? {},
    envelopeHash: row.envelopeHash,
    sealJws: row.sealJws,
    composed: (row.composed as AdmissionEvaluation["composed"]) ?? null,
  };
}

/** FR-010: any unlifted revocation for (scope, key), org-scoped or global. */
export async function hasActiveRevocation(
  orgId: string,
  scopeKind: "factory" | "adapter" | "agent" | "content-hash",
  key: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: factoryRevocations.id })
    .from(factoryRevocations)
    .where(
      and(
        eq(factoryRevocations.scopeKind, scopeKind),
        eq(factoryRevocations.key, key),
        isNull(factoryRevocations.liftedAt),
        or(
          eq(factoryRevocations.orgId, sql`${orgId}::uuid`),
          isNull(factoryRevocations.orgId),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * The standing admission verdict the serve/bind paths consult (spec 198
 * FR-001; spec 199 FR-006). Fail-closed: unevaluated counts as not admitted.
 */
export async function isFactoryAdmitted(
  orgId: string,
  origin: string,
): Promise<{ admitted: boolean; reason: string | null }> {
  const state = await loadLatestAdmission(orgId, origin);
  if (state.status !== "admitted") {
    return {
      admitted: false,
      reason:
        state.status === "unevaluated"
          ? `factory '${origin}' has no admission evaluation — run /factory-sync (spec 198 FR-001)`
          : `factory '${origin}' was refused admission: ${state.violations[0] ?? "see admission record"}`,
    };
  }
  // Spec 208 FR-001: an active org-scoped halt makes serve/bind fail-closed,
  // alongside the revocation checks (the switch reuses these check sites). The
  // origin is a factory origin, not a project, so only org-scoped halts gate
  // here; project-scoped refusal is exact at the grant seam (which carries
  // projectId). Agent-profile scope is rejected at the verb in Phase 1.
  const haltId = await isHaltedInScope(orgId);
  if (haltId) {
    return {
      admitted: false,
      reason: `org halt ${haltId} is active: factory '${origin}' is unavailable (spec 208 FR-001)`,
    };
  }
  if (await hasActiveRevocation(orgId, "factory", origin)) {
    return {
      admitted: false,
      reason: `factory '${origin}' is revoked or quarantined (spec 198 FR-010)`,
    };
  }
  if (
    state.envelopeHash &&
    (await hasActiveRevocation(orgId, "content-hash", state.envelopeHash))
  ) {
    return {
      admitted: false,
      reason: `factory '${origin}' admitted envelope hash is revoked (spec 198 FR-010)`,
    };
  }
  return { admitted: true, reason: null };
}

// ---------------------------------------------------------------------------
// Override consumption (spec 198 FR-013 c) — collection + envelope predicate
// ---------------------------------------------------------------------------

/** One override a run will consume — bound into the run's certificate by
 * the engine (traceable + revocable via FR-010 content-hash keys). */
export type ConsumedOverride = {
  artifactId: string;
  path: string;
  contentHash: string;
  /** Rauthy subject that authored the revision (FR-013 b). */
  author: string | null;
  modifiedAt: string | null;
  verified: boolean;
  verifiedBy: string | null;
};

/**
 * Collect the active overrides on the admitted factory's content and
 * enforce the envelope's consumption predicate: when the admitted
 * envelope declares `overrides.require_verified: true`, an unverified
 * override refuses the whole serve fail-closed — serving upstream content
 * instead would silently swap what the org configured, and serving the
 * unverified override would violate the filed org policy (ASI06 m3/m9).
 *
 * User-authored agent rows are a separate trust class with their own
 * publication gate (spec 111 `publication_status`); the envelope predicate
 * governs overrides of the admitted factory's content only.
 */
export async function collectConsumedOverrides(
  orgId: string,
  origin: string,
  composed: AdmissionEvaluation["composed"],
): Promise<ConsumedOverride[]> {
  const rows = await db
    .select({
      id: factoryArtifactSubstrate.id,
      path: factoryArtifactSubstrate.path,
      contentHash: factoryArtifactSubstrate.contentHash,
      userModifiedAt: factoryArtifactSubstrate.userModifiedAt,
      userModifiedBy: factoryArtifactSubstrate.userModifiedBy,
      userBodyVerified: factoryArtifactSubstrate.userBodyVerified,
      verifiedBy: factoryArtifactSubstrate.verifiedBy,
    })
    .from(factoryArtifactSubstrate)
    .where(
      and(
        eq(factoryArtifactSubstrate.orgId, orgId),
        eq(factoryArtifactSubstrate.origin, origin),
        eq(factoryArtifactSubstrate.status, "active"),
        isNotNull(factoryArtifactSubstrate.userBody),
      ),
    )
    .orderBy(factoryArtifactSubstrate.path);

  // Spec 200 FR-003(a) — consumed-override content hashes join the
  // revocation sweep. Checked BEFORE the verified predicate: quarantine
  // wins regardless of `user_body_verified` (FR-006), and a hit refuses
  // the whole serve fail-closed, mirroring the verified-predicate refusal.
  const quarantine = await sweepContentHashRevocations(
    orgId,
    rows.map((r) => r.contentHash),
  );
  if (quarantine) {
    const hitRow = rows.find((r) => r.contentHash === quarantine.key);
    throw APIError.failedPrecondition(
      `artifact '${hitRow?.path ?? "(unknown)"}' (${hitRow?.id ?? quarantine.key}) ` +
        `carries an override whose content hash is ${quarantine.mode} ` +
        `(revocation ${quarantine.revocationId}) — lift the quarantine or ` +
        `revise the override (spec 198 FR-010 / spec 200 FR-003)`,
    );
  }

  const requireVerified =
    composed?.process?.overrides?.require_verified === true;
  if (requireVerified) {
    const unverified = rows.find((r) => !r.userBodyVerified);
    if (unverified) {
      throw APIError.failedPrecondition(
        `artifact '${unverified.path}' (${unverified.id}) carries an unverified ` +
          `override and the admitted envelope declares ` +
          `overrides.require_verified: true — verify or clear the override ` +
          `(spec 198 FR-013 c)`,
      );
    }
  }

  return rows.map((r) => ({
    artifactId: r.id,
    path: r.path,
    contentHash: r.contentHash,
    author: r.userModifiedBy,
    modifiedAt: r.userModifiedAt ? r.userModifiedAt.toISOString() : null,
    verified: r.userBodyVerified,
    verifiedBy: r.verifiedBy,
  }));
}

// ---------------------------------------------------------------------------
// Sync-time entry — evaluate + persist from the freshly-mirrored substrate
// ---------------------------------------------------------------------------

export async function evaluateAndPersistFromSync(input: {
  orgId: string;
  factoryOrigin: string;
  factorySha: string;
  rows: Array<{
    origin: string;
    path: string;
    kind: string;
    upstreamBody: string;
    contentHash: string;
    frontmatter: Record<string, unknown> | null;
  }>;
}): Promise<AdmissionEvaluation> {
  const upstreamRows = await db
    .select({
      sourceId: factoryUpstreams.sourceId,
      repoUrl: factoryUpstreams.repoUrl,
      ref: factoryUpstreams.ref,
    })
    .from(factoryUpstreams)
    .where(eq(factoryUpstreams.orgId, input.orgId));

  const evaluation = evaluateFactoryAdmission({
    factoryOrigin: input.factoryOrigin,
    rows: input.rows.map((r) => ({
      origin: r.origin,
      path: r.path,
      kind: r.kind,
      body: r.upstreamBody,
      contentHash: r.contentHash,
      frontmatter: r.frontmatter,
    })),
    upstreams: upstreamRows,
  });
  await persistAdmission(
    input.orgId,
    input.factoryOrigin,
    input.factorySha,
    evaluation,
  );
  return evaluation;
}
