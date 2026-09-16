/**
 * Spec 123: agents are org-scoped; projects consume via bindings.
 * Spec 139 Phase 4 (T091): handlers read AND write `factory_artifact_substrate`
 * directly. The legacy `agent_catalog` + `agent_catalog_audit` tables are
 * dropped in migration 34 (T093). The wire shape (CatalogAgent) is
 * preserved; spec 111's draft|published|retired ternary is recovered
 * from `frontmatter.publication_status` (Phase 2 mirror seeded this on
 * every existing row; Phase 4 writes maintain it directly).
 */

import { createHash } from "node:crypto";
import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { db } from "../db/drizzle";
import {
  factoryArtifactSubstrate,
  factoryArtifactSubstrateAudit,
  organizations,
  type AgentCatalogAuditAction,
  type AgentCatalogStatus,
} from "../db/schema";
import { and, desc, eq, max, ne } from "drizzle-orm";
import type { CatalogFrontmatter } from "./frontmatter";
import { publishAgentCatalogUpdated } from "./relay";
import { assertOverrideGate } from "../factory/artifacts";
import {
  publishOverrideScanRun,
  recordOverrideScanIntent,
} from "../factory/overrideScanCore";
import { runOverrideGate } from "../factory/overrideGate";
import {
  mapAgentCatalogAuditAction,
  mapAgentCatalogStatus,
  userAuthoredAgentPath,
} from "../factory/agentCatalogMigration";

// ---------------------------------------------------------------------------
// Wire types — preserved from spec 111/123.
// ---------------------------------------------------------------------------

export type { CatalogFrontmatter };

export type CatalogAgent = {
  id: string;
  org_id: string;
  name: string;
  version: number;
  status: AgentCatalogStatus;
  frontmatter: CatalogFrontmatter;
  body_markdown: string;
  content_hash: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type CreateAgentRequest = {
  orgId: string;
  name: string;
  frontmatter: CatalogFrontmatter;
  body_markdown: string;
};
type CreateAgentResponse = { agent: CatalogAgent };

type ListAgentsRequest = { orgId: string; status?: AgentCatalogStatus };
type ListAgentsResponse = { agents: CatalogAgent[] };

type GetAgentRequest = { orgId: string; id: string };
type GetAgentResponse = { agent: CatalogAgent };

type PatchAgentRequest = {
  orgId: string;
  id: string;
  frontmatter?: CatalogFrontmatter;
  body_markdown?: string;
  expected_content_hash?: string;
};
type PatchAgentResponse = { agent: CatalogAgent };

type PublishAgentRequest = { orgId: string; id: string };
type PublishAgentResponse = { agent: CatalogAgent; retired?: CatalogAgent };

type RetireAgentRequest = { orgId: string; id: string };
type RetireAgentResponse = { agent: CatalogAgent };

type ForkAgentRequest = { orgId: string; id: string; new_name: string };
type ForkAgentResponse = { agent: CatalogAgent };

export type CatalogAuditEntry = {
  id: string;
  agent_id: string;
  org_id: string;
  action: AgentCatalogAuditAction;
  actor_user_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
};

type ListAgentAuditRequest = { orgId: string; id: string };
type ListAgentAuditResponse = { entries: CatalogAuditEntry[] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const PATH_PREFIX = "user-authored/";
const PATH_SUFFIX = ".md";

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return entries.reduce<Record<string, unknown>>((acc, [k, v]) => {
      acc[k] = canonicalise(v);
      return acc;
    }, {});
  }
  return value;
}

export function computeContentHash(
  frontmatter: Record<string, unknown>,
  bodyMarkdown: string,
): string {
  const canon = JSON.stringify({
    frontmatter: canonicalise(frontmatter),
    body_markdown: bodyMarkdown,
  });
  return createHash("sha256").update(canon).digest("hex");
}

type SubstrateRow = typeof factoryArtifactSubstrate.$inferSelect;

function nameFromPath(path: string): string {
  if (!path.startsWith(PATH_PREFIX) || !path.endsWith(PATH_SUFFIX)) {
    return path;
  }
  return path.slice(PATH_PREFIX.length, path.length - PATH_SUFFIX.length);
}

function recoverPublicationStatus(
  frontmatter: Record<string, unknown> | null,
  substrateStatus: "active" | "retired",
): AgentCatalogStatus {
  if (substrateStatus === "retired") return "retired";
  const fmStatus = frontmatter?.publication_status;
  if (fmStatus === "draft" || fmStatus === "published" || fmStatus === "retired") {
    return fmStatus;
  }
  // Default for an active substrate row whose frontmatter never carried
  // publication_status: treat as draft (matches createAgent semantics).
  return "draft";
}

