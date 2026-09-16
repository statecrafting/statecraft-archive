import { api, APIError } from "encore.dev/api";
import log from "encore.dev/log";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getAuthData } from "~encore/auth";
import { db } from "../db/drizzle";
import {
  auditLog,
  environments,
  projectArtifacts,
  projects,
  organizations,
  type DeploymentStatus,
  type EnvironmentDeployment,
} from "../db/schema";
import { validateM2mRequest } from "../auth/m2mAuth.js";
import { readSecretFromDir } from "./secrets";
import {
  DEPLOYD_URL,
  describeTransportError,
  dispatchDeployment,
  getDeploydAuthHeader,
  getDeploymentStatus,
} from "./deploydClient";
import {
  createDeploymentRecord,
  getLatestDeploymentForEnv,
  mapDeploydStatus,
  updateDeploymentByReleaseId,
  updateDeploymentRecord,
} from "./deployments";
import { loadDeployDescriptorForEnv } from "../environments/accessGatesDeploy";
import {
  resolveChartSelection,
  isReservedConfigRefKey,
  RESERVED_CONFIG_REF_PREFIXES,
} from "./deployResolve";
import { deriveHost } from "./hostname";
import type { HostVariant } from "./hostname";

// Hand-rolled validator for the `/v1/deployments` raw body. zod is
// avoided here because Encore.ts's TS parser walks zod 4's `.d.cts`
// during codegen and crashes on `TsFnOrConstructorType` — see
// `api/knowledge/extractionOutput.ts` for the longer explanation.

// DEPLOYD_URL and getDeploydAuthHeader are imported from ./deploydClient: the
// single deployd client module (spec 215 FR-007). The M2M token endpoint
// (OIDC_ENDPOINT), audience, and scope are resolved there, not here.
// Spec 137 — Rauthy issuer URL passed through to deployd-api so the
// rendered oauth2-proxy points at our identity provider. Distinct from
// OIDC_ENDPOINT (which is the M2M token endpoint used to call deployd-api).
const RAUTHY_ISSUER_URL = process.env.RAUTHY_ISSUER_URL ?? "";
// Spec 214 FR-007 / Clarification 3: the apex the tenant wildcard cert covers
// (`*.tenants.${TENANTS_BASE_DOMAIN}`). Operational config surfaced to the
// deploy service; the host is derived as a single label below `tenants.`.
// When unset, route derivation is skipped and the caller's desired_routes (if
// any) flow through unchanged.
const TENANTS_BASE_DOMAIN = process.env.TENANTS_BASE_DOMAIN ?? "";

interface DesiredRoute {
  host?: string;
  path: string;
}

interface CreateDeploymentBody {
  tenant_id: string;
  app_id: string;
  app_slug: string;
  env_id: string;
  env_slug: string;
  release_sha: string;
  artifact_ref: string;
  lane: "LANE_A" | "LANE_B";
  desired_routes: DesiredRoute[];
  config_refs: Record<string, string>;
  // Spec 214 optional dispatch fields. All default-derivable: chart from the
  // project's adapter (FR-002), namespace from the environment (FR-008), host
  // from slugs (FR-007). A caller may still supply them explicitly and they
  // take precedence over the derived values.
  chart?: string;
  chart_version?: string;
  image_pull_secret_name?: string;
  namespace?: string;
  variant?: HostVariant;
}

