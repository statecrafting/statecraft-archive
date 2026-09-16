/**
 * AWS S3 connector (spec 087 Phase 4).
 *
 * Syncs files from an S3-compatible bucket into the workspace S3 bucket.
 * Supports:
 *
 * - Prefix filtering for folder-scoped sync
 * - Pagination via ContinuationToken
 * - Content hash deduplication via SHA-256
 * - Incremental sync using LastModified timestamp as delta token
 *
 * Config shape (stored in source_connectors.config_encrypted):
 * {
 *   bucket:          string  — Source S3 bucket name
 *   prefix?:         string  — Key prefix to filter (e.g. "docs/")
 *   region:          string  — AWS region (e.g. "us-east-1")
 *   accessKeyId:     string  — AWS access key ID
 *   secretAccessKey: string  — AWS secret access key
 * }
 */

import log from "encore.dev/log";
import { createHash } from "crypto";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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
// S3 connector config type guard
// ---------------------------------------------------------------------------

interface S3ConnectorConfig {
  bucket: string;
  prefix?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function asS3Config(config: Record<string, unknown>): S3ConnectorConfig {
  return config as unknown as S3ConnectorConfig;
}

// ---------------------------------------------------------------------------
// S3Connector
// ---------------------------------------------------------------------------

export class S3Connector implements SourceConnector {
  readonly type = "s3";

  validateConfig(config: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const required = ["bucket", "region", "accessKeyId", "secretAccessKey"];
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
    const cfg = asS3Config(config);
    const client = this.buildSourceClient(cfg);
    // Attempt a minimal list to verify credentials and bucket access
    await client.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: cfg.prefix,
        MaxKeys: 1,
      })
    );
  }

  async sync(ctx: SyncContext): Promise<SyncResult> {
    const cfg = asS3Config(ctx.config);
    const sourceClient = this.buildSourceClient(cfg);

    // Parse previous delta token — ISO timestamp of last seen LastModified
    const sinceDate = ctx.previousDeltaToken
      ? new Date(ctx.previousDeltaToken)
      : null;

    const syncedObjects: SyncedObject[] = [];
    let continuationToken: string | undefined;
    let latestModified: Date | null = null;

    do {
      const listRes = await sourceClient.send(
        new ListObjectsV2Command({
          Bucket: cfg.bucket,
          Prefix: cfg.prefix,
          ContinuationToken: continuationToken,
        })
      );

      for (const obj of listRes.Contents ?? []) {
        if (!obj.Key || !obj.LastModified) continue;

        // Incremental: skip objects not modified since last sync
        if (sinceDate && obj.LastModified <= sinceDate) continue;

        // Track the most recent LastModified seen in this run
        if (!latestModified || obj.LastModified > latestModified) {
          latestModified = obj.LastModified;
        }

        const synced = await this.syncObject(ctx, sourceClient, cfg, obj.Key, obj.LastModified);
        if (synced) syncedObjects.push(synced);
      }

      continuationToken = listRes.NextContinuationToken;
    } while (continuationToken);

    const deltaToken = latestModified
      ? latestModified.toISOString()
      : ctx.previousDeltaToken;

    log.info("s3 sync complete", {
      connectorId: ctx.connectorId,
      objectCount: syncedObjects.length,
      hasDeltaToken: !!deltaToken,
    });

    return { objects: syncedObjects, deltaToken };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildSourceClient(cfg: S3ConnectorConfig): S3Client {
    return new S3Client({
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }

  private async syncObject(
    ctx: SyncContext,
    sourceClient: S3Client,
    cfg: S3ConnectorConfig,
    key: string,
    lastModified: Date
  ): Promise<SyncedObject | null> {
    const getRes = await sourceClient.send(
      new GetObjectCommand({ Bucket: cfg.bucket, Key: key })
    );

    if (!getRes.Body) {
      log.warn("s3 object body empty", { key });
      return null;
    }

    const content = Buffer.from(await getRes.Body.transformToByteArray());
    const contentHash = createHash("sha256").update(content).digest("hex");

    const filename = key.split("/").pop() ?? key;
    const mimeType = getRes.ContentType ?? "application/octet-stream";

    // Strip any connector-configured prefix from the key to avoid double-nesting
    const relativeKey = cfg.prefix ? key.slice(cfg.prefix.length) : key;
    const storageKey = `knowledge/${ctx.connectorId}/${relativeKey}`;

    await getWorkspaceS3().send(
      new PutObjectCommand({
        Bucket: ctx.bucket,
        Key: storageKey,
        Body: content,
        ContentType: mimeType,
      })
    );

    const now = new Date().toISOString();

    return {
      filename,
      mimeType,
      contentHash,
      sizeBytes: content.length,
      storageKey,
      action: ctx.previousDeltaToken ? "updated" : "created",
      provenance: {
        sourceType: "s3",
        sourceUri: `s3://${cfg.bucket}/${key}`,
        importedAt: now,
        lastSyncedAt: now,
        versionId: lastModified.toISOString(),
      },
    };
  }
}
