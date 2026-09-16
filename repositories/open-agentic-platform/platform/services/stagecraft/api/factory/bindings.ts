// Spec 139 Phase 1 — `/api/factory/bindings*` endpoints.
//
// Universal pinning: any project can declare it was built against a
// specific `(artifact_id, version, content_hash)` tuple. Replaces spec
// 123 `project_agent_bindings`; the same row shape extends to any kind
// (adapter, contract, skill, pattern, sample). Spec 123 invariants
// I-B1..I-B4 carry over verbatim:
//
//   I-B1: no definition override (only id+version+hash).
//   I-B2: pin integrity — `pinnedContentHash` MUST match the artifact's
//         `contentHash` at `(artifactId, pinnedVersion)` at bind time.
//   I-B3: retired-upstream bindings stay readable but cannot be repinned.
//   I-B4: ON DELETE RESTRICT on `artifactId` — retire instead of hard delete.
//
// Binding mutations are audited via the global `audit_log` under
// `action='factory.binding_{created,repinned,unbound}'` (spec §6.4).

import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  factoryArtifactSubstrate,
  factoryBindings,
  projects,
} from "../db/schema";
import { hasOrgPermission } from "../auth/membership";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

export type BindingRow = {
  id: string;
  projectId: string;
  artifactId: string;
  pinnedVersion: number;
  pinnedContentHash: string;
  boundBy: string;
  boundAt: string;
};

export type CreateBindingRequest = {
  projectId: string;
  artifactId: string;
  pinnedVersion: number;
  pinnedContentHash: string;
};

export type ListBindingsRequest = { projectId: string };

export type ListBindingsResponse = { bindings: BindingRow[] };

export interface BindingsAuth {
  orgId: string;
  userID: string;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export async function createBindingCore(
  auth: BindingsAuth,
  req: CreateBindingRequest,
): Promise<BindingRow> {
  return db.transaction(async (tx) => {
    // Project must belong to caller's org.
    const projectRows = await tx
      .select({ id: projects.id, orgId: projects.orgId })
      .from(projects)
      .where(eq(projects.id, req.projectId))
      .limit(1);
    if (!projectRows[0] || projectRows[0].orgId !== auth.orgId) {
      throw APIError.notFound(`project ${req.projectId} not found in org`);
    }

    // Artifact must belong to caller's org and the version + hash must
    // match a real row (I-B2 pin integrity).
    const artifactRows = await tx
      .select()
      .from(factoryArtifactSubstrate)
      .where(
        and(
          eq(factoryArtifactSubstrate.orgId, auth.orgId),
          eq(factoryArtifactSubstrate.id, req.artifactId),
          eq(factoryArtifactSubstrate.version, req.pinnedVersion),
        ),
      )
      .limit(1);
    const artifact = artifactRows[0];
    if (!artifact) {
      throw APIError.notFound(
        `artifact ${req.artifactId} version ${req.pinnedVersion} not found`,
      );
    }
    if (artifact.contentHash !== req.pinnedContentHash) {
      throw APIError.failedPrecondition(
        `pin integrity (I-B2) failed: pinnedContentHash does not match artifact's contentHash`,
      );
    }
    if (artifact.status === "retired") {
      // I-B3 — retired-upstream cannot be repinned. Existing bindings
      // remain readable; new bindings are blocked.
      throw APIError.failedPrecondition(
        `artifact ${req.artifactId} is retired and cannot be bound (I-B3)`,
      );
    }

    const insertedRows = await tx
      .insert(factoryBindings)
      .values({
        projectId: req.projectId,
        artifactId: req.artifactId,
        pinnedVersion: req.pinnedVersion,
        pinnedContentHash: req.pinnedContentHash,
        boundBy: auth.userID,
      })
      .onConflictDoUpdate({
        target: [factoryBindings.projectId, factoryBindings.artifactId],
        set: {
          pinnedVersion: req.pinnedVersion,
          pinnedContentHash: req.pinnedContentHash,
          boundBy: auth.userID,
          boundAt: new Date(),
        },
      })
      .returning();
    const inserted = insertedRows[0];

    await tx.insert(auditLog).values({
      actorUserId: auth.userID,
      // Reuse existing audit_log columns.
      action: "factory.binding_created",
      targetType: "factory_artifact",
      targetId: req.artifactId,
      metadata: {
        projectId: req.projectId,
        artifactId: req.artifactId,
        pinnedVersion: req.pinnedVersion,
        pinnedContentHash: req.pinnedContentHash,
      },
    });

    return rowToWire(inserted);
  });
}

export async function listBindingsCore(
  auth: BindingsAuth,
  req: ListBindingsRequest,
): Promise<ListBindingsResponse> {
  // Org-scope check via project membership.
  const projectRows = await db
    .select({ orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.id, req.projectId))
    .limit(1);
  if (!projectRows[0] || projectRows[0].orgId !== auth.orgId) {
    throw APIError.notFound(`project ${req.projectId} not found in org`);
  }

  const rows = await db
    .select()
    .from(factoryBindings)
    .where(eq(factoryBindings.projectId, req.projectId))
    .orderBy(asc(factoryBindings.boundAt));
  return { bindings: rows.map(rowToWire) };
}

export type UnbindArgs = { bindingId: string };

export async function unbindCore(
  auth: BindingsAuth,
  req: UnbindArgs,
): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: factoryBindings.id,
        projectId: factoryBindings.projectId,
        artifactId: factoryBindings.artifactId,
      })
      .from(factoryBindings)
      .where(eq(factoryBindings.id, req.bindingId))
      .limit(1);
    const binding = rows[0];
    if (!binding) {
      throw APIError.notFound(`binding ${req.bindingId} not found`);
    }
    // Validate org via project lookup.
    const projectRows = await tx
      .select({ orgId: projects.orgId })
      .from(projects)
      .where(eq(projects.id, binding.projectId))
      .limit(1);
    if (!projectRows[0] || projectRows[0].orgId !== auth.orgId) {
      throw APIError.notFound(`binding ${req.bindingId} not found`);
    }
    await tx.delete(factoryBindings).where(eq(factoryBindings.id, binding.id));
    await tx.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "factory.binding_unbound",
      targetType: "factory_artifact",
      targetId: binding.artifactId,
      metadata: { projectId: binding.projectId, artifactId: binding.artifactId },
    });
  });
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

