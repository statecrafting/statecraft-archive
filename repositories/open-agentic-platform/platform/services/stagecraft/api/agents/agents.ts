import { api, APIError, Header } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { db } from "../db/drizzle";
import { agentPolicies, auditLog } from "../db/schema";
import { and, eq, desc } from "drizzle-orm";
import { validateM2mRequest } from "../auth/m2mAuth.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Require admin or owner platform role. Throws 403 if not. Mirrors admin.ts::requireAdmin. */
function requireAdmin(): { userID: string; orgId: string } {
  const auth = getAuthData()!;
  if (auth.platformRole !== "admin" && auth.platformRole !== "owner") {
    throw APIError.permissionDenied("Admin access required");
  }
  return { userID: auth.userID, orgId: auth.orgId };
}

// ---------------------------------------------------------------------------
// Seam D: runtime authorization check
// ---------------------------------------------------------------------------

type AgentAuthorizedRequest = {
  slug: string;
  orgId: string;
  authorization: Header<"Authorization">;
};

type AgentAuthorizedResponse = { authorized: true };

/**
 * Seam D: Validate agent execution against org-level policies.
 * GET /api/agents/:slug/authorized: M2M bearer token auth, matching the
 * seam pattern used by policy.ts, audit.ts and grants.ts. The real caller
 * (OPC's check_agent_authorized) already presents PLATFORM_M2M_TOKEN as a
 * bearer token, not a Rauthy user session, so `auth: true` would reject it
 * outright (see handler.ts's audience-mismatch comment).
 *
 * `orgId` is now a required, explicit query parameter instead of a
 * hardcoded "default" literal, so the block policy is per-org rather than
 * globally anonymous. Note: the M2M credential behind this seam is
 * platform-wide and carries no org claim of its own (see m2mAuth.ts), so
 * this cannot yet verify the caller is entitled to `orgId` the way a
 * session-authenticated endpoint can (compare admin.ts::requireOrgAdmin).
 * Closing that residual gap needs the seam to carry a verifiable org claim;
 * that is a larger change than this fix and is flagged as follow-up.
 *
 * Returns 200 if the agent is authorized.
 * Returns 403 with { reason } if the agent is blocked.
 * Agents with no policy row are allowed by default.
 */
export const isAgentAuthorized = api(
  { expose: true, method: "GET", path: "/api/agents/:slug/authorized" },
  async (req: AgentAuthorizedRequest): Promise<AgentAuthorizedResponse> => {
    await validateM2mRequest(req.authorization, "platform:policy:read");

    if (!UUID_PATTERN.test(req.orgId)) {
      throw APIError.invalidArgument("orgId must be a UUID");
    }

    const rows = await db
      .select()
      .from(agentPolicies)
      .where(
        and(
          eq(agentPolicies.orgId, req.orgId),
          eq(agentPolicies.slug, req.slug)
        )
      )
      .limit(1);

    if (rows.length > 0 && rows[0].blocked) {
      const reason = rows[0].reason || `agent '${req.slug}' is blocked by org policy`;
      throw APIError.permissionDenied(reason);
    }

    return { authorized: true };
  }
);

// ---------------------------------------------------------------------------
// Admin CRUD for agent policies
// ---------------------------------------------------------------------------

type AgentPolicyRow = {
  id: string;
  orgId: string;
  slug: string;
  blocked: boolean;
  reason: string;
  createdAt: Date;
  updatedAt: Date;
};

type ListAgentPoliciesResponse = { policies: AgentPolicyRow[] };

// Admin-only, session-authenticated (Rauthy JWT via the Gateway authHandler)
// and org-scoped, matching admin.ts's requireAdmin/requireOrgAdmin pattern.
// Previously this had no auth at all, so any anonymous caller could list
// org-wide agent-execution policies.
export const listAgentPolicies = api(
  { expose: true, auth: true, method: "GET", path: "/admin/agent-policies" },
  async (): Promise<ListAgentPoliciesResponse> => {
    const auth = requireAdmin();
    const rows = await db
      .select()
      .from(agentPolicies)
      .where(eq(agentPolicies.orgId, auth.orgId))
      .orderBy(desc(agentPolicies.createdAt))
      .limit(500);
    return { policies: rows };
  }
);

type UpsertAgentPolicyRequest = {
  slug: string;
  blocked: boolean;
  reason?: string;
};

type UpsertAgentPolicyResponse = { policy: AgentPolicyRow };

export const upsertAgentPolicy = api(
  { expose: true, auth: true, method: "POST", path: "/admin/agent-policies" },
  async (req: UpsertAgentPolicyRequest): Promise<UpsertAgentPolicyResponse> => {
    const auth = requireAdmin();

    if (!req.slug) {
      throw APIError.invalidArgument("slug is required");
    }

    const now = new Date();
    const existing = await db
      .select()
      .from(agentPolicies)
      .where(
        and(
          eq(agentPolicies.orgId, auth.orgId),
          eq(agentPolicies.slug, req.slug)
        )
      )
      .limit(1);

    let policy: AgentPolicyRow;

    if (existing.length > 0) {
      const [updated] = await db
        .update(agentPolicies)
        .set({
          blocked: req.blocked,
          reason: req.reason ?? "",
          updatedAt: now,
        })
        .where(eq(agentPolicies.id, existing[0].id))
        .returning();
      policy = updated;
    } else {
      const [inserted] = await db
        .insert(agentPolicies)
        .values({
          orgId: auth.orgId,
          slug: req.slug,
          blocked: req.blocked,
          reason: req.reason ?? "",
        })
        .returning();
      policy = inserted;
    }

    // actorUserId is derived from the authenticated session, never from the
    // request body: accepting a caller-supplied actorUserId let any caller
    // forge audit attribution for a policy change they did not make.
    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: req.blocked ? "agent_policy.block" : "agent_policy.allow",
      targetType: "agent_policy",
      targetId: policy.id,
      metadata: { slug: req.slug, blocked: req.blocked, reason: req.reason ?? "" },
    });

    return { policy };
  }
);

type DeleteAgentPolicyResponse = { ok: true };

export const deleteAgentPolicy = api(
  { expose: true, auth: true, method: "DELETE", path: "/admin/agent-policies/:id" },
  async (req: { id: string }): Promise<DeleteAgentPolicyResponse> => {
    const auth = requireAdmin();

    // Scope the lookup (and therefore the delete) to the caller's org so an
    // admin of one org cannot delete another org's policy row by ID.
    const existing = await db
      .select()
      .from(agentPolicies)
      .where(
        and(
          eq(agentPolicies.id, req.id),
          eq(agentPolicies.orgId, auth.orgId)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      throw APIError.notFound("agent policy not found");
    }

    // Bind the delete itself to the caller's org, not just the preceding
    // existence check, for real defense-in-depth: a TOCTOU or a future
    // refactor that drops the existence check must not leave a bare
    // id-only delete able to remove another org's policy row.
    await db
      .delete(agentPolicies)
      .where(and(eq(agentPolicies.id, req.id), eq(agentPolicies.orgId, auth.orgId)));

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "agent_policy.delete",
      targetType: "agent_policy",
      targetId: req.id,
      metadata: { slug: existing[0].slug },
    });

    return { ok: true };
  }
);