function stripPublicationStatus(
  frontmatter: Record<string, unknown> | null,
): CatalogFrontmatter {
  if (!frontmatter) return {} as CatalogFrontmatter;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { publication_status, ...rest } = frontmatter;
  return rest as CatalogFrontmatter;
}

function injectPublicationStatus(
  frontmatter: Record<string, unknown> | null,
  publicationStatus: AgentCatalogStatus,
): Record<string, unknown> {
  return {
    ...(frontmatter ?? {}),
    publication_status: publicationStatus,
  };
}

function toWire(row: SubstrateRow): CatalogAgent {
  const fm = (row.frontmatter as Record<string, unknown> | null) ?? null;
  const status = recoverPublicationStatus(fm, row.status);
  return {
    id: row.id,
    org_id: row.orgId,
    name: nameFromPath(row.path),
    version: row.version,
    status,
    frontmatter: stripPublicationStatus(fm),
    // For user-authored content the body lives in `user_body`; the
    // generated `effective_body` mirrors it.
    body_markdown: row.userBody ?? row.effectiveBody,
    content_hash: row.contentHash,
    created_by: row.userModifiedBy ?? row.orgId, // fallback for migrated rows; prod paths populate
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function auditSnapshot(row: SubstrateRow): Record<string, unknown> {
  return {
    id: row.id,
    org_id: row.orgId,
    name: nameFromPath(row.path),
    version: row.version,
    status: recoverPublicationStatus(
      (row.frontmatter as Record<string, unknown> | null) ?? null,
      row.status,
    ),
    content_hash: row.contentHash,
    frontmatter: row.frontmatter,
    updated_at: row.updatedAt.toISOString(),
  };
}

async function recordAudit(
  entry: {
    agentId: string;
    orgId: string;
    action: AgentCatalogAuditAction;
    actorUserId: string;
    before?: SubstrateRow | null;
    after?: SubstrateRow | null;
  },
  tx: typeof db,
): Promise<void> {
  await tx.insert(factoryArtifactSubstrateAudit).values({
    artifactId: entry.agentId,
    orgId: entry.orgId,
    action: mapAgentCatalogAuditAction(entry.action),
    actorUserId: entry.actorUserId,
    before: entry.before ? auditSnapshot(entry.before) : null,
    after: entry.after ? auditSnapshot(entry.after) : null,
  });
}

async function verifyOrgAccess(orgId: string, callerOrgId: string): Promise<void> {
  if (orgId !== callerOrgId) {
    throw APIError.permissionDenied(
      "agent catalog access is restricted to the caller's org",
    );
  }
  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!row) {
    throw APIError.notFound("org not found");
  }
}

function requireOrgAuth(): {
  userId: string;
  orgId: string;
  platformRole: string;
} {
  const auth = getAuthData()!;
  return {
    userId: auth.userID,
    orgId: auth.orgId,
    platformRole: auth.platformRole,
  };
}

function requirePublishRole(platformRole: string) {
  if (platformRole !== "owner" && platformRole !== "admin") {
    throw APIError.permissionDenied(
      "publishing or retiring agents requires org admin",
    );
  }
}

async function loadAgent(
  tx: typeof db,
  id: string,
  orgId: string,
): Promise<SubstrateRow> {
  const rows = await tx
    .select()
    .from(factoryArtifactSubstrate)
    .where(
      and(
        eq(factoryArtifactSubstrate.id, id),
        eq(factoryArtifactSubstrate.orgId, orgId),
        eq(factoryArtifactSubstrate.origin, "user-authored"),
        eq(factoryArtifactSubstrate.kind, "agent"),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw APIError.notFound("agent not found");
  }
  return rows[0];
}

async function nextVersion(
  tx: typeof db,
  orgId: string,
  name: string,
): Promise<number> {
  const path = userAuthoredAgentPath(name);
  const [row] = await tx
    .select({ max: max(factoryArtifactSubstrate.version) })
    .from(factoryArtifactSubstrate)
    .where(
      and(
        eq(factoryArtifactSubstrate.orgId, orgId),
        eq(factoryArtifactSubstrate.origin, "user-authored"),
        eq(factoryArtifactSubstrate.path, path),
      ),
    );
  return (row?.max ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Endpoints — every read/write hits `factory_artifact_substrate` only.
// ---------------------------------------------------------------------------

export const createAgent = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/orgs/:orgId/agents",
  },
  async (req: CreateAgentRequest): Promise<CreateAgentResponse> => {
    if (!KEBAB_CASE.test(req.name)) {
      throw APIError.invalidArgument(
        `name must be kebab-case (matching ${KEBAB_CASE.source})`,
      );
    }
    if (!req.body_markdown || req.body_markdown.length === 0) {
      throw APIError.invalidArgument("body_markdown is required");
    }

    const { userId, orgId } = requireOrgAuth();
    await verifyOrgAccess(req.orgId, orgId);
    const path = userAuthoredAgentPath(req.name);
    // Spec 198 FR-013(a) — user-authored agent bodies are `user_body`
    // writes; the deterministic gate applies. No audit row here: the
    // artifact does not exist yet (the audit table requires an id), so
    // the attributable 400 is the refusal record.
    const createVerdict = runOverrideGate({
      content: req.body_markdown,
      kind: "agent",
      path,
    });
    if (!createVerdict.ok) {
      throw APIError.invalidArgument(
        `agent body rejected by ${createVerdict.ruleId}: ${createVerdict.detail} (spec 198 FR-013 a)`,
      );
    }
    const hash = computeContentHash(req.frontmatter, req.body_markdown);
    const frontmatterWithStatus = injectPublicationStatus(
      req.frontmatter,
      "draft",
    );

    const { inserted, scanRunId } = await db.transaction(async (tx) => {
      const version = await nextVersion(
        tx as unknown as typeof db,
        req.orgId,
        req.name,
      );
      const [row] = await tx
        .insert(factoryArtifactSubstrate)
        .values({
          orgId: req.orgId,
          origin: "user-authored",
          path,
          kind: "agent",
          version,
          status: "active",
          userBody: req.body_markdown,
          userModifiedBy: userId,
          contentHash: hash,
          frontmatter: frontmatterWithStatus,
          conflictState: "ok",
        })
        .returning();
      await recordAudit(
        {
          agentId: row.id,
          orgId: req.orgId,
          action: "create",
          actorUserId: userId,
          after: row,
        },
        tx as unknown as typeof db,
      );
      // Spec 200 FR-001 — a user-authored agent body is a `user_body`
      // write (the same class as assertOverrideGate above); durable scan
      // intent rides this transaction, published after commit.
      const intent = await recordOverrideScanIntent(
        tx as unknown as typeof db,
        {
          orgId: req.orgId,
          artifactId: row.id,
          contentHash: row.contentHash,
          reason: "agent_created",
        },
      );
      return {
        inserted: row,
        scanRunId: intent.outcome === "recorded" ? intent.scanRunId : null,
      };
    });
    if (scanRunId) await publishOverrideScanRun(scanRunId);

    return { agent: toWire(inserted) };
  },
);

export const listAgents = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/orgs/:orgId/agents",
  },
  async (req: ListAgentsRequest): Promise<ListAgentsResponse> => {
    const { orgId } = requireOrgAuth();
    await verifyOrgAccess(req.orgId, orgId);

    const rows = await db
      .select()
      .from(factoryArtifactSubstrate)
      .where(
        and(
          eq(factoryArtifactSubstrate.orgId, req.orgId),
          eq(factoryArtifactSubstrate.origin, "user-authored"),
          eq(factoryArtifactSubstrate.kind, "agent"),
        ),
      )
      .orderBy(desc(factoryArtifactSubstrate.updatedAt))
      .limit(500);

    let agents = rows.map(toWire);
    if (req.status) {
      agents = agents.filter((a) => a.status === req.status);
    }
    return { agents };
  },
);

