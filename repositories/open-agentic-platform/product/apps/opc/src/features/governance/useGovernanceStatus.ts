import { useCallback, useState } from 'react';
import { apiCall } from '@/lib/apiAdapter';

export interface GovernanceOverview {
  status: 'success' | 'degraded';
  repoRoot: string;
  registry: {
    status: 'ok' | 'unavailable';
    path: string;
    message?: string;
    summary?: {
      featureCount: number;
      validationPassed: boolean;
      violationsCount: number;
      statusCounts: Record<string, number>;
      /** Present when registry was compiled with per-feature spec paths (Feature 032 follow-up actions). */
      featureSummaries?: Array<{ id: string; title: string; specPath: string }>;
    };
  };
  featuregraph: {
    status: 'ok' | 'unavailable';
    message?: string;
    summary?: {
      featureCount: number;
      violationsCount: number;
    };
  };
}

export type GovernanceState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: GovernanceOverview }
  | { status: 'degraded'; data: GovernanceOverview; reason: string }
  | { status: 'error'; message: string };

function toErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function describeDegraded(data: GovernanceOverview): string {
  const reasons: string[] = [];
  if (data.registry.status !== 'ok') reasons.push('compiled registry unavailable');
  if (data.featuregraph.status !== 'ok') reasons.push('featuregraph overview unavailable');
  return reasons.length > 0 ? reasons.join('; ') : 'governance data degraded';
}

export function useGovernanceStatus() {
  const [state, setState] = useState<GovernanceState>({ status: 'idle' });

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  const load = useCallback(async (repoRoot: string) => {
    setState({ status: 'loading' });
    try {
      const data = await apiCall<GovernanceOverview>('featuregraph_overview', {
        featuresYamlPath: repoRoot.trim(),
      });
      if (data.status === 'degraded') {
        setState({ status: 'degraded', data, reason: describeDegraded(data) });
      } else {
        setState({ status: 'success', data });
      }
    } catch (err) {
      setState({ status: 'error', message: toErrorMessage(err) });
    }
  }, []);

  return { state, load, reset };
}
