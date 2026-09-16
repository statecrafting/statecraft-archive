// Spec: specs/076-factory-desktop-panel/spec.md
// Spec 112 §6.3 — bundle prop carries the statecraft handoff context.
// Top-level Factory pipeline panel registered in TabContent.
//
// Spec 171: the panel also renders the PlanReviewDialog when an
// agent-proposed plan is pending review. The dialog is the primary
// action surface for plan approval; the structural diff + action
// graph leads, the agent narrative is demoted to a collapsed pane.

import React, { useCallback, useState } from 'react';
import { FolderOpen, History, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@opc/ui/badge';
import { Button } from '@opc/ui/button';
import type { OpcBundle } from '@/types/factoryBundle';
import { FactoryPipelineProvider, useFactoryPipeline } from './FactoryPipelineContext';
import { PipelineSelector } from './PipelineSelector';
import { PipelineDAG } from './PipelineDAG';
import { TokenDashboard } from './TokenDashboard';
import { ArtifactInspector } from './ArtifactInspector';
import { GateDialog } from './GateDialog';
import { ScaffoldMonitor } from './ScaffoldMonitor';
import { PipelineHistory } from './PipelineHistory';
import { ProjectContextOverview } from './ProjectContextOverview';
import { FactoryProjectPicker } from './FactoryProjectPicker';
import { LiveAgentOutput } from './LiveAgentOutput';
import { PlanReviewDialog } from './PlanReviewDialog';

// ── Status badge ─────────────────────────────────────────────────────────────

const PHASE_BADGE_VARIANT: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  idle: 'outline',
  process: 'default',
  scaffolding: 'default',
  complete: 'secondary',
  failed: 'destructive',
  paused: 'outline',
};

const PHASE_LABEL: Record<string, string> = {
  idle: 'Idle',
  process: 'Processing',
  scaffolding: 'Scaffolding',
  complete: 'Complete',
  failed: 'Failed',
  paused: 'Paused',
};

type PanelView = 'pipeline' | 'history';

// ── Inner panel (unwrapped from provider) ────────────────────────────────────