export const getAgent = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/orgs/:orgId/agents/:id",
  },
  async (req: GetAgentRequest): Promise<GetAgentResponse> => {
    const { orgId } = requireOrgAuth();
    await verifyOrgAccess(req.orgId, orgId);
    const row = await loadAgent(db, req.id, req.orgId);
    return { agent: toWire(row) };
  },
);

export const patchAgent = api(
  {
    expose: true,
    auth: true,
    method: "PATCH",
    path: "/api/orgs/:orgId/agents/:id",
  },
  async (req: PatchAgentRequest): Promise<PatchAgentResponse> => {
    const { userId, orgId } = requireOrgAuth();
    await verifyOrgAccess(req.orgId, orgId);

    const { updated, scanRunId } = await db.transaction(async (tx) => {
      const existing = await loadAgent(
        tx as unknown as typeof db,
        req.id,
        req.orgId,
      );
      const existingStatus = recoverPublicationStatus(
        (existing.frontmatter as Record<string, unknown> | null) ?? null,
        existing.status,
      );
      if (existingStatus !== "draft") {
        throw APIError.failedPrecondition(
          `only drafts may be edited (agent is ${existingStatus})`,
        );
      }
      if (
        req.expected_content_hash !== undefined &&
        req.expected_content_hash !== existing.contentHash
      ) {
        throw APIError.failedPrecondition(
          "content_hash mismatch — the draft was edited by someone else",
        );
      }

      const newFrontmatter =
        req.frontmatter ??
        (stripPublicationStatus(
          existing.frontmatter as Record<string, unknown> | null,
        ));
      const newBody = req.body_markdown ?? existing.userBody ?? "";
      // Spec 198 FR-013(a) — gate the edited body before the write (the
      // refusal audit survives this transaction's rollback by design).
      if (req.body_markdown !== undefined) {
        await assertOverrideGate(
          {
            orgId: req.orgId,
            userId,
            artifactId: existing.id,
            kind: existing.kind,
            path: existing.path,
          },
          newBody,
        );
      }
      const newHash = computeContentHash(newFrontmatter, newBody);
      const frontmatterWithStatus = injectPublicationStatus(
        newFrontmatter,
        "draft",
      );

      const [row] = await tx
        .update(factoryArtifactSubstrate)
        .set({
          frontmatter: frontmatterWithStatus,
          userBody: newBody,
          userModifiedAt: new Date(),
          userModifiedBy: userId,
          contentHash: newHash,
          updatedAt: new Date(),
        })
        .where(eq(factoryArtifactSubstrate.id, existing.id))
        .returning();

      await recordAudit(
        {
          agentId: row.id,
          orgId: req.orgId,
          action: "edit",
          actorUserId: userId,
          before: existing,
          after: row,
        },
        tx as unknown as typeof db,
      );
      // Spec 200 FR-001 — enqueue only on a `user_body` revision (the
      // same condition the gate above runs under); a frontmatter-only
      // patch changes no body content.
      let scanRunId: string | null = null;
      if (req.body_markdown !== undefined) {
        const intent = await recordOverrideScanIntent(
          tx as unknown as typeof db,
          {
            orgId: req.orgId,
            artifactId: row.id,
            contentHash: row.contentHash,
            reason: "agent_patched",
          },
        );
        scanRunId = intent.outcome === "recorded" ? intent.scanRunId : null;
      }
      return { updated: row, scanRunId };
    });
    if (scanRunId) await publishOverrideScanRun(scanRunId);

    return { agent: toWire(updated) };
  },
);

