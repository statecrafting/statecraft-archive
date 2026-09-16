// Spec 112 §6.4.4 — OPC-side clone-token refresh loop.
//
// Owns project-scoped clone-token state on the React side:
//
//   * Persists the bundle's initial token to the OS keychain so a
//     subsequent factory run can read it without round-tripping
//     statecraft. Storage is delegated to the Tauri keychain commands;
//     this hook never holds the long-lived secret in component memory
//     beyond the in-flight refresh window.
//   * Schedules a single timer 5 minutes before an installation token's
//     `expiresAt`. When it fires, the hook calls `refreshCloneToken`,
//     which atomically re-fetches from statecraft and writes the new
//     blob to the keychain.
//   * Exposes `invalidate()` so callers that observe a 401 from a
//     GitHub-using subprocess can force an out-of-band refresh. PATs
//     that fail validation transition the hook into a `pat_invalid`
//     status surface so the cockpit can render an actionable banner.
//   * On unmount, clears the pending timer but leaves the keychain
//     entry alone — the cached token persists across OPC restarts per
//     §6.4.4 ("cached tokens persist across restarts but are
//     re-validated on first GitHub call").
//
// Status state machine:
//   uninitialized → fresh ─┬─→ refreshing → fresh
//                          ├─→ refreshing → expired (Statecraft 503)
//                          ├─→ refreshing → pat_invalid (PAT 401 reported by caller)
//                          └─→ anonymous (clone_token == null)
//
// The hook does not poll Statecraft for new tokens; it only fires once
// per scheduled expiry plus any explicit invalidate() calls.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type {
  OpcBundleCloneToken,
  StoredCloneToken,
} from '@/types/factoryBundle';

export type CloneTokenStatus =
  | 'uninitialized'
  | 'fresh'
  | 'refreshing'
  | 'expired'
  | 'pat_invalid'
  | 'anonymous'
  | 'error';

export interface CloneTokenState {
  token: StoredCloneToken | null;
  status: CloneTokenStatus;
  /** ISO-8601 of the last successful refresh (or initial persist). */
  lastRefreshedAt: string | null;
  /** Last error message, if any. */
  error: string | null;
}

export interface UseCloneTokenRefreshArgs {
  projectId: string | null | undefined;
  initialToken: OpcBundleCloneToken | null | undefined;
  /**
   * Minutes before `expiresAt` to schedule the refresh. Default 5.
   * Exposed for tests; cockpit callers should keep the default.
   */
  refreshMinutesBeforeExpiry?: number;
}

export interface UseCloneTokenRefresh extends CloneTokenState {
  /** Manually fetch a fresh token from Statecraft and persist. */
  refresh: () => Promise<void>;
  /**
   * Mark the current token as invalid (e.g. caller saw a 401). Drops
   * the keychain entry, then re-fetches. PAT-source invalidations
   * land in `pat_invalid` so the UI can point the user at Statecraft's
   * settings page. Installation-token invalidations cycle through
   * `refreshing → fresh` cleanly because the broker can mint a new
   * token on demand.
   */
  invalidate: () => Promise<void>;
  /** Clear the keychain entry (e.g. project removed, workspace switch). */
  clear: () => Promise<void>;
}

const INITIAL_STATE: CloneTokenState = {
  token: null,
  status: 'uninitialized',
  lastRefreshedAt: null,
  error: null,
};

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Compute the delay (ms) from now to a refresh point that is
 * `windowMinutes` minutes before `expiresAt`. Returns `null` when the
 * token has no expiry (PATs) or when the window has already passed
 * (caller should refresh immediately).
 */
function refreshDelayMs(
  expiresAt: string | null | undefined,
  windowMinutes: number
): number | null {
  if (!expiresAt) return null;
  const target = new Date(expiresAt).getTime();
  if (Number.isNaN(target)) return null;
  const fireAt = target - windowMinutes * 60_000;
  const delay = fireAt - Date.now();
  return delay > 0 ? delay : 0;
}

/**
 * Hard-coded for now (matches spec 109 §3 + spec 112 §6.4.4). A future
 * spec may parameterise this per-org. The constant lives here rather
 * than on the wire so we don't burn a token-refresh round-trip.
 */
const PAT_SETTINGS_PATH = (projectId: string) =>
  `/app/project/${encodeURIComponent(projectId)}/settings/github-pat`;

export function patSettingsUrl(
  statecraftBaseUrl: string,
  projectId: string
): string {
  const trimmed = statecraftBaseUrl.replace(/\/+$/, '');
  return `${trimmed}${PAT_SETTINGS_PATH(projectId)}`;
}

