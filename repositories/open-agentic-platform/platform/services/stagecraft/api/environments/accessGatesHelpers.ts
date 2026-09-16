// Spec 137 Phase 2 — pure helpers for the access-gate API surface.
//
// Lives in its own module so vitest can test invariants like the
// FR-007 password-rejection defense-in-depth without dragging in
// `encore.dev/storage/sqldb` (which requires the Encore native
// runtime). Mirrors the `cloneAvailabilityHelpers.ts` pattern.

import { APIError } from "encore.dev/api";

export type FederatedProvider =
  | "google"
  | "microsoft"
  | "github"
  | "generic_oidc";

export const FEDERATED_PROVIDERS: ReadonlySet<FederatedProvider> = new Set([
  "google",
  "microsoft",
  "github",
  "generic_oidc",
]);

export const ALLOWLIST_KINDS: ReadonlySet<"email" | "domain"> = new Set([
  "email",
  "domain",
]);

/**
 * Defense-in-depth — FR-007 invariant. Refuse any payload field that
 * looks like a password. The schema has no such field, but the API
 * rejects shapes that look like passwords so a buggy upstream caller
 * fails loudly rather than silently dropping the field.
 *
 * Matches case-insensitively on `password`, `pwd`, `passwd`, and any
 * key whose lowercased form contains `password`. `secret`-named
 * Rauthy/k8s reference fields are not rejected — they're references
 * to credentials, not credentials themselves.
 */
export function assertNoPasswordFields(payload: unknown): void {
  if (payload === null || typeof payload !== "object") return;
  const obj = payload as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (
      lower === "password" ||
      lower === "pwd" ||
      lower === "passwd" ||
      lower.includes("password")
    ) {
      throw APIError.invalidArgument(
        `field '${key}' is rejected: tenant gates do not handle passwords (FR-007)`,
      );
    }
  }
}

/**
 * Validate a federated-provider payload. Returns the validated
 * `{ provider, clientRef }` pair (both null or both set) or throws
 * `APIError.invalidArgument` on an inconsistent pair.
 */
export function validateFederatedProviderPair(
  provider: string | null | undefined,
  clientRef: string | null | undefined,
): { provider: FederatedProvider | null; clientRef: string | null } {
  const p = provider ?? null;
  const r = clientRef ?? null;
  if (p !== null && !FEDERATED_PROVIDERS.has(p as FederatedProvider)) {
    throw APIError.invalidArgument(
      `loginMethodFederatedProvider must be one of: ${[...FEDERATED_PROVIDERS].join(", ")}`,
    );
  }
  if ((p === null) !== (r === null)) {
    throw APIError.invalidArgument(
      "loginMethodFederatedProvider and loginMethodFederatedProviderClientRef must both be set or both be null",
    );
  }
  return { provider: p as FederatedProvider | null, clientRef: r };
}
