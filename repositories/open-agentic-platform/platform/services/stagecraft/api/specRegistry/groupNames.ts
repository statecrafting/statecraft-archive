// Spec 163 FR-004 — cosmetic display names for derived spec-spine groups.
//
// CRUD over the `project_spec_group_names` table. Custom names are
// project-scoped and resolve client-side: the inventory loader fetches
// the full mapping with the spec list, the renderer overlays
// `displayName` onto each derived group's algorithmic label.

import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import { projects, projectSpecGroupNames } from "../db/schema";

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

export interface SpecGroupNameRow {
  groupId: string;
  displayName: string;
}

const MAX_DISPLAY_NAME_LEN = 200;

export const listSpecGroupNames = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/spec-group-names",
  },
  async (req: {
    projectId: string;
  }): Promise<{ names: SpecGroupNameRow[] }> => {
    await assertProjectInOrg(req.projectId);
    const rows = await db
      .select({
        groupId: projectSpecGroupNames.groupId,
        displayName: projectSpecGroupNames.displayName,
      })
      .from(projectSpecGroupNames)
      .where(eq(projectSpecGroupNames.projectId, req.projectId));
    return { names: rows };
  }
);

export const setSpecGroupName = api(
  {
    expose: true,
    auth: true,
    method: "PUT",
    path: "/api/projects/:projectId/spec-group-names/:groupId",
  },
  async (req: {
    projectId: string;
    groupId: string;
    displayName: string;
  }): Promise<{ name: SpecGroupNameRow }> => {
    await assertProjectInOrg(req.projectId);
    const trimmed = (req.displayName ?? "").trim();
    if (trimmed.length === 0) {
      throw APIError.invalidArgument("displayName must not be empty");
    }
    if (trimmed.length > MAX_DISPLAY_NAME_LEN) {
      throw APIError.invalidArgument(
        `displayName must be ${MAX_DISPLAY_NAME_LEN} characters or fewer`
      );
    }
    const auth = getAuthData()!;
    await db
      .insert(projectSpecGroupNames)
      .values({
        projectId: req.projectId,
        groupId: req.groupId,
        displayName: trimmed,
        createdBy: auth.userID,
      })
      .onConflictDoUpdate({
        target: [
          projectSpecGroupNames.projectId,
          projectSpecGroupNames.groupId,
        ],
        set: { displayName: trimmed, updatedAt: new Date() },
      });
    return { name: { groupId: req.groupId, displayName: trimmed } };
  }
);

export const deleteSpecGroupName = api(
  {
    expose: true,
    auth: true,
    method: "DELETE",
    path: "/api/projects/:projectId/spec-group-names/:groupId",
  },
  async (req: { projectId: string; groupId: string }): Promise<{ deleted: boolean }> => {
    await assertProjectInOrg(req.projectId);
    const res = await db
      .delete(projectSpecGroupNames)
      .where(
        and(
          eq(projectSpecGroupNames.projectId, req.projectId),
          eq(projectSpecGroupNames.groupId, req.groupId)
        )
      )
      .returning({ groupId: projectSpecGroupNames.groupId });
    return { deleted: res.length > 0 };
  }
);
