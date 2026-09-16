import React from 'react';
import { FolderOpen } from 'lucide-react';
import { Badge } from '@opc/ui/badge';

interface Props {
  topDirs: Record<string, number>;
}

export const XrayTopDirs: React.FC<Props> = ({ topDirs }) => {
  const entries = Object.entries(topDirs).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) return null;

  return (
    <div className="border rounded-md p-3">
      <div className="text-xs text-muted-foreground mb-2">Top directories</div>
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([dir, count]) => (
          <Badge key={dir} variant="outline" className="text-[11px] gap-1">
            <FolderOpen className="h-3 w-3" aria-hidden />
            {dir} {count}
          </Badge>
        ))}
      </div>
    </div>
  );
};
