// Spec: specs/171-opc-structural-diff-plan-ui/spec.md
//
// Primary action surface (§2.1) for agent-proposed plans. Renders the
// structural diff, the action graph, the gate-impact roll-up, and the
// predicted governance certificate. The agent's narrative is DEMOTED
// to a secondary collapsed pane (§2.2, FR-004): the human can read it
// but cannot approve from it.
//
// Approval requires the human to acknowledge every action in the graph
// before the approve button enables (FR-005). Post-execution, the
// certificate prediction is compared against the actual emission and
// any discrepancy gates the next plan (SC-004).
//
// This dialog deliberately does NOT include any natural-language
// approval shortcut. The anti-anthropomorphic-trust posture (ASI09)
// requires the human to act on the structural diff, not on the prose.

import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CheckCircle2,
  XCircle,
  GitCompare,
  MessageSquareText,
  Fingerprint,
} from 'lucide-react';
import { Button } from '@opc/ui/button';
import { Badge } from '@opc/ui/badge';
import { cn } from '@/lib/utils';
import { PlanStructuralDiff } from './PlanStructuralDiff';
import { PlanActionGraph } from './PlanActionGraph';
import { GateImpactSummary } from './GateImpactSummary';
import { PlanCertificatePrediction } from './PlanCertificatePrediction';
import {
  type AgentPlan,
  type CertificateActual,
  type PlanApprovalState,
  createInitialApprovalState,
  hashPlan,
  isPlanFullyAcknowledged,
} from './planTypes';
import { enrichPlan } from './planAnalysis';

// ── Public API ───────────────────────────────────────────────────────

export interface PlanReviewDialogProps {
  plan: AgentPlan;
  /** Actual governance certificate (post-execution). When present the
   *  certificate prediction panel surfaces the prediction-vs-actual
   *  diff and any discrepancy gates approval per SC-004. */
  certificateActual?: CertificateActual;
  /** Called when the human approves the plan. Approval is only
   *  reachable after the action graph has been traversed (FR-005). */
  onApprove: (planId: string, planHash: string) => void;
  /** Called when the human rejects the plan; the cockpit decides what
   *  to do with the feedback. */
  onReject: (planId: string, reason: string) => void;
  /** Called when the dialog is dismissed without an action. */
  onDismiss: () => void;
  /** Whether the plan has already executed; influences button copy
   *  and disables approval (post-execution is review-only). */
  alreadyExecuted?: boolean;
}

// ── Reject form ──────────────────────────────────────────────────────

const RejectForm: React.FC<{
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}> = ({ onSubmit, onCancel }) => {
  const [reason, setReason] = useState('');
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18 }}
      className="space-y-3 overflow-hidden"
    >
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <p className="text-xs text-destructive font-medium mb-2">
          Describe why this plan should be rejected. The reason is recorded
          alongside the plan id and hash so the audit chain reflects the
          decision.
        </p>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Action 02 would touch the constitutional invariant freeze without an amendment."
          rows={4}
          data-testid="plan-reject-reason"
          className={cn(
            'w-full rounded-md border border-input bg-background px-3 py-2',
            'text-sm text-foreground placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
            'resize-none',
          )}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={!reason.trim()}
          data-testid="plan-reject-submit"
          onClick={() => onSubmit(reason.trim())}
        >
          <XCircle className="h-3.5 w-3.5 mr-1.5" />
          Submit rejection
        </Button>
      </div>
    </motion.div>
  );
};

// ── Secondary narrative pane ─────────────────────────────────────────

const SecondaryNarrative: React.FC<{ narrative: string | undefined }> = ({
  narrative,
}) => {
  const [open, setOpen] = useState(false);
  return (
    <section
      data-testid="plan-narrative-secondary"
      className="rounded-lg border border-dashed border-border bg-muted/10 overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground hover:bg-muted/30"
        aria-expanded={open}
        data-testid="plan-narrative-toggle"
      >
        <MessageSquareText className="h-3.5 w-3.5" />
        <span className="font-semibold">Agent narrative (secondary)</span>
        <Badge variant="outline" className="ml-auto text-[10px] font-mono">
          not an approval surface
        </Badge>
      </button>
      {open && (
        <div
          className="border-t border-border bg-background p-3 text-sm text-muted-foreground whitespace-pre-wrap"
          data-testid="plan-narrative-body"
        >
          {narrative && narrative.trim().length > 0 ? (
            narrative
          ) : (
            <span className="italic">
              No narrative supplied. (Acceptable — the structural diff is the
              load-bearing surface.)
            </span>
          )}
        </div>
      )}
    </section>
  );
};

// ── Plan header ──────────────────────────────────────────────────────

