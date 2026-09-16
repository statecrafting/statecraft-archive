import { useCallback, useState } from 'react';
import { apiCall } from '@/lib/apiAdapter';

export interface WorkflowStateSummary {
  workflow_id: string;
  workflow_name: string;
  status: string;
  started_at: string;
  org_id: string | null;
}

export type PromotionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; workflows: WorkflowStateSummary[] }
  | { status: 'error'; message: string };

export function usePromotionData() {
  const [state, setState] = useState<PromotionState>({ status: 'idle' });

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  const load = useCallback(async (orgId: string) => {
    setState({ status: 'loading' });
    try {
      const workflows = await apiCall<WorkflowStateSummary[]>(
        'list_workspace_workflows',
        { orgId: orgId.trim(), limit: 50 },
      );
      setState({ status: 'success', workflows });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: 'error', message });
    }
  }, []);

  return { state, load, reset };
}