export const publishAgent = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/orgs/:orgId/agents/:id/publish",
  },
  async (req: PublishAgentRequest): Promise<PublishAgentResponse> => {
    const { userId, orgId, platformRole } = requireOrgAuth();
    requirePublishRole(platformRole);
    await verifyOrgAccess(req.orgId, orgId);

    const result = await db.transaction(async (tx) => {
      const existing = await loadAgent(
        tx as unknown as typeof db,
        req.id,
        req.orgId,
      );
      const existingStatus = recoverPublicationStatus(
        (existing.frontmatter as Record<string, unknown> | null) ?? null,
        existing.status,
      );
      if (existingStatus !== "draft") {
        throw APIError.failedPrecondition(
          `only drafts may be published (agent is ${existingStatus})`,
        );
      }

      // Auto-retire any currently-published sibling for the same
      // (org_id, path). The substrate's UNIQUE constraint is
      // (org_id, origin, path, version), so siblings live on different
      // versions but the same path. Retire by status flip + audit.
      const priorPublished = await tx
        .select()
        .from(factoryArtifactSubstrate)
        .where(
          and(
            eq(factoryArtifactSubstrate.orgId, req.orgId),
            eq(factoryArtifactSubstrate.origin, "user-authored"),
            eq(factoryArtifactSubstrate.path, existing.path),
            ne(factoryArtifactSubstrate.id, existing.id),
            eq(factoryArtifactSubstrate.status, "active"),
          ),
        );

      let retired: SubstrateRow | null = null;
      for (const prior of priorPublished) {
        const priorStatus = recoverPublicationStatus(
          (prior.frontmatter as Record<string, unknown> | null) ?? null,
          prior.status,
        );
        if (priorStatus !== "published") continue;
        const retiredFm = injectPublicationStatus(
          stripPublicationStatus(
            prior.frontmatter as Record<string, unknown> | null,
          ),
          "retired",
        );
        const [row] = await tx
          .update(factoryArtifactSubstrate)
          .set({
            status: "retired",
            frontmatter: retiredFm,
            updatedAt: new Date(),
          })
          .where(eq(factoryArtifactSubstrate.id, prior.id))
          .returning();
        await recordAudit(
          {
            agentId: row.id,
            orgId: req.orgId,
            action: "retire",
            actorUserId: userId,
            before: prior,
            after: row,
          },
          tx as unknown as typeof db,
        );
        retired = row;
      }

      const publishedFm = injectPublicationStatus(
        stripPublicationStatus(
          existing.frontmatter as Record<string, unknown> | null,
        ),
        "published",
      );
      const [published] = await tx
        .update(factoryArtifactSubstrate)
        .set({
          frontmatter: publishedFm,
          updatedAt: new Date(),
        })
        .where(eq(factoryArtifactSubstrate.id, existing.id))
        .returning();

      await recordAudit(
        {
          agentId: published.id,
          orgId: req.orgId,
          action: "publish",
          actorUserId: userId,
          before: existing,
          after: published,
        },
        tx as unknown as typeof db,
      );

      return { published, retired };
    });

    if (result.retired) {
      await publishAgentCatalogUpdated(toWireForRelay(result.retired));
    }
    await publishAgentCatalogUpdated(toWireForRelay(result.published));

    return {
      agent: toWire(result.published),
      ...(result.retired ? { retired: toWire(result.retired) } : {}),
    };
  },
);

