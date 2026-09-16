import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  factoryUpstreams,
  factoryArtifactSubstrate,
  auditLog,
} from "../db/schema";
import { hasOrgPermission } from "../auth/membership";
import { loadSubstrateForOrg } from "./substrateBrowser";
import { findEnvelopeProcess, listAdapterViews } from "./adapterView";

// ---------------------------------------------------------------------------
// Spec 108 + spec 139 — Factory upstream configuration.
//
// Spec 108 introduced one row per organisation with fixed factory+template
// fields. Spec 139 generalises the table to N-per-org keyed on
// (org_id, source_id) with role/subpath columns.
//
// Spec 139 Phase 4b (B-3): the legacy singleton wire shape
// {factorySource, factoryRef, templateSource, templateRef} now reads from
// TWO N-per-org rows — `factory` carries the factory side
// (role='mixed'); `template` carries the template side
// (role='scaffold'). The four legacy columns
// (factory_source/factory_ref/template_source/template_ref) are dropped
// in migration 35.
// ---------------------------------------------------------------------------

export const FACTORY_SOURCE_ID = "factory";
/** Spec 139 Phase 4b — template-side row that backs the legacy
 *  `templateSource`/`templateRef` wire-shape fields. */
export const TEMPLATE_SOURCE_ID = "template";

