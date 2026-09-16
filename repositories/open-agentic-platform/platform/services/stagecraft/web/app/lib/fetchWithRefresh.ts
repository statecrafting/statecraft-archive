/**
 * Browser-side fetch wrapper with single-flight 401 → /auth/refresh retry.
 *
 * Spec 143 FU-023 (the source-side implementation arm of FU-016). The
 * long-running upload-batch path in `app.project.$projectId.knowledge.tsx`
 * makes direct browser fetches to `/api/projects/.../knowledge/upload` and
 * `/api/projects/.../knowledge/objects/{id}/confirm` (the comment on
 * `uploadOne` explains why it bypasses Remix actions — RR v7 single-fetch
 * returns HTML, which breaks Safari `res.json()`). The browser `__session`
 * cookie expires on Rauthy's access-token lifetime (~30 min default); a
 * batch crossing the boundary mid-stream 401s with no recovery.
 *
 * This wrapper catches the first 401, POSTs to `/auth/refresh` (which rotates
 * `__session` and `__refresh` cookies via Set-Cookie), and retries the
 * original request once. Concurrent in-flight requests share a single
 * refresh promise — N parallel uploads do not kick off N parallel refreshes.
 */

let refreshInFlight: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const resp = await fetch("/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
      });
      return resp.status === 204;
    } catch {
      return false;
    } finally {
      // Clear the slot so a future 401 (e.g. next refresh window) can refresh again.
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Drop-in replacement for `fetch` that single-flights an `/auth/refresh` on
 * 401 and retries the original request once. Non-401 responses (including
 * 4xx other than 401, and 5xx) are returned as-is. On refresh failure the
 * original 401 response is returned to the caller (which preserves the
 * existing error-surface contract — the upload-batch UI already handles
 * non-ok responses).
 *
 * The retry is intentionally bounded at one — a second 401 after a
 * successful refresh implies the refresh token itself is invalid (revoked,
 * upstream policy change, IdP misconfiguration) and warrants user-visible
 * failure rather than a tight retry loop.
 */
export async function fetchWithRefresh(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const first = await fetch(input, init);
  if (first.status !== 401) return first;

  const refreshed = await performRefresh();
  if (!refreshed) return first;

  return fetch(input, init);
}

/**
 * Test-only seam: reset the module-level single-flight slot between tests.
 * Production callers must not rely on this.
 */
export function __resetRefreshInFlightForTests(): void {
  refreshInFlight = null;
}