export const createBinding = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/factory/bindings",
  },
  async (req: CreateBindingRequest): Promise<BindingRow> => {
    const auth = getAuthData()!;
    if (!hasOrgPermission(auth.platformRole, "factory:configure")) {
      throw APIError.permissionDenied(
        "factory:configure permission required to create a binding",
      );
    }
    return createBindingCore(
      { orgId: auth.orgId, userID: auth.userID },
      req,
    );
  },
);

export const listBindings = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/factory/bindings",
  },
  async (req: ListBindingsRequest): Promise<ListBindingsResponse> => {
    const auth = getAuthData()!;
    return listBindingsCore(
      { orgId: auth.orgId, userID: auth.userID },
      req,
    );
  },
);

export const unbind = api(
  {
    expose: true,
    auth: true,
    method: "DELETE",
    path: "/api/factory/bindings/:bindingId",
  },
  async (req: { bindingId: string }): Promise<{ ok: true }> => {
    const auth = getAuthData()!;
    if (!hasOrgPermission(auth.platformRole, "factory:configure")) {
      throw APIError.permissionDenied(
        "factory:configure permission required to unbind",
      );
    }
    await unbindCore(
      { orgId: auth.orgId, userID: auth.userID },
      req,
    );
    return { ok: true };
  },
);

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

type StoredBindingRow = typeof factoryBindings.$inferSelect;

function rowToWire(row: StoredBindingRow): BindingRow {
  return {
    id: row.id,
    projectId: row.projectId,
    artifactId: row.artifactId,
    pinnedVersion: row.pinnedVersion,
    pinnedContentHash: row.pinnedContentHash,
    boundBy: row.boundBy,
    boundAt: row.boundAt.toISOString(),
  };
}
