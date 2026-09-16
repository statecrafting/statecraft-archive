/**
 * Spec 123 §5.2 — Project agent bindings.
 *
 * Spec 139 Phase 4b: handlers read AND write the substrate
 * (`factory_artifact_substrate` filtered to `origin='user-authored'`,
 * `kind='agent'`) and `factory_bindings` directly. The legacy
 * `agent_catalog` and `project_agent_bindings` tables are dropped in
 * migration 35; this module is the last consumer to leave them.
 *
 * Wire shape (`ProjectAgentBinding`) is preserved: `org_agent_id` carries
 * the substrate row id (Phase 2 migration preserved every legacy
 * `agent_catalog.id` as `factory_artifact_substrate.id`, so existing
 * consumers keep their UUIDs). The spec 111 publication ternary
 * (`draft|published|retired`) is recovered from
 * `frontmatter.publication_status` (Phase 2 mirror seeded this on every
 * row; Phase 4 catalog handlers maintain it).
 *
 * Endpoints:
 *   GET    /api/projects/:projectId/agents             — list bindings
 *   POST   /api/projects/:projectId/agents/bind        — { org_agent_id, version }
 *   PATCH  /api/projects/:projectId/agents/:bindingId  — { version } repin
 *   DELETE /api/projects/:projectId/agents/:bindingId  — unbind
 *
 * Audit: each mutation writes an `audit_log` row keyed by
 * `agent.binding_created` / `agent.binding_repinned` / `agent.binding_unbound`
 * (spec 123 T003). The audit-action wire identifiers stay `agent.binding_*`
 * — spec 139 §6.4 reserves `factory.binding_*` for future bindings of
 * non-agent kinds; today's handlers only mutate agent bindings.
 *
 * Spec 123 invariants I-B1..I-B4 carry over verbatim:
 *   I-B1 — no definition override (binding row carries id+version+hash only).
 *   I-B2 — `pinned_content_hash` matches the substrate row's `contentHash`
 *          at `(artifactId, pinnedVersion)`.
 *   I-B3 — bindings whose substrate row is now retired remain readable
 *          as `status='retired_upstream'`; bind/repin to a retired row
 *          is rejected.
 *   I-B4 — substrate rows retire in place (status='retired') instead of
 *          hard delete; bindings stay valid for audit.
 */

import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  factoryArtifactSubstrate,
  factoryBindings,
  projects,
  type AgentBindingAuditAction,
  type AgentCatalogStatus,
} from "../db/schema";
import { publishProjectAgentBindingUpdated } from "./relay";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

export type ProjectAgentBinding = {
  binding_id: string;
  project_id: string;
  org_agent_id: string;
  agent_name: string;
  pinned_version: number;
  pinned_content_hash: string;
  /** Status of the substrate row this binding points at. `retired_upstream`
   *  is surfaced when the substrate row was retired AFTER bind time
   *  (spec 123 invariant I-B3 — bindings stay visible read-only). */
  status: "active" | "retired_upstream";
  bound_by: string;
  bound_at: string;
};

type ListBindingsRequest = { projectId: string };
type ListBindingsResponse = { bindings: ProjectAgentBinding[] };

type BindAgentRequest = {
  projectId: string;
  org_agent_id: string;
  /** Version on the org agent to pin. Server resolves to content_hash. */
  version: number;
};
type BindAgentResponse = { binding: ProjectAgentBinding };

type RepinBindingRequest = {
  projectId: string;
  bindingId: string;
  /** New version to pin. */
  version: number;
};
type RepinBindingResponse = { binding: ProjectAgentBinding };

type UnbindRequest = { projectId: string; bindingId: string };
type UnbindResponse = { ok: true };

// ---------------------------------------------------------------------------
// Auth + helpers
// ---------------------------------------------------------------------------

/**
 * Subset of the Encore auth payload the binding endpoints depend on.
 * Mirrors the spec 124 `runs.ts` Core/api split so integration tests can
 * exercise the business logic without `getAuthData()`.
 */
export interface BindingAuth {
  orgId: string;
  userID: string;
}

