/**
 * Tenant ingress hostname convention (spec 214 FR-007; amends spec 137
 * §Clarification 4).
 *
 * The platform, not the caller, owns the host. It is a single DNS label
 * under `tenants.{base}` so the single-level wildcard certificate
 * (`*.tenants.{base}`) covers it; a multi-label host is therefore rejected
 * by construction (137's three-label sketch is not implementable against a
 * single-level wildcard). The label is
 * `{orgSlug}--{projectSlug}--{envSlug}` with `--int` appended for the
 * internal variant. Double-hyphen separators keep single-hyphen slugs
 * (e.g. `my-test-project-1`) unambiguous. Deterministic, RFC-1123 valid,
 * 63 chars or fewer (truncate-plus-stable-hash on overflow).
 */

import { createHash } from "crypto";

/** Max length of a single RFC-1123 DNS label. */
export const HOST_LABEL_MAX = 63;
/** Length of the stable hash suffix appended when a label would overflow. */
export const HASH_SUFFIX_LEN = 6;

/**
 * Deploy variant that participates in the host. `public` (and the
 * single-variant default) get no suffix; `internal` gets `--int`
 * (spec 214 FR-009 / FR-007).
 */
export type HostVariant = "public" | "internal";

export interface HostInput {
  orgSlug: string;
  projectSlug: string;
  envSlug: string;
  /** Defaults to "public" (the default variant for preview/dev, FR-009). */
  variant?: HostVariant;
}

/**
 * Reduce a slug to RFC-1123 label-safe characters: lowercase, alphanumeric
 * and hyphen, with leading/trailing hyphens trimmed so the joined label is
 * never edge-hyphenated.
 */
function sanitizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Deterministic short hash used to disambiguate truncated labels. */
function stableHashSuffix(input: string): string {
  return createHash("sha256")
    .update(input)
    .digest("hex")
    .slice(0, HASH_SUFFIX_LEN);
}

/**
 * Derive the single DNS label for a tenant environment (no domain suffix).
 * Deterministic in its inputs. On overflow past `HOST_LABEL_MAX`, the label
 * is truncated and a stable 6-char hash of the full label is appended so
 * distinct inputs keep distinct labels (collision-resistance, SC-004).
 */
export function deriveHostLabel(input: HostInput): string {
  const variant = input.variant ?? "public";
  const base = [
    sanitizeSlug(input.orgSlug),
    sanitizeSlug(input.projectSlug),
    sanitizeSlug(input.envSlug),
  ].join("--");
  const full = variant === "internal" ? `${base}--int` : base;

  if (full.length <= HOST_LABEL_MAX) return full;

  // Overflow: keep a deterministic prefix and append `-<hash>` so the label
  // stays unique to the full input and remains a valid RFC-1123 label.
  const hash = stableHashSuffix(full);
  const keep = HOST_LABEL_MAX - HASH_SUFFIX_LEN - 1; // room for "-<hash>"
  const prefix = full.slice(0, keep).replace(/-+$/g, "");
  return `${prefix}-${hash}`;
}

/**
 * Derive the fully-qualified tenant host under `tenants.{base}`. `baseDomain`
 * is the apex the wildcard cert covers (operational config surfaced to the
 * deploy service); the result is always a single label below `tenants.`.
 */
export function deriveHost(input: HostInput & { baseDomain: string }): string {
  return `${deriveHostLabel(input)}.tenants.${input.baseDomain}`;
}

/** RFC-1123 DNS label predicate (lowercase alnum + hyphen, no edge hyphen, <=63). */
export function isValidLabel(label: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label) && label.length <= HOST_LABEL_MAX;
}
