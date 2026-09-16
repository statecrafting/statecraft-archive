/**
 * SharePoint Online connector (spec 087 Phase 4).
 *
 * Uses Microsoft Graph API to sync files from a SharePoint site/drive/folder
 * into the workspace S3 bucket. Supports:
 *
 * - OAuth2 client credentials flow (app-only access)
 * - Delta queries for incremental sync
 * - Folder-level scoping
 * - Content hash deduplication
 *
 * Config shape (stored in source_connectors.config_encrypted):
 * {
 *   tenantId:     string  — Azure AD tenant ID
 *   clientId:     string  — App registration client ID
 *   clientSecret: string  — App registration client secret
 *   siteUrl:      string  — SharePoint site URL (e.g. https://contoso.sharepoint.com/sites/docs)
 *   driveId?:     string  — Specific drive ID (default: root document library)
 *   folderPath?:  string  — Folder path within the drive (e.g. "/General/Specs")
 * }
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
// S3 client (reuse the same credentials as storage.ts)
// ---------------------------------------------------------------------------

const s3Endpoint = secret("S3_ENDPOINT");
const s3Region = secret("S3_REGION");
const s3AccessKey = secret("S3_ACCESS_KEY");
const s3SecretKey = secret("S3_SECRET_KEY");

let _s3: S3Client | null = null;

function getS3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      endpoint: s3Endpoint(),
      region: s3Region(),
      credentials: {
        accessKeyId: s3AccessKey(),
        secretAccessKey: s3SecretKey(),
      },
      forcePathStyle: true,
    });
  }
  return _s3;
}

// ---------------------------------------------------------------------------
// SharePoint config type guard
// ---------------------------------------------------------------------------

interface SharePointConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteUrl: string;
  driveId?: string;
  folderPath?: string;
}

function asSharePointConfig(
  config: Record<string, unknown>
): SharePointConfig {
  return config as unknown as SharePointConfig;
}

// ---------------------------------------------------------------------------
// Microsoft Graph helpers
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

async function getAccessToken(cfg: SharePointConfig): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SharePoint OAuth token request failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as TokenResponse;
  return data.access_token;
}

/** Resolve the SharePoint site ID from the site URL. */
async function resolveSiteId(
  token: string,
  siteUrl: string
): Promise<string> {
  // Parse: https://contoso.sharepoint.com/sites/docs → hostname=contoso.sharepoint.com, path=/sites/docs
  const url = new URL(siteUrl);
  const hostname = url.hostname;
  const sitePath = url.pathname.replace(/\/$/, "");

  const graphUrl = `https://graph.microsoft.com/v1.0/sites/${hostname}:${sitePath}`;
  const res = await fetch(graphUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to resolve SharePoint site: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

/** Resolve the default drive ID for a site (if driveId not explicitly set). */
async function resolveDefaultDriveId(
  token: string,
  siteId: string
): Promise<string> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to resolve default drive: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

// ---------------------------------------------------------------------------
// Microsoft Graph delta query types
// ---------------------------------------------------------------------------

interface DriveItem {
  id: string;
  name: string;
  file?: {
    mimeType: string;
    hashes?: { sha256Hash?: string; quickXorHash?: string };
  };
  size: number;
  parentReference?: { path?: string };
  webUrl?: string;
  deleted?: { state: string };
  "@microsoft.graph.downloadUrl"?: string;
}

interface DeltaResponse {
  value: DriveItem[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

// ---------------------------------------------------------------------------
// SharePointConnector
// ---------------------------------------------------------------------------

export class SharePointConnector implements SourceConnector {
  readonly type = "sharepoint";

  validateConfig(config: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const required = ["tenantId", "clientId", "clientSecret", "siteUrl"];
    for (const field of required) {
      if (!config[field] || typeof config[field] !== "string") {
        errors.push(`${field} is required and must be a string`);
      }
    }

    if (config.siteUrl && typeof config.siteUrl === "string") {
      try {
        new URL(config.siteUrl as string);
      } catch {
        errors.push("siteUrl must be a valid URL");
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async testConnection(config: Record<string, unknown>): Promise<void> {
    const cfg = asSharePointConfig(config);
    const token = await getAccessToken(cfg);
    // Verify we can resolve the site
    await resolveSiteId(token, cfg.siteUrl);
  }

  async sync(ctx: SyncContext): Promise<SyncResult> {
    const cfg = asSharePointConfig(ctx.config);
    const token = await getAccessToken(cfg);
    const siteId = await resolveSiteId(token, cfg.siteUrl);
    const driveId = cfg.driveId ?? (await resolveDefaultDriveId(token, siteId));

    // Build the delta query URL
    let deltaUrl: string;
    if (ctx.previousDeltaToken) {
      // Incremental sync — resume from the previous delta link
      deltaUrl = ctx.previousDeltaToken;
    } else {
      // Full sync — enumerate all items
      const basePath = cfg.folderPath
        ? `/root:${cfg.folderPath}:`
        : "/root";
      deltaUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items${basePath}/delta?$select=id,name,file,size,parentReference,webUrl,deleted`;
    }

    const syncedObjects: SyncedObject[] = [];
    let nextDeltaLink: string | null = null;

    // Page through delta results
    let currentUrl: string | null = deltaUrl;
    while (currentUrl) {
      const res = await fetch(currentUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`SharePoint delta query failed: ${res.status} ${text}`);
      }

      const data = (await res.json()) as DeltaResponse;

      for (const item of data.value) {
        // Skip folders and deleted items
        if (!item.file || item.deleted) continue;

        // Filter by folder path if configured
        if (cfg.folderPath && item.parentReference?.path) {
          const normalizedFolder = cfg.folderPath.replace(/^\//, "").replace(/\/$/, "");
          if (!item.parentReference.path.includes(normalizedFolder)) continue;
        }

        const synced = await this.syncItem(ctx, item, token, driveId);
        if (synced) syncedObjects.push(synced);
      }

      currentUrl = data["@odata.nextLink"] ?? null;
      if (data["@odata.deltaLink"]) {
        nextDeltaLink = data["@odata.deltaLink"];
      }
    }

    log.info("sharepoint sync complete", {
      connectorId: ctx.connectorId,
      objectCount: syncedObjects.length,
      hasDeltaToken: !!nextDeltaLink,
    });

    return { objects: syncedObjects, deltaToken: nextDeltaLink };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async syncItem(
    ctx: SyncContext,
    item: DriveItem,
    token: string,
    driveId: string
  ): Promise<SyncedObject | null> {
    // Get the download URL
    const downloadUrl =
      item["@microsoft.graph.downloadUrl"] ??
      (await this.getDownloadUrl(driveId, item.id, token));

    if (!downloadUrl) {
      log.warn("no download URL for item", { itemId: item.id, name: item.name });
      return null;
    }

    // Download the file content
    const fileRes = await fetch(downloadUrl);
    if (!fileRes.ok) {
      log.warn("failed to download item", {
        itemId: item.id,
        name: item.name,
        status: fileRes.status,
      });
      return null;
    }

    const content = Buffer.from(await fileRes.arrayBuffer());

    // Compute SHA-256 hash
    const contentHash = createHash("sha256").update(content).digest("hex");

    // Build the S3 storage key
    const storageKey = `knowledge/${ctx.connectorId}/${item.id}/${item.name}`;

    // Upload to S3
    await getS3().send(
      new PutObjectCommand({
        Bucket: ctx.bucket,
        Key: storageKey,
        Body: content,
        ContentType: item.file!.mimeType,
      })
    );

    const now = new Date().toISOString();

    return {
      filename: item.name,
      mimeType: item.file!.mimeType,
      contentHash,
      sizeBytes: content.length,
      storageKey,
      action: ctx.previousDeltaToken ? "updated" : "created",
      provenance: {
        sourceType: "sharepoint",
        sourceUri: item.webUrl ?? `sharepoint://${item.id}`,
        importedAt: now,
        lastSyncedAt: now,
        versionId: item.id,
      },
    };
  }

  private async getDownloadUrl(
    driveId: string,
    itemId: string,
    token: string
  ): Promise<string | null> {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`,
      {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "manual",
      }
    );

    // Graph returns a 302 redirect to the download URL
    if (res.status === 302) {
      return res.headers.get("Location");
    }

    return null;
  }
}
