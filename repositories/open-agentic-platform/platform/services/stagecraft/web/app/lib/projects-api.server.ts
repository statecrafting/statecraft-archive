/**
 * Projects API helpers using direct fetch.
 * The Encore generated client now includes the projects service
 * (see client.ts projects.ServiceClient), but these helpers are kept
 * because they forward cookies and derive the base URL from the incoming
 * request — behavior the generated client does not support.
 * Decision: Keep manual fetch. The Encore generated client does not support
 * forwarding cookies from incoming SSR requests, which is required for
 * server-side loaders in React Router v7 to proxy the user's session cookie.
 */

const DEFAULT_API_BASE = "http://localhost:4000";

/**
 * Resolve the base URL for the SSR → Encore API hop.
 *
 * In production, the RR SSR runs in the same pod as the Encore API. Routing
 * the call back out through the public hostname means a pointless trip
 * through Cloudflare + ingress, and — if `x-forwarded-proto` is missing —
 * reconstructs `request.url` as `http://…`, which Cloudflare then redirects
 * to HTTPS, causing undici to drop the Cookie header on the scheme change.
 * The result is a 401 for the inner call even though the outer request was
 * perfectly authenticated.
 *
 * Prefer `ENCORE_API_BASE_URL` when set, otherwise always loop back via
 * localhost:4000 (same pod). `request` is accepted for future use.
 */
function getBaseUrl(_request: Request): string {
  return process.env.ENCORE_API_BASE_URL ?? DEFAULT_API_BASE;
}

async function apiFetch(request: Request, path: string, init?: RequestInit) {
  const base = getBaseUrl(request);
  const cookie = request.headers.get("Cookie") ?? "";
  const fullUrl = `${base}${path}`;
  const method = init?.method ?? "GET";
  const hasSessionCookie = cookie.includes("__session=");
  console.log("apiFetch outbound", {
    method,
    url: fullUrl,
    requestUrl: request.url,
    hasSessionCookie,
    cookieLen: cookie.length,
    envBase: process.env.ENCORE_API_BASE_URL ?? null,
  });
  let res: Response;
  try {
    res = await fetch(fullUrl, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(cookie && { Cookie: cookie }),
        ...init?.headers,
      },
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    console.error("apiFetch network error", { method, url: fullUrl, cause });
    throw new Error(`Network error calling ${path}: ${cause}`);
  }
  if (!res.ok) {
    const body = await res.text();
    console.error("apiFetch non-ok response", {
      method,
      url: fullUrl,
      status: res.status,
      bodyPreview: body.slice(0, 300),
    });
    throw new Error(body || `API error: ${res.status}`);
  }
  return res.json();
}

// Projects

// Spec 113 §FR-039 — `hasPrimaryRepo` is computed server-side via an EXISTS
// subquery so the projects index can hide the Clone affordance for projects
// without a primary repo without a second round-trip. `primaryRepoName`
// drives the dialog's `<sourceRepoName>-clone` pre-fill.
export interface ProjectListEntry {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description: string;
  factoryAdapterId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  hasPrimaryRepo: boolean;
  primaryRepoName: string | null;
}

export async function listProjects(request: Request) {
  return apiFetch(request, "/api/projects") as Promise<{
    projects: ProjectListEntry[];
    destinationGithubOrgLogin: string | null;
  }>;
}

export async function getProject(request: Request, id: string) {
  return apiFetch(request, `/api/projects/${id}`) as Promise<{
    project: any;
  }>;
}

