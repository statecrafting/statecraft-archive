import { useCallback, useState } from 'react';
import { apiCall } from '@/lib/apiAdapter';

export interface EnrichedFeature {
  feature_id: string;
  title: string;
  status: string;
  implementation: string;
  owner: string;
  spec_path: string;
  depends_on: string[];
  impl_file_count: number;
  test_file_count: number;
  total_loc: number;
  max_complexity: number;
  avg_complexity: number;
  total_functions: number;
  test_loc: number;
  test_coverage_ratio: number;
}

export interface PortfolioAggregates {
  totalFeatures: number;
  totalLoc: number;
  avgTestCoverage: number;
  byStatus: Record<string, number>;
  byRisk: Record<string, number>;
}

export interface PortfolioOverview {
  features: EnrichedFeature[];
  aggregates: PortfolioAggregates;
}

export type PortfolioState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: PortfolioOverview }
  | { status: 'error'; message: string };

export function usePortfolioData() {
  const [state, setState] = useState<PortfolioState>({ status: 'idle' });

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  const load = useCallback(async (repoRoot: string) => {
    setState({ status: 'loading' });
    try {
      const data = await apiCall<PortfolioOverview>('portfolio_overview', {
        repoRoot: repoRoot.trim(),
      });
      setState({ status: 'success', data });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: 'error', message });
    }
  }, []);

  return { state, load, reset };
}
