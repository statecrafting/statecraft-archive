/**
 * Server-side API helpers for project-scoped resources: knowledge objects,
 * source connectors, document bindings, and the factory pipeline.
 *
 * Uses direct fetch with cookie forwarding — the Encore-generated client
 * does not support forwarding cookies from incoming SSR requests, which is
 * required for React Router v7 server-side loaders.
 */

const DEFAULT_API_BASE = "http://localhost:4000";

// SSR runs in the same pod as the Encore API. Calling back via the public
// hostname is a pointless trip through Cloudflare + ingress and drops the
// Cookie header when HTTP is upgraded to HTTPS mid-flight. Loop back via
// localhost:4000 instead.
function getBaseUrl(_request: Request): string {
  return process.env.ENCORE_API_BASE_URL ?? DEFAULT_API_BASE;
}

async function apiFetch(request: Request, path: string, init?: RequestInit) {
  const base = getBaseUrl(request);
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

// =========================================================================
// Knowledge Objects
//
// Spec 119 collapsed the workspace abstraction; every knowledge endpoint is
// now project-scoped at `/api/projects/:projectId/knowledge/...`. The web
// SSR helpers thread the projectId from the route params.
// =========================================================================

const knowledgeBase = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/knowledge`;

export async function listKnowledgeObjects(
  request: Request,
  projectId: string,
  state?: string
) {
  const qs = state ? `?state=${encodeURIComponent(state)}` : "";
  return apiFetch(request, `${knowledgeBase(projectId)}/objects${qs}`) as Promise<{
    objects: KnowledgeObjectRow[];
  }>;
}

export async function getKnowledgeObject(
  request: Request,
  projectId: string,
  id: string
) {
  return apiFetch(
    request,
    `${knowledgeBase(projectId)}/objects/${id}`
  ) as Promise<{
    object: KnowledgeObjectRow;
    bindingsCount: number;
  }>;
}

export async function requestUpload(
  request: Request,
  projectId: string,
  data: {
    filename: string;
    mimeType: string;
    contentHash: string;
    sizeBytes: number;
    sourcePath?: string;
  }
) {
  return apiFetch(request, `${knowledgeBase(projectId)}/upload`, {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ objectId: string; uploadUrl: string; storageKey: string }>;
}

export async function confirmUpload(
  request: Request,
  projectId: string,
  objectId: string
) {
  return apiFetch(
    request,
    `${knowledgeBase(projectId)}/objects/${objectId}/confirm`,
    {
      method: "POST",
      body: "{}",
    }
  ) as Promise<{ object: KnowledgeObjectRow }>;
}

export async function getDownloadUrl(
  request: Request,
  projectId: string,
  objectId: string
) {
  return apiFetch(
    request,
    `${knowledgeBase(projectId)}/objects/${objectId}/download`
  ) as Promise<{ downloadUrl: string }>;
}

export async function transitionKnowledgeState(
  request: Request,
  projectId: string,
  objectId: string,
  data: {
    targetState: string;
    extractionOutput?: Record<string, unknown>;
    classification?: string[];
  }
) {
  return apiFetch(
    request,
    `${knowledgeBase(projectId)}/objects/${objectId}/transition`,
    {
      method: "POST",
      body: JSON.stringify(data),
    }
  ) as Promise<{ object: KnowledgeObjectRow }>;
}

export async function deleteKnowledgeObject(
  request: Request,
  projectId: string,
  objectId: string
) {
  return apiFetch(
    request,
    `${knowledgeBase(projectId)}/objects/${objectId}`,
    {
      method: "DELETE",
    }
  ) as Promise<{ deleted: boolean; bindingsRemoved: number }>;
}

/** Spec 115 FR-010 — operator re-enqueue for an extraction that failed. */
export async function retryExtraction(
  request: Request,
  projectId: string,
  objectId: string
) {
  return apiFetch(
    request,
    `${knowledgeBase(projectId)}/objects/${objectId}/retry-extraction`,
    {
      method: "POST",
      body: "{}",
    },
  ) as Promise<{ runId: string; outcome: "enqueued" | "deduped" }>;
}

// =========================================================================
// Source Connectors (project-scoped)
// =========================================================================

export async function listConnectors(request: Request, projectId: string) {
  return apiFetch(request, `${knowledgeBase(projectId)}/connectors`) as Promise<{
    connectors: SourceConnectorRow[];
  }>;
}

export async function createConnector(
  request: Request,
  projectId: string,
  data: { type: string; name: string; config?: Record<string, unknown>; syncSchedule?: string }
) {
  return apiFetch(request, `${knowledgeBase(projectId)}/connectors`, {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ connector: SourceConnectorRow }>;
}

export async function getConnector(
  request: Request,
  projectId: string,
  id: string
) {
  return apiFetch(
    request,
    `${knowledgeBase(projectId)}/connectors/${id}`
  ) as Promise<{
    connector: SourceConnectorRow;
  }>;
}

export async function updateConnector(
  request: Request,
  projectId: string,
  id: string,
  data: { name?: string; config?: Record<string, unknown>; syncSchedule?: string | null; status?: string }
) {
  return apiFetch(request, `${knowledgeBase(projectId)}/connectors/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  }) as Promise<{ connector: SourceConnectorRow }>;
}