interface FieldIssue {
  field: string;
  message: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseCreateDeployment(
  raw: unknown,
):
  | { ok: true; data: CreateDeploymentBody }
  | { ok: false; issues: FieldIssue[] } {
  const issues: FieldIssue[] = [];
  if (!isObject(raw)) {
    return { ok: false, issues: [{ field: "<root>", message: "expected object" }] };
  }

  const reqStr = (key: keyof CreateDeploymentBody, min = 1): string => {
    const v = raw[key as string];
    if (typeof v !== "string" || v.length < min) {
      issues.push({
        field: key as string,
        message: `expected string with length >= ${min}`,
      });
      return "";
    }
    return v;
  };

  const tenant_id = reqStr("tenant_id");
  const app_id = reqStr("app_id");
  const app_slug = reqStr("app_slug");
  const env_id = reqStr("env_id");
  const env_slug = reqStr("env_slug");
  const release_sha = reqStr("release_sha", 7);
  const artifact_ref = reqStr("artifact_ref");

  let lane: "LANE_A" | "LANE_B" = "LANE_A";
  if (raw.lane === "LANE_A" || raw.lane === "LANE_B") {
    lane = raw.lane;
  } else {
    issues.push({ field: "lane", message: "expected 'LANE_A' or 'LANE_B'" });
  }

  const desired_routes: DesiredRoute[] = [];
  if (raw.desired_routes !== undefined) {
    if (!Array.isArray(raw.desired_routes)) {
      issues.push({ field: "desired_routes", message: "expected array" });
    } else {
      raw.desired_routes.forEach((entry, i) => {
        if (!isObject(entry)) {
          issues.push({
            field: `desired_routes[${i}]`,
            message: "expected object",
          });
          return;
        }
        const host = entry.host;
        if (host !== undefined && typeof host !== "string") {
          issues.push({
            field: `desired_routes[${i}].host`,
            message: "expected string",
          });
          return;
        }
        const path = typeof entry.path === "string" ? entry.path : "/";
        desired_routes.push({ host, path });
      });
    }
  }

  const config_refs: Record<string, string> = {};
  if (raw.config_refs !== undefined) {
    if (!isObject(raw.config_refs)) {
      issues.push({ field: "config_refs", message: "expected object" });
    } else {
      for (const [k, v] of Object.entries(raw.config_refs)) {
        if (typeof v !== "string") {
          issues.push({
            field: `config_refs.${k}`,
            message: "expected string value",
          });
          continue;
        }
        // Spec 214 FR-004: ENCORE_/KUBERNETES_ are runtime/platform-owned.
        if (isReservedConfigRefKey(k)) {
          issues.push({
            field: `config_refs.${k}`,
            message: `reserved prefix: keys starting with ${RESERVED_CONFIG_REF_PREFIXES.join(" or ")} are platform-managed and cannot be set via config_refs`,
          });
          continue;
        }
        config_refs[k] = v;
      }
    }
  }

  // Spec 214 optional dispatch fields. Absent fields stay undefined and are
  // derived (or defaulted) downstream; present non-strings are a field error.
  const optStr = (key: string): string | undefined => {
    const v = raw[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "string") {
      issues.push({ field: key, message: "expected string" });
      return undefined;
    }
    return v;
  };
  const chart = optStr("chart");
  const chart_version = optStr("chart_version");
  const image_pull_secret_name = optStr("image_pull_secret_name");
  const namespace = optStr("namespace");

  let variant: HostVariant | undefined;
  if (raw.variant !== undefined && raw.variant !== null) {
    if (raw.variant === "public" || raw.variant === "internal") {
      variant = raw.variant;
    } else {
      issues.push({ field: "variant", message: "expected 'public' or 'internal'" });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    data: {
      tenant_id,
      app_id,
      app_slug,
      env_id,
      env_slug,
      release_sha,
      artifact_ref,
      lane,
      desired_routes,
      config_refs,
      chart,
      chart_version,
      image_pull_secret_name,
      namespace,
      variant,
    },
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}

export const createDeployment = api.raw(
  // Spec 215 FR-006: `auth: false` keeps the Encore gateway's user-session
  // handler off this seam, but the handler now requires a valid Rauthy M2M
  // JWT carrying `platform:deploy:write`. Browser-reachable anonymity ends;
  // machine callers present a client_credentials token (validateM2mRequest).
  { expose: true, path: "/v1/deployments", method: "POST", auth: false },
  async (req, res) => {
    // FR-006: validate the M2M bearer before doing any work. In a raw handler
    // a thrown APIError is not auto-rendered, so map its code to a status and
    // write the response ourselves.
    try {
      const authHeader =
        typeof req.headers["authorization"] === "string"
          ? req.headers["authorization"]
          : undefined;
      await validateM2mRequest(authHeader, "platform:deploy:write");
    } catch (err) {
      const code = err instanceof APIError ? err.code : "internal";
      const status =
        code === "unauthenticated" ? 401 : code === "permission_denied" ? 403 : 500;
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: String(code),
          message: err instanceof Error ? err.message : "authentication failed",
        })
      );
      return;
    }

    let body: unknown;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "invalid_request",
          message: "Invalid JSON body",
        })
      );
      return;
    }

    const parsed = parseCreateDeployment(body);
    if (!parsed.ok) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "invalid_request",
          details: parsed.issues,
        })
      );
      return;
    }

    const data = parsed.data;

    // POC: when deployed (SECRETS_DIR set), validate CSI wiring by checking STATECRAFT_DB_URL
    const secretsDir = process.env.SECRETS_DIR;
    if (secretsDir) {
      const statecraftDbUrl =
        (await readSecretFromDir("STATECRAFT_DB_URL")) ?? process.env.statecraft_DB_URL ?? null;

      if (!statecraftDbUrl) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            error: "missing_secret",
            message:
              "STATECRAFT_DB_URL not found in secrets mount or env; set Key Vault secret or env var",
          })
        );
        return;
      }
    }

    // region: access-gate-wire
    // Spec 137 Phase 4↔5 integration — load the per-env access-gate
    // descriptor and forward as `access_gate` to deployd-api. The
    // descriptor lives in statecraft Postgres; deployd-api only sees the
    // rendered wire shape. Absent descriptor (no gate ever configured)
    // produces `null`, which deployd-api treats identically to
    // `enabled: false` (no auth-url annotation, no gate release).
    //
    // RAUTHY_ISSUER_URL is required when any tenant in this cluster
    // wants an enabled gate; gate-disabled deploys can flow through even
    // when it's missing (we surface the env var only when we actually
    // emit a non-null access_gate).
    let access_gate: Awaited<ReturnType<typeof loadDeployDescriptorForEnv>> = null;
    try {
      access_gate = await loadDeployDescriptorForEnv(
        data.env_id,
        RAUTHY_ISSUER_URL,
      );
      if (access_gate?.enabled && !RAUTHY_ISSUER_URL) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            error: "missing_config",
            message:
              "RAUTHY_ISSUER_URL is required when a tenant access gate is enabled",
          }),
        );
        return;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("deploy.access_gate.load_failed", {
        envId: data.env_id,
        error: msg,
      });
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "access_gate_load_failed",
          message: msg,
        }),
      );
      return;
    }

    // region: shape-and-routing
    // Spec 214: enrich the dispatch from statecraft's own records. Resolve the
    // chart shape from the project's factory adapter (FR-002), forward the
    // stored namespace (FR-008), and derive the tenant host from
    // org/project/env slugs when the caller supplied no routes (FR-007).
    // Best-effort: any lookup miss or DB error falls back to caller-supplied
    // values so existing /v1/deployments callers keep working unchanged.
    let chartSelection = resolveChartSelection(undefined, data.chart);
    let forwardedNamespace: string | undefined = data.namespace || undefined;
    let desiredRoutes = data.desired_routes;
    try {
      const [env] = await db
        .select({
          projectId: environments.projectId,
          k8sNamespace: environments.k8sNamespace,
        })
        .from(environments)
        .where(eq(environments.id, data.env_id))
        .limit(1);
      if (env) {
        if (!forwardedNamespace && env.k8sNamespace) {
          forwardedNamespace = env.k8sNamespace;
        }
        const [project] = await db
          .select({
            slug: projects.slug,
            orgId: projects.orgId,
            factoryAdapterId: projects.factoryAdapterId,
          })
          .from(projects)
          .where(eq(projects.id, env.projectId))
          .limit(1);
        if (project) {
          chartSelection = resolveChartSelection(project.factoryAdapterId, data.chart);
          if (desiredRoutes.length === 0 && TENANTS_BASE_DOMAIN) {
            const [org] = await db
              .select({ slug: organizations.slug })
              .from(organizations)
              .where(eq(organizations.id, project.orgId))
              .limit(1);
            if (org) {
              const host = deriveHost({
                orgSlug: org.slug,
                projectSlug: project.slug,
                envSlug: data.env_slug,
                variant: data.variant,
                baseDomain: TENANTS_BASE_DOMAIN,
              });
              desiredRoutes = [{ host, path: "/" }];
            }
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("deploy.enrichment.lookup_failed", { envId: data.env_id, error: msg });
      // Fall through with caller-supplied chart/namespace/routes.
    }
    // FR-005: default the pull secret to the reflected `ghcr-pull` dockerconfig.
    const imagePullSecretName = data.image_pull_secret_name || "ghcr-pull";
    // endregion shape-and-routing

    try {
      const authHeader = await getDeploydAuthHeader();
      const resp = await fetch(`${DEPLOYD_URL}/v1/deployments`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: authHeader,
        },
        body: JSON.stringify({
          tenant_id: data.tenant_id,
          app_id: data.app_id,
          app_slug: data.app_slug,
          env_id: data.env_id,
          env_slug: data.env_slug,
          release_sha: data.release_sha,
          artifact_ref: data.artifact_ref,
          lane: data.lane,
          config_refs: data.config_refs,
          desired_routes: desiredRoutes,
          access_gate,
          // Spec 214: chart (FR-002), namespace (FR-008), pull secret (FR-005).
          // Undefined fields are omitted by JSON.stringify, so deployd-api's
          // Option<_> defaults apply (chart falls back to its own default).
          chart: chartSelection?.chart,
          chart_version: data.chart_version || chartSelection?.version,
          image_pull_secret_name: imagePullSecretName,
          namespace: forwardedNamespace,
        }),
      });
    // endregion access-gate-wire

      const text = await resp.text();

      res.statusCode = resp.status;
      res.setHeader("Content-Type", "application/json");

      if (!resp.ok) {
        res.end(
          JSON.stringify({
            error: "deployd_failed",
            status: resp.status,
            body: safeJson(text),
          })
        );
        return;
      }

      res.end(
        JSON.stringify({
          env_id: data.env_id,
          deployd: safeJson(text),
        })
      );
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "internal",
          message: err instanceof Error ? err.message : "Unknown error",
        })
      );
    }
  }
);

