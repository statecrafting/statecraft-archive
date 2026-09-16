import React from 'react';
import { Badge } from '@opc/ui/badge';

interface Props {
  languages: Record<string, number>;
}

export const XrayLanguages: React.FC<Props> = ({ languages }) => {
  const entries = Object.entries(languages).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) return null;

  return (
    <div className="border rounded-md p-3">
      <div className="text-xs text-muted-foreground mb-2">Languages</div>
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([lang, count]) => (
          <Badge key={lang} variant="secondary" className="text-[11px]">
            {lang} {count}
          </Badge>
        ))}
      </div>
    </div>
  );
};