export type FactoryUpstreamRow = {
  orgId: string;
  factorySource: string;
  factoryRef: string;
  templateSource: string;
  templateRef: string;
  lastSyncedAt: Date | null;
  lastSyncSha: { factory?: string; template?: string } | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FactoryUpstreamSource = {
  orgId: string;
  sourceId: string;
  role: string;
  repoUrl: string;
  ref: string;
  subpath: string | null;
  lastSyncedAt: Date | null;
  lastSyncStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FactoryUpstreamCounts = {
  adapters: number;
  contracts: number;
  processes: number;
  /** Spec 139 — total active substrate rows. */
  artifacts: number;
};

// Matches the "owner/repo" shape GitHub uses. Permissive on character classes
// — the sync worker does the authoritative validation when it tries to clone.
const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function validateRepo(value: string, field: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    throw APIError.invalidArgument(`${field} is required`);
  }
  // Accept a full GitHub URL (https://github.com/owner/repo[.git]) or the
  // git@ form as well as a bare owner/repo, and lowercase it (GitHub
  // owners/repos are case-insensitive). The sync worker does the authoritative
  // validation when it clones.
  const repo = trimmed
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  if (!REPO_PATTERN.test(repo)) {
    throw APIError.invalidArgument(
      `${field} must be in the form "owner/repo" or a GitHub URL (got "${trimmed}")`,
    );
  }
  return repo;
}

function validateRef(value: string | undefined, field: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "main";
  if (trimmed.length > 255) {
    throw APIError.invalidArgument(`${field} must be ≤ 255 characters`);
  }
  return trimmed;
}

const ALLOWED_ROLES = new Set([
  "orchestration",
  "scaffold",
  "mixed",
  "oap-self",
]);

function validateRole(value: string): string {
  const trimmed = value.trim();
  if (!ALLOWED_ROLES.has(trimmed)) {
    throw APIError.invalidArgument(
      `role must be one of: orchestration, scaffold, mixed, oap-self`,
    );
  }
  return trimmed;
}

function validateSourceId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw APIError.invalidArgument("sourceId is required");
  }
  if (trimmed.length > 100) {
    throw APIError.invalidArgument("sourceId must be ≤ 100 characters");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) {
    throw APIError.invalidArgument(
      "sourceId must be lowercase kebab-case (a-z, 0-9, -)",
    );
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Legacy singleton wire-shape helpers.
//
// Spec 139 Phase 4b (B-3): the singleton wire shape
// {factorySource, factoryRef, templateSource, templateRef} composes from
// two N-per-org rows. `factory` carries the factory side via its
// (repo_url, ref) columns; `template` carries the template
// side via the same columns. Reading both produces the legacy shape;
// writing both keeps the wire shape idempotent. Storage flips from the
// per-side legacy columns to the substrate-shape columns; the wire shape
// is byte-stable.
// ---------------------------------------------------------------------------

async function loadUpstream(orgId: string): Promise<FactoryUpstreamRow | null> {
  const rows = await db
    .select()
    .from(factoryUpstreams)
    .where(
      and(
        eq(factoryUpstreams.orgId, orgId),
        sql`${factoryUpstreams.sourceId} IN (${FACTORY_SOURCE_ID}, ${TEMPLATE_SOURCE_ID})`,
      ),
    );
  const factory = rows.find((r) => r.sourceId === FACTORY_SOURCE_ID);
  const template = rows.find((r) => r.sourceId === TEMPLATE_SOURCE_ID);
  if (!factory || !template) return null;
  // The factory row is the canonical carrier of last-sync state — the
  // sync worker stamps it on the orchestration sync; the template row
  // tracks scaffold cache freshness independently when used.
  return {
    orgId: factory.orgId,
    factorySource: factory.repoUrl,
    factoryRef: factory.ref,
    templateSource: template.repoUrl,
    templateRef: template.ref,
    lastSyncedAt: factory.lastSyncedAt,
    lastSyncSha: (factory.lastSyncSha as FactoryUpstreamRow["lastSyncSha"]) ?? null,
    lastSyncStatus: factory.lastSyncStatus,
    lastSyncError: factory.lastSyncError,
    createdAt: factory.createdAt,
    updatedAt: factory.updatedAt,
  };
}

async function loadCounts(orgId: string): Promise<FactoryUpstreamCounts> {
  // Spec 139 Phase 4 (T091): adapter / contract / process counts come
  // from the substrate via the same projection used by browse.ts. The
  // substrate-row count is a separate kind-agnostic head-count.
  const [substrateForOrg, artifactsRow] = await Promise.all([
    loadSubstrateForOrg(orgId),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(factoryArtifactSubstrate)
      .where(
        and(
          eq(factoryArtifactSubstrate.orgId, orgId),
          eq(factoryArtifactSubstrate.status, "active"),
        ),
      ),
  ]);
  // Spec 199 FR-005 — counts come from the substrate by kind + manifest
  // identity (the categorical projection is retired).
  return {
    adapters: listAdapterViews(substrateForOrg).length,
    contracts: substrateForOrg.rows.filter((r) => r.kind === "contract-schema")
      .length,
    processes: findEnvelopeProcess(substrateForOrg) ? 1 : 0,
    artifacts: artifactsRow[0]?.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// GET /api/factory/upstreams — fetch current org config (or null).
// Singleton-shaped; backed by the 'factory' row.
// ---------------------------------------------------------------------------

export const getUpstreams = api(
  { expose: true, auth: true, method: "GET", path: "/api/factory/upstreams" },
  async (): Promise<{
    upstream: FactoryUpstreamRow | null;
    counts: FactoryUpstreamCounts;
  }> => {
    const auth = getAuthData()!;
    const [upstream, counts] = await Promise.all([
      loadUpstream(auth.orgId),
      loadCounts(auth.orgId),
    ]);
    return { upstream, counts };
  },
);

// ---------------------------------------------------------------------------
// POST /api/factory/upstreams — create or update the legacy singleton.
// Idempotent. Writes both the legacy fixed columns and the new spec 139
// (sourceId, role, repoUrl, ref) columns so syncWorker.ts can keep
// reading legacy fields while the new schema is authoritative.
// ---------------------------------------------------------------------------

type UpsertUpstreamRequest = {
  factorySource: string;
  factoryRef?: string;
  templateSource: string;
  templateRef?: string;
};

export const upsertUpstreams = api(
  { expose: true, auth: true, method: "POST", path: "/api/factory/upstreams" },
  async (
    req: UpsertUpstreamRequest,
  ): Promise<{ upstream: FactoryUpstreamRow }> => {
    const auth = getAuthData()!;

    if (!hasOrgPermission(auth.platformRole, "factory:configure")) {
      throw APIError.permissionDenied(
        "Only org admins can configure factory upstreams",
      );
    }

    const factorySource = validateRepo(req.factorySource, "factorySource");
    const templateSource = validateRepo(req.templateSource, "templateSource");
    const factoryRef = validateRef(req.factoryRef, "factoryRef");
    const templateRef = validateRef(req.templateRef, "templateRef");

    const existing = await loadUpstream(auth.orgId);

    // Spec 139 Phase 4b — write factory + template as TWO N-per-org rows.
    // Idempotent upsert: ON CONFLICT updates the substrate-shape columns
    // (repo_url, ref, role) so the singleton wire shape becomes a thin
    // projection over two rows.
    await db
      .insert(factoryUpstreams)
      .values({
        orgId: auth.orgId,
        sourceId: FACTORY_SOURCE_ID,
        role: "mixed",
        repoUrl: factorySource,
        ref: factoryRef,
      })
      .onConflictDoUpdate({
        target: [factoryUpstreams.orgId, factoryUpstreams.sourceId],
        set: {
          role: "mixed",
          repoUrl: factorySource,
          ref: factoryRef,
          updatedAt: new Date(),
        },
      });
    await db
      .insert(factoryUpstreams)
      .values({
        orgId: auth.orgId,
        sourceId: TEMPLATE_SOURCE_ID,
        role: "scaffold",
        repoUrl: templateSource,
        ref: templateRef,
      })
      .onConflictDoUpdate({
        target: [factoryUpstreams.orgId, factoryUpstreams.sourceId],
        set: {
          role: "scaffold",
          repoUrl: templateSource,
          ref: templateRef,
          updatedAt: new Date(),
        },
      });

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: existing ? "factory.upstreams.update" : "factory.upstreams.create",
      targetType: "factory_upstreams",
      targetId: auth.orgId,
      metadata: {
        factorySource,
        factoryRef,
        templateSource,
        templateRef,
      },
    });

    const upstream = await loadUpstream(auth.orgId);
    if (!upstream) {
      // Should never happen — we just inserted/updated it.
      throw APIError.internal("failed to read back factory_upstreams row");
    }
    return { upstream };
  },
);

// ---------------------------------------------------------------------------
// Spec 139 — N-per-org source endpoints.
//
// These let an org declare separate orchestration / scaffold sources for
// the substrate (Phase 2 wires them per-adapter). The legacy singleton
// row continues to surface in `getUpstreams` above.
// ---------------------------------------------------------------------------

export interface UpstreamsAuth {
  orgId: string;
  userID: string;
}

export type ListUpstreamSourcesResponse = {
  sources: FactoryUpstreamSource[];
};

export async function listUpstreamSourcesCore(
  auth: UpstreamsAuth,
): Promise<ListUpstreamSourcesResponse> {
  const rows = await db
    .select()
    .from(factoryUpstreams)
    .where(eq(factoryUpstreams.orgId, auth.orgId))
    .orderBy(asc(factoryUpstreams.sourceId));
  return {
    sources: rows.map(rowToSource),
  };
}

export type UpsertUpstreamSourceRequest = {
  sourceId: string;
  role: string;
  repoUrl: string;
  ref?: string;
  subpath?: string;
};

export async function upsertUpstreamSourceCore(
  auth: UpstreamsAuth,
  req: UpsertUpstreamSourceRequest,
): Promise<FactoryUpstreamSource> {
  const sourceId = validateSourceId(req.sourceId);
  const role = validateRole(req.role);
  const repoUrl = req.repoUrl.trim();
  if (!repoUrl) {
    throw APIError.invalidArgument("repoUrl is required");
  }
  const ref = validateRef(req.ref, "ref");
  const subpath = req.subpath?.trim() || null;

  const existing = await db
    .select()
    .from(factoryUpstreams)
    .where(
      and(
        eq(factoryUpstreams.orgId, auth.orgId),
        eq(factoryUpstreams.sourceId, sourceId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(factoryUpstreams)
      .set({ role, repoUrl, ref, subpath, updatedAt: new Date() })
      .where(
        and(
          eq(factoryUpstreams.orgId, auth.orgId),
          eq(factoryUpstreams.sourceId, sourceId),
        ),
      );
  } else {
    await db.insert(factoryUpstreams).values({
      orgId: auth.orgId,
      sourceId,
      role,
      repoUrl,
      ref,
      subpath,
    });
  }

  await db.insert(auditLog).values({
    actorUserId: auth.userID,
    action: existing[0] ? "factory.source.updated" : "factory.source.created",
    targetType: "factory_upstreams",
    targetId: `${auth.orgId}:${sourceId}`,
    metadata: { sourceId, role, repoUrl, ref, subpath },
  });

  const reread = await db
    .select()
    .from(factoryUpstreams)
    .where(
      and(
        eq(factoryUpstreams.orgId, auth.orgId),
        eq(factoryUpstreams.sourceId, sourceId),
      ),
    )
    .limit(1);
  if (!reread[0]) throw APIError.internal("failed to read back source row");
  return rowToSource(reread[0]);
}

export async function deleteUpstreamSourceCore(
  auth: UpstreamsAuth,
  req: { sourceId: string },
): Promise<void> {
  const sourceId = validateSourceId(req.sourceId);
  if (sourceId === FACTORY_SOURCE_ID) {
    throw APIError.failedPrecondition(
      `cannot delete the factory source row; it backs spec 108's API surface`,
    );
  }
  const deleted = await db
    .delete(factoryUpstreams)
    .where(
      and(
        eq(factoryUpstreams.orgId, auth.orgId),
        eq(factoryUpstreams.sourceId, sourceId),
      ),
    )
    .returning({ sourceId: factoryUpstreams.sourceId });
  if (deleted.length === 0) {
    throw APIError.notFound(`source ${sourceId} not found`);
  }
  await db.insert(auditLog).values({
    actorUserId: auth.userID,
    action: "factory.source.deleted",
    targetType: "factory_upstreams",
    targetId: `${auth.orgId}:${sourceId}`,
    metadata: { sourceId },
  });
}

// HTTP handlers for N-per-org sources

export const listUpstreamSources = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/factory/upstreams/sources",
  },
  async (): Promise<ListUpstreamSourcesResponse> => {
    const auth = getAuthData()!;
    return listUpstreamSourcesCore({ orgId: auth.orgId, userID: auth.userID });
  },
);

export const upsertUpstreamSource = api(
  {
    expose: true,
    auth: true,
    method: "PUT",
    path: "/api/factory/upstreams/sources/:sourceId",
  },
  async (
    req: { sourceId: string } & Omit<UpsertUpstreamSourceRequest, "sourceId">,
  ): Promise<{ source: FactoryUpstreamSource }> => {
    const auth = getAuthData()!;
    if (!hasOrgPermission(auth.platformRole, "factory:configure")) {
      throw APIError.permissionDenied(
        "factory:configure permission required to configure upstream sources",
      );
    }
    const source = await upsertUpstreamSourceCore(
      { orgId: auth.orgId, userID: auth.userID },
      { ...req, sourceId: req.sourceId },
    );
    return { source };
  },
);

export const deleteUpstreamSource = api(
  {
    expose: true,
    auth: true,
    method: "DELETE",
    path: "/api/factory/upstreams/sources/:sourceId",
  },
  async (req: { sourceId: string }): Promise<{ ok: true }> => {
    const auth = getAuthData()!;
    if (!hasOrgPermission(auth.platformRole, "factory:configure")) {
      throw APIError.permissionDenied(
        "factory:configure permission required to delete upstream sources",
      );
    }
    await deleteUpstreamSourceCore(
      { orgId: auth.orgId, userID: auth.userID },
      req,
    );
    return { ok: true };
  },
);

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

type StoredUpstreamRow = typeof factoryUpstreams.$inferSelect;

function rowToSource(row: StoredUpstreamRow): FactoryUpstreamSource {
  return {
    orgId: row.orgId,
    sourceId: row.sourceId,
    role: row.role,
    repoUrl: row.repoUrl,
    ref: row.ref,
    subpath: row.subpath,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncStatus: row.lastSyncStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
