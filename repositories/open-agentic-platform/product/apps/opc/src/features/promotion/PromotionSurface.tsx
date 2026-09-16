import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@opc/ui/button';
import { usePromotionData } from './usePromotionData';
import { PromotionBadge } from './PromotionBadge';

interface PromotionSurfaceProps {
  projectPath?: string;
}

export const PromotionSurface: React.FC<PromotionSurfaceProps> = ({ projectPath }) => {
  const [orgId, setOrgId] = useState('');
  const { state, load, reset } = usePromotionData();
  const autoLoaded = useRef(false);
  const busy = state.status === 'loading';

  // Auto-load if projectPath is provided (use it as workspace hint).
  useEffect(() => {
    if (projectPath && !autoLoaded.current) {
      autoLoaded.current = true;
      // Use the last path segment as a workspace ID hint.
      const segments = projectPath.replace(/\/+$/, '').split('/');
      const hint = segments[segments.length - 1] || projectPath;
      setOrgId(hint);
    }
  }, [projectPath]);

  return (
    <div className="p-6 h-full flex flex-col gap-4 text-foreground">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Promotion Eligibility</h1>
        <p className="text-sm text-muted-foreground">
          View workflow promotion status. Fully synced runs are eligible for platform promotion;
          local-only runs need governance and platform sync to qualify.
        </p>
      </header>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={orgId}
          onChange={e => setOrgId(e.target.value)}
          placeholder="Org ID"
          className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
        <Button size="sm" onClick={() => void load(orgId)} disabled={busy || !orgId.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load'}
        </Button>
        {state.status !== 'idle' && (
          <Button size="sm" variant="ghost" onClick={reset}>Clear</Button>
        )}
      </div>

      {state.status === 'error' && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="h-4 w-4" />
          {state.message}
        </div>
      )}

      {state.status === 'success' && (
        <div className="flex-1 overflow-auto space-y-2">
          {state.workflows.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No workflows found for this org.
            </div>
          ) : (
            state.workflows.map(wf => (
              <div
                key={wf.workflow_id}
                className="border rounded-md p-3 bg-muted/30 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{wf.workflow_name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span className="font-mono">{wf.workflow_id.slice(0, 8)}</span>
                    <span>{wf.started_at}</span>
                  </div>
                </div>
                <PromotionBadge status={wf.status} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