function requireOrgAuth(): BindingAuth {
  const auth = getAuthData()!;
  return { orgId: auth.orgId, userID: auth.userID };
}

async function verifyProjectInOrg(projectId: string, orgId: string): Promise<void> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .limit(1);
  if (!row) {
    throw APIError.notFound("project not found");
  }
}

type SubstrateRow = typeof factoryArtifactSubstrate.$inferSelect;
type BindingRow = typeof factoryBindings.$inferSelect;

const PATH_PREFIX = "user-authored/";
const PATH_SUFFIX = ".md";

function nameFromPath(path: string): string {
  if (!path.startsWith(PATH_PREFIX) || !path.endsWith(PATH_SUFFIX)) {
    return path;
  }
  return path.slice(PATH_PREFIX.length, path.length - PATH_SUFFIX.length);
}

/**
 * Spec 111 publication ternary recovered from `frontmatter.publication_status`.
 * Mirrors the helper in catalog.ts — kept private to bindings.ts so the
 * publish/retire-only-published rule applies consistently here too.
 */
function recoverPublicationStatus(
  frontmatter: Record<string, unknown> | null,
  substrateStatus: "active" | "retired",
): AgentCatalogStatus {
  if (substrateStatus === "retired") return "retired";
  const fmStatus = frontmatter?.publication_status;
  if (fmStatus === "draft" || fmStatus === "published" || fmStatus === "retired") {
    return fmStatus;
  }
  return "draft";
}

/**
 * Resolve the substrate row at `(orgId, origin='user-authored', path, version)`.
 * Asserts org ownership and rejects draft/retired targets per spec 123 §5.2.
 */
async function resolveTargetByPathVersion(
  path: string,
  version: number,
  orgId: string,
): Promise<SubstrateRow> {
  const [row] = await db
    .select()
    .from(factoryArtifactSubstrate)
    .where(
      and(
        eq(factoryArtifactSubstrate.orgId, orgId),
        eq(factoryArtifactSubstrate.origin, "user-authored"),
        eq(factoryArtifactSubstrate.kind, "agent"),
        eq(factoryArtifactSubstrate.path, path),
        eq(factoryArtifactSubstrate.version, version),
      ),
    )
    .limit(1);
  if (!row) {
    throw APIError.notFound(
      `agent ${nameFromPath(path)} v${version} not found in org`,
    );
  }
  const status = recoverPublicationStatus(
    (row.frontmatter as Record<string, unknown> | null) ?? null,
    row.status,
  );
  if (status === "draft") {
    throw APIError.failedPrecondition(
      "cannot bind to a draft — publish first",
    );
  }
  if (status === "retired") {
    throw APIError.failedPrecondition(
      `cannot bind to retired version v${version}; choose a published version`,
    );
  }
  return row;
}

/**
 * The caller passes the org_agent_id (any version row of an agent's name);
 * we read its path first, then resolve the target row at the requested
 * version. The path serves as the agent-name key in the substrate's
 * `(origin='user-authored', path)` partition.
 */
async function resolveTargetByHintAndVersion(
  orgAgentIdHint: string,
  version: number,
  orgId: string,
): Promise<SubstrateRow> {
  const [hint] = await db
    .select({
      path: factoryArtifactSubstrate.path,
      orgId: factoryArtifactSubstrate.orgId,
      origin: factoryArtifactSubstrate.origin,
      kind: factoryArtifactSubstrate.kind,
    })
    .from(factoryArtifactSubstrate)
    .where(eq(factoryArtifactSubstrate.id, orgAgentIdHint))
    .limit(1);
  if (!hint) {
    throw APIError.notFound("org_agent_id not found");
  }
  if (hint.orgId !== orgId) {
    throw APIError.permissionDenied("agent belongs to a different org");
  }
  if (hint.origin !== "user-authored" || hint.kind !== "agent") {
    throw APIError.failedPrecondition(
      "org_agent_id does not reference a user-authored agent artifact",
    );
  }
  return resolveTargetByPathVersion(hint.path, version, orgId);
}

