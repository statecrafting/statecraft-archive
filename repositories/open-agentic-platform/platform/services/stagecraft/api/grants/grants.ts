import { api, APIError, Header } from "encore.dev/api";
import { validateM2mRequest } from "../auth/m2mAuth.js";
import { db } from "../db/drizzle";
import { projectGrants, projectMembers } from "../db/schema";
import { and, eq } from "drizzle-orm";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type GrantsRequest = {
  authorization: Header<"Authorization">;
  userId: string;
  projectId: string;
};

type GrantsResponse = {
  enable_file_read: boolean;
  enable_file_write: boolean;
  enable_network: boolean;
  max_tier: number;
};

/**
 * Spec 119 §6.4 — Serve project-scoped permission grants to OPC desktop app.
 * GET /api/grants/:userId/:projectId — M2M bearer token auth (OIDC JWT or static fallback).
 *
 * Returns the grant row if found, otherwise restrictive defaults (read-only, tier 1).
 */
export const getGrants = api(
  { expose: true, method: "GET", path: "/api/grants/:userId/:projectId" },
  async (req: GrantsRequest): Promise<GrantsResponse> => {
    await validateM2mRequest(req.authorization, "platform:grants:read");

    if (!UUID_PATTERN.test(req.userId) || !UUID_PATTERN.test(req.projectId)) {
      throw APIError.invalidArgument("userId and projectId must be UUIDs");
    }

    // The M2M credential behind this seam carries no caller identity (see
    // m2mAuth.ts / policy.ts), so bind the requested subject to the
    // requested project via project_members instead of trusting the
    // (userId, projectId) pairing verbatim. Without this, any caller
    // holding a valid M2M token could probe grants for a user/project pair
    // it has no relationship to.
    const [membership] = await db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.userId, req.userId),
          eq(projectMembers.projectId, req.projectId)
        )
      )
      .limit(1);
    if (!membership) {
      throw APIError.notFound("no grant found for this user/project pair");
    }

    const rows = await db
      .select()
      .from(projectGrants)
      .where(
        and(
          eq(projectGrants.userId, req.userId),
          eq(projectGrants.projectId, req.projectId)
        )
      )
      .limit(1);

    if (rows.length === 0) {
      // No explicit grant: return restrictive defaults.
      return {
        enable_file_read: true,
        enable_file_write: false,
        enable_network: false,
        max_tier: 1,
      };
    }

    const g = rows[0];
    return {
      enable_file_read: g.enableFileRead,
      enable_file_write: g.enableFileWrite,
      enable_network: g.enableNetwork,
      max_tier: g.maxTier,
    };
  }
);
