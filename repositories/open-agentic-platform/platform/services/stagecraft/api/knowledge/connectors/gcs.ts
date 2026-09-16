/**
 * Google Cloud Storage connector (spec 087 Phase 4).
 *
 * Syncs objects from a GCS bucket into the workspace S3 bucket.
 * Supports:
 *
 * - Prefix filtering for folder-scoped sync
 * - Pagination via pageToken
 * - Content hash deduplication via SHA-256
 * - Incremental sync using most-recent updated timestamp as delta token
 *
 * Config shape (stored in source_connectors.config_encrypted):
 * {
 *   bucket:            string  — GCS bucket name
 *   prefix?:           string  — Object name prefix to filter (e.g. "docs/")
 *   serviceAccountKey: string  — JSON-encoded service account key
 * }
 *
 * Dependency: @google-cloud/storage
 * This package is not included in the default package.json. To enable this
 * connector, run:
 *   npm install @google-cloud/storage
 * The connector validates the package is available at runtime and returns a
 * descriptive error if it is not.
 */

import log from "encore.dev/log";
import { createHash } from "crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { secret } from "encore.dev/config";
import type {
  SourceConnector,
  SyncContext,
  SyncResult,
  SyncedObject,
  ValidationResult,
} from "./types";

// ---------------------------------------------------------------------------
// Workspace S3 client (env-based credentials, same as sharepoint.ts)
// ---------------------------------------------------------------------------

const s3Endpoint = secret("S3_ENDPOINT");
const s3Region = secret("S3_REGION");
const s3AccessKey = secret("S3_ACCESS_KEY");
const s3SecretKey = secret("S3_SECRET_KEY");

let _workspaceS3: S3Client | null = null;

function getWorkspaceS3(): S3Client {
  if (!_workspaceS3) {
    _workspaceS3 = new S3Client({
      endpoint: s3Endpoint(),
      region: s3Region(),
      credentials: {
        accessKeyId: s3AccessKey(),
        secretAccessKey: s3SecretKey(),
      },
      forcePathStyle: true,
    });
  }
  return _workspaceS3;
}

// ---------------------------------------------------------------------------
// @google-cloud/storage dynamic import with friendly error
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StorageType = any;

async function importGcsStorage(): Promise<{
  Storage: new (opts: { credentials: Record<string, unknown> }) => StorageType;
}> {
  try {
    const mod = await import("@google-cloud/storage" as string);
    return mod as {
      Storage: new (opts: { credentials: Record<string, unknown> }) => StorageType;
    };
  } catch {
    throw new Error(
      "GCS connector requires @google-cloud/storage. " +
        "Install it with: npm install @google-cloud/storage"
    );
  }
}

// ---------------------------------------------------------------------------
// GCS connector config type guard
// ---------------------------------------------------------------------------

interface GcsConnectorConfig {
  bucket: string;
  prefix?: string;
  serviceAccountKey: string;
}

function asGcsConfig(config: Record<string, unknown>): GcsConnectorConfig {
  return config as unknown as GcsConnectorConfig;
}

// ---------------------------------------------------------------------------
// GcsConnector
// ---------------------------------------------------------------------------

export class GcsConnector implements SourceConnector {
  readonly type = "gcs";

  validateConfig(config: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const required = ["bucket", "serviceAccountKey"];
    for (const field of required) {
      if (!config[field] || typeof config[field] !== "string") {
        errors.push(`${field} is required and must be a string`);
      }
    }
    if (config.prefix !== undefined && typeof config.prefix !== "string") {
      errors.push("prefix must be a string if provided");
    }
    // Validate that serviceAccountKey is parseable JSON
    if (config.serviceAccountKey && typeof config.serviceAccountKey === "string") {
      try {
        JSON.parse(config.serviceAccountKey as string);
      } catch {
        errors.push("serviceAccountKey must be valid JSON");
      }
    }
    return { valid: errors.length === 0, errors };
  }

