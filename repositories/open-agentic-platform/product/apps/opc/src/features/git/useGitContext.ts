import { useCallback, useState } from 'react';
import { commands, type GitError, type GitStatusEntry } from '@/lib/bindings';
import type { GitContextData, GitContextViewState } from './types';

function formatGitError(e: GitError): string {
  switch (e.type) {
    case 'NotFound':
      return e.message;
    case 'RefNotFound':
      return e.message;
    case 'DetachedHead':
      return 'Detached HEAD';
    case 'Other':
      return e.message;
    default:
      return 'Unknown git error';
  }
}

function isDirty(entries: GitStatusEntry[]): boolean {
  return entries.length > 0;
}

export interface UseGitContextResult {
  state: GitContextViewState;
  /** Load git context for an absolute repository path. */
  refresh: (repoPath: string) => Promise<void>;
  reset: () => void;
}

/**
 * Loads branch / HEAD / cleanliness / ahead-behind using native `git_*` Tauri commands.
 */
export function useGitContext(): UseGitContextResult {
  const [state, setState] = useState<GitContextViewState>({ status: 'idle' });

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  const refresh = useCallback(async (repoPath: string) => {
    const trimmed = repoPath.trim();
    if (!trimmed) {
      setState({ status: 'idle' });
      return;
    }

    setState({ status: 'loading' });
    const warnings: string[] = [];

    const branchRes = await commands.gitCurrentBranch(trimmed);
    if (branchRes.status === 'error') {
      const err = branchRes.error;
      if (err.type === 'NotFound') {
        setState({ status: 'unavailable', message: err.message });
        return;
      }
      if (err.type === 'DetachedHead') {
        const statusRes = await commands.gitStatus(trimmed);
        if (statusRes.status === 'error') {
          setState({ status: 'error', message: formatGitError(statusRes.error) });
          return;
        }
        const data: GitContextData = {
          repoPath: trimmed,
          branch: null,
          detached: true,
          ahead: 0,
          behind: 0,
          workingTreeDirty: isDirty(statusRes.data),
          statusEntries: statusRes.data,
          upstreamResolved: false,
        };
        setState({ status: 'success', data });
        return;
      }
      setState({ status: 'error', message: formatGitError(err) });
      return;
    }

    const branchName = branchRes.data;
    const statusRes = await commands.gitStatus(trimmed);
    if (statusRes.status === 'error') {
      setState({ status: 'error', message: formatGitError(statusRes.error) });
      return;
    }

    const entries = statusRes.data;
    let ahead = 0;
    let behind = 0;
    let upstreamResolved = true;

    const abRes = await commands.gitAheadBehind(trimmed, branchName);
    if (abRes.status === 'error') {
      warnings.push(`Ahead/behind: ${formatGitError(abRes.error)}`);
      upstreamResolved = false;
    } else {
      ahead = abRes.data.ahead;
      behind = abRes.data.behind;
    }

    const data: GitContextData = {
      repoPath: trimmed,
      branch: branchName,
      detached: false,
      ahead,
      behind,
      workingTreeDirty: isDirty(entries),
      statusEntries: entries,
      upstreamResolved,
    };

    if (warnings.length > 0) {
      setState({ status: 'degraded', data, warnings });
    } else {
      setState({ status: 'success', data });
    }
  }, []);

  return { state, refresh, reset };
}