export const healthz = api.raw(
  { expose: true, path: "/healthz", method: "GET", auth: false },
  async (_req, res) => {
    res.statusCode = 200;
    res.end("ok");
  }
);

// ===========================================================================
// Spec 215 FR-002 / FR-006 / FR-008: authenticated deploy trigger + status.
// ===========================================================================
//
// Two session-authed endpoints used by the project UI. The web tier never
// calls deployd-api directly; it calls these, which use the consolidated
// deployd client (FR-007). `auth: true` plus the org-scoped environment
// lookup below is the FR-006 membership gate: a caller may only act on an
// environment whose project lives in the caller's active org.

const HELM_TIMEOUT_SEC = Number(process.env.DEPLOYD_HELM_TIMEOUT_SEC ?? "300");

export interface DeploymentView {
  id: string;
  environmentId: string;
  projectId: string;
  releaseId: string | null;
  releaseSha: string;
  artifactRef: string;
  variant: string;
  status: DeploymentStatus;
  endpoints: string[];
  dispatchedBy: string;
  diagnostic: string | null;
  createdAt: string;
  updatedAt: string;
}

function toDeploymentView(d: EnvironmentDeployment): DeploymentView {
  return {
    id: d.id,
    environmentId: d.environmentId,
    projectId: d.projectId,
    releaseId: d.releaseId,
    releaseSha: d.releaseSha,
    artifactRef: d.artifactRef,
    variant: d.variant,
    status: d.status,
    endpoints: d.endpoints,
    dispatchedBy: d.dispatchedBy,
    diagnostic: d.diagnostic,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

interface DeployEnvContext {
  envId: string;
  projectId: string;
  envName: string;
  envKind: string;
  k8sNamespace: string | null;
  requiresApproval: boolean;
  projectSlug: string;
  orgId: string;
  orgSlug: string;
  factoryAdapterId: string | null;
  usesRedis: boolean;
}

/**
 * Resolve the environment, its project, and the owning org, scoped to the
 * caller's active org (FR-006). Throws NotFound when the environment is not in
 * the caller's org or the (projectId, envId) pair does not line up: the same
 * org-scoping contract the access-gate endpoints enforce (spec 137).
 */
async function loadDeployEnvContext(
  projectId: string,
  envId: string,
  orgId: string,
): Promise<DeployEnvContext> {
  const [row] = await db
    .select({
      envId: environments.id,
      projectId: environments.projectId,
      envName: environments.name,
      envKind: environments.kind,
      k8sNamespace: environments.k8sNamespace,
      requiresApproval: environments.requiresApproval,
      projectSlug: projects.slug,
      orgId: projects.orgId,
      orgSlug: organizations.slug,
      factoryAdapterId: projects.factoryAdapterId,
      usesRedis: projects.usesRedis,
    })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .where(
      and(
        eq(environments.id, envId),
        eq(environments.projectId, projectId),
        eq(projects.orgId, orgId),
      ),
    )
    .limit(1);
  if (!row) {
    throw APIError.notFound("environment not found in this org");
  }
  return row;
}

/** Lowercase DNS label for host derivation (env name to a single label). */
function hostLabel(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63) || "env"
  );
}

