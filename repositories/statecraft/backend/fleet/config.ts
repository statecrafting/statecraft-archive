/**
 * Fleet configuration (spec 006 §3).
 *
 * `FLEET_BASE_DOMAIN` is the domain under which each app gets `<name>.<domain>`
 * (deployd.xyz, per spec 006 §3): a public, non-secret input read from env, with
 * NO hardcoded default. Endpoints that need it report a failedPrecondition if it
 * is unset ("stop and report", spec 006 §3), rather than inventing a fallback.
 *
 * Backup secrets (restic password + Hetzner Object Storage S3 keys) are true
 * secrets read via Encore `secret()`, with the same dev fallback to the
 * operator's `~/.config/oap/infra/hetzner/.env` that tenants/config.ts uses. The
 * S3 endpoint, bucket, and restic image are non-secret and default to the
 * provisioned Hetzner target (spec 006 §3); the reconciliation of these into the
 * infra `.env` is a follow-up (spec 006 §3 operator prerequisites).
 *
 * The kubeconfig is resolved entirely Rust-side by the addon
 * (`FLEET_KUBECONFIG_PATH`, else in-cluster / `~/.kube/config`); this service
 * never reads it.
 */
import { secret } from "encore.dev/config";

import type { BackupTarget } from "./native";

const resticPassword = secret("FLEET_S3_RESTIC_PASSWORD");
const s3AccessKey = secret("FLEET_S3_ACCESS_KEY_ID");
const s3SecretKey = secret("FLEET_S3_SECRET_ACCESS_KEY");

/** S3-compatible endpoint for the Hetzner Object Storage backup bucket. */
export const FLEET_BACKUP_S3_ENDPOINT =
  process.env.FLEET_BACKUP_S3_ENDPOINT ?? "https://nbg1.your-objectstorage.com";

/** The backup bucket (sibling of oap-deployd-backups-prod, spec 006 §3). */
export const FLEET_BACKUP_BUCKET =
  process.env.FLEET_BACKUP_BUCKET ?? "oap-fleet-backups-prod";

/** The restic image the backup Job runs. */
export const FLEET_RESTIC_IMAGE = process.env.FLEET_RESTIC_IMAGE ?? "restic/restic:0.17.3";

/** `<name>.<FLEET_BASE_DOMAIN>` root (deployd.xyz). Empty until configured. */
export function fleetBaseDomain(): string {
  return (process.env.FLEET_BASE_DOMAIN ?? "").trim().replace(/\.+$/, "");
}

/**
 * Name of a pre-provisioned `kubernetes.io/dockerconfigjson` Secret in the app
 * namespace, wired onto the pod as `imagePullSecrets` so a private image (e.g. a
 * private GHCR enrahitu image) can be pulled (spec 006 §3, finding #2). This is
 * a resource name, not a credential, so it is a plain env var (non-secret);
 * empty means public images only and no pull secret is attached. Provisioning
 * the Secret in the namespace is an operator step (spec 006 §3 operator
 * prerequisites).
 */
export function fleetImagePullSecret(): string {
  return (process.env.FLEET_IMAGE_PULL_SECRET ?? "").trim();
}

function fromSecretOrEnv(value: string, envName: string): string {
  const v = value.trim();
  if (v.length > 0) return v;
  return (process.env[envName] ?? "").trim();
}

/**
 * The restic + S3 backup target, or null when the secrets are not configured
 * (the backup endpoint then reports a failedPrecondition). The per-app
 * repository path (`<namespace>/<app>`) is appended inside the addon.
 */
export function backupTarget(): BackupTarget | null {
  const password = fromSecretOrEnv(resticPassword(), "FLEET_S3_RESTIC_PASSWORD");
  const accessKeyId = fromSecretOrEnv(s3AccessKey(), "FLEET_S3_ACCESS_KEY_ID");
  const secretAccessKey = fromSecretOrEnv(s3SecretKey(), "FLEET_S3_SECRET_ACCESS_KEY");
  if (!password || !accessKeyId || !secretAccessKey) return null;
  return {
    repositoryBase: `s3:${FLEET_BACKUP_S3_ENDPOINT}/${FLEET_BACKUP_BUCKET}`,
    password,
    accessKeyId,
    secretAccessKey,
    resticImage: FLEET_RESTIC_IMAGE,
  };
}
