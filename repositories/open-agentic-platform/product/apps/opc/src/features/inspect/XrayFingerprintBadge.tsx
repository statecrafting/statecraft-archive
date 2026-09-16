import React from 'react';
import { Badge } from '@opc/ui/badge';
import type { Fingerprint } from './types';

interface Props {
  fingerprint?: Fingerprint;
  schemaVersion: string;
}

export const XrayFingerprintBadge: React.FC<Props> = ({ fingerprint, schemaVersion }) => {
  if (!fingerprint) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Badge>{fingerprint.classification}</Badge>
      <Badge variant="outline">{fingerprint.primaryLanguage}</Badge>
      <Badge variant="outline">{fingerprint.sizeBucket}</Badge>
      <Badge variant="outline" className="font-mono text-[10px]">
        {fingerprint.ecosystemCount} ecosystem{fingerprint.ecosystemCount !== 1 ? 's' : ''}
      </Badge>
      {schemaVersion && (
        <span className="text-[10px] text-muted-foreground ml-auto font-mono">
          schema {schemaVersion}
        </span>
      )}
    </div>
  );
};