export const retireAgent = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/orgs/:orgId/agents/:id/retire",
  },
  async (req: RetireAgentRequest): Promise<RetireAgentResponse> => {
    const { userId, orgId, platformRole } = requireOrgAuth();
    requirePublishRole(platformRole);
    await verifyOrgAccess(req.orgId, orgId);

    const retired = await db.transaction(async (tx) => {
      const existing = await loadAgent(
        tx as unknown as typeof db,
        req.id,
        req.orgId,
      );
      const existingStatus = recoverPublicationStatus(
        (existing.frontmatter as Record<string, unknown> | null) ?? null,
        existing.status,
      );
      if (existingStatus !== "published") {
        throw APIError.failedPrecondition(
          `only published agents may be retired (agent is ${existingStatus})`,
        );
      }
      const retiredFm = injectPublicationStatus(
        stripPublicationStatus(
          existing.frontmatter as Record<string, unknown> | null,
        ),
        "retired",
      );
      const [row] = await tx
        .update(factoryArtifactSubstrate)
        .set({
          status: "retired",
          frontmatter: retiredFm,
          updatedAt: new Date(),
        })
        .where(eq(factoryArtifactSubstrate.id, existing.id))
        .returning();
      await recordAudit(
        {
          agentId: row.id,
          orgId: req.orgId,
          action: "retire",
          actorUserId: userId,
          before: existing,
          after: row,
        },
        tx as unknown as typeof db,
      );
      return row;
    });

    await publishAgentCatalogUpdated(toWireForRelay(retired));

    return { agent: toWire(retired) };
  },
);

export const listAgentAudit = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/orgs/:orgId/agents/:id/audit",
  },
  async (req: ListAgentAuditRequest): Promise<ListAgentAuditResponse> => {
    const { orgId } = requireOrgAuth();
    await verifyOrgAccess(req.orgId, orgId);
    await loadAgent(db, req.id, req.orgId);

    const rows = await db
      .select()
      .from(factoryArtifactSubstrateAudit)
      .where(
        and(
          eq(factoryArtifactSubstrateAudit.artifactId, req.id),
          eq(factoryArtifactSubstrateAudit.orgId, req.orgId),
        ),
      )
      .orderBy(desc(factoryArtifactSubstrateAudit.createdAt))
      .limit(500);

    return {
      entries: rows.map((r) => ({
        id: r.id,
        agent_id: r.artifactId,
        org_id: r.orgId,
        action: substrateActionToLegacy(r.action),
        actor_user_id: r.actorUserId ?? "",
        before: (r.before as Record<string, unknown> | null) ?? null,
        after: (r.after as Record<string, unknown> | null) ?? null,
        created_at: r.createdAt.toISOString(),
      })),
    };
  },
);

