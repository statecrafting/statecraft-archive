import type { GitContextViewState, GitCtxEnrichment } from './types';

export type GitCtxEnrichmentState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: GitCtxEnrichment }
  | { status: 'degraded'; message: string };

/**
 * Gracefully-degraded stub: the gitctx-mcp binary has been removed (Phase 6).
 * GitHub enrichment is now provided via axiomregent GitHub tools.
 * Both hooks return `idle` immediately so callers continue to render without errors.
 * @see spec 073-axiomregent-unification
 */
export function useGitCtxResourceEnrichment(_repoPath: string, _shouldFetch: boolean): GitCtxEnrichmentState {
  return { status: 'idle' };
}

/**
 * Additive GitHub enrichment layered on native git context.
 * Routes through axiomregent GitHub tools; returns idle when unavailable.
 */
export function useGitCtxEnrichment(repoPath: string, baseState: GitContextViewState): GitCtxEnrichmentState {
  const shouldFetch =
    !!repoPath.trim() && (baseState.status === 'success' || baseState.status === 'degraded');
  return useGitCtxResourceEnrichment(repoPath, shouldFetch);
}
