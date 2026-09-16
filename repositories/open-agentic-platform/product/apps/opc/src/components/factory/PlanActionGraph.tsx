// Spec: specs/171-opc-structural-diff-plan-ui/spec.md
// FR-002 action-graph enumeration + FR-005 traversal acknowledgement.
//
// Action graph renderer: enumerates each agent-proposed action with
// its kind, target, and structured diff. Each action exposes an
// "acknowledge" checkbox so approval traversal (FR-005) can hold the
// "approve plan" button disabled until the human has walked every row.
//
// The serialised YAML view is included to match the spec body's
// "plans rendered as YAML/JSON action graphs" framing — it is the
// machine-shaped representation the human inspects, not the agent's
// prose.

import React from 'react';
import * as yaml from 'js-yaml';
import { CheckSquare, Square, ListTree } from 'lucide-react';
import { Badge } from '@opc/ui/badge';
import { cn } from '@/lib/utils';
import type { AgentPlan, PlanAction, PlanActionKind } from './planTypes';

// ── Action-kind presentation ─────────────────────────────────────────

const KIND_LABEL: Record<PlanActionKind, string> = {
  edit_spec: 'edit spec',
  edit_code: 'edit code',
  invoke_tool: 'invoke tool',
  factory_run: 'factory run',
  deploy: 'deploy',
};

const KIND_BADGE: Record<PlanActionKind, string> = {
  edit_spec: 'border-blue-500/40 text-blue-600 dark:text-blue-400',
  edit_code: 'border-purple-500/40 text-purple-600 dark:text-purple-400',
  invoke_tool: 'border-cyan-500/40 text-cyan-600 dark:text-cyan-400',
  factory_run:
    'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
  deploy: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
};

// ── Hunk view ────────────────────────────────────────────────────────

const HunkPre: React.FC<{ hunks: string[] }> = ({ hunks }) => (
  <pre
    className="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-muted/30 p-2 text-[11px] font-mono leading-snug"
    data-testid="action-hunks"
  >
    {hunks.map((h, i) => (
      <code
        key={i}
        className="block whitespace-pre-wrap break-words text-foreground"
      >
        {h}
      </code>
    ))}
  </pre>
);

// ── Critical / gate badges ───────────────────────────────────────────

const CriticalBadge: React.FC<{ action: PlanAction }> = ({ action }) => {
  if (!action.critical) return null;
  return (
    <Badge
      variant="outline"
      data-testid={`critical-marker-${action.id}`}
      className="border-red-500/50 text-red-600 dark:text-red-400 text-[10px] font-mono"
      title={`Critical (${action.critical.category}): ${action.critical.reason}. Requires ${action.critical.requiredAcks} acknowledgements (M-of-N future spec).`}
    >
      M-of-N · {action.critical.category}
    </Badge>
  );
};

const GateImpactBadges: React.FC<{ action: PlanAction }> = ({ action }) => {
  if (!action.gateImpact || action.gateImpact.entries.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {action.gateImpact.entries.map((entry) => {
        const tone =
          entry.level === 'fail'
            ? 'border-red-500/40 text-red-600 dark:text-red-400'
            : entry.level === 'warn'
              ? 'border-amber-500/40 text-amber-600 dark:text-amber-400'
              : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400';
        return (
          <Badge
            key={`${action.id}-${entry.gate}`}
            variant="outline"
            data-testid={`gate-impact-${entry.gate}-${entry.level}`}
            className={cn('text-[10px] font-mono', tone)}
            title={entry.reason}
          >
            {entry.gate}: {entry.level}
          </Badge>
        );
      })}
    </span>
  );
};

// ── Action row ───────────────────────────────────────────────────────

export interface PlanActionRowProps {
  action: PlanAction;
  index: number;
  acknowledged: boolean;
  onToggle: () => void;
}

