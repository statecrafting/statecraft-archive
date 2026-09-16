/**
 * Factory API helpers (spec 108). Mirrors projects-api.server.ts — manual
 * fetch so we can forward the SSR session cookie; the Encore generated
 * client does not support that.
 */

const DEFAULT_API_BASE = "http://localhost:4000";

function getBaseUrl(): string {
  return process.env.ENCORE_API_BASE_URL ?? DEFAULT_API_BASE;
}

async function apiFetch(request: Request, path: string, init?: RequestInit) {
  const base = getBaseUrl();
  const cookie = request.headers.get("Cookie") ?? "";
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie && { Cookie: cookie }),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `API error: ${res.status}`);
  }
  return res.json();
}

export type FactoryUpstream = {
  orgId: string;
  factorySource: string;
  factoryRef: string;
  templateSource: string;
  templateRef: string;
  lastSyncedAt: string | null;
  lastSyncSha: { factory?: string; template?: string } | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FactoryUpstreamCounts = {
  adapters: number;
  contracts: number;
  processes: number;
};

export async function getFactoryUpstreams(request: Request) {
  return apiFetch(request, "/api/factory/upstreams") as Promise<{
    upstream: FactoryUpstream | null;
    counts: FactoryUpstreamCounts;
  }>;
}

export async function upsertFactoryUpstreams(
  request: Request,
  data: {
    factorySource: string;
    factoryRef?: string;
    templateSource: string;
    templateRef?: string;
  }
) {
  return apiFetch(request, "/api/factory/upstreams", {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ upstream: FactoryUpstream }>;
}

export type FactorySyncTriggerResponse = {
  syncRunId: string;
  status: "pending" | "running";
  queuedAt: string;
};

export type FactorySyncRunStatus = "pending" | "running" | "ok" | "failed";

export type FactorySyncRun = {
  id: string;
  status: FactorySyncRunStatus;
  triggeredBy: string;
  factorySha: string | null;
  templateSha: string | null;
  counts: FactoryUpstreamCounts | null;
  error: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export async function syncFactoryUpstreams(
  request: Request
): Promise<FactorySyncTriggerResponse> {
  return apiFetch(request, "/api/factory/upstreams/sync", {
    method: "POST",
    body: "{}",
  }) as Promise<FactorySyncTriggerResponse>;
}

export async function listFactorySyncRuns(request: Request) {
  return apiFetch(request, "/api/factory/upstreams/sync") as Promise<{
    runs: FactorySyncRun[];
  }>;
}

export async function getFactorySyncRun(
  request: Request,
  id: string
): Promise<FactorySyncRun> {
  return apiFetch(
    request,
    `/api/factory/upstreams/sync/${encodeURIComponent(id)}`
  ) as Promise<FactorySyncRun>;
}

// ---------------------------------------------------------------------------
// Factory upstream PAT (spec 109 §6)
// ---------------------------------------------------------------------------

export type FactoryUpstreamPatMetadata = {
  exists: boolean;
  tokenPrefix?: string;
  isFineGrained?: boolean;
  scopes?: string[];
  githubLogin?: string | null;
  lastUsedAt?: string | null;
  lastCheckedAt?: string;
  createdAt?: string;
};

export type FactoryUpstreamPatValidation = {
  ok: boolean;
  tokenPrefix: string;
  isFineGrained: boolean;
  scopes: string[];
  lastCheckedAt: string;
  githubLogin?: string;
  reason?: "pat_invalid" | "pat_rate_limited" | "pat_saml_not_authorized";
};

export async function getFactoryUpstreamPat(request: Request) {
  return apiFetch(
    request,
    "/api/factory/upstreams/pat"
  ) as Promise<FactoryUpstreamPatMetadata>;
}

export async function storeFactoryUpstreamPat(
  request: Request,
  token: string
): Promise<FactoryUpstreamPatValidation> {
  return apiFetch(request, "/api/factory/upstreams/pat", {
    method: "POST",
    body: JSON.stringify({ token }),
  }) as Promise<FactoryUpstreamPatValidation>;
}

export async function revokeFactoryUpstreamPat(request: Request) {
  return apiFetch(request, "/api/factory/upstreams/pat", {
    method: "DELETE",
  }) as Promise<{ revoked: boolean }>;
}

export async function validateFactoryUpstreamPat(
  request: Request
): Promise<FactoryUpstreamPatValidation> {
  return apiFetch(request, "/api/factory/upstreams/pat/validate", {
    method: "POST",
    body: "{}",
  }) as Promise<FactoryUpstreamPatValidation>;
}

// ---------------------------------------------------------------------------
// Project PAT (spec 109 §6)
// ---------------------------------------------------------------------------

export type ProjectPatMetadata = FactoryUpstreamPatMetadata;
export type ProjectPatValidation = FactoryUpstreamPatValidation;

export async function getProjectPat(request: Request, projectId: string) {
  return apiFetch(
    request,
    `/api/projects/${encodeURIComponent(projectId)}/pat`
  ) as Promise<ProjectPatMetadata>;
}

export async function storeProjectPat(
  request: Request,
  projectId: string,
  token: string
): Promise<ProjectPatValidation> {
  return apiFetch(
    request,
    `/api/projects/${encodeURIComponent(projectId)}/pat`,
    {
      method: "POST",
      body: JSON.stringify({ token }),
    }
  ) as Promise<ProjectPatValidation>;
}

export async function revokeProjectPat(request: Request, projectId: string) {
  return apiFetch(
    request,
    `/api/projects/${encodeURIComponent(projectId)}/pat`,
    { method: "DELETE" }
  ) as Promise<{ revoked: boolean }>;
}

export async function validateProjectPat(
  request: Request,
  projectId: string
): Promise<ProjectPatValidation> {
  return apiFetch(
    request,
    `/api/projects/${encodeURIComponent(projectId)}/pat/validate`,
    { method: "POST", body: "{}" }
  ) as Promise<ProjectPatValidation>;
}

// ---------------------------------------------------------------------------
// Spec 108 Phase 4 — read-only browsers.
// ---------------------------------------------------------------------------

export type FactoryResourceSummary = {
  name: string;
  version: string;
  sourceSha: string;
  syncedAt: string;
};

/** Spec 198 FR-001 / spec 199 FR-006 — the serve path's admission verdict
 * for the org's factory origin; list endpoints carry it so the UI can say
 * WHY content is absent instead of rendering a bare empty state. */
export type FactoryAdmissionWire = {
  status: string;
  reason: string | null;
};

export type FactoryAdapterDetail = FactoryResourceSummary & {
  manifest: unknown;
};

export type FactoryContractDetail = FactoryResourceSummary & {
  schema: unknown;
};

export type FactoryProcessDetail = FactoryResourceSummary & {
  definition: unknown;
};

export async function listFactoryAdapters(request: Request) {
  return apiFetch(request, "/api/factory/adapters") as Promise<{
    adapters: FactoryResourceSummary[];
    admission: FactoryAdmissionWire;
  }>;
}

export async function getFactoryAdapter(request: Request, name: string) {
  return apiFetch(
    request,
    `/api/factory/adapters/${encodeURIComponent(name)}`
  ) as Promise<FactoryAdapterDetail>;
}

export async function listFactoryContracts(request: Request) {
  return apiFetch(request, "/api/factory/contracts") as Promise<{
    contracts: FactoryResourceSummary[];
    admission: FactoryAdmissionWire;
  }>;
}

export async function getFactoryContract(request: Request, name: string) {
  return apiFetch(
    request,
    `/api/factory/contracts/${encodeURIComponent(name)}`
  ) as Promise<FactoryContractDetail>;
}

export async function listFactoryProcesses(request: Request) {
  return apiFetch(request, "/api/factory/processes") as Promise<{
    processes: FactoryResourceSummary[];
    admission: FactoryAdmissionWire;
  }>;
}

export async function getFactoryProcess(request: Request, name: string) {
  return apiFetch(
    request,
    `/api/factory/processes/${encodeURIComponent(name)}`
  ) as Promise<FactoryProcessDetail>;
}

// ---------------------------------------------------------------------------
// Spec 139 — `/api/factory/artifacts/*` (substrate browser + override).
// ---------------------------------------------------------------------------

export type ArtifactKind =
  | "agent"
  | "skill"
  | "process-stage"
  | "adapter-manifest"
  | "contract-schema"
  | "pattern"
  | "page-type-reference"
  | "sample-html"
  | "reference-data"
  | "invariant"
  | "pipeline-orchestrator";

export type ArtifactSummary = {
  id: string;
  orgId: string;
  origin: string;
  path: string;
  kind: ArtifactKind;
  bundleId: string | null;
  version: number;
  status: "active" | "retired";
  contentHash: string;
  conflictState: "ok" | "diverged" | null;
  hasOverride: boolean;
  /** Spec 198 FR-013(c) — null when no override; otherwise the trust-class
   * verdict (false until a privileged human verifies the revision). */
  overrideVerified: boolean | null;
  syncedAt: string;
};

export type ArtifactDetail = ArtifactSummary & {
  upstreamSha: string | null;
  upstreamBody: string | null;
  userBody: string | null;
  effectiveBody: string;
  frontmatter: Record<string, unknown> | null;
  conflictUpstreamSha: string | null;
  userModifiedAt: string | null;
  userModifiedBy: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
};

export type ListArtifactsResponse = {
  artifacts: ArtifactSummary[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listFactoryArtifacts(
  request: Request,
  params: {
    kind?: ArtifactKind;
    origin?: string;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const search = new URLSearchParams();
  if (params.kind) search.set("kind", params.kind);
  if (params.origin) search.set("origin", params.origin);
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("pageSize", String(params.pageSize));
  const query = search.toString() ? `?${search.toString()}` : "";
  return apiFetch(
    request,
    `/api/factory/artifacts${query}`,
  ) as Promise<ListArtifactsResponse>;
}

export async function getFactoryArtifactById(
  request: Request,
  id: string,
) {
  return apiFetch(
    request,
    `/api/factory/artifacts/${encodeURIComponent(id)}`,
  ) as Promise<ArtifactDetail>;
}

export async function applyFactoryArtifactOverride(
  request: Request,
  id: string,
  userBody: string,
) {
  return apiFetch(
    request,
    `/api/factory/artifacts/${encodeURIComponent(id)}/override`,
    {
      method: "POST",
      body: JSON.stringify({ userBody }),
      headers: { "content-type": "application/json" },
    },
  ) as Promise<ArtifactDetail>;
}

export async function clearFactoryArtifactOverride(
  request: Request,
  id: string,
) {
  return apiFetch(
    request,
    `/api/factory/artifacts/${encodeURIComponent(id)}/override`,
    { method: "DELETE" },
  ) as Promise<ArtifactDetail>;
}

/** Spec 198 FR-013(c) — privileged verified-flag flip on the current
 * override revision (org owner/admin). */
export async function verifyFactoryArtifactOverride(
  request: Request,
  id: string,
) {
  return apiFetch(
    request,
    `/api/factory/artifacts/${encodeURIComponent(id)}/verify-override`,
    { method: "POST" },
  ) as Promise<ArtifactDetail>;
}

// Spec 201 FR-001/FR-002 — the fact-grounded approval basis the verify
// surface renders. Wire mirror of `api/factory/approvalSummary.ts`.

export type ApprovalProvenanceLink = {
  artifactId: string;
  contentHash: string;
  kind: string;
  path: string;
};

export type ApprovalConsumedOverride = {
  artifactId: string;
  contentHash: string;
  path: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  requireVerifiedSatisfied: boolean;
};

export type ApprovalSummaryWire = {
  summaryHash: string;
  gatePredicate: string;
  blastRadiusStatement: string;
  provenanceLinks: ApprovalProvenanceLink[];
  consumedOverrides: ApprovalConsumedOverride[];
  assembledAt: string;
  actorId: string;
};

/** Flat mirror of the Encore wire shape: `applicable: false` → spec 111
 * user-authored trust class (legacy verify, no basis); otherwise exactly
 * one of `summary` (ok) or `reason` (refused) is present. */
export type ArtifactApprovalSummaryResponse = {
  applicable: boolean;
  ok?: boolean;
  reason?: string;
  summary?: ApprovalSummaryWire;
};

export async function getFactoryArtifactApprovalSummary(
  request: Request,
  id: string,
) {
  return apiFetch(
    request,
    `/api/factory/artifacts/${encodeURIComponent(id)}/approval-summary`,
  ) as Promise<ArtifactApprovalSummaryResponse>;
}

export type ArtifactConflictSummary = {
  id: string;
  origin: string;
  path: string;
  kind: string;
  conflictUpstreamSha: string | null;
  upstreamSha: string | null;
  upstreamBody: string | null;
  userBody: string | null;
  contentHash: string;
};

export async function listFactoryArtifactConflicts(request: Request) {
  return apiFetch(request, "/api/factory/artifacts/conflicts") as Promise<{
    conflicts: ArtifactConflictSummary[];
  }>;
}

export async function resolveFactoryArtifactConflict(
  request: Request,
  id: string,
  action: "keep_mine" | "take_upstream",
) {
  return apiFetch(
    request,
    `/api/factory/artifacts/${encodeURIComponent(id)}/resolve`,
    {
      method: "POST",
      body: JSON.stringify({ action }),
      headers: { "content-type": "application/json" },
    },
  ) as Promise<ArtifactDetail>;
}

/**
 * Spec 139 Phase 2 (T058) — `edit_and_accept` resolution. Carries the
 * hand-merged body to the platform; server stores it as `user_body`.
 */
export async function resolveFactoryArtifactEditAndAccept(
  request: Request,
  id: string,
  body: string,
) {
  return apiFetch(
    request,
    `/api/factory/artifacts/${encodeURIComponent(id)}/resolve`,
    {
      method: "POST",
      body: JSON.stringify({ action: "edit_and_accept", body }),
      headers: { "content-type": "application/json" },
    },
  ) as Promise<ArtifactDetail>;
}

// ---------------------------------------------------------------------------
// Spec 124 — factory runs (list + detail).
// ---------------------------------------------------------------------------
//
// The reservation POST is desktop-only; the web UI consumes only the read
// endpoints. Wire shapes mirror `api/factory/runs.ts` exactly — keep field
// names in sync (FactoryAgentRef triple is acceptance gate A-9 / T088).

export type FactoryRunStatus =
  | "queued"
  | "running"
  | "ok"
  | "failed"
  | "cancelled";

export type FactoryAgentRef = {
  orgAgentId: string;
  version: number;
  contentHash: string;
};

export type FactoryRunStageProgressEntry = {
  stage_id: string;
  status: "running" | "ok" | "failed" | "skipped";
  started_at: string;
  completed_at?: string | null;
  agent_ref?: FactoryAgentRef | null;
  error?: string | null;
};

export type FactoryRunSourceShas = {
  adapter: string;
  process: string;
  contracts: Record<string, string>;
  agents: FactoryAgentRef[];
};

export type FactoryRunTokenSpend = {
  input: number;
  output: number;
  total: number;
};

export type FactoryRunSummary = {
  id: string;
  orgId: string;
  projectId: string | null;
  triggeredBy: string;
  adapterId: string;
  processId: string;
  clientRunId: string;
  status: FactoryRunStatus;
  startedAt: string;
  completedAt: string | null;
  lastEventAt: string;
  error: string | null;
};

export type FactoryRunDetail = FactoryRunSummary & {
  stageProgress: FactoryRunStageProgressEntry[];
  sourceShas: FactoryRunSourceShas;
  tokenSpend: FactoryRunTokenSpend | null;
};

export type ListFactoryRunsResponse = {
  runs: FactoryRunSummary[];
  nextCursor?: string;
};

export type ListFactoryRunsQuery = {
  status?: FactoryRunStatus;
  adapter?: string;
  limit?: number;
  /** ISO-8601 cursor — rows with `started_at < before`. */
  before?: string;
};

export async function listFactoryRuns(
  request: Request,
  query: ListFactoryRunsQuery = {}
): Promise<ListFactoryRunsResponse> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.adapter) params.set("adapter", query.adapter);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.before) params.set("before", query.before);
  const qs = params.toString();
  const path = qs ? `/api/factory/runs?${qs}` : "/api/factory/runs";
  return apiFetch(request, path) as Promise<ListFactoryRunsResponse>;
}

export async function getFactoryRun(
  request: Request,
  id: string
): Promise<FactoryRunDetail> {
  return apiFetch(
    request,
    `/api/factory/runs/${encodeURIComponent(id)}`
  ) as Promise<FactoryRunDetail>;
}

// Spec 201 phase 3 — run-level HITL gate (FR-002/FR-003/FR-004 run path).

export type RunGateApprovalWire = {
  stageId: string;
  gatePredicate: string;
  summaryHash: string;
  approvedBy: string;
  approvedAt: string;
};

export type RunApprovalContextWire = {
  requiredStageIds: string[];
  approvals: RunGateApprovalWire[];
  ok: boolean;
  reason?: string;
  gatePredicate?: string;
  summary?: ApprovalSummaryWire;
  blockingOverridePaths?: string[];
};

export async function getFactoryRunApprovalContext(
  request: Request,
  runId: string,
) {
  return apiFetch(
    request,
    `/api/factory/runs/${encodeURIComponent(runId)}/approval-context`,
  ) as Promise<RunApprovalContextWire>;
}

export async function approveFactoryRunGate(
  request: Request,
  runId: string,
  stageId: string,
  summaryHash: string,
) {
  return apiFetch(
    request,
    `/api/factory/runs/${encodeURIComponent(runId)}/gates/${encodeURIComponent(stageId)}/approve`,
    {
      method: "POST",
      body: JSON.stringify({ summaryHash }),
      headers: { "content-type": "application/json" },
    },
  ) as Promise<{ approval: RunGateApprovalWire; created: boolean }>;
}