export const forkAgent = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/orgs/:orgId/agents/:id/fork",
  },
  async (req: ForkAgentRequest): Promise<ForkAgentResponse> => {
    if (!KEBAB_CASE.test(req.new_name)) {
      throw APIError.invalidArgument(
        `new_name must be kebab-case (matching ${KEBAB_CASE.source})`,
      );
    }
    const { userId, orgId, platformRole } = requireOrgAuth();
    requirePublishRole(platformRole);
    await verifyOrgAccess(req.orgId, orgId);

    const forked = await db.transaction(async (tx) => {
      const source = await loadAgent(
        tx as unknown as typeof db,
        req.id,
        req.orgId,
      );
      const sourceName = nameFromPath(source.path);
      if (sourceName === req.new_name) {
        throw APIError.invalidArgument(
          "new_name must differ from the source agent's name",
        );
      }

      const version = await nextVersion(
        tx as unknown as typeof db,
        req.orgId,
        req.new_name,
      );
      const sourceFm = stripPublicationStatus(
        source.frontmatter as Record<string, unknown> | null,
      );
      const sourceBody = source.userBody ?? "";
      const hash = computeContentHash(sourceFm, sourceBody);
      const forkedFm = injectPublicationStatus(sourceFm, "draft");

      const [row] = await tx
        .insert(factoryArtifactSubstrate)
        .values({
          orgId: req.orgId,
          origin: "user-authored",
          path: userAuthoredAgentPath(req.new_name),
          kind: "agent",
          version,
          status: "active",
          userBody: sourceBody,
          userModifiedBy: userId,
          contentHash: hash,
          frontmatter: forkedFm,
          conflictState: "ok",
        })
        .returning();

      await recordAudit(
        {
          agentId: row.id,
          orgId: req.orgId,
          action: "fork",
          actorUserId: userId,
          before: source,
          after: row,
        },
        tx as unknown as typeof db,
      );
      return row;
    });

    return { agent: toWire(forked) };
  },
);

// ---------------------------------------------------------------------------
// Internal helpers for relay broadcast.
// ---------------------------------------------------------------------------

/**
 * `publishAgentCatalogUpdated` was authored against the legacy
 * `agent_catalog` row shape. Translate the substrate row into that shape
 * for relay broadcast — the relay's wire payload mirrors the legacy
 * field names per spec 123 §7.1, untouched by Phase 4.
 */
function toWireForRelay(row: SubstrateRow): {
  id: string;
  orgId: string;
  name: string;
  version: number;
  status: AgentCatalogStatus;
  frontmatter: Record<string, unknown>;
  bodyMarkdown: string;
  contentHash: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
} {
  const fm = (row.frontmatter as Record<string, unknown> | null) ?? null;
  return {
    id: row.id,
    orgId: row.orgId,
    name: nameFromPath(row.path),
    version: row.version,
    status: recoverPublicationStatus(fm, row.status),
    frontmatter: stripPublicationStatus(fm),
    bodyMarkdown: row.userBody ?? "",
    contentHash: row.contentHash,
    createdBy: row.userModifiedBy ?? row.orgId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Reverse of `mapAgentCatalogAuditAction` — substrate action → legacy
 * spec 111 action for the wire shape on `listAgentAudit`. The spec 139
 * `artifact.forked` action maps back to `fork`; everything else folds
 * into the spec 111 5-action enum.
 */
function substrateActionToLegacy(
  action: typeof factoryArtifactSubstrateAudit.$inferSelect["action"],
): AgentCatalogAuditAction {
  switch (action) {
    case "artifact.synced":
      return "create";
    case "artifact.overridden":
      return "edit";
    case "artifact.retired":
      return "retire";
    case "artifact.forked":
      return "fork";
    case "artifact.override_cleared":
    case "artifact.conflict_detected":
    case "artifact.conflict_resolved":
    // Spec 198 FR-013 — gate refusals and verified-flag flips have no
    // legacy spec 111 equivalent; fold into the edit bucket like the
    // other override-lifecycle actions.
    case "artifact.override_gate_rejected":
    case "artifact.override_verified":
    // Spec 200 FR-008 — scan outcomes are service events on the same
    // override lifecycle; same fold.
    case "artifact.scan_flagged":
    case "artifact.scan_clean":
    case "artifact.scan_skipped":
    case "artifact.scan_failed":
      return "edit";
  }
}
