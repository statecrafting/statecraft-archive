/**
 * Knowledge intake domain types (spec 087 section 4).
 *
 * Knowledge objects are workspace-scoped, not project-scoped.
 * They exist independently of projects and may be consumed by
 * multiple factories across multiple projects.
 */

// ---------------------------------------------------------------------------
// Knowledge object lifecycle
// ---------------------------------------------------------------------------

export type KnowledgeObjectState =
  | "imported"
  | "extracting"
  | "extracted"
  | "classified"
  | "available";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface KnowledgeObject {
  id: string;
  projectId: string;
  connectorId: string | null;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  state: KnowledgeObjectState;
  extractionOutput: Record<string, unknown> | null;
  classification: string[] | null;
  provenance: KnowledgeProvenance;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeProvenance {
  sourceType: string;
  sourceUri: string;
  importedAt: string;
  lastSyncedAt?: string;
  versionId?: string;
}

// ---------------------------------------------------------------------------
// Source connectors
// ---------------------------------------------------------------------------

export type ConnectorType =
  | "upload"
  | "sharepoint"
  | "s3"
  | "azure-blob"
  | "gcs";

export type ConnectorStatus = "active" | "paused" | "error" | "disabled";

export interface SourceConnector {
  id: string;
  projectId: string;
  type: ConnectorType;
  name: string;
  syncSchedule: string | null;
  status: ConnectorStatus;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Document bindings (link knowledge objects to projects)
// ---------------------------------------------------------------------------

export interface DocumentBinding {
  id: string;
  projectId: string;
  knowledgeObjectId: string;
  boundBy: string;
  boundAt: string;
}

// ---------------------------------------------------------------------------
// Sync runs (spec 087 Phase 4)
// ---------------------------------------------------------------------------

export type SyncRunStatus = "running" | "completed" | "failed";

export interface SyncRun {
  id: string;
  connectorId: string;
  projectId: string;
  status: SyncRunStatus;
  objectsCreated: number;
  objectsUpdated: number;
  objectsSkipped: number;
  error: string | null;
  deltaToken: string | null;
  startedAt: string;
  completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Connector config shapes (spec 087 Phase 4)
// ---------------------------------------------------------------------------

export interface SharePointConnectorConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteUrl: string;
  driveId?: string;
  folderPath?: string;
}

export interface S3ConnectorConfig {
  bucket: string;
  prefix?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface AzureBlobConnectorConfig {
  connectionString: string;
  container: string;
  prefix?: string;
}

export interface GcsConnectorConfig {
  bucket: string;
  prefix?: string;
  serviceAccountKey: string;
}

export type ConnectorConfig =
  | SharePointConnectorConfig
  | S3ConnectorConfig
  | AzureBlobConnectorConfig
  | GcsConnectorConfig
  | Record<string, never>; // upload — no config

/** Valid sync schedule intervals. */
export type SyncSchedule = "15m" | "30m" | "1h" | "6h" | "12h" | "24h";