  async testConnection(config: Record<string, unknown>): Promise<void> {
    const cfg = asGcsConfig(config);
    const { Storage } = await importGcsStorage();
    const credentials = JSON.parse(cfg.serviceAccountKey) as Record<string, unknown>;
    const storage = new Storage({ credentials });
    const bucket = storage.bucket(cfg.bucket);

    // Attempt a single-item list to verify credentials and bucket access
    const [files] = await bucket.getFiles({
      prefix: cfg.prefix,
      maxResults: 1,
    });
    void files; // presence of a successful call is sufficient
  }

  async sync(ctx: SyncContext): Promise<SyncResult> {
    const cfg = asGcsConfig(ctx.config);
    const { Storage } = await importGcsStorage();
    const credentials = JSON.parse(cfg.serviceAccountKey) as Record<string, unknown>;
    const storage = new Storage({ credentials });
    const bucket = storage.bucket(cfg.bucket);

    const sinceDate = ctx.previousDeltaToken
      ? new Date(ctx.previousDeltaToken)
      : null;

    const syncedObjects: SyncedObject[] = [];
    let latestModified: Date | null = null;
    let pageToken: string | undefined;

    do {
      const queryOptions: Record<string, unknown> = {
        prefix: cfg.prefix,
        maxResults: 1000,
      };
      if (pageToken) queryOptions.pageToken = pageToken;

      const [files, , apiResponse] = await bucket.getFiles(queryOptions);

      for (const file of files) {
        const updatedStr: string | undefined = file.metadata?.updated;
        const lastModified = updatedStr ? new Date(updatedStr) : null;

        if (!lastModified) continue;

        // Incremental: skip objects not modified since last sync
        if (sinceDate && lastModified <= sinceDate) continue;

        if (!latestModified || lastModified > latestModified) {
          latestModified = lastModified;
        }

        const synced = await this.syncFile(ctx, file, cfg, lastModified);
        if (synced) syncedObjects.push(synced);
      }

      pageToken = (apiResponse as Record<string, unknown>)?.nextPageToken as
        | string
        | undefined;
    } while (pageToken);

    const deltaToken = latestModified
      ? latestModified.toISOString()
      : ctx.previousDeltaToken;

    log.info("gcs sync complete", {
      connectorId: ctx.connectorId,
      objectCount: syncedObjects.length,
      hasDeltaToken: !!deltaToken,
    });

    return { objects: syncedObjects, deltaToken };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async syncFile(
    ctx: SyncContext,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    file: any,
    cfg: GcsConnectorConfig,
    lastModified: Date
  ): Promise<SyncedObject | null> {
    const name: string = file.name as string;
    const [content] = (await file.download()) as [Buffer];

    if (!content || content.length === 0) {
      log.warn("gcs file empty", { name });
      return null;
    }

    const contentHash = createHash("sha256").update(content).digest("hex");
    const contentType: string =
      (file.metadata?.contentType as string | undefined) ??
      "application/octet-stream";

    const filename = name.split("/").pop() ?? name;
    const relativeKey = cfg.prefix ? name.slice(cfg.prefix.length) : name;
    const storageKey = `knowledge/${ctx.connectorId}/${relativeKey}`;

    await getWorkspaceS3().send(
      new PutObjectCommand({
        Bucket: ctx.bucket,
        Key: storageKey,
        Body: content,
        ContentType: contentType,
      })
    );

    const now = new Date().toISOString();

    return {
      filename,
      mimeType: contentType,
      contentHash,
      sizeBytes: content.length,
      storageKey,
      action: ctx.previousDeltaToken ? "updated" : "created",
      provenance: {
        sourceType: "gcs",
        sourceUri: `gs://${cfg.bucket}/${name}`,
        importedAt: now,
        lastSyncedAt: now,
        versionId: lastModified.toISOString(),
      },
    };
  }
}
