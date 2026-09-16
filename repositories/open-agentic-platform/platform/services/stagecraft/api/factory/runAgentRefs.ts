// Spec 124 §4.1 / T022 — agent-reference resolver for the reservation path.
//
// Walks a process-stage definition for embedded `AgentReference` instances
// (the externally-tagged enum from
// `crates/factory-contracts/src/agent_reference.rs`), then resolves each
// reference to a `(org_agent_id, version, content_hash)` triple. Spec 139
// Phase 4b — reads come from the substrate (`factory_artifact_substrate`
// filtered to `origin='user-authored'`, `kind='agent'`) and
// `factory_bindings` instead of the dropped `agent_catalog` /
// `project_agent_bindings`. The publication ternary recovers from
// `frontmatter.publication_status` — only `published` rows resolve.
//
// AgentReference JSON shape (externally-tagged, snake_case):
//   { "by_id":          { "org_agent_id": "...", "version": 3 } }
//   { "by_name":        { "name": "stage-cd",   "version": 2 } }
//   { "by_name_latest": { "name": "stage-cd"                  } }

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  factoryArtifactSubstrate,
  factoryBindings,
} from "../db/schema";
import type { FactoryRunSourceShas } from "../db/schema";
import {
  walkForAgentRefs,
  type AgentRefVariant,
} from "./agentRefWalker";
import { sweepContentHashRevocations } from "./overrideScanCore";

const AGENT_PATH_PREFIX = "user-authored/";
const AGENT_PATH_SUFFIX = ".md";

function pathFromName(name: string): string {
  return `${AGENT_PATH_PREFIX}${name}${AGENT_PATH_SUFFIX}`;
}

function nameFromPath(path: string): string {
  if (
    path.startsWith(AGENT_PATH_PREFIX) &&
    path.endsWith(AGENT_PATH_SUFFIX)
  ) {
    return path.slice(
      AGENT_PATH_PREFIX.length,
      path.length - AGENT_PATH_SUFFIX.length,
    );
  }
  return path;
}

/** Recover spec 111's draft|published|retired ternary from a substrate row. */
function recoverPublicationStatus(
  frontmatter: Record<string, unknown> | null,
  substrateStatus: "active" | "retired",
): "draft" | "published" | "retired" {
  if (substrateStatus === "retired") return "retired";
  const fm = frontmatter?.publication_status;
  if (fm === "published" || fm === "retired" || fm === "draft") return fm;
  return "draft";
}

// Re-export the pure walker so callers that already import from
// `runAgentRefs.ts` keep working. Tests should import the walker
// directly from `./agentRefWalker` to avoid dragging the DB client.
export { walkForAgentRefs };
export type { AgentRefVariant };

/** Spec 122 / spec 123 — minimal agent-identity triple. snake_case keys
 *  are the JSONB shape persisted under `factory_runs.source_shas.agents[]`. */
export interface AgentTriple {
  org_agent_id: string;
  version: number;
  content_hash: string;
}

/**
 * The reservation rejects when a project's binding points at a retired
 * catalog row (spec 123 invariant I-B3). Mapped to a typed
 * `FactoryError::RetiredAgent` on the desktop and to
 * `APIError.failedPrecondition` on the platform. Carrying the triple plus
 * the agent name is what the UI needs to deep-link the user to the
 * project's binding management page.
 */
export class RetiredAgentError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly orgAgentId: string,
    public readonly version: number,
    public readonly projectId: string | null,
  ) {
    super(
      `agent "${agentName}" (${orgAgentId} v${version}) is retired upstream`,
    );
    this.name = "RetiredAgentError";
  }
}

/** Thrown when an `AgentReference` does not resolve against the org
 *  catalog. Surfaced as `APIError.failedPrecondition` so the user gets a
 *  clear "process references unknown agent" message rather than a generic
 *  500. */
export class AgentReferenceNotFoundError extends Error {
  constructor(public readonly summary: string) {
    super(`agent reference not resolvable: ${summary}`);
    this.name = "AgentReferenceNotFoundError";
  }
}

/** Spec 200 FR-003(c) — thrown when a resolved agent revision's content
 *  hash is under an unlifted content-hash revocation. Surfaced as
 *  `APIError.failedPrecondition` (FR-010-class fail-closed refusal). */
