/**
 * Spec 113 Phase 1a — pure helpers for the clone-availability endpoint.
 *
 * These helpers do not import `encore.dev/*`. They are extracted so the
 * unit test runner can exercise the format gate (FR-019, SC-008) and the
 * GitHub-status → state mapping (FR-020) without bringing up the Encore
 * native runtime — same pattern as `importHelpers.ts` vs. `import.ts`.
 */

const GITHUB_REPO_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const PROJECT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidGithubRepoName(s: string): boolean {
  if (typeof s !== "string") return false;
  if (s === "." || s === "..") return false;
  return GITHUB_REPO_NAME_RE.test(s);
}

export function isValidProjectSlug(s: string): boolean {
  if (typeof s !== "string") return false;
  return PROJECT_SLUG_RE.test(s);
}

// ---------------------------------------------------------------------------
// Response shape (FR-017)
// ---------------------------------------------------------------------------

export type AvailabilityState =
  | "available"
  | "unavailable"
  | "invalid"
  | "unverifiable";

export type AvailabilityReason =
  | "format"
  | "exists"
  | "rate_limited"
  | "no_installation"
  | "transient_error";

export interface AvailabilityVerdict {
  value: string;
  state: AvailabilityState;
  reason?: AvailabilityReason;
  retryAfterSec?: number;
}

export interface CheckAvailabilityResponse {
  repoName?: AvailabilityVerdict;
  slug?: AvailabilityVerdict;
}

// ---------------------------------------------------------------------------
// Repo availability probe (FR-020) — fetch-injectable for tests
// ---------------------------------------------------------------------------

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> }
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/**
 * Probe `GET /repos/:org/:repo` and map status to availability.
 *
 * - 404                                    ⇒ available
 * - 200                                    ⇒ unavailable, reason=exists
 * - 403/429 with secondary-rate-limit hdrs ⇒ unverifiable, reason=rate_limited
 * - other non-2xx                          ⇒ unverifiable, reason=transient_error
 */
export async function checkRepoAvailable(
  token: string,
  githubOrgLogin: string,
  repoName: string,
  fetcher: FetchLike = fetch as unknown as FetchLike
): Promise<{
  state: AvailabilityState;
  reason?: AvailabilityReason;
  retryAfterSec?: number;
}> {
  const url = `https://api.github.com/repos/${encodeURIComponent(
    githubOrgLogin
  )}/${encodeURIComponent(repoName)}`;
  const resp = await fetcher(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (resp.status === 404) return { state: "available" };
  if (resp.status === 200)
    return { state: "unavailable", reason: "exists" };

  if (resp.status === 403 || resp.status === 429) {
    const remaining = resp.headers.get("x-ratelimit-remaining");
    const retryAfter = resp.headers.get("retry-after");
    const reset = resp.headers.get("x-ratelimit-reset");
    const isSecondary =
      (remaining !== null && remaining === "0") ||
      retryAfter !== null ||
      reset !== null;
    if (isSecondary) {
      let retryAfterSec: number | undefined;
      if (retryAfter !== null) {
        const n = Number(retryAfter);
        if (Number.isFinite(n) && n > 0) retryAfterSec = Math.ceil(n);
      } else if (reset !== null) {
        const resetEpoch = Number(reset);
        if (Number.isFinite(resetEpoch)) {
          const now = Math.floor(Date.now() / 1000);
          retryAfterSec = Math.max(1, resetEpoch - now);
        }
      }
      return { state: "unverifiable", reason: "rate_limited", retryAfterSec };
    }
  }

  return { state: "unverifiable", reason: "transient_error" };
}
