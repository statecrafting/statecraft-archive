/**
 * Factory pipeline types (spec 087 section 3.2).
 *
 * The factory is the execution artifact of the workspace:
 * scoped by workspace + project, fed by knowledge objects,
 * executed on desktop, observed/governed through the web plane.
 */

// ---------------------------------------------------------------------------
// Pipeline lifecycle
// ---------------------------------------------------------------------------

export type PipelineStatus =
  | "initialized"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type StageStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "confirmed"
  | "rejected";

export type ScaffoldStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

// ---------------------------------------------------------------------------
// Pipeline stages (7-stage pipeline)
// ---------------------------------------------------------------------------

export const PIPELINE_STAGES = [
  "s0-preflight",
  "s1-business-requirements",
  "s2-service-requirements",
  "s3-data-model",
  "s4-api-spec",
  "s5-ui-spec",
  "s6-scaffolding",
] as const;

export type PipelineStageId = (typeof PIPELINE_STAGES)[number];

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface FactoryPipeline {
  id: string;
  projectId: string;
  adapterName: string;
  status: PipelineStatus;
  policyBundleId: string | null;
  buildSpecHash: string | null;
  previousPipelineId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FactoryStage {
  id: string;
  pipelineId: string;
  stageId: PipelineStageId;
  status: StageStatus;
  startedAt: string | null;
  completedAt: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  promptTokens: number;
  completionTokens: number;
}

export interface FactoryArtifact {
  id: string;
  pipelineId: string;
  stageId: string;
  artifactType: string;
  contentHash: string;
  storagePath: string;
  sizeBytes: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Known adapters
// ---------------------------------------------------------------------------

export const KNOWN_ADAPTERS = [
  "acme-vue-node",
  "encore-react",
  "next-prisma",
  "rust-axum",
] as const;

export type AdapterName = (typeof KNOWN_ADAPTERS)[number];
