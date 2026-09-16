import React from 'react';
import { Badge } from '@opc/ui/badge';

interface Props {
  moduleFiles: string[];
}

export const XrayModuleFiles: React.FC<Props> = ({ moduleFiles }) => {
  if (moduleFiles.length === 0) return null;

  return (
    <div className="border rounded-md p-3">
      <div className="text-xs text-muted-foreground mb-2">Module files</div>
      <div className="flex flex-wrap gap-1.5">
        {moduleFiles.map((file) => (
          <Badge key={file} variant="outline" className="font-mono text-[11px]">
            {file}
          </Badge>
        ))}
      </div>
    </div>
  );
};
