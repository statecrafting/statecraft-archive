import React from 'react';
import type { CallGraphSummary } from './types';

interface Props {
  callGraphSummary?: CallGraphSummary;
}

const MAX_ENTRY_POINTS = 20;

export const XrayCallGraph: React.FC<Props> = ({ callGraphSummary }) => {
  if (!callGraphSummary) return null;

  const { totalFunctions, totalEdges, entryPoints } = callGraphSummary;
  const shown = entryPoints.slice(0, MAX_ENTRY_POINTS);
  const remaining = entryPoints.length - shown.length;

  return (
    <details className="border rounded-md">
      <summary className="px-3 py-2 text-sm font-medium cursor-pointer hover:bg-muted/50">
        Call graph — {totalFunctions} functions, {totalEdges} edges
      </summary>
      <div className="px-3 pb-3">
        <div className="text-xs text-muted-foreground mb-2">
          Entry points ({entryPoints.length})
        </div>
        {shown.length > 0 ? (
          <ul className="max-h-32 overflow-auto text-xs font-mono space-y-0.5">
            {shown.map((ep) => (
              <li key={ep} className="px-1 py-0.5 rounded hover:bg-muted/50 break-all">
                {ep}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-xs text-muted-foreground">No entry points detected.</div>
        )}
        {remaining > 0 && (
          <div className="text-xs text-muted-foreground mt-1">
            and {remaining} more
          </div>
        )}
      </div>
    </details>
  );
};
