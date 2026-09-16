// Spec 112 §6.3 — Open-in-OPC frontend listener.
//
// Subscribes to the `project-open-request` Tauri event emitted by the
// Rust deep-link dispatcher when an `opc://project/open?...` URL
// arrives. Maintains a single "pending handoff" slot (the latest
// request wins; older unread requests are replaced) and resolves the
// statecraft bundle for it on demand.
//
// Wire shape mirrors `commands::project_open::ProjectOpenRequest`.

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiCall } from '@/lib/apiAdapter';
import type {
  OpcBundle,
  OpcBundleAdapter,
  OpcBundleAgent,
  OpcBundleContract,
  OpcBundleProcess,
  OpcBundleProject,
  OpcBundleRepo,
} from '@/types/factoryBundle';

export type {
  OpcBundle,
  OpcBundleAdapter,
  OpcBundleAgent,
  OpcBundleContract,
  OpcBundleProcess,
  OpcBundleProject,
  OpcBundleRepo,
};

export interface ProjectOpenRequest {
  projectId: string;
  cloneUrl: string;
  level?: 'scaffold_only' | 'legacy_produced' | 'acp_produced';
}

interface FetchBundleResponse {
  ok: boolean;
  bundle?: OpcBundle;
  error?: string;
}

interface CloneProjectResponse {
  ok: boolean;
  path: string;
  alreadyCloned: boolean;
  error?: string;
}

export interface CloneState {
  loading: boolean;
  path: string | null;
  alreadyCloned: boolean;
  error: string | null;
}

export interface InboxState {
  pending: ProjectOpenRequest | null;
  bundle: OpcBundle | null;
  bundleLoading: boolean;
  bundleError: string | null;
  clone: CloneState;
}

export interface InboxApi extends InboxState {
  fetchBundle: () => Promise<void>;
  /**
   * Clone the handed-off repo to `targetDir`. When `githubToken` is
   * supplied (spec 112 §6.4.3), the Tauri command rewrites the HTTPS
   * URL to embed `x-access-token:<token>@…` for the subprocess only.
   * Public-anon callers pass undefined.
   */
  cloneProject: (targetDir: string, githubToken?: string | null) => Promise<void>;
  dismiss: () => void;
}

const isTauri = (): boolean => {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  return Boolean(w.__TAURI_INTERNALS__ ?? w.__TAURI__);
};

const INITIAL_CLONE: CloneState = {
  loading: false,
  path: null,
  alreadyCloned: false,
  error: null,
};

export function useProjectOpenInbox(): InboxApi {
  const [pending, setPending] = useState<ProjectOpenRequest | null>(null);
  const [bundle, setBundle] = useState<OpcBundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [clone, setClone] = useState<CloneState>(INITIAL_CLONE);
  const lastProjectIdRef = useRef<string | null>(null);

  // Subscribe to the deep-link event. The dispatcher in lib.rs emits
  // {projectId, cloneUrl, level} per `parse_project_open_url`.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void import('@tauri-apps/api/event').then(({ listen }) => {
      if (cancelled) return;
      void listen<ProjectOpenRequest>('project-open-request', (event) => {
        const next = event.payload;
        // Skip duplicate replays (cold-launch re-dispatches the same URL).
        if (lastProjectIdRef.current === next.projectId && pending) return;
        lastProjectIdRef.current = next.projectId;
        setPending(next);
        // Reset bundle + clone slots when a new request arrives.
        setBundle(null);
        setBundleError(null);
        setClone(INITIAL_CLONE);
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchBundle = useCallback(async () => {
    if (!pending) return;
    setBundleLoading(true);
    setBundleError(null);
    try {
      const resp = await apiCall<FetchBundleResponse>(
        'fetch_project_opc_bundle',
        { request: { project_id: pending.projectId } }
      );
      if (resp.ok && resp.bundle) {
        setBundle(resp.bundle);
      } else {
        setBundleError(resp.error ?? 'unknown error fetching bundle');
      }
    } catch (err) {
      setBundleError(err instanceof Error ? err.message : String(err));
    } finally {
      setBundleLoading(false);
    }
  }, [pending]);

  const cloneProject = useCallback(
    async (targetDir: string, githubToken?: string | null) => {
      // Prefer the bundle's repo info (post-resolve) for branch hint.
      const cloneUrl = bundle?.repo?.cloneUrl ?? pending?.cloneUrl;
      if (!cloneUrl) {
        setClone({
          ...INITIAL_CLONE,
          error: 'No clone URL available for this handoff',
        });
        return;
      }
      setClone({ loading: true, path: null, alreadyCloned: false, error: null });
      try {
        const resp = await apiCall<CloneProjectResponse>(
          'clone_project_from_bundle',
          {
            request: {
              cloneUrl,
              targetDir,
              defaultBranch: bundle?.repo?.defaultBranch ?? null,
              githubToken: githubToken ?? null,
            },
          }
        );
        if (resp.ok) {
          setClone({
            loading: false,
            path: resp.path,
            alreadyCloned: resp.alreadyCloned,
            error: null,
          });
        } else {
          setClone({
            loading: false,
            path: null,
            alreadyCloned: false,
            error: resp.error ?? 'unknown clone error',
          });
        }
      } catch (err) {
        setClone({
          loading: false,
          path: null,
          alreadyCloned: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [pending, bundle]
  );

  const dismiss = useCallback(() => {
    setPending(null);
    setBundle(null);
    setBundleError(null);
    setClone(INITIAL_CLONE);
    lastProjectIdRef.current = null;
  }, []);

  return {
    pending,
    bundle,
    bundleLoading,
    bundleError,
    clone,
    fetchBundle,
    cloneProject,
    dismiss,
  };
}