async function loadBinding(
  bindingId: string,
  projectId: string,
): Promise<BindingRow> {
  const [row] = await db
    .select()
    .from(factoryBindings)
    .where(
      and(
        eq(factoryBindings.id, bindingId),
        eq(factoryBindings.projectId, projectId),
      ),
    )
    .limit(1);
  if (!row) {
    throw APIError.notFound("binding not found");
  }
  return row;
}

async function recordBindingAudit(
  tx: typeof db,
  action: AgentBindingAuditAction,
  actorUserId: string,
  binding: BindingRow,
  detail?: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditLog).values({
    actorUserId,
    action,
    targetType: "project_agent_binding",
    targetId: binding.id,
    metadata: {
      project_id: binding.projectId,
      org_agent_id: binding.artifactId,
      pinned_version: binding.pinnedVersion,
      pinned_content_hash: binding.pinnedContentHash,
      ...(detail ?? {}),
    },
  });
}

function toWire(
  binding: BindingRow,
  artifact: { path: string; status: AgentCatalogStatus },
): ProjectAgentBinding {
  return {
    binding_id: binding.id,
    project_id: binding.projectId,
    org_agent_id: binding.artifactId,
    agent_name: nameFromPath(artifact.path),
    pinned_version: binding.pinnedVersion,
    pinned_content_hash: binding.pinnedContentHash,
    // Spec 123 I-B3: bindings whose substrate row is now retired surface
    // as `retired_upstream` so the UI can dim/badge them; the data path
    // keeps them visible for audit.
    status: artifact.status === "retired" ? "retired_upstream" : "active",
    bound_by: binding.boundBy,
    bound_at: binding.boundAt.toISOString(),
  };
}

/**
 * Translate the substrate-keyed binding row into the legacy structural
 * shape `relay.ts` expects on the wire. Spec 139 §3.1 preserved
 * `agent_catalog.id` as `factory_artifact_substrate.id` during the Phase
 * 2 migration, so `org_agent_id` on the relay envelope is still the
 * UUID existing OPC consumers know about.
 */
function toRelayBindingRow(row: BindingRow): {
  id: string;
  projectId: string;
  orgAgentId: string;
  pinnedVersion: number;
  pinnedContentHash: string;
  boundBy: string;
  boundAt: Date;
} {
  return {
    id: row.id,
    projectId: row.projectId,
    orgAgentId: row.artifactId,
    pinnedVersion: row.pinnedVersion,
    pinnedContentHash: row.pinnedContentHash,
    boundBy: row.boundBy,
    boundAt: row.boundAt,
  };
}

// ---------------------------------------------------------------------------
// Core implementations — auth is passed explicitly so integration tests can
// drive the business logic without `getAuthData()`. The api() handlers are
// thin wrappers that read auth from the Encore context.
// ---------------------------------------------------------------------------

export async function listBindingsCore(
  req: ListBindingsRequest,
  auth: BindingAuth,
): Promise<ListBindingsResponse> {
  await verifyProjectInOrg(req.projectId, auth.orgId);

  const rows = await db
    .select({
      binding: factoryBindings,
      path: factoryArtifactSubstrate.path,
      substrateStatus: factoryArtifactSubstrate.status,
      frontmatter: factoryArtifactSubstrate.frontmatter,
    })
    .from(factoryBindings)
    .innerJoin(
      factoryArtifactSubstrate,
      eq(factoryArtifactSubstrate.id, factoryBindings.artifactId),
    )
    .where(eq(factoryBindings.projectId, req.projectId))
    .orderBy(desc(factoryBindings.boundAt));

  return {
    bindings: rows.map((r) =>
      toWire(r.binding, {
        path: r.path,
        status: recoverPublicationStatus(
          (r.frontmatter as Record<string, unknown> | null) ?? null,
          r.substrateStatus,
        ),
      }),
    ),
  };
}

