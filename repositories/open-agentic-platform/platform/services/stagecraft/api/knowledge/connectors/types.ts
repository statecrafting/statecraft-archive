/**
 * SourceConnector interface and supporting types (spec 087 Phase 4).
 *
 * Every connector type implements this interface. The registry maps
 * ConnectorType → SourceConnector implementation. Adding a new connector
 * requires only implementing this interface and registering it — no changes
 * to the knowledge object model or factory integration (NF-003).
 */

// ---------------------------------------------------------------------------
// Sync context — passed to every connector sync invocation
// ---------------------------------------------------------------------------

export interface SyncContext {
  /** Connector row ID. */
  connectorId: string;
  /** Project ID the connector belongs to (spec 119). */
  projectId: string;
  /** S3-compatible bucket for this project. */
  bucket: string;
  /** Connector-specific config (from source_connectors.config_encrypted). */
  config: Record<string, unknown>;
  /** Previous delta token from the last successful sync run (if any). */
  previousDeltaToken: string | null;
}

// ---------------------------------------------------------------------------
// Sync result — returned by the connector after a sync run
// ---------------------------------------------------------------------------

export interface SyncedObject {
  /** Original filename from the external source. */
  filename: string;
  /** MIME type. */
  mimeType: string;
  /** SHA-256 content hash. */
  contentHash: string;
  /** Size in bytes. */
  sizeBytes: number;
  /** S3 storage key where the file was written. */
  storageKey: string;
  /** Whether this is a new object or an update to an existing one. */
  action: "created" | "updated" | "skipped";
  /** Provenance metadata for the knowledge object. */
  provenance: {
    sourceType: string;
    sourceUri: string;
    importedAt: string;
    lastSyncedAt: string;
    versionId?: string;
  };
}

export interface SyncResult {
  /** Objects that were synced. */
  objects: SyncedObject[];
  /** Opaque cursor for incremental sync (e.g. Microsoft Graph delta link). */
  deltaToken: string | null;
}

// ---------------------------------------------------------------------------
// Connector config validation result
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// SourceConnector interface — the pluggable trait (NF-003)
// ---------------------------------------------------------------------------

export interface SourceConnector {
  /** Connector type identifier (matches ConnectorType enum). */
  readonly type: string;

  /**
   * Validate connector configuration before saving.
   * Returns validation errors if the config is malformed.
   */
  validateConfig(config: Record<string, unknown>): ValidationResult;

  /**
   * Test connectivity to the external source.
   * Throws on failure with a descriptive error message.
   */
  testConnection(config: Record<string, unknown>): Promise<void>;

  /**
   * Execute a sync run: enumerate files from the external source,
   * download new/changed files into the workspace S3 bucket,
   * and return the list of synced objects.
   *
   * The connector is responsible for:
   * - Downloading files and uploading them to S3 (via the storage helpers)
   * - Computing content hashes for deduplication
   * - Using the delta token for incremental sync where supported
   *
   * The caller is responsible for:
   * - Creating/updating knowledge_objects rows from the SyncedObject list
   * - Updating the sync_runs table
   * - Broadcasting events to connected clients
   */
  sync(ctx: SyncContext): Promise<SyncResult>;
}