interface ResolvedArtifact {
  releaseSha: string;
  artifactRef: string;
  variant: string;
}

/**
 * Resolve the image to deploy from the project's artifact record (spec 213).
 * Picks the newest built artifact in the deployable set (public for dual-
 * profile trees, root for single-variant). The internal variant is a separate
 * action (spec 214 FR-009 / this spec's edge cases). Returns null when no
 * image has been published yet, which the caller surfaces as not-built.
 */
async function resolveLatestArtifact(
  projectId: string,
): Promise<ResolvedArtifact | null> {
  const [row] = await db
    .select({
      releaseSha: projectArtifacts.releaseSha,
      imageRef: projectArtifacts.imageRef,
      variant: projectArtifacts.variant,
    })
    .from(projectArtifacts)
    .where(
      and(
        eq(projectArtifacts.projectId, projectId),
        inArray(projectArtifacts.variant, ["public", "root"]),
      ),
    )
    .orderBy(desc(projectArtifacts.builtAt))
    .limit(1);
  if (!row) return null;
  return {
    releaseSha: row.releaseSha,
    artifactRef: row.imageRef,
    variant: row.variant,
  };
}

type BuildBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * Assemble the deployd-api dispatch body for a UI-triggered deploy, enriched
 * from statecraft's own records (spec 214): chart from the project's adapter,
 * namespace from the environment, tenant host derived from org/project/env
 * slugs, and the per-env access-gate descriptor. Mirrors the enrichment the
 * raw /v1/deployments proxy does inline for external callers; kept separate
 * because the trigger derives every field rather than accepting overrides.
 */
