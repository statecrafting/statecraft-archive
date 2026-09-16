/**
 * Azure Blob Storage connector (spec 087 Phase 4).
 *
 * Syncs blobs from an Azure Blob Storage container into the workspace S3
 * bucket. Supports:
 *
 * - Prefix filtering for virtual-directory-scoped sync
 * - Async iterator pagination (no explicit pageToken needed)
 * - Content hash deduplication via SHA-256
 * - Incremental sync using most-recent lastModified as delta token
 *
 * Config shape (stored in source_connectors.config_encrypted):
 * {
 *   connectionString: string  — Azure Storage connection string
 *   container:        string  — Blob container name
 *   prefix?:          string  — Blob name prefix to filter (e.g. "docs/")
 * }
 *
 * Dependency: @azure/storage-blob
 * This package is not included in the default package.json. To enable this
 * connector, run:
 *   npm install @azure/storage-blob
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
// @azure/storage-blob dynamic import with friendly error
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BlobServiceClientType = any;

async function importAzureStorageBlob(): Promise<{
  BlobServiceClient: { fromConnectionString(cs: string): BlobServiceClientType };
}> {
  try {
    // Dynamic import so the connector module loads even when the package is absent
    const mod = await import("@azure/storage-blob" as string);
    return mod as { BlobServiceClient: { fromConnectionString(cs: string): BlobServiceClientType } };
  } catch {
    throw new Error(
      "Azure Blob connector requires @azure/storage-blob. " +
        "Install it with: npm install @azure/storage-blob"
    );
  }
}

// ---------------------------------------------------------------------------
// Azure Blob connector config type guard
// ---------------------------------------------------------------------------

interface AzureBlobConnectorConfig {
  connectionString: string;
  container: string;
  prefix?: string;
}

function asAzureConfig(
  config: Record<string, unknown>
): AzureBlobConnectorConfig {
  return config as unknown as AzureBlobConnectorConfig;
}

// ---------------------------------------------------------------------------
// AzureBlobConnector
// ---------------------------------------------------------------------------

export class AzureBlobConnector implements SourceConnector {
  readonly type = "azure-blob";

  validateConfig(config: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const required = ["connectionString", "container"];
    for (const field of required) {
      if (!config[field] || typeof config[field] !== "string") {
        errors.push(`${field} is required and must be a string`);
      }
    }
    if (config.prefix !== undefined && typeof config.prefix !== "string") {
      errors.push("prefix must be a string if provided");
    }
    return { valid: errors.length === 0, errors };
  }

  async testConnection(config: Record<string, unknown>): Promise<void> {
    const cfg = asAzureConfig(config);
    const { BlobServiceClient } = await importAzureStorageBlob();
    const serviceClient = BlobServiceClient.fromConnectionString(
      cfg.connectionString
    );
    const containerClient = serviceClient.getContainerClient(cfg.container);

    // Attempt a single-item list to verify credentials and container access
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _blob of containerClient.listBlobsFlat({
      prefix: cfg.prefix,
    })) {
      break; // one item is enough to confirm connectivity
    }
  }

  async sync(ctx: SyncContext): Promise<SyncResult> {
    const cfg = asAzureConfig(ctx.config);
    const { BlobServiceClient } = await importAzureStorageBlob();
    const serviceClient = BlobServiceClient.fromConnectionString(
      cfg.connectionString
    );
    const containerClient = serviceClient.getContainerClient(cfg.container);

    const sinceDate = ctx.previousDeltaToken
      ? new Date(ctx.previousDeltaToken)
      : null;

    const syncedObjects: SyncedObject[] = [];
    let latestModified: Date | null = null;

    // Azure SDK returns an async iterator — no manual pageToken needed
    for await (const blob of containerClient.listBlobsFlat({
      prefix: cfg.prefix,
      includeMetadata: false,
    })) {
      const lastModified: Date | undefined = blob.properties?.lastModified;
      if (!lastModified) continue;

      // Incremental: skip blobs not modified since last sync
      if (sinceDate && lastModified <= sinceDate) continue;

      if (!latestModified || lastModified > latestModified) {
        latestModified = lastModified;
      }

      const synced = await this.syncBlob(
        ctx,
        containerClient,
        cfg,
        blob.name,
        blob.properties?.contentType ?? "application/octet-stream",
        lastModified
      );
      if (synced) syncedObjects.push(synced);
    }

    const deltaToken = latestModified
      ? latestModified.toISOString()
      : ctx.previousDeltaToken;

    log.info("azure-blob sync complete", {
      connectorId: ctx.connectorId,
      objectCount: syncedObjects.length,
      hasDeltaToken: !!deltaToken,
    });

    return { objects: syncedObjects, deltaToken };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async syncBlob(
    ctx: SyncContext,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    containerClient: any,
    cfg: AzureBlobConnectorConfig,
    blobName: string,
    contentType: string,
    lastModified: Date
  ): Promise<SyncedObject | null> {
    const blobClient = containerClient.getBlobClient(blobName);
    const downloadRes = await blobClient.download();

    if (!downloadRes.readableStreamBody) {
      log.warn("azure blob body empty", { blobName });
      return null;
    }

    // Collect stream into Buffer
    const chunks: Buffer[] = [];
    for await (const chunk of downloadRes.readableStreamBody) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
    }
    const content = Buffer.concat(chunks);
    const contentHash = createHash("sha256").update(content).digest("hex");

    const filename = blobName.split("/").pop() ?? blobName;
    const relativeKey = cfg.prefix ? blobName.slice(cfg.prefix.length) : blobName;
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
        sourceType: "azure-blob",
        sourceUri: `azure-blob://${cfg.container}/${blobName}`,
        importedAt: now,
        lastSyncedAt: now,
        versionId: lastModified.toISOString(),
      },
    };
  }
}