export async function createProject(
  request: Request,
  data: {
    name: string;
    slug: string;
    description?: string;
    actorUserId: string;
  }
) {
  return apiFetch(request, "/api/projects", {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ project: any }>;
}

export async function deleteProject(
  request: Request,
  id: string,
  actorUserId: string
) {
  return apiFetch(
    request,
    `/api/projects/${id}?actorUserId=${encodeURIComponent(actorUserId)}`,
    { method: "DELETE" }
  ) as Promise<{ ok: true }>;
}

// Spec 113 — Clone Project (availability + submit).

export type CloneAvailabilityState =
  | "available"
  | "unavailable"
  | "invalid"
  | "unverifiable";

export type CloneAvailabilityReason =
  | "format"
  | "exists"
  | "rate_limited"
  | "no_installation"
  | "transient_error";

export interface CloneAvailabilityVerdict {
  value: string;
  state: CloneAvailabilityState;
  reason?: CloneAvailabilityReason;
  retryAfterSec?: number;
}

export interface CloneAvailabilityResponse {
  repoName?: CloneAvailabilityVerdict;
  slug?: CloneAvailabilityVerdict;
}

export async function checkCloneAvailability(
  request: Request,
  params: { repoName?: string; slug?: string }
) {
  const qs = new URLSearchParams();
  if (params.repoName !== undefined) qs.set("repoName", params.repoName);
  if (params.slug !== undefined) qs.set("slug", params.slug);
  return apiFetch(
    request,
    `/api/projects/clone/check-availability?${qs.toString()}`
  ) as Promise<CloneAvailabilityResponse>;
}

/**
 * Spec 114 §5.1 — the submit endpoint now queues and returns a job id.
 * The dialog polls `getCloneRunStatus` until the run is terminal.
 */
export interface CloneJobAccepted {
  cloneJobId: string;
  status: "queued";
}

export interface CloneRunStatus {
  cloneJobId: string;
  status: "pending" | "running" | "ok" | "failed";
  sourceProjectId: string;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  projectId: string | null;
  finalName: string | null;
  finalSlug: string | null;
  repoFullName: string | null;
  defaultBranch: string | null;
  opcDeepLink: string | null;
  rawArtifactsCopied: number | null;
  rawArtifactsSkipped: number | null;
  durationMs: number | null;
  error: string | null;
  errorDetail: string | null;
}

export async function cloneProject(
  request: Request,
  sourceProjectId: string,
  body: { name?: string; slug?: string; repoName?: string }
) {
  return apiFetch(request, `/api/projects/${sourceProjectId}/clone`, {
    method: "POST",
    body: JSON.stringify({ ...body, sourceProjectId }),
  }) as Promise<CloneJobAccepted>;
}

export async function getCloneRunStatus(
  request: Request,
  cloneJobId: string
) {
  return apiFetch(
    request,
    `/api/projects/clone/runs/${encodeURIComponent(cloneJobId)}`
  ) as Promise<CloneRunStatus>;
}

// Self-service project creation (spec 080 Phase 2)

export async function createProjectWithRepo(
  request: Request,
  data: {
    name: string;
    slug: string;
    description?: string;
    adapter: string;
    repoName: string;
    isPrivate?: boolean;
  }
) {
  return apiFetch(request, "/api/projects/with-repo", {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{
    project: any;
    repo: any;
    environments: any[];
    githubRepoUrl: string;
  }>;
}

// Spec 112 §5.2 — ACP-native factory project creation.
export async function createFactoryProject(
  request: Request,
  data: {
    name: string;
    slug: string;
    description?: string;
    adapterId: string;
    variant: "single-public" | "single-internal" | "dual";
    modules?: string[];
    repoName: string;
    isPrivate?: boolean;
    // Spec 227 Stage 2: Base-app config (BFF gateway knobs).
    bffPrivateApiBaseUrl?: string;
    gatewayTimeoutMs?: number;
    // Spec 229 auth-driver axis: mock|rauthy, patched as AUTH_DRIVER.
    authDriver?: "mock" | "rauthy";
  }
) {
  return apiFetch(request, "/api/projects/factory-create", {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{
    projectId: string;
    repoUrl: string;
    cloneUrl: string;
    opcDeepLink: string;
    scaffoldJobId: string;
    factoryAdapterId: string;
    devEnvironmentId: string;
    profile: string;
  }>;
}

// Spec 112 Phase 5 — scaffold-readiness gate for the Create form.
// Spec 139 Phase 2 (T056) — added per-adapter eligibility verdicts and the
// `scaffoldSourceResolved` blocker.
// Spec 140 §2.3 / T061 — `hasTemplateRemote` removed from both the
// per-adapter verdict and the top-level response. Create-eligibility is
// solely `scaffoldSourceResolved`.
export interface AdapterReadinessVerdict {
  id: string;
  name: string;
  declaresScaffoldSource: boolean;
  scaffoldSourceResolved: boolean;
  createEligible: boolean;
}

export interface ScaffoldReadiness {
  ready: boolean;
  step: string;
  progress: number;
  error?: string;
  hasFactoryAdapter: boolean;
  hasUpstreamPat: boolean;
  scaffoldSourceResolved: boolean;
  adapters: AdapterReadinessVerdict[];
  canCreate: boolean;
  blocker?:
    | "warming-up"
    | "warmup-error"
    | "no-factory-adapter"
    | "stale-adapter-manifest"
    | "no-scaffold-source-resolved"
    | "no-upstream-pat";
}

export async function getScaffoldReadiness(
  request: Request
): Promise<ScaffoldReadiness> {
  return apiFetch(
    request,
    "/api/projects/scaffold-readiness"
  ) as Promise<ScaffoldReadiness>;
}

export async function listFactoryAdapters(request: Request) {
  return apiFetch(request, "/api/factory/adapters") as Promise<{
    adapters: Array<{
      id: string;
      name: string;
      version: string;
      sourceSha: string;
    }>;
  }>;
}

// Spec 227 Stage 1: the create-project module catalog, derived server-side
// from the org's adapter manifests (api/factory/moduleCatalog.ts). Mirrors the
// backend ModuleDescriptor so the route loader can drop its hand-copy.
export interface ModuleDescriptor {
  id: string;
  displayName: string;
  category: string;
  description: string;
  requires: string[];
  conflicts: string[];
  status?: string;
}

// Spec 227 Stage 2: per-profile scaffold defaults (from the adapter manifest's
// scaffold.profiles), mirrored for the create form's two-axis selector and
// "auto for Internal" pre-check. Source of truth: api/factory/moduleCatalog.ts.
export interface ProfileDefault {
  name: string;
  variant: string;
  authDriver?: string;
  modules: string[];
}

export async function getModuleCatalog(request: Request) {
  return apiFetch(request, "/api/factory/module-catalog") as Promise<{
    modules: ModuleDescriptor[];
    profiles: ProfileDefault[];
  }>;
}

// Spec 112 §6.2 — factory project import.
export interface ImportedRawArtifact {
  objectId: string;
  filename: string;
  relativePath: string;
  contentHash: string;
  sizeBytes: number;
}

// Spec 112 §6.1 — App-installation picker for the Statecraft Import UI.
export interface ImportInstallationRepo {
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
}

export interface ImportInstallationEntry {
  installationId: number;
  githubOrgLogin: string;
  error: string | null;
  repos: ImportInstallationRepo[];
}

export async function listImportInstallations(request: Request) {
  return apiFetch(
    request,
    "/api/projects/factory-import/installations"
  ) as Promise<{ installations: ImportInstallationEntry[] }>;
}

export async function importFactoryProject(
  request: Request,
  data: {
    repoUrl: string;
    name?: string;
    slug?: string;
    description?: string;
    previewOnly?: boolean;
    githubPat?: string;
    skipPullRequest?: boolean;
  }
) {
  return apiFetch(request, "/api/projects/factory-import", {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{
    projectId: string | null;
    detectionLevel:
      | "not_factory"
      | "scaffold_only"
      | "legacy_produced"
      | "acp_produced";
    repoUrl: string;
    cloneUrl: string;
    opcDeepLink: string | null;
    translatorVersion: string | null;
    translatedPreview?: Record<string, unknown>;
    previewOnly: boolean;
    rawArtifacts: ImportedRawArtifact[];
    rawArtifactsSkipped: number;
    /** L1 only — URL of the translation PR opened on the source repo. */
    pullRequestUrl?: string | null;
    /** L1 only — message when PR opening failed after registration. */
    pullRequestError?: string;
  }>;
}

// Spec 112 §6.3 — Open-in-OPC bundle for a project.
export interface OpcBundle {
  project: {
    id: string;
    name: string;
    slug: string;
    orgId: string;
  };
  repo: {
    cloneUrl: string;
    githubOrg: string;
    repoName: string;
    defaultBranch: string;
  } | null;
  deepLink: string | null;
  adapter: {
    id: string;
    name: string;
    version: string;
    sourceSha: string;
    syncedAt: string;
    manifest: unknown;
  } | null;
  contracts: Array<{
    name: string;
    version: string;
    sourceSha: string;
    syncedAt: string;
    schema: unknown;
  }>;
  processes: Array<{
    name: string;
    version: string;
    sourceSha: string;
    syncedAt: string;
    definition: unknown;
  }>;
  agents: Array<{
    id: string;
    name: string;
    version: number;
    status: "published";
    contentHash: string;
    frontmatter: unknown;
    bodyMarkdown: string;
  }>;
}

export async function getProjectOpcBundle(request: Request, projectId: string) {
  return apiFetch(
    request,
    `/api/projects/${projectId}/opc-bundle`
  ) as Promise<OpcBundle>;
}

// Spec 112 §6.3 — lightweight deep-link sibling of the full bundle. The
// project-layout header uses only these two fields, so it calls this
// instead of getProjectOpcBundle to avoid minting a GitHub installation
// token on every project navigation (RR v7 single-fetch revalidation).
export interface OpcDeepLink {
  deepLink: string | null;
  adapterName: string | null;
}

export async function getProjectOpcDeepLink(request: Request, projectId: string) {
  return apiFetch(
    request,
    `/api/projects/${projectId}/opc-deep-link`
  ) as Promise<OpcDeepLink>;
}

// Spec 087 Phase 2 + spec 112 §6 — per-project knowledge object views.
export interface ProjectKnowledgeObject {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  state:
    | "imported"
    | "extracting"
    | "extracted"
    | "classified"
    | "available";
  storageKey: string;
  extractedStorageKey: string | null;
  provenance: Record<string, unknown>;
  boundAt: string;
  updatedAt: string;
}

export async function listProjectKnowledge(
  request: Request,
  projectId: string
) {
  return apiFetch(
    request,
    `/api/projects/${projectId}/knowledge`
  ) as Promise<{ objects: ProjectKnowledgeObject[] }>;
}

export async function advanceKnowledgeToExtracted(
  request: Request,
  projectId: string,
  objectId: string
) {
  return apiFetch(
    request,
    `/api/projects/${projectId}/knowledge/${objectId}/advance-extracted`,
    { method: "POST" }
  ) as Promise<{
    objectId: string;
    state: "extracted";
    extractedStorageKey: string;
    summary: {
      ok: number;
      cached: number;
      error: number;
      skip_unsupported: number;
    };
    extractorMessage: string;
  }>;
}

// Repos

export async function listProjectRepos(request: Request, projectId: string) {
  return apiFetch(request, `/api/projects/${projectId}/repos`) as Promise<{
    repos: any[];
  }>;
}

export async function addProjectRepo(
  request: Request,
  projectId: string,
  data: {
    githubOrg: string;
    repoName: string;
    defaultBranch?: string;
    isPrimary?: boolean;
    actorUserId: string;
  }
) {
  return apiFetch(request, `/api/projects/${projectId}/repos`, {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ repo: any }>;
}

export async function removeProjectRepo(
  request: Request,
  projectId: string,
  repoId: string,
  actorUserId: string
) {
  return apiFetch(
    request,
    `/api/projects/${projectId}/repos/${repoId}?actorUserId=${encodeURIComponent(actorUserId)}`,
    { method: "DELETE" }
  ) as Promise<{ ok: true }>;
}

export async function setPrimaryProjectRepo(
  request: Request,
  projectId: string,
  repoId: string
) {
  return apiFetch(
    request,
    `/api/projects/${projectId}/repos/${repoId}/primary`,
    { method: "POST" }
  ) as Promise<{ repo: any }>;
}

// Environments

export async function listEnvironments(request: Request, projectId: string) {
  return apiFetch(request, `/api/projects/${projectId}/envs`) as Promise<{
    environments: any[];
  }>;
}

export async function createEnvironment(
  request: Request,
  projectId: string,
  data: {
    name: string;
    kind?: string;
    autoDeployBranch?: string;
    requiresApproval?: boolean;
    actorUserId: string;
  }
) {
  return apiFetch(request, `/api/projects/${projectId}/envs`, {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ environment: any }>;
}

export async function deleteEnvironment(
  request: Request,
  projectId: string,
  envId: string,
  actorUserId: string
) {
  return apiFetch(
    request,
    `/api/projects/${projectId}/envs/${envId}?actorUserId=${encodeURIComponent(actorUserId)}`,
    { method: "DELETE" }
  ) as Promise<{ ok: true }>;
}

// Members

export async function listProjectMembers(
  request: Request,
  projectId: string
) {
  return apiFetch(request, `/api/projects/${projectId}/members`) as Promise<{
    members: any[];
  }>;
}

// -------------------------------------------------------------------------
// Spec 137 — per-environment access gates (Phase 5 UI client helpers).
//
// Wire shapes mirror `api/environments/accessGates.ts`. The `any` shapes
// are kept loose here for the same reason the rest of this file uses
// `any` for response bodies — Encore's generated types aren't threaded
// into the SSR layer; the route loader narrows the shape at consumption.
// -------------------------------------------------------------------------

export type FederatedProvider = "google" | "microsoft" | "github" | "generic_oidc";

export interface AccessGateAllowlistEntry {
  id: string;
  kind: "email" | "domain";
  value: string;
  createdAt: string;
}

export interface AccessGateRead {
  environmentId: string;
  enabled: boolean;
  rauthyClientRef: string | null;
  loginMethodMagicLink: boolean;
  loginMethodFederatedProvider: FederatedProvider | null;
  loginMethodFederatedProviderClientRef: string | null;
  createdAt: string;
  updatedAt: string;
  allowlist: AccessGateAllowlistEntry[];
}

export async function getAccessGate(request: Request, envId: string) {
  return apiFetch(
    request,
    `/api/environments/${envId}/access-gate`,
  ) as Promise<AccessGateRead>;
}

export async function putAccessGate(
  request: Request,
  envId: string,
  data: {
    enabled: boolean;
    loginMethodMagicLink?: boolean;
    loginMethodFederatedProvider?: FederatedProvider | null;
    loginMethodFederatedProviderClientRef?: string | null;
  },
) {
  return apiFetch(request, `/api/environments/${envId}/access-gate`, {
    method: "PUT",
    body: JSON.stringify(data),
  }) as Promise<AccessGateRead>;
}

export async function addAllowlistEntry(
  request: Request,
  envId: string,
  data: { kind: "email" | "domain"; value: string },
) {
  return apiFetch(
    request,
    `/api/environments/${envId}/access-gate/allowlist`,
    {
      method: "POST",
      body: JSON.stringify(data),
    },
  ) as Promise<AccessGateAllowlistEntry>;
}

export async function removeAllowlistEntry(
  request: Request,
  envId: string,
  entryId: string,
) {
  return apiFetch(
    request,
    `/api/environments/${envId}/access-gate/allowlist/${entryId}`,
    { method: "DELETE" },
  ) as Promise<{ ok: true; removed: AccessGateAllowlistEntry | null }>;
}

// -------------------------------------------------------------------------
// Spec 215: deploy trigger + status. Wire shapes mirror
// `api/deploy/deploy.ts` (DeploymentView). The web tier calls these
// statecraft endpoints, never deployd-api directly (FR-002). Status is
// served by getLatestDeployment, which lazily reconciles a stale PENDING
// record against deployd-api before answering (FR-008), so a separate
// getDeploymentStatus call is unnecessary.
// -------------------------------------------------------------------------

export type DeploymentStatus =
  | "REQUESTED"
  | "PENDING"
  | "ROLLED_OUT"
  | "FAILED"
  | "REQUEST_FAILED"
  | "DESTROYED";

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

/** FR-001/002: trigger a deploy of the project's latest built image to an env. */
export async function createDeployment(
  request: Request,
  projectId: string,
  envId: string,
) {
  return apiFetch(
    request,
    `/api/projects/${projectId}/envs/${envId}/deployments`,
    { method: "POST", body: "{}" },
  ) as Promise<{ deployment: DeploymentView; alreadyDeployed: boolean }>;
}

/** FR-004/008: latest deployment for an env (null = never deployed). */
export async function getLatestDeployment(
  request: Request,
  projectId: string,
  envId: string,
) {
  return apiFetch(
    request,
    `/api/projects/${projectId}/envs/${envId}/deployments/latest`,
  ) as Promise<{ deployment: DeploymentView | null }>;
}
