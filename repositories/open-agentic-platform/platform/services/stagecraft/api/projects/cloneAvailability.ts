/**
 * Spec 113 Phase 1a — Clone availability endpoint (amended by spec 119).
 *
 * `GET /api/projects/clone/check-availability` answers two yes/no questions
 * for the Clone Project dialog:
 *
 *   1. Is `repoName` free under the destination GitHub org?
 *   2. Is `slug` free under `(orgId, slug)` in `projects`?
 *
 * The endpoint is read-only, idempotent, never audits, never consumes a
 * retry budget. Format validation runs first so invalid inputs never cost
 * an outbound GitHub API request (FR-019, SC-008). Pure validators and the
 * fetch-injectable repo probe live in `cloneAvailabilityHelpers.ts` so the
 * unit test runner can exercise them without the Encore native runtime.
 */

import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import log from "encore.dev/log";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import { projects, githubInstallations } from "../db/schema";
import { brokerInstallationToken } from "../github/repoInit";
import {
  checkRepoAvailable,
  isValidGithubRepoName,
  isValidProjectSlug,
  type AvailabilityReason,
  type AvailabilityState,
  type CheckAvailabilityResponse,
} from "./cloneAvailabilityHelpers";

export type {
  AvailabilityReason,
  AvailabilityState,
  AvailabilityVerdict,
  CheckAvailabilityResponse,
} from "./cloneAvailabilityHelpers";

// ---------------------------------------------------------------------------
// Slug availability — DB-only (FR-021)
// ---------------------------------------------------------------------------

export async function checkSlugAvailable(
  orgId: string,
  slug: string
): Promise<{ state: AvailabilityState; reason?: AvailabilityReason }> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.orgId, orgId), eq(projects.slug, slug))
    )
    .limit(1);
  if (rows.length === 0) return { state: "available" };
  return { state: "unavailable", reason: "exists" };
}

// ---------------------------------------------------------------------------
// Encore endpoint (FR-017, FR-018)
// ---------------------------------------------------------------------------

interface CheckAvailabilityRequest {
  repoName?: string;
  slug?: string;
}

export const checkCloneAvailability = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/clone/check-availability",
  },
  async (req: CheckAvailabilityRequest): Promise<CheckAvailabilityResponse> => {
    const auth = getAuthData()!;

    if (!req.repoName && !req.slug) {
      throw APIError.invalidArgument(
        "at least one of repoName or slug must be provided"
      );
    }

    const out: CheckAvailabilityResponse = {};

    // -----------------------------------------------------------------------
    // slug — DB lookup, no external calls
    // -----------------------------------------------------------------------
    if (req.slug !== undefined) {
      if (!isValidProjectSlug(req.slug)) {
        out.slug = { value: req.slug, state: "invalid", reason: "format" };
      } else {
        const verdict = await checkSlugAvailable(auth.orgId, req.slug);
        out.slug = { value: req.slug, ...verdict };
      }
    }

    // -----------------------------------------------------------------------
    // repoName — format gate, then GitHub probe
    // -----------------------------------------------------------------------
    if (req.repoName !== undefined) {
      if (!isValidGithubRepoName(req.repoName)) {
        out.repoName = {
          value: req.repoName,
          state: "invalid",
          reason: "format",
        };
      } else {
        // Resolve the destination installation for the caller's current org.
        const [installation] = await db
          .select({
            installationId: githubInstallations.installationId,
            githubOrgLogin: githubInstallations.githubOrgLogin,
          })
          .from(githubInstallations)
          .where(
            and(
              eq(githubInstallations.orgId, auth.orgId),
              eq(githubInstallations.installationState, "active")
            )
          )
          .limit(1);

        if (!installation) {
          out.repoName = {
            value: req.repoName,
            state: "unverifiable",
            reason: "no_installation",
          };
        } else {
          let token: string;
          try {
            ({ token } = await brokerInstallationToken(
              installation.installationId,
              { metadata: "read" }
            ));
          } catch (err) {
            log.warn("clone availability: broker token failed", {
              orgId: auth.orgId,
              installationId: installation.installationId,
              err: String(err),
            });
            out.repoName = {
              value: req.repoName,
              state: "unverifiable",
              reason: "transient_error",
            };
            return out;
          }

          try {
            const verdict = await checkRepoAvailable(
              token,
              installation.githubOrgLogin,
              req.repoName
            );
            out.repoName = { value: req.repoName, ...verdict };
          } catch (err) {
            log.warn("clone availability: repo probe failed", {
              orgId: auth.orgId,
              repoName: req.repoName,
              err: String(err),
            });
            out.repoName = {
              value: req.repoName,
              state: "unverifiable",
              reason: "transient_error",
            };
          }
        }
      }
    }

    return out;
  }
);
