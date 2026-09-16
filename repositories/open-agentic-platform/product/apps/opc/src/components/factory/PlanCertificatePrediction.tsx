// Spec: specs/171-opc-structural-diff-plan-ui/spec.md
// FR-006 — predicted-vs-actual governance-certificate diff surface.
//
// Predicted-vs-actual governance-certificate stage list. The agent
// declares the certificate it expects to emit *before* the run; once
// the run terminates and a real certificate lands, this component
// surfaces any discrepancy as a post-action diagnostic the human
// must acknowledge before the next plan can be approved (SC-004).

import React from 'react';
import { CheckCircle2, AlertCircle, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@opc/ui/badge';
import type {
  CertificateActual,
  CertificatePrediction,
  CertificateDiscrepancy,
} from './planTypes';

// ── Diff helpers ─────────────────────────────────────────────────────

export function diffCertificate(
  prediction: CertificatePrediction,
  actual: CertificateActual,
): CertificateDiscrepancy[] {
  const discrepancies: CertificateDiscrepancy[] = [];

  const predictedById = new Map(prediction.stages.map((s) => [s.id, s]));
  const actualById = new Map(actual.stages.map((s) => [s.id, s]));

  for (const predicted of prediction.stages) {
    const actualStage = actualById.get(predicted.id);
    if (!actualStage) {
      discrepancies.push({
        kind: 'missing-stage',
        stageId: predicted.id,
        detail: `Predicted stage "${predicted.name}" did not appear in the certificate.`,
      });
      continue;
    }
    const predictedArtifacts = new Set(predicted.artifacts);
    const actualArtifacts = new Set(actualStage.artifacts);
    for (const art of predictedArtifacts) {
      if (!actualArtifacts.has(art)) {
        discrepancies.push({
          kind: 'missing-artifact',
          stageId: predicted.id,
          detail: `Predicted artifact "${art}" missing from stage "${predicted.name}".`,
        });
      }
    }
    for (const art of actualArtifacts) {
      if (!predictedArtifacts.has(art)) {
        discrepancies.push({
          kind: 'extra-artifact',
          stageId: predicted.id,
          detail: `Unpredicted artifact "${art}" appeared in stage "${predicted.name}".`,
        });
      }
    }
  }

  for (const actualStage of actual.stages) {
    if (!predictedById.has(actualStage.id)) {
      discrepancies.push({
        kind: 'extra-stage',
        stageId: actualStage.id,
        detail: `Unpredicted stage "${actualStage.name}" appeared in the certificate.`,
      });
    }
  }

  return discrepancies;
}

// ── Stage row ────────────────────────────────────────────────────────

interface StageRowProps {
  stageId: string;
  name: string;
  predicted: string[];
  actual?: string[];
  hashPrefix?: string;
  status: 'pending' | 'matched' | 'mismatch' | 'missing' | 'extra';
}

const STATUS_STYLES: Record<StageRowProps['status'], string> = {
  pending: 'border-border bg-muted/20',
  matched: 'border-emerald-500/30 bg-emerald-500/5',
  mismatch: 'border-amber-500/30 bg-amber-500/5',
  missing: 'border-red-500/40 bg-red-500/5',
  extra: 'border-blue-500/40 bg-blue-500/5',
};

const StageRow: React.FC<StageRowProps> = ({
  stageId,
  name,
  predicted,
  actual,
  hashPrefix,
  status,
}) => (
  <div
    data-testid={`cert-stage-${stageId}`}
    data-status={status}
    className={cn('rounded-md border px-3 py-2 text-xs', STATUS_STYLES[status])}
  >
    <div className="flex items-center gap-2">
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="font-mono text-foreground">{stageId}</span>
      <span className="text-muted-foreground">· {name}</span>
      {hashPrefix && (
        <Badge variant="outline" className="ml-auto text-[10px] font-mono">
          {hashPrefix}
        </Badge>
      )}
      <Badge
        variant="outline"
        className={cn(
          'text-[10px] font-mono',
          status === 'matched' && 'border-emerald-500/40 text-emerald-600',
          status === 'mismatch' && 'border-amber-500/40 text-amber-600',
          status === 'missing' && 'border-red-500/40 text-red-600',
          status === 'extra' && 'border-blue-500/40 text-blue-600',
        )}
      >
        {status}
      </Badge>
    </div>
    <div className="mt-1.5 grid grid-cols-2 gap-3 pl-5">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Predicted
        </div>
        {predicted.length === 0 ? (
          <div className="font-mono italic text-muted-foreground/70">∅</div>
        ) : (
          <ul className="font-mono space-y-0.5">
            {predicted.map((a) => (
              <li key={`p-${a}`} className="text-foreground">
                {a}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Actual
        </div>
        {actual === undefined ? (
          <div className="font-mono italic text-muted-foreground/70">
            (pending execution)
          </div>
        ) : actual.length === 0 ? (
          <div className="font-mono italic text-muted-foreground/70">∅</div>
        ) : (
          <ul className="font-mono space-y-0.5">
            {actual.map((a) => (
              <li key={`a-${a}`} className="text-foreground">
                {a}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  </div>
);

// ── Top-level ────────────────────────────────────────────────────────

export interface PlanCertificatePredictionProps {
  prediction: CertificatePrediction;
  actual?: CertificateActual;
}

export const PlanCertificatePrediction: React.FC<
  PlanCertificatePredictionProps
> = ({ prediction, actual }) => {
  const discrepancies = actual ? diffCertificate(prediction, actual) : [];
  const actualById = actual
    ? new Map(actual.stages.map((s) => [s.id, s]))
    : new Map();

  // Build a row per predicted stage, plus any actual-only "extra" stages.
  const predictedIds = new Set(prediction.stages.map((s) => s.id));
  const rows: StageRowProps[] = prediction.stages.map((stage) => {
    const actualStage = actualById.get(stage.id);
    let status: StageRowProps['status'];
    if (!actual) status = 'pending';
    else if (!actualStage) status = 'missing';
    else {
      const predictedSet = new Set(stage.artifacts);
      const actualSet = new Set(actualStage.artifacts);
      const equal =
        predictedSet.size === actualSet.size &&
        [...predictedSet].every((a) => actualSet.has(a));
      status = equal ? 'matched' : 'mismatch';
    }
    return {
      stageId: stage.id,
      name: stage.name,
      predicted: stage.artifacts,
      actual: actualStage?.artifacts,
      hashPrefix: actualStage?.artifactHashPrefix,
      status,
    };
  });
  if (actual) {
    for (const actualStage of actual.stages) {
      if (!predictedIds.has(actualStage.id)) {
        rows.push({
          stageId: actualStage.id,
          name: actualStage.name,
          predicted: [],
          actual: actualStage.artifacts,
          hashPrefix: actualStage.artifactHashPrefix,
          status: 'extra',
        });
      }
    }
  }

  const hasDiscrepancy = discrepancies.length > 0;
  const headerIcon = !actual ? (
    <FileText className="h-4 w-4 text-muted-foreground" />
  ) : hasDiscrepancy ? (
    <AlertCircle className="h-4 w-4 text-amber-500" />
  ) : (
    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  );

  return (
    <section
      data-testid="plan-certificate-prediction"
      data-has-actual={actual ? 'true' : 'false'}
      data-has-discrepancy={hasDiscrepancy ? 'true' : 'false'}
      className="rounded-lg border border-border bg-background overflow-hidden"
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          {headerIcon}
          Predicted governance certificate
          {prediction.adapter && (
            <span className="font-mono normal-case text-muted-foreground">
              · adapter {prediction.adapter}
            </span>
          )}
        </h3>
        {actual && (
          <Badge
            variant="outline"
            data-testid="cert-discrepancy-count"
            className={cn(
              'text-[10px] font-mono',
              hasDiscrepancy
                ? 'border-amber-500/40 text-amber-600 dark:text-amber-400'
                : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
            )}
          >
            {hasDiscrepancy
              ? `${discrepancies.length} discrepanc${discrepancies.length === 1 ? 'y' : 'ies'}`
              : 'matches prediction'}
          </Badge>
        )}
      </header>

      <div className="p-3 space-y-2">
        {rows.map((row) => (
          <StageRow key={row.stageId} {...row} />
        ))}
      </div>

      {hasDiscrepancy && (
        <div
          data-testid="cert-discrepancy-list"
          className="border-t border-amber-500/20 bg-amber-500/5 p-3 text-xs space-y-1"
        >
          <div className="font-semibold text-amber-600 dark:text-amber-400">
            Discrepancies
          </div>
          <ul className="space-y-0.5 list-disc list-inside text-foreground">
            {discrepancies.map((d, i) => (
              <li key={i} className="font-mono">
                <span className="text-muted-foreground">[{d.kind}]</span>{' '}
                {d.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
