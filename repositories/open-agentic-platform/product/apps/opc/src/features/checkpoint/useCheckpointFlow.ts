import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Checkpoint, CheckpointDiff, VerificationReport } from './types';

export type FlowStatus = 'idle' | 'initializing' | 'ready' | 'error';

export interface CheckpointFlowState {
  status: FlowStatus;
  projectRoot: string;
  checkpoints: Checkpoint[];
  error: string | null;
  /** Per-operation busy flags so the list remains visible during sub-ops. */
  busy: {
    creating: boolean;
    restoring: string | null;
    verifying: string | null;
    diffing: boolean;
  };
  /** Last diff result, cleared on new diff request. */
  diff: CheckpointDiff | null;
  /** Last verification result keyed by checkpoint id. */
  verifications: Record<string, VerificationReport>;
}

const INITIAL_BUSY = { creating: false, restoring: null, verifying: null, diffing: false };

const initialState: CheckpointFlowState = {
  status: 'idle',
  projectRoot: '',
  checkpoints: [],
  error: null,
  busy: { ...INITIAL_BUSY },
  diff: null,
  verifications: {},
};

/**
 * Call an axiomregent checkpoint tool via the MCP sidecar proxy.
 *
 * This is the single integration point between the frontend and
 * axiomregent's checkpoint.* MCP tools.
 */
async function callCheckpointTool<T>(toolName: string, args: Record<string, unknown>): Promise<T> {
  const result = await invoke<{ content: Array<{ json: T }> }>('mcp_call_tool', {
    server: 'axiomregent',
    toolName,
    args,
  });
  // MCP tool results are wrapped in content[].json
  return result.content[0].json;
}

export function useCheckpointFlow() {
  const [state, setState] = useState<CheckpointFlowState>(initialState);

  const setError = useCallback((error: string) => {
    setState(prev => ({ ...prev, status: 'error', error, busy: { ...INITIAL_BUSY } }));
  }, []);

  const refreshList = useCallback(async (rootPath: string) => {
    try {
      const result = await callCheckpointTool<{ checkpoints: Checkpoint[] }>(
        'checkpoint.list',
        { repo_root: rootPath },
      );
      const sorted = [...result.checkpoints].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setState(prev => ({ ...prev, checkpoints: sorted }));
    } catch (err) {
      setError(String(err));
    }
  }, [setError]);

  const initialize = useCallback(async (rootPath: string) => {
    setState(prev => ({ ...prev, status: 'initializing', projectRoot: rootPath, error: null }));
    try {
      // axiomregent manages checkpoint storage automatically — just fetch the list
      const result = await callCheckpointTool<{ checkpoints: Checkpoint[] }>(
        'checkpoint.list',
        { repo_root: rootPath },
      );
      const sorted = [...result.checkpoints].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setState(prev => ({
        ...prev,
        status: 'ready',
        projectRoot: rootPath,
        checkpoints: sorted,
        error: null,
      }));
    } catch (err) {
      setError(String(err));
    }
  }, [setError]);

  const createCheckpoint = useCallback(async (label?: string) => {
    setState(prev => ({ ...prev, busy: { ...prev.busy, creating: true } }));
    try {
      await callCheckpointTool('checkpoint.create', {
        repo_root: state.projectRoot,
        label: label || null,
      });
      await refreshList(state.projectRoot);
    } catch (err) {
      setError(String(err));
    } finally {
      setState(prev => ({ ...prev, busy: { ...prev.busy, creating: false } }));
    }
  }, [state.projectRoot, refreshList, setError]);

  const restore = useCallback(async (checkpointId: string) => {
    setState(prev => ({ ...prev, busy: { ...prev.busy, restoring: checkpointId } }));
    try {
      await callCheckpointTool('checkpoint.restore', {
        repo_root: state.projectRoot,
        checkpoint_id: checkpointId,
      });
      await refreshList(state.projectRoot);
    } catch (err) {
      setError(String(err));
    } finally {
      setState(prev => ({ ...prev, busy: { ...prev.busy, restoring: null } }));
    }
  }, [state.projectRoot, refreshList, setError]);

  const diff = useCallback(async (id1: string, id2: string) => {
    setState(prev => ({ ...prev, busy: { ...prev.busy, diffing: true }, diff: null }));
    try {
      const result = await callCheckpointTool<CheckpointDiff>('checkpoint.diff', {
        from_checkpoint_id: id1,
        to_checkpoint_id: id2,
      });
      setState(prev => ({ ...prev, diff: result, busy: { ...prev.busy, diffing: false } }));
    } catch (err) {
      setError(String(err));
    }
  }, [setError]);

  const verify = useCallback(async (checkpointId: string) => {
    setState(prev => ({ ...prev, busy: { ...prev.busy, verifying: checkpointId } }));
    try {
      const report = await callCheckpointTool<VerificationReport>('checkpoint.verify', {
        checkpoint_id: checkpointId,
      });
      setState(prev => ({
        ...prev,
        verifications: { ...prev.verifications, [checkpointId]: report },
        busy: { ...prev.busy, verifying: null },
      }));
    } catch (err) {
      setError(String(err));
    }
  }, [setError]);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  return { state, initialize, createCheckpoint, restore, diff, verify, reset };
}