function FactoryPipelinePanelInner({
  projectPath,
  bundle,
  onOpenProject,
}: {
  projectPath?: string;
  bundle?: OpcBundle;
  onOpenProject: (path: string, bundle: OpcBundle) => void;
}) {
  const {
    state,
    agentOutput,
    proposedPlan,
    certificateActual,
    approvePlan,
    rejectPlan,
    dismissPlan,
  } = useFactoryPipeline();
  const [view, setView] = useState<PanelView>('pipeline');
  const [showPicker, setShowPicker] = useState(false);

  const phaseVariant = PHASE_BADGE_VARIANT[state.phase] ?? 'outline';
  const phaseLabel = PHASE_LABEL[state.phase] ?? state.phase;

  const showScaffoldMonitor = state.phase === 'scaffolding' && state.scaffolding !== null;
  // Active pipelines own the panel — switching projects mid-run would orphan
  // the running orchestrator and tangle artifact persistence. Block the swap
  // until the run reaches a terminal phase (idle / complete / failed / paused).
  const pipelineActive = state.phase === 'process' || state.phase === 'scaffolding';
  // Phase 1 (process) gets a terminal-style live output panel in the right
  // pane. We also keep it visible on 'failed' so any output that streamed
  // before the crash survives, and so the failure banner has somewhere to
  // anchor. Scaffolding already shows its own LiveAgentOutput inside
  // ScaffoldMonitor, so we only wire it up here for the pre-scaffold stages.
  const showLiveOutput = state.phase === 'process' || state.phase === 'failed';
  const activeStepId =
    state.stages.find((s) => s.status === 'in_progress')?.id ?? null;
  // Last failure recorded in the audit trail — surfaced as a banner above
  // the live output when phase === 'failed'. The orchestrator emits its
  // OrchestratorError into `details`; the entry timestamp tells the user
  // when the run died.
  const lastFailure =
    state.phase === 'failed'
      ? [...state.auditTrail]
          .reverse()
          .find((e) => e.action === 'pipeline_failed')
      : undefined;

  const handleOpenedFromPicker = useCallback(
    (path: string, nextBundle: OpcBundle) => {
      setShowPicker(false);
      onOpenProject(path, nextBundle);
    },
    [onOpenProject],
  );

  return (
    <div className="h-full flex flex-col text-foreground relative">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0">
        <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
        <h1 className="text-sm font-semibold flex-1 flex items-center gap-2 min-w-0">
          <span className="shrink-0">Factory Pipeline</span>
          {bundle && (
            <span
              className="font-mono text-xs text-muted-foreground truncate"
              title={`${bundle.project.name} (${bundle.project.slug})`}
            >
              · {bundle.project.slug}
            </span>
          )}
          {bundle?.adapter && (
            <Badge
              variant="outline"
              className="text-[10px] font-mono shrink-0"
              title={`Adapter ${bundle.adapter.name} v${bundle.adapter.version}`}
            >
              {bundle.adapter.name}
            </Badge>
          )}
        </h1>
        {state.runId && (
          <span
            className="font-mono text-xs text-muted-foreground truncate max-w-[160px]"
            title={state.runId}
          >
            {state.runId.slice(0, 12)}…
          </span>
        )}
        <Badge variant={phaseVariant} className="shrink-0 text-xs">
          {phaseLabel}
        </Badge>
        {bundle && (
          <Button
            variant={showPicker ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => setShowPicker((v) => !v)}
            disabled={pipelineActive}
            title={
              pipelineActive
                ? 'Cannot switch project while a pipeline is running'
                : 'Switch project…'
            }
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant={view === 'history' ? 'secondary' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => setView(view === 'history' ? 'pipeline' : 'history')}
          title="Pipeline history"
        >
          <History className="h-3.5 w-3.5" />
        </Button>
      </header>

      {/* View: History */}
      {view === 'history' && (
        <div className="flex-1 min-h-0 overflow-auto">
          <PipelineHistory projectPath={projectPath} bundle={bundle} />
        </div>
      )}

      {/* View: Pipeline */}
      {view === 'pipeline' && (
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Left pane — ~40% */}
          <div
            className={cn(
              'flex flex-col border-r border-border overflow-hidden',
              'w-[40%] min-w-[220px] max-w-[360px]',
            )}
          >
            {/* Selector at top */}
            <PipelineSelector projectPath={projectPath} bundle={bundle} />

            {/* DAG fills remaining height */}
            <PipelineDAG />

            {/* Token dashboard pinned to bottom */}
            <TokenDashboard compact />
          </div>

          {/* Right pane — ~60% */}
          <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
            {/* Scaffold monitor shown during scaffolding phase */}
            {showScaffoldMonitor && (
              <div className="border-b border-border shrink-0 max-h-[40%] overflow-auto">
                <ScaffoldMonitor />
              </div>
            )}

            {/* Right-pane content stack. Priority:
                  1. Selected step → ArtifactInspector
                  2. User toggled picker OR no bundle → FactoryProjectPicker
                  3. Phase 1 active → LiveAgentOutput (terminal-style)
                  4. Bundle present, idle/terminal phase → ProjectContextOverview
                The Phase 1 terminal slots in only when the pipeline is
                actually running so we don't replace the project overview the
                user expects to see between runs. */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {state.selectedStepId !== null ? (
                <ArtifactInspector />
              ) : showPicker || !bundle ? (
                <FactoryProjectPicker
                  onOpened={handleOpenedFromPicker}
                  activeProjectId={bundle?.project?.id}
                  onCancel={bundle ? () => setShowPicker(false) : undefined}
                  variant="fullscreen"
                />
              ) : showLiveOutput ? (
                <div className="flex-1 min-h-0 p-3 flex flex-col gap-3">
                  {lastFailure && (
                    <div
                      className="shrink-0 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
                      role="alert"
                    >
                      <div className="font-semibold mb-1">Pipeline failed</div>
                      <div className="font-mono whitespace-pre-wrap break-words">
                        {lastFailure.details ?? '(no detail recorded)'}
                      </div>
                      <div className="mt-1 opacity-70">
                        {lastFailure.timestamp}
                      </div>
                    </div>
                  )}
                  <div className="flex-1 min-h-0">
                    <LiveAgentOutput
                      lines={agentOutput}
                      activeStepId={activeStepId}
                      fill
                    />
                  </div>
                </div>
              ) : (
                <ProjectContextOverview bundle={bundle} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Gate dialog overlay */}
      {state.gateAction !== null && <GateDialog />}

      {/* Spec 171 — Plan review overlay (primary action surface for
          agent-proposed plans). Renders only when a plan is pending;
          the dialog itself enforces approval-via-traversal. */}
      {proposedPlan !== null && (
        <PlanReviewDialog
          plan={proposedPlan}
          certificateActual={certificateActual ?? undefined}
          onApprove={approvePlan}
          onReject={rejectPlan}
          onDismiss={dismissPlan}
        />
      )}
    </div>
  );
}

// ── Public export (wraps provider) ───────────────────────────────────────────

export interface FactoryPipelinePanelProps {
  projectPath?: string;
  bundle?: OpcBundle;
  /**
   * Called when the user opens a project from the in-panel picker. The
   * caller (TabContent) updates the surrounding factory tab so the panel
   * re-renders with the new bundle/projectPath. When this prop is omitted
   * the picker still resolves+clones but the parent tab will not update —
   * useful only for tests.
   */
  onOpenProject?: (path: string, bundle: OpcBundle) => void;
}

export const FactoryPipelinePanel: React.FC<FactoryPipelinePanelProps> = ({
  projectPath,
  bundle,
  onOpenProject,
}) => {
  // Re-key the provider on the active project id so switching projects gives
  // the pipeline state a clean slate (run id, stage tracker, audit trail).
  // Without this, a stale runId from the previous project would leak into the
  // header even though the bundle and projectPath have already changed.
  const providerKey = bundle?.project?.id ?? 'no-project';
  return (
    <FactoryPipelineProvider key={providerKey}>
      <FactoryPipelinePanelInner
        projectPath={projectPath}
        bundle={bundle}
        onOpenProject={onOpenProject ?? (() => {})}
      />
    </FactoryPipelineProvider>
  );
};
