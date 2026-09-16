// Spec 112 §5.2 + §5.3 — scaffold subflow shared types.
//
// Spec 140 §2.2 — `ScaffoldAdapterRef.templateRemote` /
// `templateDefaultBranch` and the now-obsolete `AdapterTemplateRemote`
// interface are removed. The scaffold layer derives the clone target
// from `factory_upstreams (org_id, source_id=manifest.scaffold_source_id)`
// at warmup time (`api/projects/scaffold/scheduler.ts`); per-request
// scaffolds copy from the prebuilt cache the warmup populates and never
// need the URL again.

export interface ScaffoldAdapterRef {
  /** factory_adapters.id — links the job to the row the scaffold came from. */
  id: string;
  name: string;
  version: string;
  sourceSha: string;
}

export interface ScaffoldRequest {
  orgId: string;
  requestedBy: string;
  adapter: ScaffoldAdapterRef;
  /** One of build-spec.schema.yaml's project.variant values. */
  variant: string;
  /** Modules the user picked from MODULE_CATALOG (filtered server-side). */
  selectedModules: string[];
  githubOrg: string;
  repoName: string;
  isPrivate: boolean;
  /** Seed inputs uploaded into the project bucket (spec 112 §4.3). */
  seedInputs?: ScaffoldSeedInput[];
}

export interface ScaffoldSeedInput {
  bucketObjectId: string;
  filename: string;
  mimeType: string;
  /** SHA-256 of the raw bytes, captured at upload time. */
  contentHash: string;
}

export interface ScaffoldJobRecord {
  id: string;
  status: ScaffoldJobStatus;
  step: ScaffoldStep | null;
  errorMessage: string | null;
  githubOrg: string | null;
  repoName: string | null;
  cloneUrl: string | null;
  commitSha: string | null;
}

export type ScaffoldJobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "orphaned";

export type ScaffoldStep =
  | "template-cache"
  | "prebuild"
  | "run-entry"
  | "seed-pipeline-state"
  | "extract-artifacts"
  | "repo-create"
  | "provision-signing-key"
  | "regenerate-index"
  | "push-initial"
  | "cleanup";

export interface ScaffoldResult {
  jobId: string;
  githubOrg: string;
  repoName: string;
  cloneUrl: string;
  htmlUrl: string;
  defaultBranch: string;
  commitSha: string;
  /** L0 pipeline-state.json contents that were committed at commit #1. */
  pipelineStateSeed: Record<string, unknown>;
}
