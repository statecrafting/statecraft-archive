// Spec 112 §6.3 — in-OPC project opener.
//
// Mirrors the resolve→clone→open sequence that ProjectOpenInbox runs after
// a deep-link handoff, but starts from a `projectId` the caller already has
// (e.g. a row in the duplex-synced project catalog). Lets the Factory tab
// open any synced project without going through statecraft's success page.

import { useCallback, useState } from 'react';
import { apiCall } from '@/lib/apiAdapter';
import { api } from '@/lib/api';
import type { OpcBundle } from '@/types/factoryBundle';

export type FactoryOpenerStatus =
  | 'idle'
  | 'resolving'
  | 'cloning'
  | 'done'
  | 'error';

export interface FactoryOpenerState {
  status: FactoryOpenerStatus;
  /** Human-readable progress label for the active step. */
  step: string | null;
  error: string | null;
  result: { path: string; bundle: OpcBundle; alreadyCloned: boolean } | null;
}

export interface UseFactoryProjectOpener extends FactoryOpenerState {
  /** Resolve the bundle, clone the repo, and return the resolved tuple. */
  open: (
    projectId: string,
  ) => Promise<{ path: string; bundle: OpcBundle; alreadyCloned: boolean } | null>;
  reset: () => void;
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

const PROJECTS_SUBDIR = 'oap-projects';

function joinPath(parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

const INITIAL: FactoryOpenerState = {
  status: 'idle',
  step: null,
  error: null,
  result: null,
};

export function useFactoryProjectOpener(): UseFactoryProjectOpener {
  const [state, setState] = useState<FactoryOpenerState>(INITIAL);

  const open = useCallback(async (projectId: string) => {
    setState({
      status: 'resolving',
      step: 'Resolving project bundle…',
      error: null,
      result: null,
    });

    try {
      const bundleResp = await apiCall<FetchBundleResponse>(
        'fetch_project_opc_bundle',
        { request: { project_id: projectId } },
      );
      if (!bundleResp.ok || !bundleResp.bundle) {
        throw new Error(bundleResp.error ?? 'Failed to resolve project bundle');
      }
      const bundle = bundleResp.bundle;
      if (!bundle.repo) {
        throw new Error(
          'Project has no repo configured in statecraft — connect a GitHub repo before opening it in Factory.',
        );
      }

      const homeDir = await api.getHomeDirectory();
      const targetDir = joinPath([homeDir, PROJECTS_SUBDIR, bundle.project.slug]);

      setState({
        status: 'cloning',
        step: bundle.cloneToken
          ? 'Cloning repository…'
          : 'Cloning repository (anonymous)…',
        error: null,
        result: null,
      });

      const cloneResp = await apiCall<CloneProjectResponse>(
        'clone_project_from_bundle',
        {
          request: {
            cloneUrl: bundle.repo.cloneUrl,
            targetDir,
            defaultBranch: bundle.repo.defaultBranch ?? null,
            githubToken: bundle.cloneToken?.value ?? null,
          },
        },
      );
      if (!cloneResp.ok) {
        throw new Error(cloneResp.error ?? 'Clone failed');
      }

      const result = {
        path: cloneResp.path,
        bundle,
        alreadyCloned: cloneResp.alreadyCloned,
      };
      setState({ status: 'done', step: null, error: null, result });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: 'error', step: null, error: message, result: null });
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL);
  }, []);

  return { ...state, open, reset };
}
