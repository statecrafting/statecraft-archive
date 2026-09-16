import { api, APIError, Header } from "encore.dev/api";
import { validateM2mRequest } from "../auth/m2mAuth.js";
import { db } from "../db/drizzle";
import { projects } from "../db/schema";
import { eq } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Directory where policy bundle JSON files are stored (one per project).
 * Spec 119 §4.5 renamed the on-disk layout to
 * `build/policy/projects/{projectId}.json`. Mount a config volume here in
 * production, or set POLICY_BUNDLE_DIR env var.
 */
const BUNDLE_DIR = process.env.POLICY_BUNDLE_DIR ?? "/var/lib/statecraft/policy-bundles";

type PolicyBundleRequest = {
  authorization: Header<"Authorization">;
  projectId: string;
};

type PolicyBundleResponse = {
  constitution: unknown[];
  shards: Record<string, unknown[]>;
};

/**
 * Seam A: Serve compiled policy bundles to OPC axiomregent.
 * GET /api/policy-bundle/:projectId — M2M bearer token auth (OIDC JWT or static fallback).
 */
export const getPolicyBundle = api(
  { expose: true, method: "GET", path: "/api/policy-bundle/:projectId" },
  async (req: PolicyBundleRequest): Promise<PolicyBundleResponse> => {
    await validateM2mRequest(req.authorization, "platform:policy:read");

    // Validate projectId to prevent path traversal (082 Phase 2). projects.id
    // is a uuid column, so this also doubles as the format check before the
    // DB lookup below.
    if (!UUID_PATTERN.test(req.projectId)) {
      throw APIError.invalidArgument("invalid project ID");
    }

    // The M2M credential behind this seam is platform-wide and carries no
    // caller/org identity (see m2mAuth.ts), so this cannot fully verify
    // "does the caller's org own this project" the way a session-
    // authenticated endpoint can (compare admin.ts::requireOrgAdmin). At
    // minimum, require projectId to name a real, currently-registered
    // project instead of trusting any UUID-shaped string as a bundle
    // filename: this closes reading stray bundle files left on disk for
    // projects that were deleted or never registered.
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, req.projectId))
      .limit(1);
    if (!project) {
      throw APIError.notFound(`no policy bundle for project ${req.projectId}`);
    }

    const filePath = path.join(BUNDLE_DIR, `${req.projectId}.json`);

    if (!fs.existsSync(filePath)) {
      throw APIError.notFound(`no policy bundle for project ${req.projectId}`);
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const bundle = JSON.parse(raw) as PolicyBundleResponse;

    return bundle;
  }
);
