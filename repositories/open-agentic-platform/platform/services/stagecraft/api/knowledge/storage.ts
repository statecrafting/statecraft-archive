/**
 * S3-compatible object store client for knowledge intake (spec 087 Phase 2,
 * spec 143 dual-endpoint split).
 *
 * Uses MinIO for local dev, S3/Azure Blob for production.
 * Provides presigned URLs so clients upload directly to the store
 * without routing blobs through the Encore API.
 *
 * Spec 143 §4.1: two clients with the same credentials/region but
 * potentially different endpoints. The internal client targets the
 * cluster-internal storage URL (server-side ops); the public client
 * targets the browser-reachable URL (presigning only). On AWS S3 /
 * Azure Blob / GCS where the storage endpoint is already public, the
 * S3_PUBLIC_ENDPOINT secret can be unset and both clients degenerate
 * to the same configuration (FR-007 fallback).
 */

import {
  S3Client,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { secret } from "encore.dev/config";
import log from "encore.dev/log";

// ---------------------------------------------------------------------------
// Configuration (Encore secrets)
// ---------------------------------------------------------------------------

const s3Endpoint = secret("S3_ENDPOINT"); // server-side endpoint (cluster-internal on Hetzner; public on AWS S3 / Azure / GCS)
const s3PublicEndpoint = secret("S3_PUBLIC_ENDPOINT"); // browser-reachable endpoint for presigned URLs (spec 143). Empty/unset → falls back to S3_ENDPOINT.
const s3Region = secret("S3_REGION"); // e.g. us-east-1
const s3AccessKey = secret("S3_ACCESS_KEY");
const s3SecretKey = secret("S3_SECRET_KEY");

// ---------------------------------------------------------------------------
// Client singletons (lazy-init, dual-endpoint per spec 143 FR-001/FR-002)
// ---------------------------------------------------------------------------
//
// `forcePathStyle: true` is non-negotiable on BOTH clients (FR-001).
// MinIO under a custom domain rejects virtual-hosted addressing; AWS S3
// accepts both styles, so path-style is a safe universal default.
//
// Only `getPresignedUploadUrl` and `getPresignedDownloadUrl` are allowed
// to use the public client (FR-002). Every other helper uses the
// internal client.

let _internalClient: S3Client | null = null;
let _publicClient: S3Client | null = null;

/**
 * Resolve both endpoints from the configured secrets. Exposed (with the
 * leading underscore convention) so unit tests can pin endpoint values
 * without driving secrets through the Encore runtime.
 *
 * Fallback semantics (FR-007): when `S3_PUBLIC_ENDPOINT` is unset or
 * empty, the public endpoint falls back to `S3_ENDPOINT` so AWS S3 /
 * cloud deployments keep working without configuration churn, and
 * local dev where MinIO at `http://localhost:9000` is reachable from
 * the browser directly stays functional.
 */
export function _resolveEndpoints(): { internal: string; public: string } {
  const internal = s3Endpoint();
  const explicitPublic = s3PublicEndpoint();
  return {
    internal,
    public: explicitPublic || internal,
  };
}

function buildClient(endpoint: string): S3Client {
  return new S3Client({
    endpoint,
    region: s3Region(),
    credentials: {
      accessKeyId: s3AccessKey(),
      secretAccessKey: s3SecretKey(),
    },
    forcePathStyle: true, // FR-001 — non-negotiable for MinIO under a custom domain
  });
}

function getInternalClient(): S3Client {
  if (!_internalClient) {
    _internalClient = buildClient(_resolveEndpoints().internal);
  }
  return _internalClient;
}

function getPublicClient(): S3Client {
  if (!_publicClient) {
    _publicClient = buildClient(_resolveEndpoints().public);
  }
  return _publicClient;
}

/**
 * Reset cached client singletons. Test-only: vitest fixtures call this
 * between test cases so each case can re-resolve the endpoints from a
 * freshly-set secret value without bleeding state across tests.
 */
export function _resetClientsForTesting(): void {
  _internalClient = null;
  _publicClient = null;
}

// ---------------------------------------------------------------------------
// Ensure bucket exists (idempotent)
// ---------------------------------------------------------------------------
//
// Workspace creation records the bucket name in the DB but does not touch the
// object store. On MinIO (and most S3-compatibles), the first upload targets
// a bucket that may not exist yet. We materialise it here — Head→Create with
// a best-effort CreateBucket that tolerates the 409 race when two requests
// land simultaneously.

const ensuredBuckets = new Set<string>();

export async function ensureBucket(bucket: string): Promise<void> {
  if (ensuredBuckets.has(bucket)) return;
  const client = getInternalClient();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    ensuredBuckets.add(bucket);
    return;
  } catch (err: unknown) {
    if (!isNotFoundLike(err)) throw err;
  }
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    log.info("bucket created", { bucket });
  } catch (err: unknown) {
    if (!isAlreadyOwnedLike(err)) throw err;
  }
  ensuredBuckets.add(bucket);
}

function isNotFoundLike(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = (err as { name?: string }).name ?? "";
  const statusCode = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode;
  return name === "NotFound" || name === "NoSuchBucket" || statusCode === 404;
}

function isAlreadyOwnedLike(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = (err as { name?: string }).name ?? "";
  return (
    name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists"
  );
}

// ---------------------------------------------------------------------------
// Presigned upload URL
// ---------------------------------------------------------------------------

