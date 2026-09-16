import type { GovernanceState } from './useGovernanceStatus';
import { useGitCtxResourceEnrichment } from '../git/useGitCtxEnrichment';

/**
 * Git context enrichment for the governance overview panel.
 * Registry + featuregraph remain authoritative; this is additive git context
 * provided via axiomregent GitHub tools.
 */
export function useGovernanceCtxEnrichment(repoRoot: string, state: GovernanceState) {
  const shouldFetch =
    !!repoRoot.trim() && (state.status === 'success' || state.status === 'degraded');
  return useGitCtxResourceEnrichment(repoRoot, shouldFetch);
}