export class QuarantinedAgentError extends Error {
  constructor(
    public readonly orgAgentId: string,
    public readonly contentHash: string,
    public readonly mode: string,
    public readonly revocationId: string,
  ) {
    super(
      `agent ${orgAgentId} revision ${contentHash} is ${mode} ` +
        `(revocation ${revocationId}) — lift the quarantine or publish a ` +
        `fixed revision (spec 198 FR-010 / spec 200 FR-003)`,
    );
    this.name = "QuarantinedAgentError";
  }
}

// ---------------------------------------------------------------------------
// DB-bound resolver
// ---------------------------------------------------------------------------

interface ResolveContext {
  orgId: string;
  /** When provided: project_agent_bindings is consulted for `by_name_latest`
   *  variants (spec 124 §4.1 / spec 123 binding-aware run identity). */
  projectId?: string | null;
  /** The `factory_processes.definition` JSONB body. */
  processDefinition: unknown;
}

interface BindingRow {
  orgAgentId: string;
  pinnedVersion: number;
  pinnedContentHash: string;
  status: string;
}

/**
 * Resolve every `AgentReference` in the process definition to a triple
 * suitable for `factory_runs.source_shas.agents[]`.
 *
 * Resolution strategy:
 *   * `by_id` — direct lookup in `agent_catalog`. Mismatched version is a
 *     hard error (the process pinned an exact version that doesn't exist).
 *   * `by_name` — `(org_id, name, version)` lookup; same as `by_id` modulo
 *     the lookup key.
 *   * `by_name_latest` — when `projectId` is set and a binding exists for
 *     `name`, prefer the binding's `pinned_version` / `pinned_content_hash`.
 *     Otherwise pick the highest `published` version in `agent_catalog`.
 *
 * Any binding whose pinned catalog row has `status = 'retired'` rejects
 * the reservation with `RetiredAgentError`.
 */
