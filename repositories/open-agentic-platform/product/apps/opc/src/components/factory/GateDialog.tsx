// Spec: specs/076-factory-desktop-panel/spec.md
// Gate dialog for stage checkpoint and approval gates (FR-004).

import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle, Lock, Clock } from 'lucide-react';
import * as yaml from 'js-yaml';
import { Button } from '@opc/ui/button';
import { cn } from '@/lib/utils';
import { useFactoryPipeline } from './FactoryPipelineContext';
import { BuildSpecStructuredView } from './BuildSpecStructuredView';
import type { GateAction, GateSummary } from './types';

// ── Stat card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number | undefined;
}

const StatCard: React.FC<StatCardProps> = ({ label, value }) => {
  if (value === undefined) return null;
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-border bg-muted/40 px-4 py-3 min-w-[90px]">
      <span className="text-2xl font-bold tabular-nums text-foreground">
        {value}
      </span>
      <span className="text-xs text-muted-foreground text-center leading-tight">
        {label}
      </span>
    </div>
  );
};

// ── Summary stats row ─────────────────────────────────────────────────────────

const SummaryStats: React.FC<{ summary: GateSummary }> = ({ summary }) => {
  const hasStats =
    summary.entityCount !== undefined ||
    summary.operationCount !== undefined ||
    summary.pageCount !== undefined ||
    summary.ruleCount !== undefined;

  if (!hasStats && !summary.description) return null;

  return (
    <div className="space-y-3">
      {hasStats && (
        <div className="flex flex-wrap gap-2">
          <StatCard label="Entities" value={summary.entityCount} />
          <StatCard label="Operations" value={summary.operationCount} />
          <StatCard label="Pages" value={summary.pageCount} />
          <StatCard label="Rules" value={summary.ruleCount} />
        </div>
      )}
      {summary.description && (
        <p className="text-sm text-muted-foreground">{summary.description}</p>
      )}
    </div>
  );
};

// ── Reject flow ───────────────────────────────────────────────────────────────

interface RejectFlowProps {
  onSubmit: (feedback: string) => void;
  onCancel: () => void;
  isApproval: boolean;
}

const RejectFlow: React.FC<RejectFlowProps> = ({
  onSubmit,
  onCancel,
  isApproval,
}) => {
  const [feedback, setFeedback] = useState('');

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-3 overflow-hidden"
    >
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <p className="text-xs text-destructive font-medium mb-2">
          {isApproval
            ? 'Describe what needs to be revised before re-running this stage.'
            : 'Describe why this stage should be re-run.'}
        </p>
        <textarea
          autoFocus
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={
            isApproval
              ? 'e.g. The data model is missing the audit log entities...'
              : 'e.g. The business requirements are incomplete...'
          }
          rows={4}
          className={cn(
            'w-full rounded-md border border-input bg-background px-3 py-2',
            'text-sm text-foreground placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
            'resize-none',
          )}
        />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={!feedback.trim()}
          onClick={() => onSubmit(feedback.trim())}
        >
          <XCircle className="h-3.5 w-3.5 mr-1.5" />
          Submit Rejection
        </Button>
      </div>
    </motion.div>
  );
};

// ── Build spec viewer (loads artifact for stage 5) ──────────────────────────

const BuildSpecViewer: React.FC<{ stageId: string }> = ({ stageId }) => {
  const { loadArtifacts } = useFactoryPipeline();
  const [buildSpec, setBuildSpec] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const artifacts = await loadArtifacts(stageId);
        // Look for a YAML or JSON Build Spec artifact
        const specArtifact = artifacts.find(
          (a) =>
            a.name.includes('build-spec') ||
            a.name.includes('build_spec') ||
            a.name === 'spec.yaml' ||
            a.name === 'spec.yml' ||
            a.name === 'spec.json',
        );
        if (specArtifact && !cancelled) {
          try {
            const mod = await import('@tauri-apps/plugin-fs' as any);
            const content = await mod.readTextFile(specArtifact.path);
            // Try JSON first, then fall back to YAML
            let parsed: unknown = null;
            try {
              parsed = JSON.parse(content);
            } catch {
              try {
                parsed = yaml.load(content);
              } catch {
                parsed = null;
              }
            }
            if (!cancelled) setBuildSpec(parsed);
          } catch {
            // fs plugin unavailable (web mode)
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [stageId, loadArtifacts]);

  if (loading) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
        <Lock className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50 animate-pulse" />
        <p className="text-sm text-muted-foreground">Loading Build Spec...</p>
      </div>
    );
  }

  if (!buildSpec) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
        <Lock className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
        <p className="text-sm font-medium text-muted-foreground">
          Build Spec structured view
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          No Build Spec artifact found for this stage.
        </p>
      </div>
    );
  }

  return (
    <div className="max-h-[400px] overflow-y-auto rounded-lg border border-border">
      <BuildSpecStructuredView buildSpec={buildSpec} />
    </div>
  );
};

// ── Approval countdown timer ──────────────────────────────────────────────────

interface ApprovalCountdownProps {
  timeoutMs: number;
  openedAt: string;
}

