// Spec: specs/171-opc-structural-diff-plan-ui/spec.md
// FR-001 §2.1 — structural-diff renderer (primary action surface).
//
// Structural-diff renderer over the spec spine: shows added / removed /
// modified specs the plan would produce. The primary surface — paired
// with PlanActionGraph — that makes anthropomorphic-trust failures
// (ASI09) structurally impossible to hide.

import React from 'react';
import { ArrowRight, FilePlus2, FileMinus2, FileEdit } from 'lucide-react';
import { Badge } from '@opc/ui/badge';
import { cn } from '@/lib/utils';
import type {
  StructuralDiff,
  SpecModification,
  SpecRef,
  SpecFrontmatterChange,
} from './planTypes';

// ── Helpers ──────────────────────────────────────────────────────────

function fmtValue(value: unknown): string {
  if (value === undefined) return '∅';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ── Row components ───────────────────────────────────────────────────

const SpecRow: React.FC<{
  spec: SpecRef;
  icon: React.ReactNode;
  tone: 'added' | 'removed' | 'modified';
}> = ({ spec, icon, tone }) => {
  const toneClasses: Record<typeof tone, string> = {
    added: 'border-green-500/30 bg-green-500/5',
    removed: 'border-red-500/30 bg-red-500/5',
    modified: 'border-amber-500/30 bg-amber-500/5',
  };
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
        toneClasses[tone],
      )}
      data-testid={`structural-diff-row-${tone}`}
      data-spec-id={spec.id}
    >
      <span className="shrink-0">{icon}</span>
      <span className="font-mono text-xs text-foreground">{spec.id}</span>
      <span className="font-mono text-xs text-muted-foreground truncate">
        {spec.path}
      </span>
    </div>
  );
};

const FieldChangeRow: React.FC<{ change: SpecFrontmatterChange }> = ({
  change,
}) => (
  <div className="flex items-center gap-2 pl-6 pr-2 py-1 text-xs">
    <span className="font-mono font-medium text-foreground shrink-0">
      {change.field}:
    </span>
    <span className="font-mono text-muted-foreground line-through">
      {fmtValue(change.before)}
    </span>
    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
    <span className="font-mono text-foreground">{fmtValue(change.after)}</span>
  </div>
);

const ModifiedSpecRow: React.FC<{ mod: SpecModification }> = ({ mod }) => (
  <div
    className="rounded-md border border-amber-500/30 bg-amber-500/5 overflow-hidden"
    data-testid="structural-diff-row-modified"
    data-spec-id={mod.spec.id}
  >
    <div className="flex items-center gap-2 px-3 py-2 text-sm">
      <FileEdit className="h-4 w-4 shrink-0 text-amber-500" />
      <span className="font-mono text-xs text-foreground">{mod.spec.id}</span>
      <span className="font-mono text-xs text-muted-foreground truncate">
        {mod.spec.path}
      </span>
      <Badge variant="outline" className="ml-auto text-[10px]">
        {mod.changes.length} change{mod.changes.length === 1 ? '' : 's'}
      </Badge>
    </div>
    <div className="border-t border-amber-500/20 bg-background/50 py-1">
      {mod.changes.map((c, i) => (
        <FieldChangeRow key={`${c.field}-${i}`} change={c} />
      ))}
    </div>
  </div>
);

// ── Top-level ────────────────────────────────────────────────────────

export interface PlanStructuralDiffProps {
  diff: StructuralDiff;
  /** Optional title override. */
  title?: string;
}

export const PlanStructuralDiff: React.FC<PlanStructuralDiffProps> = ({
  diff,
  title = 'Structural diff against current spec spine',
}) => {
  const empty =
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.modified.length === 0;

  return (
    <section
      data-testid="plan-structural-diff"
      className="rounded-lg border border-border bg-background overflow-hidden"
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <div className="flex gap-1.5">
          <Badge
            variant="outline"
            className="text-[10px] border-green-500/40 text-green-600 dark:text-green-400"
          >
            +{diff.added.length}
          </Badge>
          <Badge
            variant="outline"
            className="text-[10px] border-red-500/40 text-red-600 dark:text-red-400"
          >
            -{diff.removed.length}
          </Badge>
          <Badge
            variant="outline"
            className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400"
          >
            ~{diff.modified.length}
          </Badge>
        </div>
      </header>

      <div className="p-3 space-y-2">
        {empty && (
          <p
            className="text-xs text-muted-foreground italic"
            data-testid="structural-diff-empty"
          >
            This plan does not modify the spec spine. (The agent may still
            propose code-only edits — verify each action below.)
          </p>
        )}

        {diff.added.map((spec) => (
          <SpecRow
            key={`added-${spec.id}`}
            spec={spec}
            tone="added"
            icon={<FilePlus2 className="h-4 w-4 text-green-500" />}
          />
        ))}

        {diff.removed.map((spec) => (
          <SpecRow
            key={`removed-${spec.id}`}
            spec={spec}
            tone="removed"
            icon={<FileMinus2 className="h-4 w-4 text-red-500" />}
          />
        ))}

        {diff.modified.map((mod) => (
          <ModifiedSpecRow key={`mod-${mod.spec.id}`} mod={mod} />
        ))}
      </div>
    </section>
  );
};