export async function resolveProcessAgentRefs(
  ctx: ResolveContext,
): Promise<AgentTriple[]> {
  const variants = walkForAgentRefs(ctx.processDefinition);
  if (variants.length === 0) {
    return [];
  }

  // Pre-load project bindings (one query for the whole walk). Spec 139
  // Phase 4b — joined against the substrate, not the dropped catalog.
  const bindingsByName = new Map<string, BindingRow>();
  if (ctx.projectId) {
    const rows = await db
      .select({
        orgAgentId: factoryBindings.artifactId,
        pinnedVersion: factoryBindings.pinnedVersion,
        pinnedContentHash: factoryBindings.pinnedContentHash,
        path: factoryArtifactSubstrate.path,
        substrateStatus: factoryArtifactSubstrate.status,
        frontmatter: factoryArtifactSubstrate.frontmatter,
      })
      .from(factoryBindings)
      .innerJoin(
        factoryArtifactSubstrate,
        and(
          eq(factoryArtifactSubstrate.id, factoryBindings.artifactId),
          eq(factoryArtifactSubstrate.version, factoryBindings.pinnedVersion),
        ),
      )
      .where(eq(factoryBindings.projectId, ctx.projectId));
    for (const row of rows) {
      bindingsByName.set(nameFromPath(row.path), {
        orgAgentId: row.orgAgentId,
        pinnedVersion: row.pinnedVersion,
        pinnedContentHash: row.pinnedContentHash,
        status: recoverPublicationStatus(
          (row.frontmatter as Record<string, unknown> | null) ?? null,
          row.substrateStatus,
        ),
      });
    }
  }

  const triples: AgentTriple[] = [];
  for (const variant of variants) {
    if ("by_id" in variant) {
      const wanted = variant.by_id;
      const [row] = await db
        .select()
        .from(factoryArtifactSubstrate)
        .where(
          and(
            eq(factoryArtifactSubstrate.id, wanted.org_agent_id),
            eq(factoryArtifactSubstrate.orgId, ctx.orgId),
            eq(factoryArtifactSubstrate.origin, "user-authored"),
            eq(factoryArtifactSubstrate.kind, "agent"),
            eq(factoryArtifactSubstrate.version, wanted.version),
          ),
        )
        .limit(1);
      if (!row) {
        throw new AgentReferenceNotFoundError(
          `by_id ${wanted.org_agent_id} v${wanted.version}`,
        );
      }
      const status = recoverPublicationStatus(
        (row.frontmatter as Record<string, unknown> | null) ?? null,
        row.status,
      );
      const name = nameFromPath(row.path);
      if (status === "retired") {
        throw new RetiredAgentError(name, row.id, row.version, ctx.projectId ?? null);
      }
      triples.push({
        org_agent_id: row.id,
        version: row.version,
        content_hash: row.contentHash,
      });
      continue;
    }
    if ("by_name" in variant) {
      const wanted = variant.by_name;
      const path = pathFromName(wanted.name);
      const [row] = await db
        .select()
        .from(factoryArtifactSubstrate)
        .where(
          and(
            eq(factoryArtifactSubstrate.path, path),
            eq(factoryArtifactSubstrate.orgId, ctx.orgId),
            eq(factoryArtifactSubstrate.origin, "user-authored"),
            eq(factoryArtifactSubstrate.kind, "agent"),
            eq(factoryArtifactSubstrate.version, wanted.version),
          ),
        )
        .limit(1);
      if (!row) {
        throw new AgentReferenceNotFoundError(
          `by_name ${wanted.name} v${wanted.version}`,
        );
      }
      const status = recoverPublicationStatus(
        (row.frontmatter as Record<string, unknown> | null) ?? null,
        row.status,
      );
      if (status === "retired") {
        throw new RetiredAgentError(
          wanted.name,
          row.id,
          row.version,
          ctx.projectId ?? null,
        );
      }
      triples.push({
        org_agent_id: row.id,
        version: row.version,
        content_hash: row.contentHash,
      });
      continue;
    }
    // by_name_latest
    const name = variant.by_name_latest.name;
    const binding = bindingsByName.get(name);
    if (binding) {
      if (binding.status === "retired") {
        throw new RetiredAgentError(
          name,
          binding.orgAgentId,
          binding.pinnedVersion,
          ctx.projectId ?? null,
        );
      }
      triples.push({
        org_agent_id: binding.orgAgentId,
        version: binding.pinnedVersion,
        content_hash: binding.pinnedContentHash,
      });
      continue;
    }
    // Ad-hoc resolution — pick the highest active+published version.
    const path = pathFromName(name);
    const rows = await db
      .select()
      .from(factoryArtifactSubstrate)
      .where(
        and(
          eq(factoryArtifactSubstrate.orgId, ctx.orgId),
          eq(factoryArtifactSubstrate.origin, "user-authored"),
          eq(factoryArtifactSubstrate.kind, "agent"),
          eq(factoryArtifactSubstrate.path, path),
          eq(factoryArtifactSubstrate.status, "active"),
          sql`${factoryArtifactSubstrate.frontmatter}->>'publication_status' = 'published'`,
        ),
      )
      .orderBy(sql`${factoryArtifactSubstrate.version} DESC`)
      .limit(1);
    const top = rows[0];
    if (!top) {
      throw new AgentReferenceNotFoundError(
        `by_name_latest ${name} (no published versions)`,
      );
    }
    triples.push({
      org_agent_id: top.id,
      version: top.version,
      content_hash: top.contentHash,
    });
  }

  // Spec 200 FR-003(c) — every resolved agent revision joins the
  // content-hash revocation sweep before it can be served into a run.
  const quarantine = await sweepContentHashRevocations(
    ctx.orgId,
    triples.map((t) => t.content_hash),
  );
  if (quarantine) {
    const hit = triples.find((t) => t.content_hash === quarantine.key);
    throw new QuarantinedAgentError(
      hit?.org_agent_id ?? "(unknown)",
      quarantine.key,
      quarantine.mode,
      quarantine.revocationId,
    );
  }

  return triples;
}

/** Convenience: build the `source_shas` JSONB body for a reservation. */
export function buildSourceShas(args: {
  adapterSha: string;
  processSha: string;
  contracts: Record<string, string>;
  agents: AgentTriple[];
}): FactoryRunSourceShas {
  return {
    adapter: args.adapterSha,
    process: args.processSha,
    contracts: args.contracts,
    agents: args.agents,
  };
}
