import { useCallback, useState } from 'react';
import type { InspectFlowState } from './types';
import { classifyXrayIndexPayload } from './xrayResult';
import { apiCall } from '@/lib/apiAdapter';

const DEGRADED_EMPTY_REASON =
  'Scan completed but no files were indexed for this path (empty index).';

function toErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export interface UseInspectFlowResult {
  state: InspectFlowState;
  /** Run xray scan for an absolute project path. No-op if path is blank. */
  scan: (path: string) => Promise<void>;
  /** Clear result and return to idle (path input preserved by parent). */
  reset: () => void;
}

/**
 * Inspect shell state machine for the xray-backed scan command (T003).
 */
export function useInspectFlow(): UseInspectFlowResult {
  const [state, setState] = useState<InspectFlowState>({ status: 'idle' });

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  const scan = useCallback(async (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;

    setState({ status: 'loading' });
    try {
      const payload = await apiCall<unknown>('xray_scan_project', { path: trimmed });
      if (payload === null || typeof payload !== 'object') {
        setState({
          status: 'degraded',
          payload,
          reason: 'Scan completed but returned a non-object payload.',
        });
        return;
      }

      if (classifyXrayIndexPayload(payload) === 'empty_index') {
        setState({
          status: 'degraded',
          payload,
          reason: DEGRADED_EMPTY_REASON,
        });
      } else {
        setState({ status: 'success', payload });
      }
    } catch (err) {
      setState({ status: 'error', message: toErrorMessage(err) });
    }
  }, []);

  return { state, scan, reset };
}
