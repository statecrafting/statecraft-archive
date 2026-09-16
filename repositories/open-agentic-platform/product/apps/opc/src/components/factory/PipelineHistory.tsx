// Spec: specs/076-factory-desktop-panel/spec.md
// Past pipeline run history and audit trail viewer (FR-008).

import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  Lock,
  RefreshCw,
  SkipForward,
  Play,
  Loader2,
  PlayCircle,
} from 'lucide-react';
import { Button } from '@opc/ui/button';
import { formatDistanceToNow, format } from 'date-fns';
import { cn } from '@/lib/utils';
import { apiCall } from '@/lib/apiAdapter';
import { useFactoryPipeline } from './FactoryPipelineContext';
import type { PipelineRun, AuditEntry, FactoryPhase } from './types';
import type { OpcBundle } from '@/types/factoryBundle';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatDuration(ms?: number): string {
  if (ms == null) return '—';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

function truncateRunId(runId: string): string {
  return runId.length > 12 ? runId.slice(0, 12) + '…' : runId;
}

// ── Status badge ─────────────────────────────────────────────────────────────

const PHASE_BADGE: Record<FactoryPhase, { label: string; className: string }> = {
  idle:        { label: 'Idle',        className: 'bg-muted text-muted-foreground' },
  process:     { label: 'Processing',  className: 'bg-blue-500/20 text-blue-400' },
  scaffolding: { label: 'Scaffolding', className: 'bg-blue-500/20 text-blue-400' },
  complete:    { label: 'Complete',    className: 'bg-green-500/20 text-green-400' },
  failed:      { label: 'Failed',      className: 'bg-red-500/20 text-red-400' },
  paused:      { label: 'Paused',      className: 'bg-amber-500/20 text-amber-400' },
};

const StatusBadge: React.FC<{ phase: FactoryPhase }> = ({ phase }) => {
  const { label, className } = PHASE_BADGE[phase] ?? PHASE_BADGE.idle;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        className,
      )}
    >
      {label}
    </span>
  );
};

// ── Audit action icons ────────────────────────────────────────────────────────

function AuditIcon({ action }: { action: AuditEntry['action'] }) {
  switch (action) {
    case 'stage_confirmed':
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-400" />;
    case 'stage_rejected':
      return <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />;
    case 'build_spec_frozen':
      return <Lock className="h-3.5 w-3.5 shrink-0 text-blue-400" />;
    case 'step_retried':
      return <RefreshCw className="h-3.5 w-3.5 shrink-0 text-amber-400" />;
    case 'step_skipped':
      return <SkipForward className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
    case 'pipeline_started':
      return <Play className="h-3.5 w-3.5 shrink-0 text-blue-400" />;
    case 'pipeline_completed':
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-400" />;
    case 'pipeline_failed':
      return <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />;
    default:
      return <Play className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  }
}

function auditActionLabel(action: AuditEntry['action']): string {
  switch (action) {
    case 'stage_confirmed':   return 'Stage confirmed';
    case 'stage_rejected':    return 'Stage rejected';
    case 'build_spec_frozen': return 'Build spec frozen';
    case 'step_retried':      return 'Step retried';
    case 'step_skipped':      return 'Step skipped';
    case 'pipeline_started':  return 'Pipeline started';
    case 'pipeline_completed': return 'Pipeline completed';
    case 'pipeline_failed':   return 'Pipeline failed';
    default:                  return action;
  }
}

// ── AuditTrail ────────────────────────────────────────────────────────────────

interface AuditTrailProps {
  entries: AuditEntry[];
}

