import React from 'react';

interface Props {
  root: string;
  target: string;
  fileCount: number;
  totalSize: number;
}

export const XrayStatCards: React.FC<Props> = ({ root, target, fileCount, totalSize }) => (
  <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
    <div className="border rounded-md bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">Root</div>
      <div className="font-mono break-all">{root || 'n/a'}</div>
    </div>
    <div className="border rounded-md bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">Target</div>
      <div className="font-mono break-all">{target || 'n/a'}</div>
    </div>
    <div className="border rounded-md bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">Files</div>
      <div>{fileCount}</div>
    </div>
    <div className="border rounded-md bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">Total bytes</div>
      <div>{totalSize}</div>
    </div>
  </div>
);
