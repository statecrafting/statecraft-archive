// Spec: specs/076-factory-desktop-panel/spec.md
// Token spend visualization dashboard (FR-007).

import React from 'react';
import { cn } from '@/lib/utils';
import { useFactoryPipeline } from './FactoryPipelineContext';
import type { StageTokenSpend, TokenSpend } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function budgetColor(pct: number): string {
  if (pct >= 80) return 'bg-red-500';
  if (pct >= 60) return 'bg-amber-500';
  return 'bg-green-500';
}

// ── StageTokenBars ───────────────────────────────────────────────────────────

interface StageTokenBarsProps {
  stages: StageTokenSpend[];
}

const StageTokenBars: React.FC<StageTokenBarsProps> = ({ stages }) => {
  if (stages.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic px-1">
        No stage token data yet.
      </p>
    );
  }

  const maxTokens = Math.max(...stages.map((s) => s.totalTokens), 1);

  return (
    <div className="space-y-2">
      {stages.map((stage) => {
        const pct = Math.round((stage.totalTokens / maxTokens) * 100);
        return (
          <div key={stage.stageId} className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground/80 truncate max-w-[60%]">
                {stage.stageName}
              </span>
              <span className="text-muted-foreground font-mono tabular-nums">
                {formatTokens(stage.totalTokens)}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500/70 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── BudgetGauge ──────────────────────────────────────────────────────────────

interface BudgetGaugeProps {
  tokenSpend: TokenSpend;
}

const BudgetGauge: React.FC<BudgetGaugeProps> = ({ tokenSpend }) => {
  const { totalTokens, budgetLimit } = tokenSpend;

  if (budgetLimit === null) {
    return (
      <div className="text-xs text-muted-foreground">
        Total:{' '}
        <span className="font-mono font-medium text-foreground">
          {formatTokens(totalTokens)}
        </span>{' '}
        tokens
      </div>
    );
  }

  const pct = Math.min(Math.round((totalTokens / budgetLimit) * 100), 100);
  const colorClass = budgetColor(pct);
  const exceeded = totalTokens >= budgetLimit;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Total</span>
        <span className="font-mono tabular-nums text-foreground">
          {formatTokens(totalTokens)}{' '}
          <span className="text-muted-foreground">
            / {formatTokens(budgetLimit)}
          </span>
        </span>
      </div>
      <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-300', colorClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span
          className={cn(
            'font-medium',
            exceeded
              ? 'text-red-500'
              : pct > 80
                ? 'text-amber-500'
                : 'text-muted-foreground',
          )}
        >
          {exceeded
            ? 'Token budget exceeded'
            : pct > 80
              ? '\u26a0 Approaching budget limit'
              : `${pct}% used`}
        </span>
      </div>
    </div>
  );
};

// ── TokenDashboard ───────────────────────────────────────────────────────────

export const TokenDashboard: React.FC<{ compact?: boolean }> = ({
  compact = false,
}) => {
  const { state } = useFactoryPipeline();
  // Always derive the running total from per-stage spend. The accumulator on
  // `state.tokenSpend.totalTokens` only updates from `step_completed` events;
  // when the panel is hydrated from a snapshot (history selection, app
  // restart) the per-stage values are populated from disk but there is no
  // event stream to bump the global. Summing here keeps the dashboard
  // consistent with the per-stage badges in the DAG.
  const stageTotal = state.stages.reduce((sum, s) => sum + s.tokenSpend, 0);
  const tokenSpend = {
    ...state.tokenSpend,
    totalTokens: Math.max(state.tokenSpend.totalTokens, stageTotal),
  };

  if (compact) {
    return (
      <div className="px-3 py-2 space-y-2">
        <BudgetGauge tokenSpend={tokenSpend} />
      </div>
    );
  }

  return (
    <div className="px-3 py-3 space-y-4">
      {/* Budget gauge */}
      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Budget
        </h3>
        <BudgetGauge tokenSpend={tokenSpend} />
      </section>

      {/* Per-stage bars */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          By Stage
        </h3>
        <StageTokenBars stages={tokenSpend.stages} />
      </section>
    </div>
  );
};
