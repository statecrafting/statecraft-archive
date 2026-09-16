// Spec 163 — Encore.ts API surface for the Requirements view.
//
// All endpoints are project-scoped. `auth: true` ensures the caller is
// signed in. Org-scope enforcement is delegated to the existing
// getProject check pattern: a project belongs to a single org and the
// `projects` row is keyed by (id, orgId). We reuse that pattern so the
// Requirements view cannot leak a sister-org's project.

import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import { projects } from "../db/schema";
import { resolveProjectRegistry } from "./resolver";
import {
  getSpecDetail,
  getSpecRelationships,
  listSpecs,
} from "./registryReader";
import type {
  SpecDetail,
  SpecInventory,
  SpecRelationships,
} from "./types";

async function assertProjectInOrg(projectId: string): Promise<void> {
  const auth = getAuthData();
  if (!auth) {
    throw APIError.unauthenticated("authentication required");
  }
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, auth.orgId)))
    .limit(1);
  if (rows.length === 0) {
    throw APIError.notFound("project not found");
  }
}

/**
 * FR-001 / FR-002 — list specs from the project's spec-spine.
 *
 * Returns `{registryAvailable: false, specs: []}` when the project has
 * no registry yet (newly imported, decomposition not yet run). The
 * route uses this to render the FR-007 empty-state CTA.
 */
export const listProjectSpecs = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/specs",
  },
  async (req: { projectId: string }): Promise<SpecInventory> => {
    await assertProjectInOrg(req.projectId);
    const roots = await resolveProjectRegistry(req.projectId);
    if (!roots) {
      return { registryAvailable: false, specs: [] };
    }
    const specs = await listSpecs(roots.projectRoot);
    return { registryAvailable: true, specs };
  }
);

/**
 * FR-006 — single spec detail (frontmatter + markdown body).
 */
export const showProjectSpec = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/specs/:specId",
  },
  async (req: {
    projectId: string;
    specId: string;
  }): Promise<{ spec: SpecDetail }> => {
    await assertProjectInOrg(req.projectId);
    const roots = await resolveProjectRegistry(req.projectId);
    if (!roots) {
      throw APIError.notFound(
        "project has no spec-spine yet; run decomposition first"
      );
    }
    try {
      const spec = await getSpecDetail(
        req.specId,
        roots.projectRoot,
        roots.projectRoot
      );
      return { spec };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // spec-spine registry show exits non-zero on unknown id.
      if (/exited 1/i.test(msg) || /not found/i.test(msg)) {
        throw APIError.notFound(`spec ${req.specId} not found in this project`);
      }
      throw APIError.internal(`spec lookup failed: ${msg}`);
    }
  }
);

/**
 * FR-006 — outgoing + incoming relationship edges (spec 130 projection).
 */
export const showProjectSpecRelationships = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/specs/:specId/relationships",
  },
  async (req: {
    projectId: string;
    specId: string;
  }): Promise<{ relationships: SpecRelationships }> => {
    await assertProjectInOrg(req.projectId);
    const roots = await resolveProjectRegistry(req.projectId);
    if (!roots) {
      throw APIError.notFound(
        "project has no spec-spine yet; run decomposition first"
      );
    }
    try {
      const relationships = await getSpecRelationships(
        req.specId,
        roots.projectRoot
      );
      return { relationships };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/exited 1/i.test(msg) || /not found/i.test(msg)) {
        throw APIError.notFound(`spec ${req.specId} not found in this project`);
      }
      throw APIError.internal(`relationship lookup failed: ${msg}`);
    }
  }
);
