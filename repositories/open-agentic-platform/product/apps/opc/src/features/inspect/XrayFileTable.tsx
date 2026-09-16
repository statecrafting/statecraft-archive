import React, { useMemo } from 'react';
import { Badge } from '@opc/ui/badge';
import type { XrayFileNode } from './types';

interface Props {
  files: XrayFileNode[];
  changedFiles?: string[];
}

const MAX_DISPLAY = 200;

export const XrayFileTable: React.FC<Props> = ({ files, changedFiles }) => {
  const changedSet = useMemo(
    () => (changedFiles ? new Set(changedFiles) : null),
    [changedFiles],
  );

  const hasAnyFunctions = files.some((f) => f.functions != null);
  const hasAnyMaxDepth = files.some((f) => f.maxDepth != null);
  const displayed = files.slice(0, MAX_DISPLAY);

  return (
    <div className="flex-1 min-h-0 border rounded-md">
      <div className="px-3 py-2 border-b text-xs text-muted-foreground flex items-center justify-between">
        <span>Indexed files ({files.length})</span>
        {files.length > MAX_DISPLAY && (
          <span className="text-[10px]">showing first {MAX_DISPLAY}</span>
        )}
      </div>
      <div className="max-h-[40vh] overflow-auto">
        {displayed.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">No files indexed.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b">
                <th className="text-left font-medium p-2">Path</th>
                <th className="text-left font-medium p-2">Lang</th>
                <th className="text-right font-medium p-2">LOC</th>
                <th className="text-right font-medium p-2">Complexity</th>
                {hasAnyFunctions && <th className="text-right font-medium p-2">Fns</th>}
                {hasAnyMaxDepth && <th className="text-right font-medium p-2">Depth</th>}
                <th className="text-right font-medium p-2">Bytes</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((file, idx) => {
                const isChanged = changedSet?.has(file.path) ?? false;
                return (
                  <tr key={`${file.path}-${idx}`} className="border-b last:border-b-0">
                    <td className="p-2 font-mono break-all">
                      {file.path}
                      {isChanged && (
                        <Badge variant="destructive" className="text-[9px] ml-1 px-1 py-0">
                          changed
                        </Badge>
                      )}
                    </td>
                    <td className="p-2">{file.lang}</td>
                    <td className="p-2 text-right">{file.loc}</td>
                    <td className="p-2 text-right">{file.complexity}</td>
                    {hasAnyFunctions && (
                      <td className="p-2 text-right">{file.functions ?? '-'}</td>
                    )}
                    {hasAnyMaxDepth && (
                      <td className="p-2 text-right">{file.maxDepth ?? '-'}</td>
                    )}
                    <td className="p-2 text-right">{file.size}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