async function buildTriggerDeploydBody(
  ctx: DeployEnvContext,
  artifact: ResolvedArtifact,
): Promise<BuildBodyResult> {
  const hostVariant: HostVariant | undefined =
    artifact.variant === "internal"
      ? "internal"
      : artifact.variant === "public"
        ? "public"
        : undefined;

  let access_gate: Awaited<ReturnType<typeof loadDeployDescriptorForEnv>> = null;
  try {
    access_gate = await loadDeployDescriptorForEnv(ctx.envId, RAUTHY_ISSUER_URL);
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  if (access_gate?.enabled && !RAUTHY_ISSUER_URL) {
    return {
      ok: false,
      message:
        "RAUTHY_ISSUER_URL is required when a tenant access gate is enabled",
    };
  }

  // Spec 214 FR-006: the acme-vue-encore tenant is an Encore app with a
  // SQLDatabase, so it cannot boot without a database (it crash-loops on
  // "failed to resolve password" otherwise). Development and preview
  // environments get an auto-provisioned preview-grade Postgres
  // (previewDatabase.enabled=true, rendered by deployd-api + the chart);
  // other kinds must supply an external DSN, which this trigger does not model
  // yet, so refuse rather than dispatch a DB-less app.
  const previewDatabase =
    ctx.envKind === "development" || ctx.envKind === "preview";
  if (!previewDatabase) {
    return {
      ok: false,
      message: `environment kind '${ctx.envKind}' needs an external database; only development and preview environments auto-provision one`,
    };
  }

  // Spec 227 Stage 4 (FR-005): opt-in Redis. Unlike Postgres (default-on, and
  // required to boot), Redis provisions only when the project selected it at
  // scaffold (ctx.usesRedis) AND only in the same dev/preview kinds that
  // auto-provision infrastructure. Non-development environments supply an
  // external Redis as runtime env; deployd never provisions it for them. This
  // is opt-in, so no hard refusal when off (the app boots fine without Redis).
  const previewRedis = ctx.usesRedis && previewDatabase;

  const chartSelection = resolveChartSelection(ctx.factoryAdapterId, undefined);
  const desiredRoutes = TENANTS_BASE_DOMAIN
    ? [
        {
          host: deriveHost({
            orgSlug: ctx.orgSlug,
            projectSlug: ctx.projectSlug,
            envSlug: hostLabel(ctx.envName),
            variant: hostVariant,
            baseDomain: TENANTS_BASE_DOMAIN,
          }),
          path: "/",
        },
      ]
    : [];

  return {
    ok: true,
    body: {
      tenant_id: ctx.orgSlug,
      app_id: ctx.projectId,
      app_slug: ctx.projectSlug,
      env_id: ctx.envId,
      env_slug: hostLabel(ctx.envName),
      release_sha: artifact.releaseSha,
      artifact_ref: artifact.artifactRef,
      lane: "LANE_A",
      config_refs: {},
      desired_routes: desiredRoutes,
      access_gate,
      chart: chartSelection?.chart,
      chart_version: chartSelection?.version,
      image_pull_secret_name: "ghcr-pull",
      namespace: ctx.k8sNamespace ?? undefined,
      preview_database: previewDatabase,
      preview_redis: previewRedis,
    },
  };
}

export interface TriggerDeploymentRequest {
  projectId: string;
  envId: string;
}

export interface TriggerDeploymentResponse {
  deployment: DeploymentView;
  /** true when an existing ROLLED_OUT record at this commit was returned. */
  alreadyDeployed: boolean;
}

/**
 * POST /api/projects/:projectId/envs/:envId/deployments (spec 215 FR-001/002).
 * Resolve the built image (FR-001/213), refuse approval-gated environments
 * (FR-006), record the dispatch (FR-003), enrich + dispatch via the
 * consolidated client (FR-002/007), and reconcile the record from the
 * synchronous deployd response.
 */
export const triggerDeployment = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/:projectId/envs/:envId/deployments",
  },
  async (req: TriggerDeploymentRequest): Promise<TriggerDeploymentResponse> => {
    const auth = getAuthData()!;
    const ctx = await loadDeployEnvContext(req.projectId, req.envId, auth.orgId);

    // FR-006: requiresApproval environments refuse direct dispatch; the
    // approval flow itself stays with the spec 087 promotion vision.
    if (ctx.requiresApproval) {
      throw APIError.failedPrecondition(
        "environment requires approval; direct deploy is not permitted",
      );
    }

    // FR-001 / spec 213: the image must exist before we can deploy it.
    const artifact = await resolveLatestArtifact(ctx.projectId);
    if (!artifact) {
      throw APIError.failedPrecondition("image not built yet for this project");
    }

    // FR-001 scenario 3: idempotent replay. If the latest deployment already
    // rolled out this exact commit + variant, return it without re-rolling.
    const latest = await getLatestDeploymentForEnv(ctx.envId);
    if (
      latest &&
      latest.status === "ROLLED_OUT" &&
      latest.releaseSha === artifact.releaseSha &&
      latest.variant === artifact.variant
    ) {
      return { deployment: toDeploymentView(latest), alreadyDeployed: true };
    }

    // Record the dispatch up-front (FR-003) so a crash mid-dispatch still
    // leaves a row; status starts PENDING and is reconciled from the response.
    const record = await createDeploymentRecord({
      environmentId: ctx.envId,
      projectId: ctx.projectId,
      releaseSha: artifact.releaseSha,
      artifactRef: artifact.artifactRef,
      variant: artifact.variant,
      status: "PENDING",
      dispatchedBy: auth.userID,
    });

    const built = await buildTriggerDeploydBody(ctx, artifact);
    if (!built.ok) {
      await updateDeploymentRecord(record.id, {
        status: "FAILED",
        diagnostic: built.message,
      });
      // A build-body failure is an unmet deploy precondition (e.g.
      // "RAUTHY_ISSUER_URL is required when a tenant access gate is enabled"),
      // not an internal fault. Encore sanitizes `internal` errors to "an
      // internal error occurred" before they reach the client, which hid the
      // real reason in the redeploy toast even though the record's diagnostic
      // held it. failedPrecondition forwards the message, matching the
      // "image not built yet" throw above.
      throw APIError.failedPrecondition(built.message);
    }

    let updated: EnvironmentDeployment | undefined;
    try {
      const result = await dispatchDeployment(built.body);
      if (result.ok) {
        const mapped = mapDeploydStatus(result.status);
        let diagnostic: string | null = null;
        if (mapped === "FAILED") {
          // deployd's synchronous POST returns only the terminal status; the
          // real cause (helm stderr) lands in a `failed` event. Pull it via
          // the status endpoint so the UI shows what went wrong instead of a
          // generic "see deployd logs". Best-effort: keep the generic message
          // if the status read is unavailable.
          diagnostic = "deployd reported FAILED (see deployd logs)";
          if (result.releaseId) {
            try {
              const status = await getDeploymentStatus(result.releaseId);
              if (status?.failedReason) diagnostic = status.failedReason;
            } catch {
              // leave the generic diagnostic; status read is best-effort
            }
          }
        }
        updated = await updateDeploymentRecord(record.id, {
          status: mapped,
          releaseId: result.releaseId,
          endpoints: result.endpoints,
          diagnostic,
        });
      } else {
        updated = await updateDeploymentRecord(record.id, {
          status: "FAILED",
          releaseId: result.releaseId,
          diagnostic: result.diagnostic,
        });
      }
    } catch (err: unknown) {
      // Transport-level failure reaching deployd (DNS, connection refused,
      // TLS, or undici's headers timeout while deployd holds the connection
      // during a long helm --wait): REQUEST_FAILED, no phantom PENDING.
      // Node's bare `fetch failed` message hides the real reason in
      // `err.cause`; unwrap it so the diagnostic is actionable (e.g.
      // ECONNREFUSED vs ENOTFOUND vs UND_ERR_HEADERS_TIMEOUT).
      updated = await updateDeploymentRecord(record.id, {
        status: "REQUEST_FAILED",
        diagnostic: describeTransportError(err),
      });
    }

    const view = toDeploymentView(updated ?? record);
    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "deploy.triggered",
      targetType: "environment",
      targetId: ctx.envId,
      metadata: {
        projectId: ctx.projectId,
        releaseSha: artifact.releaseSha,
        variant: artifact.variant,
        status: view.status,
        releaseId: view.releaseId,
      },
    });

    return { deployment: view, alreadyDeployed: false };
  },
);