export async function bindAgentCore(
  req: BindAgentRequest,
  auth: BindingAuth,
): Promise<BindAgentResponse> {
  await verifyProjectInOrg(req.projectId, auth.orgId);

  const target = await resolveTargetByHintAndVersion(
    req.org_agent_id,
    req.version,
    auth.orgId,
  );

  const binding = await db.transaction(async (tx) => {
    // Spec 123 §6.2 UI semantics — one binding per agent name per project.
    // Same agent name across versions cannot be double-bound; explicit
    // repin or unbind is required first.
    const existingByName = await tx
      .select({ id: factoryBindings.id })
      .from(factoryBindings)
      .innerJoin(
        factoryArtifactSubstrate,
        eq(factoryArtifactSubstrate.id, factoryBindings.artifactId),
      )
      .where(
        and(
          eq(factoryBindings.projectId, req.projectId),
          eq(factoryArtifactSubstrate.path, target.path),
        ),
      )
      .limit(1);
    if (existingByName.length > 0) {
      throw APIError.alreadyExists(
        `project already has a binding for agent "${nameFromPath(target.path)}"; repin or unbind first`,
      );
    }

    const [inserted] = await tx
      .insert(factoryBindings)
      .values({
        projectId: req.projectId,
        artifactId: target.id,
        pinnedVersion: target.version,
        pinnedContentHash: target.contentHash,
        boundBy: auth.userID,
      })
      .returning();

    await recordBindingAudit(
      tx as unknown as typeof db,
      "agent.binding_created",
      auth.userID,
      inserted,
      { agent_name: nameFromPath(target.path) },
    );
    return inserted;
  });

  await publishProjectAgentBindingUpdated({
    orgId: auth.orgId,
    projectId: req.projectId,
    binding: toRelayBindingRow(binding),
    agentName: nameFromPath(target.path),
    action: "bound",
  });

  return {
    binding: toWire(binding, {
      path: target.path,
      status: recoverPublicationStatus(
        (target.frontmatter as Record<string, unknown> | null) ?? null,
        target.status,
      ),
    }),
  };
}

export async function repinBindingCore(
  req: RepinBindingRequest,
  auth: BindingAuth,
): Promise<RepinBindingResponse> {
  await verifyProjectInOrg(req.projectId, auth.orgId);

  const result = await db.transaction(async (tx) => {
    const existing = await loadBinding(req.bindingId, req.projectId);
    const target = await resolveTargetByHintAndVersion(
      existing.artifactId,
      req.version,
      auth.orgId,
    );

    const [updated] = await tx
      .update(factoryBindings)
      .set({
        artifactId: target.id,
        pinnedVersion: target.version,
        pinnedContentHash: target.contentHash,
        boundBy: auth.userID,
        boundAt: new Date(),
      })
      .where(eq(factoryBindings.id, existing.id))
      .returning();

    await recordBindingAudit(
      tx as unknown as typeof db,
      "agent.binding_repinned",
      auth.userID,
      updated,
      {
        agent_name: nameFromPath(target.path),
        previous_pinned_version: existing.pinnedVersion,
        previous_org_agent_id: existing.artifactId,
        previous_pinned_content_hash: existing.pinnedContentHash,
      },
    );
    return { binding: updated, target };
  });

  await publishProjectAgentBindingUpdated({
    orgId: auth.orgId,
    projectId: req.projectId,
    binding: toRelayBindingRow(result.binding),
    agentName: nameFromPath(result.target.path),
    action: "rebound",
  });

  return {
    binding: toWire(result.binding, {
      path: result.target.path,
      status: recoverPublicationStatus(
        (result.target.frontmatter as Record<string, unknown> | null) ?? null,
        result.target.status,
      ),
    }),
  };
}

