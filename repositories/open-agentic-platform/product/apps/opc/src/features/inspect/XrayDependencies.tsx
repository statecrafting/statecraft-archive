import React from 'react';
import { Badge } from '@opc/ui/badge';
import type { DependencyInventory } from './types';

interface Props {
  dependencies?: DependencyInventory;
}

export const XrayDependencies: React.FC<Props> = ({ dependencies }) => {
  if (!dependencies) return null;

  const ecosystemEntries = Object.entries(dependencies.ecosystems);
  if (ecosystemEntries.length === 0) return null;

  return (
    <details className="border rounded-md">
      <summary className="px-3 py-2 text-sm font-medium cursor-pointer hover:bg-muted/50">
        Dependencies ({dependencies.totalDirect} direct, {dependencies.totalDev} dev)
      </summary>
      <div className="px-3 pb-3 space-y-2">
        {ecosystemEntries.map(([ecosystem, deps]) => (
          <details key={ecosystem} className="border rounded-md">
            <summary className="px-2 py-1.5 text-xs font-medium cursor-pointer hover:bg-muted/50">
              {ecosystem} ({deps.length})
            </summary>
            <ul className="text-xs max-h-48 overflow-auto">
              {deps.map((dep) => (
                <li
                  key={`${dep.name}-${dep.sourceFile}`}
                  className="flex items-center gap-2 px-2 py-1 border-t"
                >
                  <span className="font-medium">{dep.name}</span>
                  {dep.version && (
                    <span className="text-muted-foreground font-mono text-[10px]">{dep.version}</span>
                  )}
                  {dep.devOnly && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0">dev</Badge>
                  )}
                  <span className="ml-auto text-muted-foreground font-mono text-[10px]">
                    {dep.sourceFile}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </details>
  );
};