const AuditTrail: React.FC<AuditTrailProps> = ({ entries }) => {
  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic px-1 py-2">
        No audit entries for this run.
      </p>
    );
  }

  return (
    <ol className="relative border-l border-border ml-1.5 space-y-0">
      {entries.map((entry, idx) => (
        <li key={idx} className="ml-4 pb-3 last:pb-0">
          {/* Timeline dot */}
          <span className="absolute -left-[7px] flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background border border-border">
            <AuditIcon action={entry.action} />
          </span>

          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-foreground">
                {auditActionLabel(entry.action)}
              </span>
              {entry.stageId && (
                <span className="text-xs text-muted-foreground font-mono">
                  [{entry.stageId}]
                </span>
              )}
            </div>
            {entry.details && (
              <p className="text-xs text-muted-foreground">{entry.details}</p>
            )}
            {entry.feedback && (
              <p className="text-xs text-amber-400/90 italic">
                &ldquo;{entry.feedback}&rdquo;
              </p>
            )}
            <time
              dateTime={entry.timestamp}
              className="text-[11px] text-muted-foreground/60"
              title={format(new Date(entry.timestamp), 'PPpp')}
            >
              {formatDistanceToNow(new Date(entry.timestamp), {
                addSuffix: true,
              })}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
};

// ── RunList ───────────────────────────────────────────────────────────────────

interface RunListProps {
  runs: PipelineRun[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}

const RunList: React.FC<RunListProps> = ({ runs, selectedRunId, onSelect }) => {
  if (runs.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic px-2 py-3">
        No pipeline runs found.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-1.5 px-2 font-medium">Run</th>
            <th className="text-left py-1.5 px-2 font-medium">Adapter</th>
            <th className="text-left py-1.5 px-2 font-medium">Started</th>
            <th className="text-left py-1.5 px-2 font-medium">Progress</th>
            <th className="text-left py-1.5 px-2 font-medium">Duration</th>
            <th className="text-left py-1.5 px-2 font-medium">Status</th>
            <th className="text-right py-1.5 px-2 font-medium">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const isSelected = run.runId === selectedRunId;
            const progressPct =
              run.stagesTotal > 0
                ? Math.round((run.stagesCompleted / run.stagesTotal) * 100)
                : 0;
            return (
              <tr
                key={run.runId}
                onClick={() => onSelect(run.runId)}
                className={cn(
                  'border-b border-border/50 cursor-pointer transition-colors',
                  isSelected
                    ? 'bg-accent/50'
                    : 'hover:bg-accent/20',
                )}
              >
                <td className="py-1.5 px-2 font-mono text-foreground/80">
                  {truncateRunId(run.runId)}
                </td>
                <td className="py-1.5 px-2 text-foreground/80 truncate max-w-[80px]">
                  {run.adapter || (
                    <span className="text-muted-foreground italic">—</span>
                  )}
                </td>
                <td className="py-1.5 px-2 text-muted-foreground">
                  <span
                    title={format(new Date(run.startedAt), 'PPpp')}
                  >
                    {formatDistanceToNow(new Date(run.startedAt), {
                      addSuffix: true,
                    })}
                  </span>
                </td>
                <td className="py-1.5 px-2 text-muted-foreground min-w-[140px]">
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums shrink-0">
                      {run.stagesCompleted}/{run.stagesTotal}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[40px]">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          progressPct === 100
                            ? 'bg-green-500'
                            : 'bg-blue-500/70',
                        )}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <span
                      className="truncate max-w-[120px] text-foreground/70"
                      title={run.lastCompletedStage ?? ''}
                    >
                      {run.lastCompletedStage ?? '—'}
                    </span>
                  </div>
                </td>
                <td className="py-1.5 px-2 text-muted-foreground font-mono tabular-nums">
                  {formatDuration(run.duration)}
                </td>
                <td className="py-1.5 px-2">
                  <StatusBadge phase={run.phase} />
                </td>
                <td className="py-1.5 px-2 text-right font-mono tabular-nums text-muted-foreground">
                  {formatTokens(run.totalTokens)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ── PipelineHistory ───────────────────────────────────────────────────────────

export const PipelineHistory: React.FC<{
  projectPath?: string;
  bundle?: OpcBundle;
}> = ({ projectPath, bundle }) => {
  const { state, loadPipelineStatus } = useFactoryPipeline();

  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [resumingRunId, setResumingRunId] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);

  // Load run list when projectPath changes. The Rust struct serializes its
  // fields as snake_case (no `#[serde(rename_all)]`), so we normalise into
  // the camelCase `PipelineRun` shape the rest of the panel expects.
  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await apiCall<any[]>('list_factory_runs', {
        projectPath: projectPath ?? '',
      });
      const mapped: PipelineRun[] = (raw ?? []).map((r) => ({
        runId: r.run_id ?? r.runId,
        // Normalise empty strings to null. Legacy manifest-only runs come back
        // with `adapter: ""` from Rust; downstream code uses `??` to fall back
        // to the bundle adapter, which only triggers on null/undefined.
        adapter: (r.adapter ?? '') || null,
        projectPath: r.project_path ?? r.projectPath ?? '',
        startedAt: r.started_at ?? r.startedAt ?? '',
        completedAt: r.completed_at ?? r.completedAt,
        duration:
          r.completed_at && r.started_at
            ? Math.max(
                0,
                new Date(r.completed_at).getTime() -
                  new Date(r.started_at).getTime(),
              )
            : undefined,
        phase: (r.phase ?? 'idle') as PipelineRun['phase'],
        totalTokens: r.total_tokens ?? r.totalTokens ?? 0,
        stagesCompleted: r.stages_completed ?? r.stagesCompleted ?? 0,
        stagesTotal: r.stages_total ?? r.stagesTotal ?? 6,
        lastCompletedStage:
          r.last_completed_stage ?? r.lastCompletedStage ?? null,
      }));
      setRuns(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load runs');
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Select a run — loads its full pipeline status into context.
  const handleSelectRun = useCallback(
    async (runId: string) => {
      if (runId === selectedRunId) {
        // Toggle deselect.
        setSelectedRunId(null);
        return;
      }
      setSelectedRunId(runId);
      setLoadingRun(true);
      try {
        const run = runs.find((r) => r.runId === runId);
        await loadPipelineStatus(runId, run?.projectPath ?? projectPath);
      } finally {
        setLoadingRun(false);
      }
    },
    [selectedRunId, loadPipelineStatus, runs, projectPath],
  );

  // Use the audit trail from the currently-loaded context state, which was
  // populated by loadPipelineStatus for the selected run.
  const auditEntries = selectedRunId != null ? state.auditTrail : [];

  const selectedRun = runs.find((r) => r.runId === selectedRunId) ?? null;
  const adapterName = selectedRun?.adapter ?? bundle?.adapter?.name ?? null;
  // `list_factory_runs` returns an empty `projectPath` for platform-projected
  // runs (they carry no local filesystem path, only a statecraft UUID that must
  // never be treated as a path). Normalise empties so the value falls back to
  // the open project's real clone path; when neither is a real path, treat the
  // run as needing a local clone rather than firing Resume against nothing.
  const resumeProjectPath =
    selectedRun?.projectPath?.trim() || projectPath?.trim() || null;
  const resumablePhase =
    selectedRun != null &&
    selectedRun.phase !== 'complete' &&
    adapterName != null;
  const canResume = resumablePhase && resumeProjectPath != null;
  const needsLocalClone = resumablePhase && resumeProjectPath == null;

  const handleResume = useCallback(async () => {
    if (selectedRunId == null || !canResume) return;
    setResumeError(null);
    setResumingRunId(selectedRunId);
    try {
      await apiCall<void>('resume_factory_pipeline', {
        runId: selectedRunId,
        projectPath: resumeProjectPath,
        adapterName,
        statecraftProjectId: bundle?.project?.id ?? null,
      });
    } catch (err) {
      // Tauri's `invoke` rejects with the raw string returned by the Rust
      // `Result::Err` branch — not an `Error` instance — so we must accept
      // both shapes or the user only sees the generic fallback message.
      setResumeError(
        typeof err === 'string'
          ? err
          : err instanceof Error
            ? err.message
            : 'Resume failed',
      );
    } finally {
      setResumingRunId(null);
    }
  }, [
    selectedRunId,
    canResume,
    resumeProjectPath,
    adapterName,
    bundle?.project?.id,
  ]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Run list ─────────────────────────────────────────────────────── */}
      <div className="flex-none border-b border-border px-3 py-2">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pipeline Runs
          </h3>
          <button
            onClick={fetchRuns}
            disabled={loading}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="Refresh run list"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {error != null && (
          <p className="text-xs text-red-400 mb-2">{error}</p>
        )}

        <div className="max-h-52 overflow-y-auto">
          <RunList
            runs={runs}
            selectedRunId={selectedRunId}
            onSelect={handleSelectRun}
          />
        </div>
      </div>

      {/* ── Audit trail ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {selectedRunId == null ? (
          <p className="text-xs text-muted-foreground italic">
            Select a run to view its audit trail.
          </p>
        ) : loadingRun ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Audit Trail
                <span className="ml-1.5 font-mono font-normal normal-case text-muted-foreground/60">
                  {truncateRunId(selectedRunId)}
                </span>
              </h3>
              {canResume ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={resumingRunId === selectedRunId}
                  onClick={handleResume}
                  title={`Resume run from the last completed stage using adapter ${adapterName}`}
                >
                  {resumingRunId === selectedRunId ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <PlayCircle className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Resume
                </Button>
              ) : needsLocalClone ? (
                <span
                  className="text-xs text-muted-foreground italic"
                  title="This run exists on the platform but has no local clone on this machine. Clone the project locally (Open in OPC, then Clone locally) to resume it."
                >
                  Clone locally to resume
                </span>
              ) : null}
            </div>
            {resumeError != null && (
              <p className="text-xs text-red-400 mb-2">{resumeError}</p>
            )}
            <AuditTrail entries={auditEntries} />
          </>
        )}
      </div>
    </div>
  );
};
