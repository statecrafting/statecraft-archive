// Spec: specs/076-factory-desktop-panel/spec.md
// Vertical DAG visualization of Factory pipeline stages (s0–s5) plus scaffolding.

import React, { useState } from 'react';
import {
  CheckCircle2,
  Circle,
  Loader2,
  PauseCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFactoryPipeline } from './FactoryPipelineContext';
import type {
  StageStatus,
  ScaffoldCategoryProgress,
  ScaffoldStep,
} from './types';
import { SCAFFOLD_CATEGORY_LABELS } from './types';

// ── Status helpers ───────────────────────────────────────────────────────────

const STATUS_ICON_CLASS: Record<StageStatus, string> = {
  pending: 'text-muted-foreground',
  in_progress: 'text-blue-400',
  completed: 'text-green-400',
  failed: 'text-red-400',
  awaiting_gate: 'text-amber-400',
  skipped: 'text-muted-foreground/50',
};

const STATUS_LABEL_CLASS: Record<StageStatus, string> = {
  pending: 'text-muted-foreground',
  in_progress: 'text-foreground',
  completed: 'text-foreground',
  failed: 'text-red-400',
  awaiting_gate: 'text-amber-400',
  skipped: 'text-muted-foreground/50 line-through',
};

function StatusIcon({
  status,
  className,
}: {
  status: StageStatus;
  className?: string;
}) {
  const base = cn('h-4 w-4 shrink-0', STATUS_ICON_CLASS[status], className);

  switch (status) {
    case 'in_progress':
      return <Loader2 className={cn(base, 'animate-spin')} />;
    case 'completed':
      return <CheckCircle2 className={base} />;
    case 'failed':
      return <XCircle className={base} />;
    case 'awaiting_gate':
      return <PauseCircle className={base} />;
    default:
      return <Circle className={base} />;
  }
}

// ── Scaffold step row ────────────────────────────────────────────────────────

const ScaffoldStepRow: React.FC<{ step: ScaffoldStep }> = ({ step }) => (
  <div className="flex items-center gap-2 pl-4 py-0.5">
    <StatusIcon status={step.status} className="h-3 w-3" />
    <span
      className={cn(
        'text-xs truncate flex-1',
        STATUS_LABEL_CLASS[step.status],
      )}
      title={step.featureName}
    >
      {step.featureName}
    </span>
    {step.retryCount > 0 && (
      <span className="text-xs text-amber-400 shrink-0">
        ×{step.retryCount}
      </span>
    )}
    {step.lastError && (
      <span className="text-xs text-red-400 shrink-0" title={step.lastError}>
        !
      </span>
    )}
  </div>
);

// ── Scaffold category group node ─────────────────────────────────────────────

const ScaffoldGroupNode: React.FC<{ cat: ScaffoldCategoryProgress }> = ({
  cat,
}) => {
  const [expanded, setExpanded] = useState(false);
  const pct = cat.total > 0 ? (cat.completed / cat.total) * 100 : 0;
  const label = SCAFFOLD_CATEGORY_LABELS[cat.category];

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 py-1 hover:bg-muted/30 rounded px-1 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="text-xs text-muted-foreground w-28 shrink-0 truncate">
          {label}
        </span>
        <div className="flex-1 flex items-center gap-2 min-w-0">
          {/* Progress bar */}
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-green-400 rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {cat.completed}/{cat.total}
          </span>
          {cat.failed > 0 && (
            <span className="text-xs text-red-400 shrink-0">
              {cat.failed} failed
            </span>
          )}
        </div>
      </button>

      {expanded && cat.steps.length > 0 && (
        <div className="ml-2 border-l border-border/50 mt-0.5 mb-1">
          {cat.steps.map((step) => (
            <ScaffoldStepRow key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main DAG component ───────────────────────────────────────────────────────

export const PipelineDAG: React.FC = () => {
  const { state, selectStep } = useFactoryPipeline();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-0">
      {/* Process stages s0–s5 */}
      {state.stages.map((stage, idx) => {
        const isSelected = state.selectedStepId === stage.id;
        const isLast = idx === state.stages.length - 1;

        return (
          <div key={stage.id} className="relative">
            {/* Vertical connector line (not drawn after last stage) */}
            {!isLast && (
              <div className="absolute left-[18px] top-8 bottom-0 w-px border-l border-border/50" />
            )}

            <button
              onClick={() => selectStep(isSelected ? null : stage.id)}
              className={cn(
                'relative z-10 w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                'hover:bg-muted/40',
                isSelected &&
                  'bg-muted/60 ring-1 ring-primary/40',
              )}
            >
              <StatusIcon status={stage.status} />
              <span
                className={cn(
                  'text-sm font-medium flex-1 truncate',
                  STATUS_LABEL_CLASS[stage.status],
                )}
              >
                {stage.name}
              </span>
              {stage.tokenSpend > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {stage.tokenSpend.toLocaleString()}t
                </span>
              )}
            </button>
          </div>
        );
      })}

      {/* Divider */}
      <div className="my-2 border-t border-border/50" />

      {/* Scaffolding section */}
      {state.scaffolding === null ? (
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" />
          <span className="text-sm text-muted-foreground/50">
            Scaffolding (pending)
          </span>
        </div>
      ) : (
        <div className="space-y-0.5 px-1">
          <div className="flex items-center gap-2 px-1 py-1">
            <Loader2 className="h-4 w-4 shrink-0 text-blue-400 animate-spin" />
            <span className="text-sm font-medium text-foreground">
              Scaffolding
            </span>
          </div>
          <div className="ml-6 space-y-0.5">
            {state.scaffolding.categories.map((cat) => (
              <ScaffoldGroupNode key={cat.category} cat={cat} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
