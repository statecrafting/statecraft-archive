/**
 * Tenant-repo artifact reference convention and existence checks.
 *
 * Spec 213 (tenant-repo-image-build). This module is the single owner of
 * the GHCR image-ref naming convention (FR-002 / FR-005): every statecraft
 * call site that needs "the image for this commit" derives it here, so no
 * inline `ghcr.io/...` string construction survives elsewhere (SC-003).
 */

import log from "encore.dev/log";

/**
 * Registry host for tenant images (FR-002). Isolated here so a future spec
 * can parameterise registry choice per-org without touching call sites
 * (spec 213 §Out of scope).
 */
export const TENANT_REGISTRY = "ghcr.io";

/** Length of the short commit SHA used in sha-tags (FR-002). */
export const SHORT_SHA_LEN = 12;

/**
 * Build variant as recorded on `project_artifacts.variant` and encoded in
 * the image tag. `root` is the single-variant tree (no tag suffix);
 * `public` / `internal` are the dual-profile variants (spec 214 FR-009).
 */
export type ArtifactVariant = "root" | "public" | "internal";

export interface ArtifactRefInput {
  githubOrg: string;
  repoName: string;
  /** Full or already-short commit SHA; truncated to SHORT_SHA_LEN. */
  sha: string;
  /** Defaults to "root" (single-variant tree). */
  variant?: ArtifactVariant;
}

export interface PreviewRefInput {
  githubOrg: string;
  repoName: string;
  prNumber: number;
  variant?: ArtifactVariant;
}

/** Tag suffix for a variant: empty for `root`, `-public`/`-internal` otherwise. */
function variantSuffix(variant: ArtifactVariant): string {
  return variant === "root" ? "" : `-${variant}`;
}

/** Truncate a commit SHA to the conventional 12-char prefix (FR-002). */
export function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LEN);
}

/**
 * Lowercase `org/repo`. GHCR repository names are case-insensitive and the
 * registry rejects uppercase, so the derived ref must match what the
 * workflow actually pushes regardless of the org/repo slug casing.
 */
function repoPath(githubOrg: string, repoName: string): string {
  return `${githubOrg}/${repoName}`.toLowerCase();
}

function ghcrRef(githubOrg: string, repoName: string, tag: string): string {
  return `${TENANT_REGISTRY}/${repoPath(githubOrg, repoName)}:${tag}`;
}

/**
 * The deterministic sha-tag ref for a built commit (FR-002 / FR-005).
 *   single: ghcr.io/{org}/{repo}:sha-{short}
 *   dual:   ghcr.io/{org}/{repo}:sha-{short}-{variant}
 * No `latest` tag is ever derived.
 */
export function deriveArtifactRef(input: ArtifactRefInput): string {
  const variant = input.variant ?? "root";
  const tag = `sha-${shortSha(input.sha)}${variantSuffix(variant)}`;
  return ghcrRef(input.githubOrg, input.repoName, tag);
}

/**
 * The PR-alias ref the build workflow additionally publishes on
 * `pull_request` events (FR-003), aligning the preview-deploy webhook with
 * a tag that exists.
 *   single: ghcr.io/{org}/{repo}:pr-{n}
 *   dual:   ghcr.io/{org}/{repo}:pr-{n}-{variant}
 */
export function derivePreviewRef(input: PreviewRefInput): string {
  const variant = input.variant ?? "root";
  const tag = `pr-${input.prNumber}${variantSuffix(variant)}`;
  return ghcrRef(input.githubOrg, input.repoName, tag);
}

export interface ParsedImageRef {
  registry: string;
  /** `org/repo`, lowercased. */
  repository: string;
  tag: string;
}

/**
 * Parse a `host/org/repo:tag` ref. Throws on a tag-less or malformed ref.
 * Tenant refs never carry a `host:port`, so the last `:` (which must follow
 * the final `/`) is the tag separator.
 */
export function parseImageRef(ref: string): ParsedImageRef {
  const lastColon = ref.lastIndexOf(":");
  const lastSlash = ref.lastIndexOf("/");
  if (lastColon === -1 || lastColon < lastSlash) {
    throw new Error(`Image ref missing tag: ${ref}`);
  }
  const tag = ref.slice(lastColon + 1);
  const path = ref.slice(0, lastColon);
  const firstSlash = path.indexOf("/");
  if (firstSlash === -1) {
    throw new Error(`Image ref missing repository: ${ref}`);
  }
  return {
    registry: path.slice(0, firstSlash),
    repository: path.slice(firstSlash + 1),
    tag,
  };
}

/**
 * Tri-state existence verdict (FR-007). `indeterminate` is returned for
 * rate-limit / auth / network failures so callers never treat a transient
 * registry error as "image absent" (which would mask a real deploy).
 */
export type ArtifactExistence = "exists" | "absent" | "indeterminate";

/**
 * HEAD the GHCR manifest for an image ref using a GitHub installation token
 * with `packages: read` (FR-007). 200 => exists, 404 => absent, anything
 * else (401/403/429/5xx, network error) => indeterminate.
 *
 * GHCR's registry-v2 endpoint accepts a bearer derived from the GitHub
 * token. The handshake is exercised against the live registry at deploy
 * time (spec 213 verification split); the tri-state contract here holds
 * regardless of the auth detail.
 */
export async function artifactExists(
  ref: string,
  opts: { token: string }
): Promise<ArtifactExistence> {
  let parsed: ParsedImageRef;
  try {
    parsed = parseImageRef(ref);
  } catch (e) {
    log.warn("artifactExists: unparseable ref", { ref, error: String(e) });
    return "indeterminate";
  }

  const url = `https://${parsed.registry}/v2/${parsed.repository}/manifests/${parsed.tag}`;
  try {
    const resp = await fetch(url, {
      method: "HEAD",
      headers: {
        // GHCR accepts the GitHub token base64-encoded as a registry bearer.
        Authorization: `Bearer ${Buffer.from(opts.token).toString("base64")}`,
        Accept:
          "application/vnd.oci.image.index.v1+json, " +
          "application/vnd.docker.distribution.manifest.list.v2+json, " +
          "application/vnd.oci.image.manifest.v1+json, " +
          "application/vnd.docker.distribution.manifest.v2+json",
      },
    });
    if (resp.status === 200) return "exists";
    if (resp.status === 404) return "absent";
    log.info("artifactExists: indeterminate registry status", {
      ref,
      status: resp.status,
    });
    return "indeterminate";
  } catch (e) {
    log.warn("artifactExists: registry HEAD failed", { ref, error: String(e) });
    return "indeterminate";
  }
}