export function useCloneTokenRefresh(
  args: UseCloneTokenRefreshArgs
): UseCloneTokenRefresh {
  const { projectId, initialToken, refreshMinutesBeforeExpiry = 5 } = args;
  const [state, setState] = useState<CloneTokenState>(INITIAL_STATE);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleRefresh = useCallback(
    (expiresAt: string | null | undefined, runRefresh: () => Promise<void>) => {
      clearTimer();
      const delay = refreshDelayMs(expiresAt, refreshMinutesBeforeExpiry);
      if (delay === null) return;
      timerRef.current = setTimeout(() => {
        void runRefresh();
      }, delay);
    },
    [clearTimer, refreshMinutesBeforeExpiry]
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!projectId) return;
    setState((s) => ({ ...s, status: 'refreshing', error: null }));
    try {
      const resp = await api.refreshCloneToken(projectId);
      if (!resp.ok) {
        setState({
          token: null,
          status: 'error',
          lastRefreshedAt: null,
          error: resp.error ?? 'unknown refresh error',
        });
        return;
      }
      if (!resp.token) {
        // Statecraft says: anonymous-public path, no credential available.
        setState({
          token: null,
          status: 'anonymous',
          lastRefreshedAt: nowIso(),
          error: null,
        });
        clearTimer();
        return;
      }
      setState({
        token: resp.token,
        status: 'fresh',
        lastRefreshedAt: nowIso(),
        error: null,
      });
      // Re-arm the timer for the next expiry window.
      scheduleRefresh(resp.token.expires_at, refresh);
    } catch (err) {
      setState({
        token: null,
        status: 'error',
        lastRefreshedAt: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [projectId, scheduleRefresh, clearTimer]);

  const invalidate = useCallback(async (): Promise<void> => {
    if (!projectId) return;
    // Drop the cached token before re-fetch so a stale 401-causing
    // credential cannot be picked up by a concurrent factory run.
    try {
      await api.cloneTokenClear(projectId);
    } catch (err) {
      // Non-fatal — proceed with the refresh attempt anyway.
      // eslint-disable-next-line no-console
      console.warn(
        '[useCloneTokenRefresh] keychain clear during invalidate failed',
        err
      );
    }
    // Capture the token source *before* the refresh because if Statecraft
    // re-resolves the same broken PAT we want to mark it pat_invalid.
    const previousSource = state.token?.source;
    await refresh();
    setState((s) => {
      // After invalidate + refresh, if the resolver still returned a PAT
      // (same long-lived secret), surface pat_invalid so the cockpit
      // tells the user to rotate it on statecraft instead of cycling
      // forever. Installation tokens have already been re-minted at
      // this point, so they are simply 'fresh'.
      if (
        s.status === 'fresh' &&
        s.token?.source === 'project_github_pat' &&
        previousSource === 'project_github_pat'
      ) {
        return {
          ...s,
          status: 'pat_invalid',
          error:
            'GitHub rejected this project PAT. Rotate it on Statecraft and try again.',
        };
      }
      return s;
    });
  }, [projectId, refresh, state.token?.source]);

  const clear = useCallback(async (): Promise<void> => {
    clearTimer();
    if (!projectId) return;
    await api.cloneTokenClear(projectId);
    setState(INITIAL_STATE);
  }, [projectId, clearTimer]);

  // Persist the initial token from the bundle. Re-runs whenever the
  // bundle's project or token changes (e.g. user switches handoffs).
  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setState(INITIAL_STATE);
      clearTimer();
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      if (!initialToken) {
        // No token in the bundle = anonymous-public clone path.
        setState({
          token: null,
          status: 'anonymous',
          lastRefreshedAt: nowIso(),
          error: null,
        });
        try {
          await api.cloneTokenClear(projectId);
        } catch (err) {
          // Non-fatal: clearing a slot that doesn't exist is a no-op.
          // eslint-disable-next-line no-console
          console.warn(
            '[useCloneTokenRefresh] keychain clear (no token) failed',
            err
          );
        }
        return;
      }
      try {
        await api.cloneTokenStore(
          projectId,
          initialToken.value,
          initialToken.source,
          initialToken.expiresAt
        );
        if (cancelled) return;
        setState({
          token: {
            value: initialToken.value,
            source: initialToken.source,
            expires_at: initialToken.expiresAt,
          },
          status: 'fresh',
          lastRefreshedAt: nowIso(),
          error: null,
        });
        scheduleRefresh(initialToken.expiresAt, refresh);
      } catch (err) {
        if (cancelled) return;
        setState({
          token: null,
          status: 'error',
          lastRefreshedAt: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deps deliberately do NOT include `initialToken?.expiresAt`. The
    // expiry is only used downstream to schedule the refresh timer
    // (which `refresh` re-arms anyway after a successful re-fetch).
    // Including it here would cause storage thrash on every parent
    // render — callers commonly rebuild the bundle object inline, and
    // a fresh `new Date()` for `expiresAt` would re-fire the effect
    // on every render, racing with `refresh`'s setState calls.
    //
    // refresh/scheduleRefresh are stable through their own deps; the
    // ESLint suppression is for the missing-dep warning on those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, initialToken?.value, initialToken?.source]);

  // Tear down the timer on unmount.
  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  return {
    ...state,
    refresh,
    invalidate,
    clear,
  };
}

// Exposed for unit tests. Pure, deterministic.
export const __test__ = { refreshDelayMs };