export async function unbindAgentCore(
  req: UnbindRequest,
  auth: BindingAuth,
): Promise<UnbindResponse> {
  await verifyProjectInOrg(req.projectId, auth.orgId);

  const removed = await db.transaction(async (tx) => {
    const existing = await loadBinding(req.bindingId, req.projectId);
    // Audit BEFORE delete so the row contents live in the audit row.
    const [pathRow] = await tx
      .select({ path: factoryArtifactSubstrate.path })
      .from(factoryArtifactSubstrate)
      .where(eq(factoryArtifactSubstrate.id, existing.artifactId))
      .limit(1);
    const agentName = pathRow ? nameFromPath(pathRow.path) : "";
    await recordBindingAudit(
      tx as unknown as typeof db,
      "agent.binding_unbound",
      auth.userID,
      existing,
      { agent_name: agentName || null },
    );
    await tx
      .delete(factoryBindings)
      .where(eq(factoryBindings.id, existing.id));
    return { binding: existing, agentName };
  });

  await publishProjectAgentBindingUpdated({
    orgId: auth.orgId,
    projectId: req.projectId,
    binding: toRelayBindingRow(removed.binding),
    agentName: removed.agentName,
    action: "unbound",
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Encore endpoint wrappers
// ---------------------------------------------------------------------------

export const listBindings = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/agents",
  },
  async (req: ListBindingsRequest): Promise<ListBindingsResponse> => {
    return listBindingsCore(req, requireOrgAuth());
  },
);

export const bindAgent = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/:projectId/agents/bind",
  },
  async (req: BindAgentRequest): Promise<BindAgentResponse> => {
    return bindAgentCore(req, requireOrgAuth());
  },
);

export const repinBinding = api(
  {
    expose: true,
    auth: true,
    method: "PATCH",
    path: "/api/projects/:projectId/agents/:bindingId",
  },
  async (req: RepinBindingRequest): Promise<RepinBindingResponse> => {
    return repinBindingCore(req, requireOrgAuth());
  },
);

export const unbindAgent = api(
  {
    expose: true,
    auth: true,
    method: "DELETE",
    path: "/api/projects/:projectId/agents/:bindingId",
  },
  async (req: UnbindRequest): Promise<UnbindResponse> => {
    return unbindAgentCore(req, requireOrgAuth());
  },
);

// ---------------------------------------------------------------------------
// Spec 098 integrity probe — exported for the nightly job (spec 123 T036).
// ---------------------------------------------------------------------------

export type BindingIntegrityViolation = {
  binding_id: string;
  project_id: string;
  org_agent_id: string;
  pinned_version: number;
  recorded_content_hash: string;
  current_content_hash: string | null;
  reason: "row_missing" | "hash_drift";
};

/**
 * Verify every binding's `pinned_content_hash` still matches the substrate
 * row at `(artifactId, pinnedVersion)`. Returns the list of violations
 * for the spec 098 nightly integrity job. Empty list → all bindings clean.
 */
export async function verifyBindingIntegrity(): Promise<
  BindingIntegrityViolation[]
> {
  const rows = await db
    .select({
      bindingId: factoryBindings.id,
      projectId: factoryBindings.projectId,
      orgAgentId: factoryBindings.artifactId,
      pinnedVersion: factoryBindings.pinnedVersion,
      recordedContentHash: factoryBindings.pinnedContentHash,
      currentContentHash: factoryArtifactSubstrate.contentHash,
      currentVersion: factoryArtifactSubstrate.version,
    })
    .from(factoryBindings)
    .innerJoin(
      factoryArtifactSubstrate,
      eq(factoryArtifactSubstrate.id, factoryBindings.artifactId),
    );

  const violations: BindingIntegrityViolation[] = [];
  for (const r of rows) {
    if (r.currentVersion !== r.pinnedVersion) {
      violations.push({
        binding_id: r.bindingId,
        project_id: r.projectId,
        org_agent_id: r.orgAgentId,
        pinned_version: r.pinnedVersion,
        recorded_content_hash: r.recordedContentHash,
        current_content_hash: r.currentContentHash,
        reason: "row_missing",
      });
    } else if (r.recordedContentHash !== r.currentContentHash) {
      violations.push({
        binding_id: r.bindingId,
        project_id: r.projectId,
        org_agent_id: r.orgAgentId,
        pinned_version: r.pinnedVersion,
        recorded_content_hash: r.recordedContentHash,
        current_content_hash: r.currentContentHash,
        reason: "hash_drift",
      });
    }
  }
  return violations;
}