export interface GetLatestDeploymentRequest {
  projectId: string;
  envId: string;
}

export interface GetLatestDeploymentResponse {
  deployment: DeploymentView | null;
}

/**
 * GET /api/projects/:projectId/envs/:envId/deployments/latest (FR-004/008).
 * Returns the latest record for the environment, or null for the never-
 * deployed empty state. A PENDING record older than the helm timeout is
 * lazily reconciled against deployd-api status before answering (FR-008; no
 * background poller).
 */
export const getLatestDeployment = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/envs/:envId/deployments/latest",
  },
  async (
    req: GetLatestDeploymentRequest,
  ): Promise<GetLatestDeploymentResponse> => {
    const auth = getAuthData()!;
    await loadDeployEnvContext(req.projectId, req.envId, auth.orgId);

    let latest = await getLatestDeploymentForEnv(req.envId);
    if (!latest) {
      return { deployment: null };
    }

    if (
      latest.status === "PENDING" &&
      latest.releaseId &&
      Date.now() - latest.updatedAt.getTime() > HELM_TIMEOUT_SEC * 1000
    ) {
      try {
        const remote = await getDeploymentStatus(latest.releaseId);
        if (remote) {
          const mapped = mapDeploydStatus(remote.status);
          if (mapped !== latest.status) {
            const reconciled = await updateDeploymentByReleaseId(
              latest.releaseId,
              { status: mapped },
            );
            if (reconciled) latest = reconciled;
          }
        }
      } catch (e: unknown) {
        log.warn("deploy.reconcile.failed", {
          releaseId: latest.releaseId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { deployment: toDeploymentView(latest) };
  },
);