export const PlanActionRow: React.FC<PlanActionRowProps> = ({
  action,
  index,
  acknowledged,
  onToggle,
}) => {
  const hasFailGate = action.gateImpact?.entries.some(
    (e) => e.level === 'fail',
  );
  return (
    <div
      data-testid={`plan-action-row-${action.id}`}
      data-acknowledged={acknowledged ? 'true' : 'false'}
      className={cn(
        'rounded-md border bg-background overflow-hidden',
        acknowledged
          ? 'border-emerald-500/40 bg-emerald-500/5'
          : hasFailGate
            ? 'border-red-500/40'
            : 'border-border',
      )}
    >
      <div className="flex items-start gap-3 p-3">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={acknowledged}
          aria-label={
            acknowledged
              ? `Un-acknowledge action ${index + 1}`
              : `Acknowledge action ${index + 1}`
          }
          data-testid={`acknowledge-${action.id}`}
          className={cn(
            'mt-0.5 shrink-0 rounded transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-ring',
            acknowledged ? 'text-emerald-500' : 'text-muted-foreground',
          )}
        >
          {acknowledged ? (
            <CheckSquare className="h-4 w-4" />
          ) : (
            <Square className="h-4 w-4" />
          )}
        </button>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground tabular-nums">
              {String(index + 1).padStart(2, '0')}
            </span>
            <Badge
              variant="outline"
              className={cn('text-[10px] font-mono', KIND_BADGE[action.kind])}
            >
              {KIND_LABEL[action.kind]}
            </Badge>
            <span
              className="font-mono text-xs text-foreground truncate"
              title={action.target}
            >
              {action.target}
            </span>
            <CriticalBadge action={action} />
          </div>

          {action.diff?.frontmatter && action.diff.frontmatter.length > 0 && (
            <ul className="text-xs space-y-0.5 pl-1">
              {action.diff.frontmatter.map((c, i) => (
                <li
                  key={`${c.field}-${i}`}
                  className="font-mono text-muted-foreground"
                >
                  <span className="text-foreground">{c.field}</span>:{' '}
                  <span className="line-through">
                    {c.before === undefined ? '∅' : JSON.stringify(c.before)}
                  </span>{' '}
                  →{' '}
                  <span className="text-foreground">
                    {c.after === undefined ? '∅' : JSON.stringify(c.after)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {action.diff?.hunks && action.diff.hunks.length > 0 && (
            <HunkPre hunks={action.diff.hunks} />
          )}

          <GateImpactBadges action={action} />
        </div>
      </div>
    </div>
  );
};

// ── Action graph top-level ───────────────────────────────────────────

export interface PlanActionGraphProps {
  plan: AgentPlan;
  acknowledgements: Record<string, boolean>;
  onToggleAcknowledged: (actionId: string) => void;
  /** Render the serialised YAML view alongside the row list. */
  showSerialised?: boolean;
}

export const PlanActionGraph: React.FC<PlanActionGraphProps> = ({
  plan,
  acknowledgements,
  onToggleAcknowledged,
  showSerialised = true,
}) => {
  // Compute the serialised view once per render. The shape mirrors
  // the example in the spec body so the YAML view doubles as
  // documentation of the canonical action graph schema.
  const serialised = React.useMemo(() => {
    const payload = {
      plan_id: plan.id,
      proposed_at: plan.proposedAt,
      proposed_by: plan.proposedBy,
      actions: plan.actions.map((a) => ({
        id: a.id,
        kind: a.kind,
        target: a.target,
        ...(a.diff ? { diff: a.diff } : {}),
        ...(a.args ? { args: a.args } : {}),
        ...(a.gateImpact ? { gate_impact: a.gateImpact.entries } : {}),
        ...(a.critical ? { critical: a.critical } : {}),
      })),
    };
    try {
      return yaml.dump(payload, { lineWidth: 100, sortKeys: false });
    } catch (e) {
      return `# YAML serialisation failed: ${String(e)}`;
    }
  }, [plan]);

  return (
    <section
      data-testid="plan-action-graph"
      className="rounded-lg border border-border bg-background overflow-hidden"
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <ListTree className="h-3.5 w-3.5" />
          Action graph
        </h3>
        <Badge variant="outline" className="text-[10px] font-mono">
          {plan.actions.length} action{plan.actions.length === 1 ? '' : 's'}
        </Badge>
      </header>

      <div className="p-3 space-y-2">
        {plan.actions.length === 0 && (
          <p
            className="text-xs text-muted-foreground italic"
            data-testid="action-graph-empty"
          >
            No actions proposed. The plan cannot be approved.
          </p>
        )}
        {plan.actions.map((action, i) => (
          <PlanActionRow
            key={action.id}
            action={action}
            index={i}
            acknowledged={acknowledgements[action.id] === true}
            onToggle={() => onToggleAcknowledged(action.id)}
          />
        ))}
      </div>

      {showSerialised && plan.actions.length > 0 && (
        <details
          className="border-t border-border bg-muted/10"
          data-testid="action-graph-yaml"
        >
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-mono text-muted-foreground hover:bg-muted/30">
            Show YAML
          </summary>
          <pre className="overflow-auto p-3 text-[11px] font-mono leading-snug">
            <code className="text-foreground whitespace-pre">{serialised}</code>
          </pre>
        </details>
      )}
    </section>
  );
};