const PlanHeader: React.FC<{ plan: AgentPlan; planHash: string }> = ({
  plan,
  planHash,
}) => (
  <header
    className="flex flex-wrap items-center gap-3 pb-3 border-b border-border"
    data-testid="plan-header"
  >
    <GitCompare className="h-5 w-5 text-primary shrink-0" />
    <div className="flex-1 min-w-0">
      <h2 className="text-base font-semibold text-foreground leading-snug">
        Review agent plan
      </h2>
      <p className="text-xs text-muted-foreground mt-0.5">
        Approve via the structural diff. The agent narrative is a secondary,
        non-approval surface.
      </p>
    </div>
    <div className="flex flex-col items-end gap-1 text-[11px] font-mono">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span>plan</span>
        <span className="text-foreground" data-testid="plan-id">
          {plan.id}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Fingerprint className="h-3 w-3" />
        <span data-testid="plan-hash" title="Deterministic plan hash (FR-008)">
          {planHash}
        </span>
      </div>
    </div>
  </header>
);

// ── Top-level dialog ─────────────────────────────────────────────────

export const PlanReviewDialog: React.FC<PlanReviewDialogProps> = ({
  plan,
  certificateActual,
  onApprove,
  onReject,
  onDismiss,
  alreadyExecuted = false,
}) => {
  // Enrich once per plan identity so gate-impact / critical defaults
  // are populated for the renderers. Memo keeps the canonical hash
  // stable across re-renders (FR-008).
  const enrichedPlan = useMemo(() => enrichPlan(plan), [plan]);
  const planHash = useMemo(() => hashPlan(enrichedPlan), [enrichedPlan]);

  const [approval, setApproval] = useState<PlanApprovalState>(() =>
    createInitialApprovalState(enrichedPlan),
  );
  const [showReject, setShowReject] = useState(false);

  // If the plan identity changes (different proposal) we reset
  // approval state — partial acknowledgements cannot carry across.
  React.useEffect(() => {
    setApproval(createInitialApprovalState(enrichedPlan));
    setShowReject(false);
  }, [enrichedPlan]);

  const allAcknowledged = isPlanFullyAcknowledged(enrichedPlan, approval);
  const hasCertificateMismatch =
    certificateActual !== undefined &&
    enrichedPlan.certificatePrediction !== undefined &&
    JSON.stringify(
      enrichedPlan.certificatePrediction.stages.map((s) => [s.id, [...s.artifacts].sort()]),
    ) !==
      JSON.stringify(
        certificateActual.stages.map((s) => [s.id, [...s.artifacts].sort()]),
      );

  const approveDisabled =
    alreadyExecuted ||
    !allAcknowledged ||
    enrichedPlan.actions.length === 0 ||
    hasCertificateMismatch;

  const handleToggleAcknowledged = (actionId: string) => {
    setApproval((prev) => ({
      ...prev,
      acknowledgements: {
        ...prev.acknowledgements,
        [actionId]: !prev.acknowledgements[actionId],
      },
    }));
  };

  const ackedCount = enrichedPlan.actions.filter(
    (a) => approval.acknowledgements[a.id] === true,
  ).length;

  return (
    <AnimatePresence>
      <motion.div
        key="plan-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
        onClick={onDismiss}
        data-testid="plan-review-backdrop"
      />
      <motion.div
        key="plan-dialog"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        data-testid="plan-review-dialog"
        className={cn(
          'fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
          'w-full max-w-3xl rounded-xl border border-border bg-background shadow-2xl',
          'overflow-hidden flex flex-col max-h-[90vh]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          <PlanHeader plan={enrichedPlan} planHash={planHash} />

          <GateImpactSummary plan={enrichedPlan} />

          <PlanStructuralDiff diff={enrichedPlan.structuralDiff} />

          <PlanActionGraph
            plan={enrichedPlan}
            acknowledgements={approval.acknowledgements}
            onToggleAcknowledged={handleToggleAcknowledged}
          />

          {enrichedPlan.certificatePrediction && (
            <PlanCertificatePrediction
              prediction={enrichedPlan.certificatePrediction}
              actual={certificateActual}
            />
          )}

          <SecondaryNarrative narrative={enrichedPlan.narrative} />

          <AnimatePresence>
            {showReject && (
              <RejectForm
                onSubmit={(reason) => {
                  onReject(enrichedPlan.id, reason);
                  setShowReject(false);
                }}
                onCancel={() => setShowReject(false)}
              />
            )}
          </AnimatePresence>
        </div>

        <footer className="border-t border-border bg-muted/20 px-6 py-3 flex flex-wrap items-center gap-3">
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span data-testid="plan-acked-count">
              {ackedCount} / {enrichedPlan.actions.length} acknowledged
            </span>
            {!allAcknowledged && (
              <span className="font-mono text-amber-600 dark:text-amber-400">
                — traverse every action to enable approval
              </span>
            )}
            {hasCertificateMismatch && (
              <span
                className="font-mono text-amber-600 dark:text-amber-400"
                data-testid="plan-cert-mismatch-warning"
              >
                — certificate discrepancy; resolve before approving the next plan
              </span>
            )}
          </div>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="plan-reject-button"
              className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setShowReject((v) => !v)}
            >
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              Reject
            </Button>
            <Button
              size="sm"
              data-testid="plan-approve-button"
              disabled={approveDisabled}
              onClick={() => onApprove(enrichedPlan.id, planHash)}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Approve plan
            </Button>
          </div>
        </footer>
      </motion.div>
    </AnimatePresence>
  );
};
