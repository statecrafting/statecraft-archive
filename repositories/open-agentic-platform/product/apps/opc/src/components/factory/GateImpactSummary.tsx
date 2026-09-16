// Spec: specs/171-opc-structural-diff-plan-ui/spec.md
// FR-003 — rolled-up gate-impact preview surface.
//
// Rolled-up gate-impact preview shown at the head of the plan review
// surface. The per-action badges live on each PlanActionRow; this
// component surfaces the aggregate so the human sees the worst-case
// posture before drilling into individual actions.

import React from 'react';
import { AlertTriangle, XCircle, ShieldCheck, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@opc/ui/badge';
import { summarizeGateImpact } from './planAnalysis';
import type { AgentPlan } from './planTypes';

export interface GateImpactSummaryProps {
  plan: AgentPlan;
}

export const GateImpactSummary: React.FC<GateImpactSummaryProps> = ({ plan }) => {
  const summary = summarizeGateImpact(plan);
  const Icon =
    summary.worst === 'fail'
      ? XCircle
      : summary.worst === 'warn'
        ? AlertTriangle
        : ShieldCheck;
  const tone =
    summary.worst === 'fail'
      ? 'border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400'
      : summary.worst === 'warn'
        ? 'border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-400'
        : 'border-emerald-500/40 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400';

  return (
    <section
      data-testid="gate-impact-summary"
      data-worst={summary.worst}
      className={cn(
        'rounded-lg border px-3 py-2 flex flex-wrap items-center gap-3 text-sm',
        tone,
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="font-medium">
        {summary.worst === 'fail'
          ? 'One or more actions will fail a gate.'
          : summary.worst === 'warn'
            ? 'One or more actions warn against a gate.'
            : 'Predicted to pass all gates.'}
      </span>
      <span className="ml-auto flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          data-testid="gate-impact-fail-count"
          className="text-[10px] font-mono border-red-500/40 text-red-600 dark:text-red-400"
        >
          fail · {summary.failCount}
        </Badge>
        <Badge
          variant="outline"
          data-testid="gate-impact-warn-count"
          className="text-[10px] font-mono border-amber-500/40 text-amber-600 dark:text-amber-400"
        >
          warn · {summary.warnCount}
        </Badge>
        <Badge
          variant="outline"
          data-testid="gate-impact-total-count"
          className="text-[10px] font-mono"
        >
          actions · {summary.total}
        </Badge>
        {summary.criticalCount > 0 && (
          <Badge
            variant="outline"
            data-testid="gate-impact-critical-count"
            className="text-[10px] font-mono border-red-500/50 text-red-600 dark:text-red-400 flex items-center gap-1"
          >
            <ShieldAlert className="h-3 w-3" />
            M-of-N · {summary.criticalCount}
          </Badge>
        )}
      </span>
    </section>
  );
};