const ApprovalCountdown: React.FC<ApprovalCountdownProps> = ({
  timeoutMs,
  openedAt,
}) => {
  const [remainingMs, setRemainingMs] = useState<number>(() => {
    const elapsed = Date.now() - new Date(openedAt).getTime();
    return Math.max(0, timeoutMs - elapsed);
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - new Date(openedAt).getTime();
      const remaining = Math.max(0, timeoutMs - elapsed);
      setRemainingMs(remaining);
      if (remaining === 0 && intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    }, 1000);

    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
    };
  }, [timeoutMs, openedAt]);

  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const isUrgent = remainingMs < 5 * 60 * 1000; // < 5 minutes
  const isExpired = remainingMs === 0;

  const formatted = isExpired
    ? 'Timed out'
    : hours > 0
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium tabular-nums',
        isExpired
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : isUrgent
            ? 'border-red-500/40 bg-red-500/10 text-red-500'
            : 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400',
      )}
    >
      <Clock
        className={cn(
          'h-4 w-4 shrink-0',
          isUrgent || isExpired ? 'animate-pulse' : '',
        )}
      />
      <span>
        {isExpired ? 'Approval window expired' : `Auto-timeout in ${formatted}`}
      </span>
    </div>
  );
};

// ── Checkpoint gate ───────────────────────────────────────────────────────────

interface CheckpointGateBodyProps {
  gate: GateAction;
  onConfirm: () => void;
  onReject: (feedback: string) => void;
}

const CheckpointGateBody: React.FC<CheckpointGateBodyProps> = ({
  gate,
  onConfirm,
  onReject,
}) => {
  const [showReject, setShowReject] = useState(false);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-green-500/10 p-2">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground leading-snug">
            Stage Complete — Review{' '}
            <span className="text-primary">{gate.stageName}</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Confirm to advance the pipeline or reject to request a revision.
          </p>
        </div>
      </div>

      {/* Summary */}
      {gate.summary && <SummaryStats summary={gate.summary} />}

      {/* Reject flow */}
      <AnimatePresence>
        {showReject && (
          <RejectFlow
            isApproval={false}
            onSubmit={onReject}
            onCancel={() => setShowReject(false)}
          />
        )}
      </AnimatePresence>

      {/* Actions */}
      {!showReject && (
        <div className="flex gap-2 justify-end pt-1">
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setShowReject(true)}
          >
            <XCircle className="h-3.5 w-3.5 mr-1.5" />
            Reject
          </Button>
          <Button size="sm" onClick={onConfirm}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            Confirm
          </Button>
        </div>
      )}
    </div>
  );
};

// ── Approval gate ─────────────────────────────────────────────────────────────

interface ApprovalGateBodyProps {
  gate: GateAction;
  onConfirm: () => void;
  onReject: (feedback: string) => void;
}

const ApprovalGateBody: React.FC<ApprovalGateBodyProps> = ({
  gate,
  onConfirm,
  onReject,
}) => {
  const [showReject, setShowReject] = useState(false);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-amber-500/10 p-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground leading-snug">
            Build Spec Approval — Freeze &amp; Proceed
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Approving will freeze the Build Spec and begin Phase 2 scaffolding.
            This action cannot be undone.
          </p>
        </div>
      </div>

      {/* Countdown timer */}
      {gate.timeoutMs !== undefined && gate.openedAt !== undefined && (
        <ApprovalCountdown
          timeoutMs={gate.timeoutMs}
          openedAt={gate.openedAt}
        />
      )}

      {/* Stats */}
      {gate.summary && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <StatCard label="Entities" value={gate.summary.entityCount} />
            <StatCard label="Operations" value={gate.summary.operationCount} />
            <StatCard label="Pages" value={gate.summary.pageCount} />
            <StatCard label="Rules" value={gate.summary.ruleCount} />
          </div>
          {gate.summary.description && (
            <p className="text-sm text-muted-foreground">
              {gate.summary.description}
            </p>
          )}
        </div>
      )}

      {/* Build spec structured view */}
      <BuildSpecViewer stageId={gate.stageId} />

      {/* Reject flow */}
      <AnimatePresence>
        {showReject && (
          <RejectFlow
            isApproval={true}
            onSubmit={onReject}
            onCancel={() => setShowReject(false)}
          />
        )}
      </AnimatePresence>

      {/* Actions */}
      {!showReject && (
        <div className="flex gap-2 justify-end pt-1">
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setShowReject(true)}
          >
            <XCircle className="h-3.5 w-3.5 mr-1.5" />
            Reject &amp; Revise
          </Button>
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700 text-white focus-visible:ring-green-600"
            onClick={onConfirm}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            Approve &amp; Freeze
          </Button>
        </div>
      )}
    </div>
  );
};

// ── GateDialog ────────────────────────────────────────────────────────────────

export const GateDialog: React.FC = () => {
  const { state, confirmStage, rejectStage, dismissGate } = useFactoryPipeline();
  const { gateAction } = state;

  const handleConfirm = async () => {
    if (!gateAction) return;
    await confirmStage(gateAction.stageId);
    dismissGate();
  };

  const handleReject = async (feedback: string) => {
    if (!gateAction) return;
    await rejectStage(gateAction.stageId, feedback);
    dismissGate();
  };

  const isApproval = gateAction?.gateType === 'approval';

  return (
    <AnimatePresence>
      {gateAction !== null && (
        <>
          {/* Backdrop */}
          <motion.div
            key="gate-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
            onClick={dismissGate}
          />

          {/* Dialog panel */}
          <motion.div
            key="gate-dialog"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              'fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
              'w-full rounded-xl border border-border bg-background shadow-2xl',
              'p-6 overflow-y-auto max-h-[90vh]',
              isApproval ? 'max-w-2xl' : 'max-w-md',
            )}
            // Prevent backdrop click bubbling through the panel
            onClick={(e) => e.stopPropagation()}
          >
            {gateAction.gateType === 'checkpoint' ? (
              <CheckpointGateBody
                gate={gateAction}
                onConfirm={handleConfirm}
                onReject={handleReject}
              />
            ) : (
              <ApprovalGateBody
                gate={gateAction}
                onConfirm={handleConfirm}
                onReject={handleReject}
              />
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