export async function deleteConnector(
  request: Request,
  projectId: string,
  id: string
) {
  return apiFetch(request, `${knowledgeBase(projectId)}/connectors/${id}`, {
    method: "DELETE",
  }) as Promise<{ deleted: boolean }>;
}

export async function testConnectorConnection(
  request: Request,
  projectId: string,
  id: string
) {
  return apiFetch(request, `${knowledgeBase(projectId)}/connectors/${id}/test`, {
    method: "POST",
    body: "{}",
  }) as Promise<{ success: boolean; error?: string }>;
}

export async function triggerSync(
  request: Request,
  projectId: string,
  id: string
) {
  return apiFetch(request, `${knowledgeBase(projectId)}/connectors/${id}/sync`, {
    method: "POST",
    body: "{}",
  }) as Promise<{ syncRunId: string }>;
}

export async function listSyncRuns(
  request: Request,
  projectId: string,
  connectorId: string
) {
  return apiFetch(
    request,
    `${knowledgeBase(projectId)}/connectors/${connectorId}/sync-runs`
  ) as Promise<{ runs: SyncRunRow[] }>;
}

// Spec 119 dropped the document_bindings table — knowledge objects live
// directly on `project_id` now. The legacy `listBindings` / `bindToProject`
// helpers and their `/api/knowledge/bindings/:projectId` endpoint are gone.

// =========================================================================
// Factory Pipelines
// =========================================================================

export async function getFactoryStatus(request: Request, projectId: string) {
  return apiFetch(
    request,
    `/api/projects/${projectId}/factory/status`
  ) as Promise<{ pipeline: PipelineStatusRow | null }>;
}

export async function listFactoryAudit(request: Request, projectId: string) {
  return apiFetch(
    request,
    `/api/projects/${projectId}/factory/audit`
  ) as Promise<{ entries: FactoryAuditEntry[] }>;
}

export async function initFactoryPipeline(
  request: Request,
  projectId: string,
  data: {
    adapter: string;
    actorUserId: string;
    business_docs?: Array<{ name: string; storage_ref: string }>;
    knowledge_object_ids?: string[];
    policy_overrides?: Record<string, unknown>;
  }
) {
  return apiFetch(request, `/api/projects/${projectId}/factory/init`, {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{
    pipeline_id: string;
    adapter: string;
    policy_bundle_id: string;
    status: string;
    created_at: string;
  }>;
}

export async function confirmFactoryStage(
  request: Request,
  projectId: string,
  stageId: string,
  actorUserId: string,
  notes?: string
) {
  return apiFetch(
    request,
    `/api/projects/${projectId}/factory/stage/${stageId}/confirm`,
    { method: "POST", body: JSON.stringify({ actorUserId, notes }) }
  ) as Promise<{ stage: FactoryStageRow }>;
}

export async function rejectFactoryStage(
  request: Request,
  projectId: string,
  stageId: string,
  actorUserId: string,
  feedback: string
) {
  return apiFetch(
    request,
    `/api/projects/${projectId}/factory/stage/${stageId}/reject`,
    { method: "POST", body: JSON.stringify({ actorUserId, feedback }) }
  ) as Promise<{ stage: FactoryStageRow }>;
}

export async function cancelPipeline(
  request: Request,
  projectId: string,
  actorUserId: string,
  reason?: string
) {
  return apiFetch(request, `/api/projects/${projectId}/factory/cancel`, {
    method: "POST",
    body: JSON.stringify({
      actorUserId,
      reason: reason ?? "Cancelled from web UI",
    }),
  }) as Promise<{ pipeline: PipelineStatusRow }>;
}

// =========================================================================
// Types (server-side, matching API responses)
// =========================================================================

export type LatestExtractionRun = {
  status: string;
  extractorKind: string | null;
  completedAt: string | null;
  durationMs: number | null;
};

export type LastExtractionError = {
  code: string;
  message: string;
  extractorKind: string | null;
  attemptedAt: string;
};

export type KnowledgeObjectRow = {
  id: string;
  projectId: string;
  connectorId: string | null;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  state: string;
  extractionOutput: unknown;
  classification: unknown;
  /** Spec 115 FR-025 — populated when the most recent extraction failed. */
  lastExtractionError: LastExtractionError | null;
  /** Spec 115 FR-030 — denormalised most-recent extraction run. */
  latestRun: LatestExtractionRun | null;
  provenance: {
    sourceType: string;
    sourceUri: string;
    importedAt: string;
    lastSyncedAt?: string;
    versionId?: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type SourceConnectorRow = {
  id: string;
  projectId: string;
  type: string;
  name: string;
  syncSchedule: string | null;
  status: string;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncRunRow = {
  id: string;
  connectorId: string;
  projectId: string;
  status: string;
  objectsCreated: number;
  objectsUpdated: number;
  objectsSkipped: number;
  error: string | null;
  deltaToken: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type PipelineStatusRow = {
  id: string;
  projectId: string;
  adapterName: string;
  status: string;
  policyBundleId: string | null;
  buildSpecHash: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  stages?: FactoryStageRow[];
};

export type FactoryStageRow = {
  id: string;
  pipelineId: string;
  stageIndex: number;
  stageId: string;
  status: string;
  output: unknown;
  startedAt: string | null;
  completedAt: string | null;
};

export type FactoryAuditEntry = {
  id: string;
  pipelineId: string;
  timestamp: string;
  event: string;
  actor: string | null;
  stageId: string | null;
  featureId: string | null;
  details: unknown;
};
