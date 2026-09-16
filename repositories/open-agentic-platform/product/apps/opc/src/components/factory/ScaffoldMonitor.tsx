// Spec: specs/076-factory-desktop-panel/spec.md
// Scaffold monitor — Phase 2 fan-out progress view (FR-006).

import React from 'react';
import { ChevronDown, ChevronRight, Eye, Wrench, SkipForward } from 'lucide-react';
import { Button } from '@opc/ui/button';
import { cn } from '@/lib/utils';
import { useFactoryPipeline } from './FactoryPipelineContext';
import { LiveAgentOutput } from './LiveAgentOutput';
import {
  SCAFFOLD_CATEGORY_LABELS,
  ScaffoldCategory,
  ScaffoldCategoryProgress,
  ScaffoldStep,
} from './types';

// ── Category order ────────────────────────────────────────────────────────────

const CATEGORY_ORDER: ScaffoldCategory[] = [
  'data',
  'api',
  'ui',
  'configure',
  'trim',
  'validate',
];

// ── CategoryProgressBars ──────────────────────────────────────────────────────

interface CategoryProgressBarsProps {
  categories: ScaffoldCategoryProgress[];
}

const CategoryProgressBars: React.FC<CategoryProgressBarsProps> = ({
  categories,
}) => {
  // Index by category for O(1) lookup
  const byCategory = new Map(categories.map((c) => [c.category, c]));

  return (
    <div className="space-y-2">
      {CATEGORY_ORDER.map((cat) => {
        const data = byCategory.get(cat);
        const label = SCAFFOLD_CATEGORY_LABELS[cat];

        if (!data || data.total === 0) {
          // Category not yet started
          return (
            <div key={cat} className="flex items-center gap-3">
              <span className="w-36 shrink-0 text-xs text-muted-foreground">
                {label}
              </span>
              <div className="flex-1 h-2 rounded-full bg-muted" />
              <span className="text-xs text-muted-foreground w-20 shrink-0">
                pending
              </span>
            </div>
          );
        }

        const completedPct =
          data.total > 0 ? (data.completed / data.total) * 100 : 0;
        const failedPct =
          data.total > 0 ? (data.failed / data.total) * 100 : 0;

        return (
          <div key={cat} className="flex items-center gap-3">
            <span className="w-36 shrink-0 text-xs text-foreground font-medium">
              {label}
            </span>
            {/* Progress bar */}
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden flex">
              <div
                className="h-full bg-green-500 transition-all duration-300"
                style={{ width: `${completedPct}%` }}
              />
              <div
                className="h-full bg-red-500 transition-all duration-300"
                style={{ width: `${failedPct}%` }}
              />
            </div>
            {/* Count */}
            <span className="text-xs tabular-nums text-foreground w-12 shrink-0 text-right">
              {data.completed}/{data.total}
            </span>
            {/* Failed badge */}
            {data.failed > 0 ? (
              <span className="text-xs text-red-500 w-20 shrink-0">
                ({data.failed} failed)
              </span>
            ) : (
              <span className="text-xs text-muted-foreground w-20 shrink-0">
                {data.inProgress > 0 ? `${data.inProgress} running` : ''}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── FailedStepExpander ────────────────────────────────────────────────────────

interface FailedStepExpanderProps {
  categories: ScaffoldCategoryProgress[];
  onSkip: (stepId: string) => void;
}

const FailedStepExpander: React.FC<FailedStepExpanderProps> = ({
  categories,
  onSkip,
}) => {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [errorVisible, setErrorVisible] = React.useState<Set<string>>(new Set());

  const failedSteps: ScaffoldStep[] = categories.flatMap((c) =>
    c.steps.filter((s) => s.status === 'failed'),
  );

  if (failedSteps.length === 0) return null;

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleError = (id: string) => {
    setErrorVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleManualFix = (step: ScaffoldStep) => {
    alert(
      `Manual fix mode: edit files in your editor for step "${step.id}", then click Retry.`,
    );
  };

  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-red-500 uppercase tracking-wide">
        Failed steps ({failedSteps.length})
      </p>
      {failedSteps.map((step) => {
        const isOpen = expanded.has(step.id);
        const isErrorOpen = errorVisible.has(step.id);
        return (
          <div
            key={step.id}
            className="rounded-md border border-red-500/30 bg-red-500/5 overflow-hidden"
          >
            {/* Header row */}
            <button
              type="button"
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-left',
                'hover:bg-red-500/10 transition-colors',
              )}
              onClick={() => toggle(step.id)}
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="font-mono text-xs text-foreground truncate flex-1">
                {step.id}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">
                {step.featureName}
              </span>
              <span className="text-xs text-red-400 shrink-0">
                Retry {step.retryCount}/{step.maxRetries}
              </span>
            </button>

            {/* Expanded details */}
            {isOpen && (
              <div className="px-3 pb-3 space-y-2 border-t border-red-500/20">
                {/* Error detail — toggled by View Error */}
                {step.lastError && isErrorOpen && (
                  <pre className="mt-2 rounded bg-muted px-2 py-1.5 text-xs font-mono text-red-400 whitespace-pre-wrap break-all">
                    {step.lastError}
                  </pre>
                )}
                <div className="flex justify-end gap-1.5 mt-2">
                  {/* View Error */}
                  {step.lastError && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs px-2 gap-1"
                      onClick={() => toggleError(step.id)}
                    >
                      <Eye className="h-3 w-3" />
                      {isErrorOpen ? 'Hide Error' : 'View Error'}
                    </Button>
                  )}
                  {/* Manual Fix → Retry */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs px-2 gap-1"
                    onClick={() => handleManualFix(step)}
                  >
                    <Wrench className="h-3 w-3" />
                    Manual Fix
                  </Button>
                  {/* Skip */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs px-2 gap-1"
                    onClick={() => onSkip(step.id)}
                  >
                    <SkipForward className="h-3 w-3" />
                    Skip
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── ScaffoldMonitor ───────────────────────────────────────────────────────────

export const ScaffoldMonitor: React.FC = () => {
  const { state, agentOutput, skipStep } = useFactoryPipeline();
  const { scaffolding } = state;

  if (!scaffolding) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        Scaffolding has not started yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      {/* Title */}
      <p className="text-sm font-semibold text-foreground">
        Scaffolding Progress
      </p>

      {/* Per-category bars */}
      <CategoryProgressBars categories={scaffolding.categories} />

      {/* Failed steps expander */}
      <FailedStepExpander
        categories={scaffolding.categories}
        onSkip={skipStep}
      />

      {/* Live agent output terminal */}
      <LiveAgentOutput lines={agentOutput} />
    </div>
  );
};
