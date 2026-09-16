import React from 'react';
import { Badge } from '@opc/ui/badge';

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  Completed: {
    label: 'Promotion Eligible',
    variant: 'outline',
    className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  },
  CompletedLocal: {
    label: 'Local Only',
    variant: 'outline',
    className: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  },
  Running: {
    label: 'Running',
    variant: 'default',
  },
  Failed: {
    label: 'Failed',
    variant: 'destructive',
  },
  TimedOut: {
    label: 'Timed Out',
    variant: 'destructive',
  },
  AwaitingCheckpoint: {
    label: 'Awaiting Checkpoint',
    variant: 'secondary',
  },
};

export const PromotionBadge: React.FC<{ status: string }> = ({ status }) => {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: 'secondary' as const };
  return (
    <Badge variant={config.variant} className={config.className}>
      {config.label}
    </Badge>
  );
};