export async function getPresignedUploadUrl(
  bucket: string,
  key: string,
  _contentType: string,
  expiresInSeconds = 3600
): Promise<string> {
  await ensureBucket(bucket);
  // Deliberately omit ContentType from the signed params: Safari (and some
  // proxies) will rewrite the PUT's Content-Type header, breaking the
  // signature. The server-recorded mimeType comes from the DB row set at
  // request-upload time, not from whatever header S3 ends up storing.
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  // FR-002: presigning uses the public client so the signed URL's host
  // is browser-reachable. Signature covers the Host header, so the
  // ingress chain MUST preserve `Host: <S3_PUBLIC_ENDPOINT-host>`
  // end-to-end (FR-006a).
  const url = await getSignedUrl(getPublicClient(), cmd, {
    expiresIn: expiresInSeconds,
  });
  log.info("presigned upload URL generated", { bucket, key });
  return url;
}

// ---------------------------------------------------------------------------
// Presigned download URL
// ---------------------------------------------------------------------------

export async function getPresignedDownloadUrl(
  bucket: string,
  key: string,
  expiresInSeconds = 3600
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  // FR-002: presigning uses the public client (same rationale as
  // getPresignedUploadUrl). FR-012 pins TTLs at every call site rather
  // than mutating this helper's default.
  return getSignedUrl(getPublicClient(), cmd, { expiresIn: expiresInSeconds });
}

// ---------------------------------------------------------------------------
// Head object (verify upload + get metadata)
// ---------------------------------------------------------------------------

export type ObjectMeta = {
  contentLength: number;
  contentType: string;
  etag: string;
};

export async function headObject(
  bucket: string,
  key: string
): Promise<ObjectMeta | null> {
  try {
    const res = await getInternalClient().send(
      new HeadObjectCommand({ Bucket: bucket, Key: key })
    );
    return {
      contentLength: res.ContentLength ?? 0,
      contentType: res.ContentType ?? "application/octet-stream",
      etag: (res.ETag ?? "").replace(/"/g, ""),
    };
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "name" in err &&
      err.name === "NotFound"
    ) {
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Delete object
// ---------------------------------------------------------------------------

export async function deleteObject(
  bucket: string,
  key: string
): Promise<void> {
  await getInternalClient().send(
    new DeleteObjectCommand({ Bucket: bucket, Key: key })
  );
  log.info("object deleted", { bucket, key });
}

// ---------------------------------------------------------------------------
// List all keys under a bucket (paginated via continuation token)
// ---------------------------------------------------------------------------
//
// Used by the org-admin orphan-storage purge endpoint: walk every key in the
// workspace bucket, diff against DB-referenced keys, delete the unreferenced
// remainder. Returned set is bounded by the bucket's actual size; the caller
// is responsible for chunking deletes if the bucket is enormous.

export async function listAllObjects(bucket: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  while (true) {
    const res = await getInternalClient().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    if (!res.IsTruncated || !res.NextContinuationToken) break;
    continuationToken = res.NextContinuationToken;
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Server-side PUT (bypasses presigned URL flow)
// ---------------------------------------------------------------------------
//
// Used by flows that land files in the workspace bucket without a browser
// client — e.g. Import reads `.artifacts/raw/` from a cloned repo and
// streams each file into the bucket directly. Extractor transitions also
// use it to write the derived text output back under a deterministic key.

export async function putObject(
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await ensureBucket(bucket);
  await getInternalClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  log.info("object put", { bucket, key, size: body.length });
}

// ---------------------------------------------------------------------------
// Server-side GET → Buffer
// ---------------------------------------------------------------------------

export async function getObject(bucket: string, key: string): Promise<Buffer> {
  const res = await getInternalClient().send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  const body = res.Body;
  if (!body) {
    throw new Error(`s3 GetObject returned empty body for ${bucket}/${key}`);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Server-side ranged GET → Buffer (Spec 115 FR-014)
// ---------------------------------------------------------------------------

export async function getObjectRange(
  bucket: string,
  key: string,
  startByte: number,
  endByte: number
): Promise<Buffer> {
  const res = await getInternalClient().send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=${startByte}-${endByte}`,
    })
  );
  const body = res.Body;
  if (!body) {
    throw new Error(`s3 GetObject ranged body empty for ${bucket}/${key}`);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Magic-number sniff (Spec 115 FR-014)
// ---------------------------------------------------------------------------
//
// Reads the first 4KB of a stored object via ranged GET and reconciles the
// declared mime type against the bytes' magic-number signature. On
// disagreement the sniffed value wins — clients lie, and routing
// `image/jpeg-actually-html` to the vision model would burn tokens for
// nothing. Skips the sniff (returns the declared type) when sizeBytes is
// below the sample window, since for files that small the cost of a wrong
// dispatch is also small.
//
// The pure detector + reconciliation logic lives in `magic.ts` so it can be
// unit-tested without the Encore native runtime. This wrapper only adds the
// S3 round-trip.

import { MAGIC_SNIFF_BYTES, reconcileSniffedMime } from "./magic";
export { detectMimeFromMagic } from "./magic";

export type SniffResult = {
  /** The mime that should be used for dispatch — either the declared or sniffed value. */
  mimeType: string;
  /** True when sniffing changed the answer; the worker logs `mime_mismatch` in that case. */
  mismatched: boolean;
  /** The sniffed type if a signature matched; null when the signature was unrecognised. */
  sniffedAs: string | null;
};

export async function sniffMimeType(args: {
  bucket: string;
  storageKey: string;
  declaredMime: string;
  sizeBytes: number;
}): Promise<SniffResult> {
  if (args.sizeBytes < MAGIC_SNIFF_BYTES) {
    return reconcileSniffedMime({
      declaredMime: args.declaredMime,
      sample: null,
    });
  }
  const sample = await getObjectRange(
    args.bucket,
    args.storageKey,
    0,
    MAGIC_SNIFF_BYTES - 1
  );
  return reconcileSniffedMime({
    declaredMime: args.declaredMime,
    sample,
  });
}
